// Project model: variant, packs, placements (tag -> component), wires.
// Everything derived (markings, checks, lengths) is calculated, never stored.
import { APP_VERSION } from "./version.js";
import { markingEnd } from "./library.js";
import { parseCsv } from "./csv.js";

export const PROJECT_SCHEMA = "p8-loom-project";
export const PROJECT_SCHEMA_VERSION = 1;

export const REVC_COLUMNS = ["Wire", "Dwg", "From", "From terminal", "To", "To terminal", "Function",
  "Size (mm²)", "Colour", "Marking", "Length (mm)"];

const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
const same = (a, b) => norm(a).toUpperCase() === norm(b).toUpperCase();

export function newProject(lib, variant, name = "") {
  const templates = lib.packTemplates?.[variant] ?? [];
  return {
    schema: PROJECT_SCHEMA,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    library: { rev: lib.libraryRev, date: lib.date },
    name,
    variant,
    packs: templates.map((p) => ({ ...structuredClone(p), rev: "" })),
    placements: [],
    reservations: [],
    wires: [],
    exceptions: [],
    revisions: [],
  };
}

// ----- Lookups

export const componentById = (lib, id) => lib.components.find((c) => c.id === id) ?? null;
export const placementByTag = (prj, tag) => prj.placements.find((p) => p.tag === tag) ?? null;

export function resolveRef(prj, lib, ref) {
  // ref: { tag, connector, terminal } -> { placement, component, connector, terminal } (any may be null)
  const placement = ref ? placementByTag(prj, ref.tag) : null;
  const component = placement ? componentById(lib, placement.component) : null;
  const connector = component?.connectors.find((k) => k.id === ref.connector) ?? null;
  const terminal = connector?.terminals.find((t) => t.id === ref.terminal) ?? null;
  return { placement, component, connector, terminal };
}

export const isResolved = (prj, lib, ref) => !!resolveRef(prj, lib, ref).terminal;

export function refText(ref) {
  if (!ref) return "";
  if (ref.connector === null && ref.raw) return `${ref.raw.unit} ${ref.raw.terminal}`;
  return [ref.tag, ref.connector === "-" ? "" : ref.connector, ref.terminal].filter(Boolean).join(" ");
}

export function generatedMarking(prj, lib, wire) {
  const a = resolveRef(prj, lib, wire.from);
  const b = resolveRef(prj, lib, wire.to);
  if (!a.terminal || !b.terminal) return null;
  return `< ${markingEnd(wire.from.tag, a.connector, a.terminal)} / ${markingEnd(wire.to.tag, b.connector, b.terminal)} >`;
}

export const markingOf = (prj, lib, wire) => wire.markingOverride ?? generatedMarking(prj, lib, wire);

export function packOfNumber(prj, id) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(id ?? "");
  if (!m) return null;
  const n = Number(m[2]);
  return prj.packs.find((p) => p.wireRange.prefix === m[1] && n >= p.wireRange.from && n <= p.wireRange.to) ?? null;
}

export function nextWireNumber(prj, packId) {
  const pack = prj.packs.find((p) => p.id === packId);
  if (!pack) return "";
  const { prefix, from, to, digits = 2 } = pack.wireRange;
  // Next number after the highest used in the range: retired numbers (gaps) are not reused.
  let max = from - 1;
  for (const w of prj.wires) {
    const m = /^([A-Za-z]+)(\d+)$/.exec(w.id);
    if (m && m[1] === prefix) { const n = Number(m[2]); if (n >= from && n <= to) max = Math.max(max, n); }
  }
  return max < to ? prefix + String(max + 1).padStart(digits, "0") : "";
}

// ----- Endpoint resolution from schedule text ("TM CN5" + "5Vdc")

function matchTerminal(connector, text) {
  const t = norm(text);
  const hits = connector.terminals.filter((x) =>
    same(x.id, t) || same(x.mark, t) || same(x.name ?? "", t) || same(`${x.id} ${x.name ?? ""}`, t));
  return hits.length === 1 ? hits[0] : null;
}

