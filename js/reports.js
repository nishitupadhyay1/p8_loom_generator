// Generated tables and exports (Phase 0 step 4). Everything here is derived from the project.
import { APP_VERSION } from "./version.js";
import { resolveRef, markingOf } from "./project.js";
import { lengthUsed } from "./geometry.js";
import { runChecks } from "./checks.js";
import { toCsv } from "./csv.js";

const key = (r) => `${r.tag}|${r.connector}|${r.terminal}`;
export const pointName = (ref) => `${ref.tag}${ref.connector && ref.connector !== "-" ? " " + ref.connector : ""} ${ref.terminal}`;
const wireType = (lib, w) => lib.wireTypes.find((t) => t.id === w.type) ?? null;
const sizeText = (lib, w) => { const t = wireType(lib, w); return !t ? w.type || "" : (t.kind ?? "single") === "cable" ? "Cat" : String(t.size); };

function terminalUse(prj) {
  const m = new Map();
  for (const w of prj.wires) for (const ref of [w.from, w.to]) {
    if (!ref?.terminal) continue;
    const k = key(ref);
    if (!m.has(k)) m.set(k, { ref, wires: [] });
    m.get(k).wires.push(w);
  }
  return m;
}

// ---- Rev C schedule rows for one pack
export const SCHEDULE_COLUMNS = ["Wire", "Dwg", "From", "From terminal", "To", "To terminal", "Function", "Size (mm²)", "Colour", "Marking", "Length (mm)"];

function endCells(prj, lib, ref) {
  const r = resolveRef(prj, lib, ref);
  if (!r.terminal) return [ref?.raw?.unit ?? "", ref?.raw?.terminal ?? ""];
  const unit = `${ref.tag}${r.connector.id !== "-" ? " " + r.connector.id : ""}`;
  const t = r.terminal;
  return [unit, t.name && t.name !== t.id ? `${t.id} ${t.name}` : t.id];
}

export function scheduleRows(prj, lib, packId) {
  const pack = prj.packs.find((p) => p.id === packId);
  return prj.wires.filter((w) => w.pack === packId).map((w) => {
    const L = lengthUsed(prj, lib, w);
    const lenCell = L.length !== null ? String(L.length) : (/^EL/.test(L.source) ? "EL" : "TBC");
    return {
      cells: [w.id, pack?.drawing ?? "", ...endCells(prj, lib, w.from), ...endCells(prj, lib, w.to), w.function, sizeText(lib, w), w.colour,
        markingOf(prj, lib, w) ?? "", lenCell],
      length: L,
      wire: w,
    };
  });
}

// ---- Free and reserved points; add-on landing list
export function reservedPointsTable(prj) {
  const use = terminalUse(prj);
  return (prj.reservations ?? []).map((r) => {
    const u = use.get(key(r));
    return { point: pointName(r), packs: r.packs, reservedFor: r.reservedFor, who: r.who,
      used: u ? u.wires.map((w) => `${w.id} (${w.pack})`).join(", ") : "" };
  });
}

export function landingList(prj, packId) {
  const use = terminalUse(prj);
  return (prj.reservations ?? [])
    .filter((r) => String(r.packs ?? "").split(";").map((s) => s.trim()).includes(packId))
    .map((r) => {
      const u = use.get(key(r));
      return { point: pointName(r), reservedFor: r.reservedFor, wires: u ? u.wires.filter((w) => w.pack === packId).map((w) => w.id).join(", ") : "" };
    });
}

// ---- Shared terminals and daisy chains (within one pack)
export function sharedTerminals(prj, lib, packId) {
  const out = [];
  for (const { ref, wires } of terminalUse(prj).values()) {
    const ws = wires.filter((w) => !packId || w.pack === packId);
    if (ws.length < 2) continue;
    const r = resolveRef(prj, lib, ref);
    out.push({ point: pointName(ref), wires: ws.map((w) => w.id).join(", "), sizes: ws.map((w) => sizeText(lib, w)).join(" + "), termination: r.connector?.termination ?? "ferrule" });
  }
  return out.sort((a, b) => a.point.localeCompare(b.point, undefined, { numeric: true }));
}

