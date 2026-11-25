// Project panel: new project, packs, tags, schedule import, wire list and wire editor.
import { h, table } from "./dom.js";
import * as P from "./project.js";

const opt = (value, label, selected) => h("option", { value, selected: selected ? true : null }, label ?? value);

function select(values, current, onchange, { blank = null, attrs = {} } = {}) {
  return h("select", { ...attrs, onchange: (e) => onchange(e.target.value) },
    blank !== null ? opt("", blank, current === null || current === "" || current === undefined) : null,
    values.map((v) => (Array.isArray(v) ? opt(v[0], v[1], v[0] === current) : opt(v, v, v === current))));
}

function input(value, onchange, attrs = {}) {
  return h("input", { type: "text", value: value ?? "", ...attrs, onchange: (e) => onchange(e.target.value) });
}

function colourCell(lib, code) {
  const c = lib.colours.find((x) => x.code === code);
  return h("span", { class: c ? "" : "bad" }, c?.screen ? h("span", { class: "swatch", style: `background:${c.screen}` }) : null, " ", code || "–");
}

function endText(prj, lib, ref) {
  const r = P.resolveRef(prj, lib, ref);
  if (!r.terminal) return h("span", { class: "bad", title: "Not found in the library" }, ref?.raw ? `${ref.raw.unit} · ${ref.raw.terminal}` : "–", " ✗");
  const conn = r.connector.id === "-" ? "" : ` ${r.connector.id}`;
  const name = r.terminal.name && r.terminal.name !== r.terminal.id ? ` ${r.terminal.name}` : "";
  return `${ref.tag}${conn} ${r.terminal.id}${name}`;
}

function lengthText(w) {
  if (!w.measured) return "–";
  if (w.measured.length === null) return h("span", { class: "muted" }, w.measured.source);
  return `${w.measured.length} (${w.measured.source})`;
}

// --- Endpoint editor: tag -> connector -> terminal
function endEditor(prj, lib, ref, set) {
  const tags = prj.placements.map((p) => p.tag);
  const r = P.resolveRef(prj, lib, ref);
  const conns = r.component?.connectors ?? [];
  const terms = r.connector?.terminals ?? [];
  return h("span", { class: "end" },
    select(tags, ref?.tag, (tag) => set({ tag: tag || null, connector: null, terminal: null }), { blank: "tag" }), " ",
    select(conns.map((k) => [k.id, k.id === "-" ? "(only)" : k.id]), ref?.connector, (connector) => set({ ...ref, connector, terminal: null, raw: undefined }), { blank: "connector" }), " ",
    select(terms.map((t) => [t.id, t.name && t.name !== t.id ? `${t.id} ${t.name}` : t.id]), ref?.terminal, (terminal) => set({ ...ref, terminal, raw: undefined }), { blank: "terminal" }),
  );
}

