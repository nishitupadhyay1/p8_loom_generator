// Live checks without geometry (Phase 0 step 3). Pure functions: project + library -> issues.
// Bend radius and the 35 mm termination straight need geometry and come in step 7.
import { resolveRef, generatedMarking, packOfNumber } from "./project.js";
import { voltageClassOf } from "./library.js";
import { routeWire } from "./geometry.js";

export const LEVELS = ["error", "warning", "note"];

const key = (ref) => `${ref.tag}|${ref.connector}|${ref.terminal}`;
const label = (ref, r) => `${ref.tag}${r?.connector && r.connector.id !== "-" ? " " + r.connector.id : ""} ${r?.terminal?.id ?? ref.terminal}`;

function wireType(lib, w) { return lib.wireTypes.find((t) => t.id === w.type) ?? null; }
const isCable = (t) => (t?.kind ?? "single") === "cable";

/**
 * Returns issues: { id, level, code, wire?, point?, msg }.
 * `id` is stable (code + target), so an accepted exception can be matched to it.
 */
export function runChecks(prj, lib) {
  const issues = [];
  const add = (level, code, target, msg, extra = {}) => issues.push({ id: `${code}:${target}`, level, code, msg, ...extra });

  const packs = new Map(prj.packs.map((p) => [p.id, p]));
  const colours = new Set(lib.colours.map((c) => c.code));
  const stockAs = new Map(lib.colours.map((c) => [c.code, c.stockAs ?? c.code]));
  const blocked = new Set(lib.rules.blockedColours);
  const sizeRule = lib.rules.sizeRule?.[prj.variant];
  const reservations = new Map((prj.reservations ?? []).map((r) => [key(r), r]));

  // Terminal usage: key -> [{ wire, end, r }]
  const usage = new Map();
  const ids = new Map();

  for (const w of prj.wires) {
    ids.set(w.id, (ids.get(w.id) ?? 0) + 1);
    const pack = packs.get(w.pack);
    const t = wireType(lib, w);

    // Missing or unknown fields
    if (!pack) add("error", "PACK", w.id, `${w.id}: pack "${w.pack}" is not in the project`, { wire: w.id });
    if (!w.function) add("error", "MISSING", `${w.id}:function`, `${w.id}: function is blank`, { wire: w.id });
    if (!w.type) add("error", "MISSING", `${w.id}:type`, `${w.id}: size / type is blank`, { wire: w.id });
    else if (!t) add("error", "TYPE", w.id, `${w.id}: size "${w.type}" is not a wire type in the library`, { wire: w.id });
    if (!w.colour) add("error", "MISSING", `${w.id}:colour`, `${w.id}: colour is blank`, { wire: w.id });
    else if (blocked.has(w.colour)) add("error", "COLOUR", w.id, `${w.id}: ${w.colour} is reserved for earth bonding`, { wire: w.id });
    else if (!colours.has(w.colour)) add("error", "COLOUR", w.id, `${w.id}: colour "${w.colour}" is not in the library colour list`, { wire: w.id });
    else if (t && !isCable(t)) {
      if (!Array.isArray(t.stock)) add("note", "STOCK", w.id, `${w.id}: stock colours for ${t.id} mm² not confirmed – not checked`, { wire: w.id });
      else if (!t.stock.includes(stockAs.get(w.colour)))
        add("warning", "STOCK", w.id, `${w.id}: ${stockAs.get(w.colour)} is not on the stock list for ${t.id} mm²`, { wire: w.id });
    }

    // Wire number inside its pack's range
    if (pack) {
      const inPack = packOfNumber({ packs: [pack] }, w.id);
      if (!inPack) {
        const { prefix, from, to, digits = 2 } = pack.wireRange;
        const f = (n) => prefix + String(n).padStart(digits, "0");
        add("error", "RANGE", w.id, `${w.id}: outside the ${pack.id} range ${f(from)}–${f(to)}`, { wire: w.id });
      }
    }

    // Size rule (F3: an error)
    if (t && !isCable(t)) {
      if (!sizeRule || sizeRule.default === null || sizeRule.default === undefined)
        add("note", "SIZE-RULE", w.id, `${w.id}: no wire size rule for ${prj.variant} in the library – size not checked`, { wire: w.id });
      else if (t.size !== sizeRule.default)
        add("error", "SIZE-RULE", w.id, `${w.id}: ${t.size} mm² breaks the ${prj.variant} size rule (${sizeRule.default} mm²)`, { wire: w.id });
    }

    // Voltage class of the pack (default ELV)
    const packClass = pack?.voltageClass ?? "ELV";

    // Ends
    for (const [endName, ref] of [["from", w.from], ["to", w.to]]) {
      const r = resolveRef(prj, lib, ref);
      if (!r.terminal) {
        add("error", "END", `${w.id}:${endName}`, `${w.id}: ${endName} end not found in the library (${ref?.raw ? `${ref.raw.unit} ${ref.raw.terminal}` : "not set"})`, { wire: w.id });
        continue;
      }
      const k = key(ref);
      if (!usage.has(k)) usage.set(k, []);
      usage.get(k).push({ wire: w, end: endName, r, ref });

      const vc = voltageClassOf(r.connector, r.terminal);
      if (vc && vc !== packClass)
        add("error", "VOLTAGE", `${w.id}:${endName}`, `${w.id}: ${label(ref, r)} is ${vc}, but pack ${w.pack} is ${packClass}`, { wire: w.id });

      // Accepted size range of the terminal
      if (t && !isCable(t) && r.connector.termination !== "rj45") {
        const acc = r.connector.accepts;
        if (!acc) add("note", "ACCEPTS", `${w.id}:${endName}`, `${w.id}: accepted sizes of ${label(ref, r)} not confirmed – not checked`, { wire: w.id });
        else if ((acc.min !== undefined && t.size < acc.min) || (acc.max !== undefined && t.size > acc.max))
          add("error", "ACCEPTS", `${w.id}:${endName}`, `${w.id}: ${t.size} mm² is outside ${label(ref, r)} range ${acc.min}–${acc.max} mm²`, { wire: w.id });
      }
    }

    // Route and length (step 7): bend radius and termination straight need geometry
    const route = routeWire(prj, lib, w);
    if (!route.ok) add("note", "LENGTH", w.id, `${w.id}: length not estimated – ${route.reason}`, { wire: w.id });
    else {
      // On approximate geometry (unconfirmed terminal position, exit or envelope) a bend problem is a note, not an error.
      for (const p of route.problems) add(route.approx ? "note" : "error", p.code, `${w.id}:${p.msg}`, `${w.id}: ${p.msg}${route.approx ? " (approximate geometry)" : ""}`, { wire: w.id });
      if (route.approx) add("note", "APPROX", w.id, `${w.id}: length is approximate – a terminal position, exit direction or envelope is unconfirmed`, { wire: w.id });
    }

    if (w.from?.tag && w.to?.tag && key(w.from) === key(w.to)) add("error", "SAME-END", w.id, `${w.id}: both ends are the same terminal`, { wire: w.id });

    // Marking
    const gen = generatedMarking(prj, lib, w);
    if (w.markingOverride && gen && w.markingOverride !== gen)
      add("warning", "MARKING", w.id, `${w.id}: typed marking "${w.markingOverride}" differs from generated "${gen}"`, { wire: w.id });
  }

  for (const [id, n] of ids) if (n > 1) add("error", "DUPLICATE", id, `${id}: wire number used ${n} times`, { wire: id });

  // Duplicate connections (same pair of terminals twice)
  const pairs = new Map();
  for (const w of prj.wires) {
    if (!w.from?.terminal || !w.to?.terminal) continue;
    const p = [key(w.from), key(w.to)].sort().join(" ~ ");
    if (pairs.has(p)) add("warning", "DUP-LINK", `${pairs.get(p)}+${w.id}`, `${pairs.get(p)} and ${w.id} join the same two terminals`, { wire: w.id });
    else pairs.set(p, w.id);
  }

  // Per terminal: capacity, twin ferrules, Rule 6 (add-ons only on free points), reservations
  const maxWires = lib.rules.maxWiresPerTerminal;
  const basePacks = new Set(prj.packs.filter((p) => p.role === "base").map((p) => p.id));
  const baseTags = new Set(prj.wires.filter((w) => basePacks.has(w.pack)).flatMap((w) => [w.from?.tag, w.to?.tag]));

  for (const [k, uses] of usage) {
    const { r, ref } = uses[0];
    const pt = label(ref, r);
    const wago = r.connector.termination === "wago";
    const rj45 = r.connector.termination === "rj45";
    const wires = uses.map((u) => u.wire.id).join(", ");

    if (!wago && !rj45) {
      if (uses.length > maxWires) add("error", "CAPACITY", pt, `${pt}: ${uses.length} wires (${wires}); at most ${maxWires} per terminal`, { point: pt, wire: uses[0].wire.id });
      if (uses.length === 2) {
        const tw = r.connector.twin;
        const [a, b] = uses.map((u) => wireType(lib, u.wire));
        if (a && b && !isCable(a) && !isCable(b) && a.size !== b.size)
          add("error", "TWIN-SIZE", pt, `${pt}: twin ferrule mixes ${a.size} and ${b.size} mm² (${wires}) – same size only (F1)`, { point: pt, wire: uses[0].wire.id });
        if (!tw) add("note", "TWIN", pt, `${pt}: twin-ferrule limits not confirmed (${wires}) – not checked`, { point: pt, wire: uses[0].wire.id });
        else if (tw.allowed === false) add("error", "TWIN", pt, `${pt}: twin ferrules not allowed (${wires})`, { point: pt, wire: uses[0].wire.id });
        else for (const s of [a, b]) {
          if (!s || isCable(s)) continue;
          if ((tw.minEach !== undefined && s.size < tw.minEach) || (tw.maxEach !== undefined && s.size > tw.maxEach))
            add("error", "TWIN", `${pt}:${s.size}`, `${pt}: ${s.size} mm² is outside the twin-ferrule range ${tw.minEach ?? 0}–${tw.maxEach ?? "∞"} mm² each (${wires})`, { point: pt, wire: uses[0].wire.id });
        }
      }
    }

    // Reserved points and Rule 6
    const res = reservations.get(k);
    const usePacks = new Set(uses.map((u) => u.wire.pack));
    if (res) {
      const allowed = new Set(String(res.packs ?? "").split(";").map((s) => s.trim()).filter(Boolean));
      for (const u of uses) {
        if (!allowed.has(u.wire.pack))
          add("error", "RESERVED", `${pt}:${u.wire.id}`, `${pt} is reserved (${res.reservedFor}; ${res.who}) – ${u.wire.id} in ${u.wire.pack} must not land here`, { point: pt, wire: u.wire.id });
      }
    } else {
      for (const u of uses) {
        if (basePacks.has(u.wire.pack)) continue;
        // An add-on wire on a device the base loom wires must land on a pre-allocated point.
        if (baseTags.has(ref.tag) && !wago)
          add("error", "RULE6", `${pt}:${u.wire.id}`, `${pt}: ${u.wire.id} (${u.wire.pack}) lands on a base-loom device at a point that is not pre-allocated (Rule 6)`, { point: pt, wire: u.wire.id });
      }
    }
    if (usePacks.size > 1 && !wago)
      add("error", "RULE6-TWIN", pt, `${pt}: wires from different packs share one terminal (${wires}) – twin ferrules only inside one loom (Rule 6)`, { point: pt, wire: uses[0].wire.id });
  }

  // Daisy chains: wires joined through shared terminals must be one size (F1)
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => parent.set(find(a), find(b));
  for (const w of prj.wires) parent.set(w.id, w.id);
  for (const uses of usage.values()) {
    if (uses[0].r.connector.termination === "wago" || uses[0].r.connector.termination === "rj45") continue;
    for (const u of uses.slice(1)) union(uses[0].wire.id, u.wire.id);
  }
  const chains = new Map();
  for (const w of prj.wires) { const root = find(w.id); if (!chains.has(root)) chains.set(root, []); chains.get(root).push(w); }
  for (const chain of chains.values()) {
    if (chain.length < 2) continue;
    const sizes = new Set(chain.map((w) => wireType(lib, w)).filter((t) => t && !isCable(t)).map((t) => t.size));
    if (sizes.size > 1)
      add("error", "CHAIN-SIZE", chain.map((w) => w.id).join("+"), `Daisy chain ${chain.map((w) => w.id).join(" → ")} mixes ${[...sizes].join(" and ")} mm² – one size throughout (F1)`, { wire: chain[0].id });
  }

  // Accepted exceptions
  const accepted = new Map((prj.exceptions ?? []).map((e) => [e.id, e]));
  for (const i of issues) if (accepted.has(i.id)) { i.accepted = accepted.get(i.id); }

  // Most serious first: accepted last, then level, then the check (size-rule last: one per wire, easy to bulk-fix).
  const order = { error: 0, warning: 1, note: 2 };
  const codeOrder = ["END", "BEND", "STRAIGHT", "BEND-RULE", "DUPLICATE", "SAME-END", "CAPACITY", "TWIN-SIZE", "TWIN", "CHAIN-SIZE", "RULE6-TWIN", "RESERVED", "RULE6",
    "VOLTAGE", "ACCEPTS", "RANGE", "PACK", "TYPE", "COLOUR", "MISSING", "MARKING", "DUP-LINK", "STOCK", "SIZE-RULE"];
  const ci = (c) => { const i = codeOrder.indexOf(c); return i < 0 ? 99 : i; };
  issues.sort((a, b) => (!!a.accepted - !!b.accepted) || order[a.level] - order[b.level] || ci(a.code) - ci(b.code)
    || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return issues;
}

export function countIssues(issues) {
  const c = { error: 0, warning: 0, note: 0, accepted: 0 };
  for (const i of issues) i.accepted ? c.accepted++ : c[i.level]++;
  return c;
}
