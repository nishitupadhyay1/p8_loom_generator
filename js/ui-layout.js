// Layout panel: plates, hinge, component positions, anchors; layout CSV import / export / template.
import { h, table } from "./dom.js";
import { importLayoutCsv, layoutToCsv, layoutTemplate } from "./layout.js";
import { download } from "./reports.js";
import { placementPlaced } from "./geometry.js";

const numIn = (val, set, size = 6) => h("input", { type: "text", size, value: val ?? "", onchange: (e) => {
  const s = e.target.value.trim();
  const n = s === "" ? null : Number(s);
  if (s !== "" && !Number.isFinite(n)) { e.target.classList.add("badin"); return; }
  set(n);
} });
const txtIn = (val, set, size = 8) => h("input", { type: "text", size, value: val ?? "", onchange: (e) => set(e.target.value.trim()) });
const sel = (vals, cur, set, blank) => h("select", { onchange: (e) => set(e.target.value) },
  blank !== undefined ? h("option", { value: "", selected: !cur ? true : null }, blank) : null,
  vals.map((v) => (Array.isArray(v) ? h("option", { value: v[0], selected: v[0] === cur ? true : null }, v[1]) : h("option", { value: v, selected: v === cur ? true : null }, v))));

export function renderLayout(container, state, changed) {
  const { library: lib, project: prj } = state;
  container.replaceChildren();
  const add = (...p) => container.append(...p.flat().filter((x) => x !== null && x !== undefined && x !== false));
  if (!lib || !prj) { add(h("p", { class: "muted" }, "Load a library and create or open a project first.")); return; }

  add(h("p", { class: "muted" },
    "Coordinates in mm, hinge closed. X right, Y up, Z out of the backplate. A component's X, Y, Z is its envelope corner at min X, min Y on the plate surface; ",
    "envelope L runs along X, W along Y, H away from the plate. Library terminal positions are measured from that corner."),
    h("div", { class: "actions" },
      h("button", { type: "button", onclick: () => download(`${prj.name || "project"}_layout-template.csv`, layoutTemplate(prj), "text/csv") }, "Download layout template"),
      h("label", { class: "button" }, "Import layout CSV…", h("input", { type: "file", accept: ".csv,text/csv", hidden: true, onchange: async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        state.layoutReport = { file: f.name, ...importLayoutCsv(prj, lib, await f.text()) };
        e.target.value = ""; changed();
      } })),
      h("button", { type: "button", onclick: () => download(`${prj.name || "project"}_layout.csv`, layoutToCsv(prj), "text/csv") }, "Export layout CSV")),
    state.layoutReport ? h("div", {}, h("p", {}, `${state.layoutReport.file}: ${state.layoutReport.plates} plates, ${state.layoutReport.hinge} hinge, ${state.layoutReport.components} components, ${state.layoutReport.anchors} anchors, ${state.layoutReport.problems.length} problems.`),
      state.layoutReport.problems.length ? h("ul", {}, state.layoutReport.problems.map((x) => h("li", { class: "bad" }, x))) : null) : null,
  );

  // Plates
  add(h("h3", {}, "Plates"),
    table(["Id", "Name", "X", "Y", "Z", "W (along X)", "H (along Y)", "Moves with hinge", "Components face", ""], prj.plates.map((p, i) => [
      txtIn(p.id, (v) => { p.id = v; changed(); }, 5), txtIn(p.name, (v) => { p.name = v; changed(); }, 12),
      numIn(p.x, (v) => { p.x = v; changed(); }), numIn(p.y, (v) => { p.y = v; changed(); }), numIn(p.z, (v) => { p.z = v; changed(); }),
      numIn(p.w, (v) => { p.w = v; changed(); }), numIn(p.h, (v) => { p.h = v; changed(); }),
      h("input", { type: "checkbox", checked: p.moves ? true : null, onchange: (e) => { p.moves = e.target.checked; changed(); } }),
      sel([["1", "+Z"], ["-1", "−Z"]], String(p.facing ?? 1), (v) => { p.facing = Number(v); changed(); }),
      h("button", { type: "button", onclick: () => { prj.plates.splice(i, 1); changed(); } }, "Remove")])),
    h("button", { type: "button", onclick: () => { prj.plates.push({ id: `P${prj.plates.length + 1}`, name: "", x: 0, y: 0, z: 0, w: null, h: null, moves: false, facing: 1 }); changed(); } }, "Add plate"));

  // Hinge
  const hg = prj.hinge;
  add(h("h3", {}, "Hinge"),
    h("p", {}, "Axis parallel to Y through X ", numIn(hg.x, (v) => { hg.x = v; changed(); }), " Z ", numIn(hg.z, (v) => { hg.z = v; changed(); }),
      " · opening angle (°) ", numIn(hg.openAngle, (v) => { hg.openAngle = v; changed(); }, 4),
      " · lengths taken with the hinge ", sel([["closed", "closed"], ["open", "open"]], hg.lengthsAt, (v) => { hg.lengthsAt = v; changed(); })),
    h("p", { class: "muted" }, "A route segment between a moving plate and a fixed one crosses the hinge: its bends are checked at the flexible radius."));

  // Component positions
  const plates = prj.plates.map((p) => p.id);
  add(h("h3", {}, "Component positions"),
    table(["Tag", "Component", "Plate", "X", "Y", "Z", "Rot (°)", "Placed"], prj.placements.map((pl) => [
      h("strong", {}, pl.tag), pl.component ?? h("span", { class: "bad" }, "no component"),
      sel(plates, pl.plate, (v) => { pl.plate = v || null; changed(); }, "– off-plate –"),
      numIn(pl.x, (v) => { pl.x = v; changed(); }), numIn(pl.y, (v) => { pl.y = v; changed(); }), numIn(pl.z, (v) => { pl.z = v; changed(); }),
      sel(["0", "90", "180", "270"], String(pl.rot ?? 0), (v) => { pl.rot = Number(v); changed(); }),
      placementPlaced(pl) ? h("span", { class: "ok" }, "yes") : h("span", { class: "muted" }, "no")])));

  // Anchors
  add(h("h3", {}, "Anchors (cable ties, slotted duct, exit points)"),
    h("p", { class: "muted" }, "Tie = anchor point. Duct = anchor line from X, Y, Z to X2, Y2, Z2 (wires enter and leave at the nearest slot). Exit = where the loom leaves the enclosure; an off-plate end then needs an external length on the wire."),
    table(["Id", "Type", "Plate", "X", "Y", "Z", "X2", "Y2", "Z2", "Width", "Height", "Slot pitch", "Name", ""], prj.anchors.map((a, i) => [
      txtIn(a.id, (v) => { a.id = v; changed(); }, 5),
      sel([["point", "tie"], ["line", "duct"], ["exit", "exit"]], a.type, (v) => { a.type = v; changed(); }),
      sel(plates, a.plate, (v) => { a.plate = v; changed(); }, "–"),
      numIn(a.x, (v) => { a.x = v; changed(); }), numIn(a.y, (v) => { a.y = v; changed(); }), numIn(a.z, (v) => { a.z = v; changed(); }),
      ...(a.type === "line"
        ? [numIn(a.x2, (v) => { a.x2 = v; changed(); }), numIn(a.y2, (v) => { a.y2 = v; changed(); }), numIn(a.z2, (v) => { a.z2 = v; changed(); }),
          numIn(a.width, (v) => { a.width = v; changed(); }, 4), numIn(a.height, (v) => { a.height = v; changed(); }, 4), numIn(a.slotPitch, (v) => { a.slotPitch = v; changed(); }, 4)]
        : ["", "", "", "", "", ""]),
      txtIn(a.name, (v) => { a.name = v; changed(); }, 14),
      h("button", { type: "button", onclick: () => { prj.anchors.splice(i, 1); changed(); } }, "Remove")])),
    h("div", { class: "actions" }, ["point", "line", "exit"].map((t) => h("button", { type: "button", onclick: () => {
      const pre = { point: "T", line: "D", exit: "X" }[t];
      let n = 1; while (prj.anchors.some((a) => a.id === `${pre}${n}`)) n++;
      prj.anchors.push({ id: `${pre}${n}`, type: t, plate: plates[0] ?? "", x: null, y: null, z: null, name: "" }); changed();
    } }, `Add ${{ point: "tie", line: "duct", exit: "exit" }[t]}`))));

  // Pack default anchors
  add(h("h3", {}, "Default anchor sequence per pack"),
    h("p", { class: "muted" }, "Used by wires whose own anchor list is blank. Ids in order, separated by commas, e.g. T1, D1, X1."),
    table(["Pack", "Default anchors"], prj.packs.map((p) => [p.id, txtIn((p.defaultAnchors ?? []).join(", "), (v) => {
      p.defaultAnchors = v.split(",").map((s) => s.trim()).filter(Boolean); changed();
    }, 40)])));
}
