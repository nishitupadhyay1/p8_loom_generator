// Layout CSV: one file for plates, hinge, component positions, cable ties, duct and exit points.
import { parseCsv, toCsv } from "./csv.js";

export const LAYOUT_COLUMNS = ["Kind", "Id", "Name", "Plate", "X", "Y", "Z", "X2", "Y2", "Z2", "W", "H", "Rot", "Moves", "Facing", "OpenAngle", "LengthsAt", "SlotPitch"];
export const KINDS = ["PLATE", "HINGE", "COMPONENT", "TIE", "DUCT", "EXIT"];
const ANCHOR_KIND = { TIE: "point", DUCT: "line", EXIT: "exit" };
const KIND_OF = { point: "TIE", line: "DUCT", exit: "EXIT" };

const num = (s) => { s = String(s ?? "").trim(); if (s === "") return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
const yes = (s) => /^(y|yes|true|1)$/i.test(String(s ?? "").trim());

export function layoutToCsv(prj) {
  const rows = [LAYOUT_COLUMNS];
  const blank = () => Object.fromEntries(LAYOUT_COLUMNS.map((c) => [c, ""]));
  const push = (o) => rows.push(LAYOUT_COLUMNS.map((c) => o[c] ?? ""));
  for (const p of prj.plates) push({ ...blank(), Kind: "PLATE", Id: p.id, Name: p.name, X: p.x, Y: p.y, Z: p.z, W: p.w, H: p.h, Moves: p.moves ? "yes" : "no", Facing: p.facing === -1 ? "-Z" : "+Z" });
  const hg = prj.hinge ?? {};
  push({ ...blank(), Kind: "HINGE", Id: "HINGE", X: hg.x ?? "", Z: hg.z ?? "", OpenAngle: hg.openAngle ?? "", LengthsAt: hg.lengthsAt ?? "closed" });
  for (const pl of prj.placements) push({ ...blank(), Kind: "COMPONENT", Id: pl.tag, Name: pl.component ?? "", Plate: pl.plate ?? "", X: pl.x ?? "", Y: pl.y ?? "", Z: pl.z ?? "", Rot: pl.rot ?? 0 });
  for (const a of prj.anchors) push({ ...blank(), Kind: KIND_OF[a.type], Id: a.id, Name: a.name ?? "", Plate: a.plate, X: a.x, Y: a.y, Z: a.z,
    X2: a.type === "line" ? a.x2 : "", Y2: a.type === "line" ? a.y2 : "", Z2: a.type === "line" ? a.z2 : "", W: a.width ?? "", H: a.height ?? "", SlotPitch: a.slotPitch ?? "" });
  return toCsv(rows);
}

// Template: the project's tags plus two plates, the hinge and one example of each anchor kind.
export function layoutTemplate(prj) {
  const copy = structuredClone(prj);
  if (!copy.plates.length) copy.plates = [
    { id: "BP", name: "Backplate", x: "", y: "", z: "", w: "", h: "", moves: false, facing: 1 },
    { id: "HP", name: "Hinge plate", x: "", y: "", z: "", w: "", h: "", moves: true, facing: 1 },
  ];
  if (!copy.anchors.length) copy.anchors = [
    { id: "T1", name: "cable tie mount (example - edit or delete)", type: "point", plate: "BP", x: "", y: "", z: "" },
    { id: "D1", name: "slotted duct (example - edit or delete)", type: "line", plate: "BP", x: "", y: "", z: "", x2: "", y2: "", z2: "", width: "", height: "", slotPitch: "" },
    { id: "X1", name: "loom exit from the enclosure (example - edit or delete)", type: "exit", plate: "BP", x: "", y: "", z: "" },
  ];
  return layoutToCsv(copy);
}

/** Apply a layout CSV to the project. Rows replace items with the same Id. Returns a report. */
export function importLayoutCsv(prj, lib, text) {
  const rows = parseCsv(text);
  const rep = { plates: 0, hinge: 0, components: 0, anchors: 0, problems: [] };
  if (!rows.length) { rep.problems.push("The file is empty."); return rep; }
  const head = rows[0].map((s) => s.trim());
  const col = Object.fromEntries(LAYOUT_COLUMNS.map((c) => [c, head.indexOf(c)]));
  if (col.Kind < 0 || col.Id < 0) { rep.problems.push(`Needs at least the columns Kind and Id (${LAYOUT_COLUMNS.join(", ")}).`); return rep; }

  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const g = (c) => (col[c] >= 0 ? String(r[col[c]] ?? "").trim() : "");
    const kind = g("Kind").toUpperCase();
    const id = g("Id");
    if (!kind && !id) return;
    if (!KINDS.includes(kind)) { rep.problems.push(`Line ${line}: Kind "${kind}" – use ${KINDS.join(", ")}`); return; }
    const n = (c, required = true) => {
      const x = num(g(c));
      if (Number.isNaN(x)) { rep.problems.push(`Line ${line} (${id}): ${c} "${g(c)}" is not a number (mm)`); return null; }
      if (x === null && required) rep.problems.push(`Line ${line} (${id}): ${c} is blank`);
      return x;
    };
    if (kind === "PLATE") {
      const p = { id, name: g("Name") || id, x: n("X"), y: n("Y"), z: n("Z"), w: n("W"), h: n("H"), moves: yes(g("Moves")), facing: g("Facing") === "-Z" ? -1 : 1 };
      const k = prj.plates.findIndex((x) => x.id === id);
      if (k >= 0) prj.plates[k] = p; else prj.plates.push(p);
      rep.plates++;
    } else if (kind === "HINGE") {
      prj.hinge = { x: n("X"), z: n("Z"), openAngle: n("OpenAngle") ?? 90, lengthsAt: /^open$/i.test(g("LengthsAt")) ? "open" : "closed" };
      rep.hinge++;
    } else if (kind === "COMPONENT") {
      let pl = prj.placements.find((p) => p.tag === id);
      if (!pl) { pl = { tag: id, component: null, plate: null, x: null, y: null, z: null, rot: 0 }; prj.placements.push(pl); }
      const comp = g("Name");
      if (comp) { if (lib.components.some((c) => c.id === comp)) pl.component = comp; else rep.problems.push(`Line ${line} (${id}): component "${comp}" is not in the library`); }
      const plate = g("Plate");
      const external = plate === "" && g("X") === "";
      if (!external) {
        if (!prj.plates.some((p) => p.id === plate) && !rows.some((x) => String(x[col.Kind]).toUpperCase() === "PLATE" && x[col.Id] === plate)) rep.problems.push(`Line ${line} (${id}): plate "${plate}" not defined`);
        Object.assign(pl, { plate, x: n("X"), y: n("Y"), z: n("Z") });
        const rot = n("Rot", false) ?? 0;
        if (![0, 90, 180, 270].includes(rot)) rep.problems.push(`Line ${line} (${id}): Rot must be 0, 90, 180 or 270`);
        pl.rot = rot;
      }
      rep.components++;
    } else {
      const type = ANCHOR_KIND[kind];
      const a = { id, name: g("Name"), type, plate: g("Plate"), x: n("X"), y: n("Y"), z: n("Z") };
      if (type === "line") Object.assign(a, { x2: n("X2"), y2: n("Y2"), z2: n("Z2"), width: n("W", false), height: n("H", false), slotPitch: n("SlotPitch", false) });
      const k = prj.anchors.findIndex((x) => x.id === id);
      if (k >= 0) prj.anchors[k] = a; else prj.anchors.push(a);
      rep.anchors++;
    }
  });
  return rep;
}
