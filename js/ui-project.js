// Project panel: new project, packs, tags, schedule import, wire list and wire editor.
import { h, table } from "./dom.js";
import * as P from "./project.js";
import { runChecks, countIssues } from "./checks.js";

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

  state.issueCounts = null;
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

  // --- Reserved points
  const unresRes = P.unresolvedReservations(prj, lib);
  add(h("h3", {}, `Reserved points (${prj.reservations?.length ?? 0})`),
    h("p", { class: "muted" }, "Free and reserved points from the base schedule. Only the packs listed may land on a reserved point; a point with no pack stays empty in every loom (site, BMS, mains or spare)."),
    h("div", { class: "actions" },
      h("label", { class: "button" }, "Import reserved points CSV…",
        h("input", { type: "file", accept: ".csv,text/csv", hidden: true, onchange: async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          state.resReport = { file: f.name, ...P.importReservationsCsv(prj, lib, await f.text()) };
          e.target.value = "";
          changed();
        } }))),
    state.resReport ? h("p", {}, `${state.resReport.file}: ${state.resReport.added.length} added, ${state.resReport.replaced.length} replaced, ${state.resReport.problems.length} problems.`,
      state.resReport.problems.length ? h("ul", {}, state.resReport.problems.map((x) => h("li", { class: "bad" }, x))) : null) : null,
    unresRes.length ? h("p", { class: "bad" }, `${unresRes.length} reserved point(s) not found in the library: ${unresRes.map((r) => `${r.tag} ${r.connector} ${r.terminal}`).join(", ")}`) : null,
    prj.reservations?.length ? h("details", {}, h("summary", {}, "Show reserved points"),
      table(["Point", "Packs allowed", "Reserved for", "Who connects", ""], prj.reservations.map((r, i) => [
        `${r.tag}${r.connector === "-" ? "" : " " + r.connector} ${r.terminal}`, r.packs || h("em", {}, "none – stays empty"), r.reservedFor, r.who,
        h("button", { type: "button", onclick: () => { prj.reservations.splice(i, 1); changed(); } }, "Remove")]))) : null,
  );

  // --- Issues
  const issues = runChecks(prj, lib);
  const n = countIssues(issues);
  state.issueCounts = n;
  state.issues = issues;
  const filter = state.issueFilter ?? "open";
  const shown = issues.filter((i) => filter === "all" || (filter === "open" && !i.accepted && i.level !== "note") || (filter === "notes" && i.level === "note" && !i.accepted) || (filter === "accepted" && i.accepted));
  const byWire = new Map();
  for (const i of issues) if (i.wire && !i.accepted && i.level !== "note") byWire.set(i.wire, (byWire.get(i.wire) ?? 0) + 1);
  add(h("h3", {}, "Issues"),
    h("p", {},
      h("span", { class: n.error ? "bad" : "ok" }, `${n.error} errors`), " · ",
      h("span", { class: n.warning ? "warn" : "ok" }, `${n.warning} warnings`), " · ",
      h("span", { class: "muted" }, `${n.note} notes (not checked: values unconfirmed) · ${n.accepted} accepted`)),
    h("div", { class: "actions" }, [["open", "Errors and warnings"], ["notes", "Notes"], ["accepted", "Accepted"], ["all", "All"]].map(([f, l]) =>
      h("button", { type: "button", class: f === filter ? "on" : "", onclick: () => { state.issueFilter = f; changed(); } }, l))),
    shown.length ? h("div", { class: "issue-list" }, table(["Level", "Check", "Issue", ""], shown.map((i) => [
      h("span", { class: i.accepted ? "muted" : i.level === "error" ? "bad" : i.level === "warning" ? "warn" : "muted" }, i.accepted ? "accepted" : i.level),
      i.code,
      h("span", {}, i.msg, i.accepted ? h("div", { class: "muted small" }, `Accepted ${i.accepted.date}: ${i.accepted.reason}`) : null),
      h("span", {},
        i.wire ? h("button", { type: "button", onclick: () => { state.selected = i.wire; changed(); } }, "Show") : null, " ",
        i.accepted
          ? h("button", { type: "button", onclick: () => { prj.exceptions = prj.exceptions.filter((e) => e.id !== i.id); changed(); } }, "Un-accept")
          : i.level !== "note" ? h("button", { type: "button", onclick: () => {
              const reason = window.prompt(`Accept this ${i.level} as an exception?\n\n${i.msg}\n\nReason (required):`);
              if (!reason || !reason.trim()) return;
              prj.exceptions.push({ id: i.id, code: i.code, msg: i.msg, reason: reason.trim(), date: new Date().toISOString().slice(0, 10) });
              changed();
            } }, "Accept…") : null),
    ]))) : h("p", { class: "ok" }, "Nothing to show."),
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
      } }, "Add wire"),
      sizeRuleButton(prj, lib, () => addPack, changed)),
  );

  const wireTable = h("table", { class: "wires" },
    h("thead", {}, h("tr", {}, ["Wire", "Pack", "From", "To", "Function", "Size", "Colour", "Marking", "Length (mm)"].map((x) => h("th", {}, x)))),
    h("tbody", {}, prj.wires.map((w) => {
      const mark = P.markingOf(prj, lib, w);
      return h("tr", { class: w.id === state.selected ? "sel" : "", onclick: () => { state.selected = w.id; changed(); } },
        h("td", {}, w.id, byWire.get(w.id) ? h("span", { class: "badge", title: "Open errors and warnings" }, byWire.get(w.id)) : null), h("td", {}, w.pack),
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
  const mine = (state.issues ?? []).filter((i) => i.wire === w.id && !i.accepted);
  return h("div", { class: "editor" },
    h("h3", {}, `Edit ${w.id}`),
    mine.length ? h("ul", {}, mine.map((i) => h("li", { class: i.level === "error" ? "bad" : i.level === "warning" ? "warn" : "muted" }, `${i.level}: ${i.msg}`))) : h("p", { class: "ok" }, "No issues on this wire."),
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

// Bulk change: set every single-core wire in a pack to the variant's size rule (for moving Rev C to Rev D).
function sizeRuleButton(prj, lib, packOf, changed) {
  const def = lib.rules.sizeRule?.[prj.variant]?.default;
  if (def === null || def === undefined) return null;
  const type = lib.wireTypes.find((t) => (t.kind ?? "single") === "single" && t.size === def);
  if (!type) return null;
  return h("button", { type: "button", onclick: () => {
    const pack = packOf();
    const hit = prj.wires.filter((w) => w.pack === pack && w.type !== type.id && (lib.wireTypes.find((t) => t.id === w.type)?.kind ?? "single") === "single");
    if (!hit.length) { window.alert(`All single-core wires in ${pack} are already ${def} mm².`); return; }
    if (!window.confirm(`Change ${hit.length} single-core wire(s) in ${pack} to ${def} mm² (the ${prj.variant} size rule)?\n\n${hit.map((w) => w.id).join(", ")}\n\nCables (Cat) are not changed.`)) return;
    for (const w of hit) w.type = type.id;
    changed();
  } }, `Apply ${def} mm² size rule to pack`);
}