function matchConnector(component, text) {
  if (!text) return component.connectors.length === 1 ? component.connectors[0] : null;
  const hits = component.connectors.filter((k) => same(k.id, text) || (k.mark && same(k.mark, text)));
  return hits.length === 1 ? hits[0] : null;
}

// Try to turn raw text into a library reference. Mutates ref; returns true if resolved.
export function resolveRaw(prj, lib, ref) {
  if (!ref?.raw) return false;
  const placement = placementByTag(prj, ref.tag);
  const component = placement ? componentById(lib, placement.component) : null;
  if (!component) { ref.connector = null; ref.terminal = null; return false; }
  let connector = matchConnector(component, ref.raw.connector);
  let terminal = connector ? matchTerminal(connector, ref.raw.terminal) : null;
  // Fallback: connector text carries part of the terminal mark, e.g. "Output CH2" + "COM2" -> Output / "CH2 COM2".
  if (!terminal && ref.raw.connector) {
    for (const k of component.connectors) {
      for (const head of [k.id, k.mark].filter(Boolean)) {
        if (norm(ref.raw.connector).toUpperCase().startsWith(head.toUpperCase() + " ")) {
          const rest = norm(ref.raw.connector).slice(head.length + 1);
          const t = matchTerminal(k, `${rest} ${ref.raw.terminal}`);
          if (t) { connector = k; terminal = t; }
        }
      }
      if (terminal) break;
    }
  }
  ref.connector = terminal ? connector.id : null;
  ref.terminal = terminal ? terminal.id : null;
  return !!terminal;
}

// Re-run resolution for every wire end that still has raw text and no terminal.
export function resolveAll(prj, lib) {
  for (const w of prj.wires) for (const end of [w.from, w.to]) if (end?.raw && !end.terminal) resolveRaw(prj, lib, end);
}

function ensurePlacement(prj, lib, tag) {
  let p = placementByTag(prj, tag);
  if (!p) {
    const byDefault = lib.components.filter((c) => c.defaultTag === tag);
    p = { tag, component: byDefault.length === 1 ? byDefault[0].id : null, plate: null, x: null, y: null, rot: 0 };
    prj.placements.push(p);
  }
  return p;
}

function endFromText(prj, lib, unitText, terminalText) {
  const parts = norm(unitText).split(" ");
  const tag = parts[0];
  const connector = parts.slice(1).join(" ") || null;
  ensurePlacement(prj, lib, tag);
  const ref = { tag, connector: null, terminal: null, raw: { unit: norm(unitText), connector, terminal: norm(terminalText) } };
  resolveRaw(prj, lib, ref);
  return ref;
}

/**
 * Import a schedule CSV in the Rev C column layout into the project, into pack `packId`.
 * Returns a report; does not overwrite existing wire numbers (they are listed as skipped).
 */
