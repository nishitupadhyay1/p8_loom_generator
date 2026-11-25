// Outputs panel: generated tables and schedule exports per pack.
import { h, table } from "./dom.js";
import * as R from "./reports.js";

export function renderReports(container, state) {
  const { library: lib, project: prj } = state;
  container.replaceChildren();
  const add = (...p) => container.append(...p.flat().filter((x) => x !== null && x !== undefined && x !== false));
  if (!lib || !prj) { add(h("p", { class: "muted" }, "Load a library and create or open a project first.")); return; }

  const packs = prj.packs.filter((p) => prj.wires.some((w) => w.pack === p.id) || p.role === "base");
  const cur = packs.find((p) => p.id === state.reportPack) ?? packs[0];
  if (!cur) return;
  state.reportPack = cur.id;
  const stamp = new Date().toISOString().slice(0, 10);
  const fileBase = `${cur.drawing}${cur.rev ? "_REV-" + cur.rev : ""}`;

  add(h("div", { class: "actions" }, h("span", {}, "Pack "),
      h("select", { onchange: (e) => { state.reportPack = e.target.value; renderReports(container, state); } },
        packs.map((p) => h("option", { value: p.id, selected: p.id === cur.id ? true : null }, `${p.id} – ${p.drawing}`))),
      h("button", { type: "button", onclick: () => R.download(`${fileBase}_schedule.md`, R.scheduleMarkdown(prj, lib, cur.id), "text/markdown") }, "Export schedule (EngDocs Markdown)"),
      h("button", { type: "button", onclick: () => R.download(`${fileBase}_schedule.csv`, R.scheduleCsv(prj, lib, cur.id), "text/csv") }, "Export schedule (CSV)")),
    h("p", { class: "muted" }, `Dwg column = pack drawing number. Length = measured length where entered, else the estimate (source shown). Exported ${stamp}.`));

  const rows = R.scheduleRows(prj, lib, cur.id);
  add(h("h3", {}, `Wire schedule – ${cur.drawing} (${rows.length} wires)`),
    h("div", { class: "scroll" }, table([...R.SCHEDULE_COLUMNS, "Length source"], rows.map((r) => [...r.cells.map((c, i) => (i === 9 ? h("code", {}, c) : c)), r.length.source]))));

  const ch = R.daisyChains(prj, cur.id);
  const sh = R.sharedTerminals(prj, lib, cur.id);
  add(h("h3", {}, "Daisy chains and shared terminals"),
    ch.length ? table(["Chain", "Wires"], ch.map((c, i) => [i + 1, c.join(", ")])) : h("p", {}, "No daisy chains."),
    sh.length ? table(["Terminal", "Wires", "Sizes (mm²)", "Termination"], sh.map((s) => [s.point, s.wires, s.sizes, s.termination === "ferrule" ? "twin-entry ferrule" : s.termination])) : null);

  if (cur.role === "base") {
    const rp = R.reservedPointsTable(prj);
    add(h("h3", {}, "Free and reserved points"),
      rp.length ? table(["Point", "Reserved for", "Who connects", "Packs allowed", "Used by"], rp.map((r) => [r.point, r.reservedFor, r.who, r.packs || "–", r.used ? h("span", { class: "warn" }, r.used) : "free"])) : h("p", { class: "muted" }, "No reserved points imported."));
  } else {
    const ll = R.landingList(prj, cur.id);
    add(h("h3", {}, "Landing points on the base loom"),
      ll.length ? table(["Point", "Reserved for", "Wires"], ll.map((r) => [r.point, r.reservedFor, r.wires || "not used"])) : h("p", { class: "muted" }, "No reserved points for this pack."));
  }

  add(h("h3", {}, "Ferrules and end fittings"), table(["Item", "Qty"], R.ferruleCounts(prj, lib, cur.id).map((f) => [f.item, f.qty])),
    h("h3", {}, "Total length per size and colour"),
    table(["Size (mm²)", "Colour", "Wires", "Total length (mm)", "Lengths TBC"], R.lengthTotals(prj, lib, cur.id).map((t) => [t.size, t.colour, t.wires, t.length, t.unknown || ""])));
}