export function renderProject(container, state, changed) {
  const lib = state.library;
  const prj = state.project;
  container.replaceChildren();
  const add = (...parts) => container.append(...parts.flat().filter((x) => x !== null && x !== undefined && x !== false));

  if (!lib) { add(h("p", { class: "muted" }, "Load a library first.")); return; }

  // --- New project
  const variants = Object.keys(lib.packTemplates ?? lib.rules.sizeRule ?? {});
  let newVariant = variants[0] ?? "";
  add(h("div", { class: "actions" },
    h("span", {}, "New project for "),
    select(variants, newVariant, (v) => { newVariant = v; }),
    h("button", { type: "button", onclick: () => {
      if (prj && prj.wires.length && !window.confirm("Start a new project? The current one is not saved (saving comes in step 4).")) return;
      state.project = P.newProject(lib, newVariant);
      state.importReport = null; state.selected = null;
      changed();
    } }, "Create"),
  ));
  if (!prj) return;

  if (prj.library?.rev !== lib.libraryRev) add(h("p", { class: "bad" }, `This project was made with library rev ${prj.library?.rev}; rev ${lib.libraryRev} is loaded.`));

  add(h("p", {}, "Project name: ", input(prj.name, (v) => { prj.name = v; changed(); }, { size: 40 }), ` · Variant: ${prj.variant}`));

  // --- Packs
  if (!prj.packs.length) add(h("p", { class: "bad" }, `No packs: the library has no pack templates for ${prj.variant}. Load a library that has "packTemplates", then create the project again.`));
  const count = (id) => prj.wires.filter((w) => w.pack === id).length;
  add(h("h3", {}, "Packs"),
    table(["Pack", "Role", "Drawing number", "Rev", "Wire range", "Wires"], prj.packs.map((p) => [
      p.id, p.role, p.drawing,
      input(p.rev, (v) => { p.rev = v; changed(); }, { size: 4 }),
      `${p.wireRange.prefix}${String(p.wireRange.from).padStart(p.wireRange.digits ?? 2, "0")}–${p.wireRange.prefix}${String(p.wireRange.to).padStart(p.wireRange.digits ?? 2, "0")}`,
      count(p.id),
    ])));

  // --- Tags (placements)
  const unmapped = prj.placements.filter((p) => !p.component);
  const used = (tag) => prj.wires.filter((w) => w.from?.tag === tag || w.to?.tag === tag).length;
  let newTag = "";
  add(h("h3", {}, "Tags"),
    unmapped.length ? h("p", { class: "bad" }, `${unmapped.length} tag(s) have no component: pick one so their wire ends can be found in the library.`) : null,
    table(["Tag", "Component", "Wires"], prj.placements.map((p) => [
      h("strong", {}, p.tag),
      select(lib.components.map((c) => [c.id, `${c.id} – ${c.name ?? ""}`]), p.component, (v) => {
        p.component = v || null;
        for (const w of prj.wires) for (const end of [w.from, w.to]) if (end?.tag === p.tag && end.raw) end.terminal = null;
        P.resolveAll(prj, lib);
        changed();
      }, { blank: "– pick –" }),
      used(p.tag),
    ])),
    h("div", { class: "actions" },
      input("", (v) => { newTag = v.trim(); }, { placeholder: "new tag", size: 8 }),
      h("button", { type: "button", onclick: () => {
        if (!newTag || P.placementByTag(prj, newTag)) return;
        prj.placements.push({ tag: newTag, component: null, plate: null, x: null, y: null, rot: 0 });
        changed();
      } }, "Add tag")),
  );

  // --- Import
  let importPack = prj.packs.find((p) => p.role === "base")?.id;
  add(h("h3", {}, "Import schedule (CSV, Rev C columns)"),
    h("div", { class: "actions" },
      h("span", {}, "Into pack "),
      select(prj.packs.map((p) => p.id), importPack, (v) => { importPack = v; }),
      input(state.importSource, (v) => { state.importSource = v; }, { placeholder: "length source, e.g. Rev C", size: 18 }),
      h("label", { class: "button" }, "Import CSV…",
        h("input", { type: "file", accept: ".csv,text/csv", hidden: true, onchange: async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          state.importReport = { file: f.name, ...P.importScheduleCsv(prj, lib, await f.text(), importPack, state.importSource || f.name) };
          P.sortWires(prj);
          e.target.value = "";
          changed();
        } })),
    ),
    state.importReport ? h("div", { class: "report" },
      h("p", {}, `${state.importReport.file}: ${state.importReport.added.length} wires added, ${state.importReport.skipped.length} skipped, ${state.importReport.problems.length} problems.`),
      [...state.importReport.skipped, ...state.importReport.problems].length
        ? h("ul", {}, [...state.importReport.skipped, ...state.importReport.problems].map((x) => h("li", {}, x))) : null,
    ) : null,
  );

  // --- Wires
  const unresolved = prj.wires.filter((w) => !P.isResolved(prj, lib, w.from) || !P.isResolved(prj, lib, w.to));
  const differ = prj.wires.filter((w) => P.markingDiffers(prj, lib, w));
  let addPack = importPack;
  add(h("h3", {}, `Wires (${prj.wires.length})`),
    h("p", {},
      h("span", { class: unresolved.length ? "bad" : "ok" }, `${unresolved.length} with an end not found in the library`), " · ",
      h("span", { class: differ.length ? "bad" : "ok" }, `${differ.length} where the imported marking differs from the generated one`)),
    h("div", { class: "actions" },
      h("span", {}, "Add wire to pack "),
      select(prj.packs.map((p) => p.id), addPack, (v) => { addPack = v; }),
      h("button", { type: "button", onclick: () => {
        const id = P.nextWireNumber(prj, addPack);
        if (!id) return;
        prj.wires.push({ id, pack: addPack, dwg: "", from: { tag: null, connector: null, terminal: null }, to: { tag: null, connector: null, terminal: null },
          function: "", type: lib.rules.sizeRule?.[prj.variant]?.default != null ? String(lib.rules.sizeRule[prj.variant].default) : "", colour: "", markingOverride: null, importedMarking: null, measured: null });
        P.sortWires(prj);
        state.selected = id;
        changed();
      } }, "Add wire")),
  );

  const wireTable = h("table", { class: "wires" },
    h("thead", {}, h("tr", {}, ["Wire", "Pack", "From", "To", "Function", "Size", "Colour", "Marking", "Length (mm)"].map((x) => h("th", {}, x)))),
    h("tbody", {}, prj.wires.map((w) => {
      const mark = P.markingOf(prj, lib, w);
      return h("tr", { class: w.id === state.selected ? "sel" : "", onclick: () => { state.selected = w.id; changed(); } },
        h("td", {}, w.id), h("td", {}, w.pack),
        h("td", {}, endText(prj, lib, w.from)), h("td", {}, endText(prj, lib, w.to)),
        h("td", {}, w.function), h("td", {}, w.type || "–"), h("td", {}, colourCell(lib, w.colour)),
        h("td", {}, mark ? h("code", {}, mark) : h("span", { class: "bad" }, "–"),
          w.markingOverride ? h("span", { class: "unc", title: "Typed override" }, "override") : null,
          P.markingDiffers(prj, lib, w) ? h("div", { class: "bad small" }, `imported: ${w.importedMarking}`) : null),
        h("td", {}, lengthText(w)));
    })));
  add(h("div", { class: "scroll" }, wireTable));

  // --- Wire editor
  const w = prj.wires.find((x) => x.id === state.selected);
  if (w) add(wireEditor(prj, lib, w, state, changed));
}