export function daisyChains(prj, packId) {
  const ws = prj.wires.filter((w) => !packId || w.pack === packId);
  const adj = new Map(ws.map((w) => [w.id, new Set()]));
  const use = new Map();
  for (const w of ws) for (const ref of [w.from, w.to]) {
    if (!ref?.terminal) continue;
    const k = key(ref);
    if (!use.has(k)) use.set(k, []);
    use.get(k).push(w.id);
  }
  for (const ids of use.values()) for (const a of ids) for (const b of ids) if (a !== b) adj.get(a).add(b);
  const seen = new Set();
  const chains = [];
  for (const w of ws) {
    if (seen.has(w.id) || !adj.get(w.id).size) continue;
    const stack = [w.id];
    const ids = [];
    while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); ids.push(x); for (const y of adj.get(x)) stack.push(y); }
    chains.push(ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  }
  return chains;
}

// ---- Ferrule and end-fitting counts per pack
export function ferruleCounts(prj, lib, packId) {
  const counts = new Map();
  const bump = (k) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const { ref, wires } of terminalUse(prj).values()) {
    const ws = wires.filter((w) => w.pack === packId);
    if (!ws.length) continue;
    const r = resolveRef(prj, lib, ref);
    const term = r.connector?.termination ?? "ferrule";
    if (term === "rj45") { bump("RJ45 plug (made-up cable)"); continue; }
    if (term === "spade") { for (const w of ws) bump(`Insulated female spade, ${sizeText(lib, w)} mm²`); continue; }
    if (ws.length === 2 && term !== "wago") bump(`Twin-entry ferrule 2 × ${sizeText(lib, ws[0])} mm²`);
    else for (const w of ws) bump(`Bootlace ferrule ${sizeText(lib, w)} mm²`);
  }
  return [...counts.entries()].sort().map(([item, qty]) => ({ item, qty }));
}

// ---- Totals per size and colour
export function lengthTotals(prj, lib, packId) {
  const m = new Map();
  for (const row of scheduleRows(prj, lib, packId)) {
    const k = `${sizeText(lib, row.wire)}|${row.wire.colour}`;
    if (!m.has(k)) m.set(k, { size: sizeText(lib, row.wire), colour: row.wire.colour, wires: 0, length: 0, unknown: 0 });
    const t = m.get(k);
    t.wires++;
    if (row.length.length !== null) t.length += row.length.length; else t.unknown++;
  }
  return [...m.values()].sort((a, b) => a.size.localeCompare(b.size) || a.colour.localeCompare(b.colour));
}

// ---- Exports
export function scheduleCsv(prj, lib, packId) {
  return toCsv([SCHEDULE_COLUMNS, ...scheduleRows(prj, lib, packId).map((r) => r.cells)]);
}