export function importScheduleCsv(prj, lib, text, packId, sourceLabel) {
  const rows = parseCsv(text);
  const report = { added: [], skipped: [], problems: [] };
  if (!rows.length) { report.problems.push("The file is empty."); return report; }
  const header = rows[0].map(norm);
  const col = Object.fromEntries(REVC_COLUMNS.map((c) => [c, header.indexOf(c)]));
  const missing = REVC_COLUMNS.filter((c) => col[c] < 0);
  if (missing.length) {
    report.problems.push(`Missing columns: ${missing.join(", ")}. Expected the Rev C layout: ${REVC_COLUMNS.join(", ")}.`);
    return report;
  }
  const wireTypeIds = new Set(lib.wireTypes.map((w) => w.id));
  const colourCodes = new Set(lib.colours.map((c) => c.code));

  for (const r of rows.slice(1)) {
    const get = (c) => norm(r[col[c]]);
    const id = get("Wire");
    if (!id) continue;
    if (prj.wires.some((w) => w.id === id)) { report.skipped.push(`${id}: wire number already in the project`); continue; }

    const sizeText = get("Size (mm²)");
    const type = /^cat/i.test(sizeText) ? "CAT" : sizeText;
    if (!wireTypeIds.has(type)) report.problems.push(`${id}: size "${sizeText}" is not a wire type in the library`);
    const colour = get("Colour");
    if (colour && !colourCodes.has(colour)) report.problems.push(`${id}: colour "${colour}" is not in the library colour list`);

    const lenText = get("Length (mm)");
    let measured = null;
    if (/^\d+(\.\d+)?$/.test(lenText)) measured = { length: Number(lenText), source: sourceLabel };
    else if (/^EL$/i.test(lenText)) measured = { length: null, source: "EL (to be measured by Electra-Loom)" };
    else if (lenText) report.problems.push(`${id}: length "${lenText}" not understood`);

    const wire = {
      id,
      pack: packId,
      dwg: "",
      from: endFromText(prj, lib, get("From"), get("From terminal")),
      to: endFromText(prj, lib, get("To"), get("To terminal")),
      function: get("Function"),
      type,
      colour,
      markingOverride: null,
      importedMarking: get("Marking") || null,
      measured,
    };
    prj.wires.push(wire);
    report.added.push(id);
  }
  return report;
}

// Imported marking kept for comparison; compare with the generated one.
export function markingDiffers(prj, lib, wire) {
  if (!wire.importedMarking) return false;
  const g = generatedMarking(prj, lib, wire);
  return g !== null && norm(g) !== norm(wire.importedMarking);
}

export function sortWires(prj) {
  const key = (w) => {
    const m = /^([A-Za-z]+)(\d+)$/.exec(w.id);
    return m ? [m[1], Number(m[2])] : [w.id, 0];
  };
  prj.wires.sort((a, b) => {
    const [pa, na] = key(a); const [pb, nb] = key(b);
    return pa === pb ? na - nb : pa.localeCompare(pb);
  });
}

// ----- Reserved points (Rev C "Free and Reserved Points"), one row per terminal
export const RESERVATION_COLUMNS = ["Tag", "Connector", "Terminal", "Packs", "Reserved for", "Who connects"];

export function importReservationsCsv(prj, lib, text) {
  const rows = parseCsv(text);
  const report = { added: [], replaced: [], problems: [] };
  if (!rows.length) { report.problems.push("The file is empty."); return report; }
  const header = rows[0].map(norm);
  const col = Object.fromEntries(RESERVATION_COLUMNS.map((c) => [c, header.indexOf(c)]));
  const missing = RESERVATION_COLUMNS.filter((c) => col[c] < 0);
  if (missing.length) { report.problems.push(`Missing columns: ${missing.join(", ")}.`); return report; }
  prj.reservations ??= [];
  const packIds = new Set(prj.packs.map((p) => p.id));
  for (const r of rows.slice(1)) {
    const get = (c) => norm(r[col[c]]);
    const res = { tag: get("Tag"), connector: get("Connector"), terminal: get("Terminal"), packs: get("Packs"),
      reservedFor: get("Reserved for"), who: get("Who connects") };
    if (!res.tag) continue;
    const name = `${res.tag} ${res.connector === "-" ? "" : res.connector + " "}${res.terminal}`;
    ensurePlacement(prj, lib, res.tag);
    for (const p of res.packs.split(";").map((s) => s.trim()).filter(Boolean)) {
      if (!packIds.has(p)) report.problems.push(`${name}: pack "${p}" is not in the project`);
    }
    const i = prj.reservations.findIndex((x) => x.tag === res.tag && x.connector === res.connector && x.terminal === res.terminal);
    if (i >= 0) { prj.reservations[i] = res; report.replaced.push(name); } else { prj.reservations.push(res); report.added.push(name); }
  }
  return report;
}

// Reservations whose terminal is not found in the library (after tags are mapped).
export function unresolvedReservations(prj, lib) {
  return (prj.reservations ?? []).filter((r) => !isResolved(prj, lib, r));
}