function wireEditor(prj, lib, w, state, changed) {
  const msg = h("span", { class: "bad" });
  const gen = P.generatedMarking(prj, lib, w);
  return h("div", { class: "editor" },
    h("h3", {}, `Edit ${w.id}`),
    h("table", {}, h("tbody", {},
      h("tr", {}, h("th", {}, "Wire number"), h("td", {}, input(w.id, (v) => {
        v = v.trim();
        if (!v || prj.wires.some((x) => x !== w && x.id === v)) { msg.textContent = `Wire number ${v || "(blank)"} is already used or blank.`; return; }
        w.id = v; state.selected = v; P.sortWires(prj); changed();
      }, { size: 6 }), " ", msg)),
      h("tr", {}, h("th", {}, "Pack"), h("td", {}, select(prj.packs.map((p) => p.id), w.pack, (v) => { w.pack = v; changed(); }))),
      h("tr", {}, h("th", {}, "From"), h("td", {}, endEditor(prj, lib, w.from, (ref) => { w.from = ref; changed(); }))),
      h("tr", {}, h("th", {}, "To"), h("td", {}, endEditor(prj, lib, w.to, (ref) => { w.to = ref; changed(); }))),
      h("tr", {}, h("th", {}, "Function"), h("td", {}, input(w.function, (v) => { w.function = v; changed(); }, { size: 60 }))),
      h("tr", {}, h("th", {}, "Size / type"), h("td", {}, select(lib.wireTypes.map((t) => [t.id, (t.kind ?? "single") === "cable" ? `${t.id} (cable)` : `${t.id} mm²`]), w.type, (v) => { w.type = v; changed(); }, { blank: "–" }))),
      h("tr", {}, h("th", {}, "Colour"), h("td", {},
        select(lib.colours.map((c) => [c.code, `${c.code} – ${c.name ?? ""}`]), w.colour, (v) => { w.colour = v; changed(); }, { blank: "–" }),
        h("span", { class: "muted" }, ` Blocked (earth bonding): ${lib.rules.blockedColours.join(", ")}`))),
      h("tr", {}, h("th", {}, "Marking"), h("td", {},
        h("div", {}, "Generated: ", gen ? h("code", {}, gen) : h("span", { class: "bad" }, "both ends must be found first")),
        h("div", {}, "Override: ", input(w.markingOverride, (v) => { w.markingOverride = v.trim() || null; changed(); }, { size: 50, placeholder: "blank = use generated" })),
        w.importedMarking ? h("div", { class: "muted" }, `Imported: ${w.importedMarking}`) : null)),
      h("tr", {}, h("th", {}, "Measured length (mm)"), h("td", {},
        input(w.measured?.length ?? "", (v) => {
          v = v.trim();
          if (v === "") { w.measured = w.measured?.source ? { ...w.measured, length: null } : null; changed(); return; }
          const n = Number(v);
          if (!Number.isFinite(n) || n <= 0) { msg.textContent = "Length must be a positive number in mm."; return; }
          w.measured = { length: n, source: w.measured?.source ?? "" }; changed();
        }, { size: 6 }), " source ",
        input(w.measured?.source ?? "", (v) => { w.measured = { length: w.measured?.length ?? null, source: v.trim() }; changed(); }, { size: 30, placeholder: "e.g. EL, Rev C" }))),
    )),
    h("div", { class: "actions" },
      h("button", { type: "button", onclick: () => { state.selected = null; changed(); } }, "Close"),
      h("button", { type: "button", class: "danger", onclick: () => {
        if (!window.confirm(`Delete ${w.id}?`)) return;
        prj.wires = prj.wires.filter((x) => x !== w); state.selected = null; changed();
      } }, "Delete wire")),
  );
}