const mdCell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const mdTable = (headers, rows) => [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`)].join("\n");
const yq = (s) => `"${String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function scheduleMarkdown(prj, lib, packId) {
  const pack = prj.packs.find((p) => p.id === packId);
  const today = new Date().toISOString().slice(0, 10);
  const rows = scheduleRows(prj, lib, packId);
  const issues = runChecks(prj, lib).filter((i) => !i.accepted && i.level !== "note" && (!i.wire || prj.wires.find((w) => w.id === i.wire)?.pack === packId));
  const accepted = runChecks(prj, lib).filter((i) => i.accepted && (!i.wire || prj.wires.find((w) => w.id === i.wire)?.pack === packId));
  const author = prj.author ?? {};
  const md = [];
  md.push("---",
    `title: ${yq(`${pack.drawing} – Loom Connection Schedule`)}`,
    `doc_number: ${yq(pack.drawing)}`,
    `date: ${today}`,
    "status: DRAFT",
    "classification: Company Confidential",
    "author:", `  name: ${yq(author.name || "TBC")}`, `  title: ${yq(author.title || "TBC")}`,
    "approver:", "  name: TBC", "  title: TBC",
    "revisions:", `  - rev: ${yq(pack.rev || "TBC")}`, `    date: ${today}`, `    author: ${yq(author.name || "TBC")}`, "    approver: TBC",
    `    description: ${yq(`Generated by P8 Loom Generator v${APP_VERSION} from project "${prj.name || "untitled"}" (library rev ${prj.library?.rev ?? "?"}).`)}`,
    "---", "");
  md.push("# Purpose and Scope", "",
    `Terminal-to-terminal connections of **${pack.drawing}** (pack ${pack.id}, ${pack.role === "base" ? "base loom" : "add-on loom"}, variant ${prj.variant}). Generated from the project model; do not edit by hand – change the project and regenerate.`, "");
  if (issues.length) md.push("> **Warning:** this schedule was exported with unresolved errors or warnings (see Open Items).", "");
  md.push("# Wire Schedule {.landscape}", "", mdTable(SCHEDULE_COLUMNS, rows.map((r) => r.cells.map((c, i) => (i === 9 && c ? `\`${c}\`` : c)))), "");
  const unknown = rows.filter((r) => r.length.length === null).length;
  md.push(`**Totals:** ${rows.length} wires. Length source per wire: ${[...new Set(rows.map((r) => r.length.source || "none"))].join("; ")}.${unknown ? ` ${unknown} lengths TBC or to be measured (EL).` : ""}`, "");

  const sh = sharedTerminals(prj, lib, packId);
  const ch = daisyChains(prj, packId);
  md.push("# Daisy Chains and Shared Terminals {.portrait}", "");
  md.push(ch.length ? mdTable(["Chain", "Wires"], ch.map((c, i) => [i + 1, c.join(", ")])) : "No daisy chains.", "");
  if (sh.length) md.push(mdTable(["Terminal", "Wires", "Sizes (mm²)", "Termination"], sh.map((s) => [s.point, s.wires, s.sizes, s.termination === "ferrule" ? "twin-entry ferrule" : s.termination])), "");

  if (pack.role === "base") {
    const rp = reservedPointsTable(prj);
    if (rp.length) md.push("# Free and Reserved Points", "", "Left **empty** in this loom. Add-on looms and site wiring land here later (Rule 6).", "",
      mdTable(["Point", "Reserved for", "Who connects", "Packs allowed"], rp.map((r) => [r.point, r.reservedFor, r.who, r.packs || "–"])), "");
  } else {
    const ll = landingList(prj, packId);
    md.push("# Landing Points on the Base Loom", "", "This loom only connects to these free, pre-allocated points (Rule 6).", "",
      ll.length ? mdTable(["Point", "Reserved for", "Wires"], ll.map((r) => [r.point, r.reservedFor, r.wires || "not used"])) : "No reserved points for this pack.", "");
  }

  md.push("# Ferrules and End Fittings", "", mdTable(["Item", "Qty"], ferruleCounts(prj, lib, packId).map((f) => [f.item, f.qty])), "");
  md.push("# Wire Totals", "", mdTable(["Size (mm²)", "Colour", "Wires", "Total length (mm)", "Lengths TBC"],
    lengthTotals(prj, lib, packId).map((t) => [t.size, t.colour, t.wires, t.length, t.unknown || ""])), "");

  md.push("# Open Items", "");
  if (!issues.length && !accepted.length) md.push("- [x] No errors or warnings from the app's checks.");
  for (const i of issues) md.push(`- [ ] ${i.level}: ${i.msg}`);
  for (const i of accepted) md.push(`- [x] Accepted ${i.accepted.date}: ${i.msg} – ${i.accepted.reason}`);
  md.push("");
  return md.join("\n");
}

export function download(name, text, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
