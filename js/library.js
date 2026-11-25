// Library file: validation and lookup.
// The library is loaded from a file the user picks; it is never stored in the repository.
//
// A value is "unconfirmed" when it is null, or when its key is listed in the
// object's `unconfirmed` array (a value was entered but is not yet checked).

export const LIBRARY_SCHEMA = "p8-loom-library";
export const LIBRARY_SCHEMA_VERSION = 1;

const MOUNTINGS = ["DIN", "plate", "busbar", "external"];
const TERMINATIONS = ["ferrule", "spade", "rj45", "wago", "none"];
const VOLTAGE_CLASSES = ["ELV", "MAINS"];
const HOLES = ["inner", "outer"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string";

// Is field `key` of object `o` unconfirmed?
export function isUnconfirmed(o, key) {
  if (!o) return true;
  if (o[key] === null || o[key] === undefined) return true;
  return Array.isArray(o.unconfirmed) && o.unconfirmed.includes(key);
}

/**
 * Validate a parsed library object.
 * Returns { ok, errors[], warnings[], unconfirmed[], stats }.
 * Errors stop the library from loading. Unconfirmed values are listed, never filled in.
 */
export function validateLibrary(lib) {
  const errors = [];
  const warnings = [];
  const unconfirmed = [];
  const err = (path, msg) => errors.push({ path, msg });
  const warn = (path, msg) => warnings.push({ path, msg });
  const unc = (path, key, o) => unconfirmed.push({ path: `${path}.${key}`, value: o ? o[key] ?? null : null });

  // Optional numeric: null allowed (unconfirmed), otherwise must be a number.
  const listed = (o, key) => Array.isArray(o?.unconfirmed) && o.unconfirmed.includes(key);

  const optNum = (o, key, path, { min = -Infinity, required = false } = {}) => {
    const v = o?.[key];
    if (v === null || v === undefined) {
      if (required || listed(o, key)) unc(path, key, o);
      return;
    }
    if (!isNum(v)) err(`${path}.${key}`, `must be a number (mm or mm²), got ${JSON.stringify(v)}`);
    else if (v < min) err(`${path}.${key}`, `must be at least ${min}`);
    if (Array.isArray(o.unconfirmed) && o.unconfirmed.includes(key)) unc(path, key, o);
  };

  const range = (o, key, path, { required = false } = {}) => {
    const r = o?.[key];
    if (r === null || r === undefined) {
      if (required || listed(o, key)) unc(path, key, o);
      return;
    }
    if (typeof r !== "object") { err(`${path}.${key}`, "must be an object"); return; }
    for (const k of Object.keys(r)) {
      if (!["min", "max", "minEach", "maxEach", "allowed"].includes(k)) warn(`${path}.${key}.${k}`, "unknown field");
    }
    for (const k of ["min", "max", "minEach", "maxEach"]) {
      if (r[k] !== undefined && r[k] !== null && !isNum(r[k])) err(`${path}.${key}.${k}`, "must be a number");
    }
    if (isNum(r.min) && isNum(r.max) && r.min > r.max) err(`${path}.${key}`, `min ${r.min} is above max ${r.max}`);
    if (isNum(r.minEach) && isNum(r.maxEach) && r.minEach > r.maxEach) err(`${path}.${key}`, `minEach ${r.minEach} is above maxEach ${r.maxEach}`);
    if (Array.isArray(o.unconfirmed) && o.unconfirmed.includes(key)) unc(path, key, o);
  };

  const unconfirmedKeysExist = (o, path) => {
    if (o?.unconfirmed === undefined) return;
    if (!Array.isArray(o.unconfirmed)) { err(`${path}.unconfirmed`, "must be a list of field names"); return; }
    for (const k of o.unconfirmed) {
      if (!(k in o)) warn(`${path}.unconfirmed`, `lists "${k}", which is not a field here`);
      else unc(path, k, o); // reported once: duplicates are removed at the end
    }
  };

  // --- Header
  if (!lib || typeof lib !== "object" || Array.isArray(lib)) {
    err("(file)", "not a JSON object");
    return { ok: false, errors, warnings, unconfirmed, stats: {} };
  }
  if (lib.schema !== LIBRARY_SCHEMA) err("schema", `must be "${LIBRARY_SCHEMA}" (is this a library file?)`);
  if (lib.schemaVersion !== LIBRARY_SCHEMA_VERSION) err("schemaVersion", `must be ${LIBRARY_SCHEMA_VERSION}`);
  if (!isStr(lib.libraryRev) || !lib.libraryRev) err("libraryRev", "missing");
  if (!isStr(lib.date) || !/^\d{4}-\d{2}-\d{2}$/.test(lib.date)) err("date", "must be YYYY-MM-DD");

  // --- Rules
  const r = lib.rules;
  if (!r || typeof r !== "object") {
    err("rules", "missing");
  } else {
    if (!Array.isArray(r.bend) || r.bend.length === 0) err("rules.bend", "needs at least one size band");
    else {
      let prev = 0;
      r.bend.forEach((b, i) => {
        const p = `rules.bend[${i}]`;
        for (const k of ["maxSize", "stationary", "flexible"]) if (!isNum(b[k]) || b[k] <= 0) err(`${p}.${k}`, "must be a positive number");
        if (isNum(b.maxSize) && b.maxSize <= prev) err(`${p}.maxSize`, "bands must be in ascending wire size");
        if (isNum(b.stationary) && isNum(b.flexible) && b.flexible < b.stationary) warn(p, "flexible radius is smaller than stationary");
        prev = isNum(b.maxSize) ? b.maxSize : prev;
      });
    }
    const ts = r.terminationStraight;
    if (!ts || !isNum(ts.maxSize) || !isNum(ts.length)) err("rules.terminationStraight", "needs maxSize (mm²) and length (mm)");
    if (!Number.isInteger(r.maxWiresPerTerminal) || r.maxWiresPerTerminal < 1) err("rules.maxWiresPerTerminal", "must be a whole number ≥ 1");
    if (!Array.isArray(r.blockedColours)) err("rules.blockedColours", "must be a list of colour codes");
    if (r.sizeRule !== undefined) {
      if (typeof r.sizeRule !== "object") err("rules.sizeRule", "must be an object keyed by variant");
      else for (const [variant, rule] of Object.entries(r.sizeRule)) {
        const p = `rules.sizeRule.${variant}`;
        unconfirmedKeysExist(rule, p);
        optNum(rule, "default", p, { min: 0, required: true });
      }
    }
  }

  // --- Colours
  const colourCodes = new Set();
  if (!Array.isArray(lib.colours)) err("colours", "must be a list");
  else lib.colours.forEach((c, i) => {
    const p = `colours[${i}]`;
    if (!isStr(c.code) || !c.code) { err(`${p}.code`, "missing"); return; }
    if (colourCodes.has(c.code)) err(`${p}.code`, `duplicate colour code ${c.code}`);
    colourCodes.add(c.code);
    if (r?.blockedColours?.includes(c.code)) err(`${p}.code`, `${c.code} is a blocked colour (earth bonding) and cannot be in the colour list`);
    if (!isStr(c.name)) warn(`${p}.name`, "missing");
  });

  // --- Wire types
  const wireIds = new Set();
  if (!Array.isArray(lib.wireTypes)) err("wireTypes", "must be a list");
  else lib.wireTypes.forEach((w, i) => {
    const p = `wireTypes[${i}]`;
    if (!isStr(w.id) || !w.id) { err(`${p}.id`, "missing"); return; }
    if (wireIds.has(w.id)) err(`${p}.id`, `duplicate wire type ${w.id}`);
    wireIds.add(w.id);
    unconfirmedKeysExist(w, `wireTypes.${w.id}`);
    const kind = w.kind ?? "single";
    if (!["single", "cable"].includes(kind)) err(`${p}.kind`, `must be "single" or "cable"`);
    if (kind === "single") {
      if (!isNum(w.size) || w.size <= 0) err(`${p}.size`, "must be a positive number (mm²)");
      optNum(w, "od", `wireTypes.${w.id}`, { min: 0, required: true });
      optNum(w, "ferruleOd", `wireTypes.${w.id}`, { min: 0, required: true });
    } else {
      if (!w.bend || !isNum(w.bend.stationary) || !isNum(w.bend.flexible)) err(`${p}.bend`, "a cable needs its own stationary and flexible bend radius (mm)");
      if (!isNum(w.terminationStraight)) err(`${p}.terminationStraight`, "a cable needs its own termination straight (mm)");
      optNum(w, "od", `wireTypes.${w.id}`, { min: 0, required: true });
    }
    if (w.stock !== undefined && !Array.isArray(w.stock)) err(`${p}.stock`, "must be a list of colour codes");
    else for (const code of w.stock ?? []) if (!colourCodes.has(code)) err(`${p}.stock`, `colour ${code} is not in the colour list`);
  });

  // --- Components
  const compIds = new Set();
  let nConnectors = 0;
  let nTerminals = 0;
  if (!Array.isArray(lib.components)) err("components", "must be a list");
  else lib.components.forEach((c, i) => {
    const cp = `components[${i}]`;
    if (!isStr(c.id) || !c.id) { err(`${cp}.id`, "missing"); return; }
    const P = c.id;
    if (compIds.has(c.id)) err(`${cp}.id`, `duplicate component ${c.id}`);
    compIds.add(c.id);
    unconfirmedKeysExist(c, P);
    if (!isStr(c.name)) warn(`${P}.name`, "missing");
    if (!isStr(c.partNumber) || !c.partNumber) warn(`${P}.partNumber`, "missing");
    if (c.mounting !== undefined && !MOUNTINGS.includes(c.mounting)) err(`${P}.mounting`, `must be one of ${MOUNTINGS.join(", ")}`);
    if (!c.envelope || typeof c.envelope !== "object") unc(P, "envelope", c);
    else {
      for (const k of ["l", "w", "h"]) optNum(c.envelope, k, `${P}.envelope`, { min: 0, required: true });
      if (c.unconfirmed?.includes("envelope")) unc(P, "envelope", c);
    }

    if (!Array.isArray(c.connectors) || c.connectors.length === 0) { warn(P, "has no connectors"); return; }
    const connIds = new Set();
    c.connectors.forEach((k, j) => {
      const kp = `${P}.connectors[${j}]`;
      if (!isStr(k.id) || !k.id) { err(`${kp}.id`, "missing"); return; }
      const K = `${P} ${k.id}`;
      if (connIds.has(k.id)) err(kp, `duplicate connector ${k.id}`);
      connIds.add(k.id);
      nConnectors++;
      unconfirmedKeysExist(k, K);
      if (!isStr(k.mark)) err(`${K}.mark`, "marking label missing (use \"\" to leave the connector out of the marking)");
      // A plug (RJ45) takes a made-up cable: no screw-terminal sizes to check.
      const screw = k.termination !== "rj45";
      optNum(k, "pitch", K, { min: 0, required: screw });
      range(k, "accepts", K, { required: screw });
      range(k, "twin", K, { required: screw });
      range(k, "torque", K);
      optNum(k, "strip", K, { min: 0 });
      if (k.holeBundle !== undefined) {
        if (!k.holeBundle || !isNum(k.holeBundle.inner) || !isNum(k.holeBundle.outer)) err(`${K}.holeBundle`, "needs inner and outer bundle diameters (mm)");
      }
      if (k.termination !== undefined && !TERMINATIONS.includes(k.termination)) err(`${K}.termination`, `must be one of ${TERMINATIONS.join(", ")}`);
      if (!VOLTAGE_CLASSES.includes(k.voltageClass)) err(`${K}.voltageClass`, `must be one of ${VOLTAGE_CLASSES.join(", ")}`);

      if (!Array.isArray(k.terminals) || k.terminals.length === 0) { err(K, "has no terminals"); return; }
      const termIds = new Set();
      k.terminals.forEach((t, m) => {
        const tp = `${K} terminals[${m}]`;
        if (!isStr(t.id) || !t.id) { err(`${tp}.id`, "missing"); return; }
        const T = `${K} ${t.id}`;
        if (termIds.has(t.id)) err(tp, `duplicate terminal ${t.id}`);
        termIds.add(t.id);
        nTerminals++;
        unconfirmedKeysExist(t, T);
        if (!isStr(t.mark) || !t.mark) err(`${T}.mark`, "marking label missing");
        if (t.voltageClass !== undefined && !VOLTAGE_CLASSES.includes(t.voltageClass)) err(`${T}.voltageClass`, `must be one of ${VOLTAGE_CLASSES.join(", ")}`);
        if (t.hole !== undefined && !HOLES.includes(t.hole)) err(`${T}.hole`, `must be "inner" or "outer"`);
        for (const key of ["pos", "exit"]) {
          const v = t[key];
          if (v === null || v === undefined) { unc(T, key, t); continue; }
          if (!["x", "y", "z"].every((a) => isNum(v[a]))) err(`${T}.${key}`, "needs numeric x, y and z (mm)");
          if (key === "exit" && ["x", "y", "z"].every((a) => isNum(v[a])) && v.x === 0 && v.y === 0 && v.z === 0) err(`${T}.exit`, "exit direction cannot be zero");
          if (t.unconfirmed?.includes(key)) unc(T, key, t);
        }
      });
    });
  });

  const seen = new Set();
  const unconfirmedUnique = unconfirmed.filter((u) => !seen.has(u.path) && seen.add(u.path));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    unconfirmed: unconfirmedUnique,
    stats: {
      components: compIds.size,
      connectors: nConnectors,
      terminals: nTerminals,
      colours: colourCodes.size,
      wireTypes: wireIds.size,
    },
  };
}

// Marking label for one end: tag, connector mark, terminal mark (blanks dropped).
export function markingEnd(tag, connector, terminal) {
  return [tag, connector?.mark, terminal?.mark].filter((s) => s && String(s).trim()).join(" ");
}

// Effective voltage class of a terminal (terminal overrides connector).
export function voltageClassOf(connector, terminal) {
  return terminal?.voltageClass ?? connector?.voltageClass;
}
