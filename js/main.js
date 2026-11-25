import { APP_VERSION, APP_STEP } from "./version.js";
import { validateLibrary } from "./library.js";
import { renderLibrary } from "./ui-library.js";
import { renderProject } from "./ui-project.js";
import { renderLayout } from "./ui-layout.js";
import { renderReports } from "./ui-reports.js";
import { resolveAll, upgradeProject, checkProjectFile } from "./project.js";
import { download } from "./reports.js";
import { View3D } from "./view3d.js";

const $ = (id) => document.getElementById(id);
$("version").textContent = `v${APP_VERSION}`;
$("version").title = APP_STEP;

// App state lives in this browser tab; it is autosaved to this browser's storage only.
const state = { library: null, libraryText: null, libraryName: null, project: null, selected: null, importReport: null, importSource: "", dirty: false };
const AUTOSAVE_KEY = "p8lg.autosave.v1";

// ---- 3D view
let view = null;
let measuring = false;
const marks = [];
function view3d() {
  if (!view) view = new View3D($("view3d"), onPick);
  return view;
}
function onPick(d) {
  if (measuring) {
    if (marks.length === 2) marks.length = 0;
    marks.push(d);
  }
  showPick(d);
  render3d();
}
function showPick(d) {
  const f = (p) => `X ${p.x.toFixed(1)}, Y ${p.y.toFixed(1)}, Z ${p.z.toFixed(1)}`;
  const lines = [];
  if (d) lines.push(`Picked: ${d.kind} ${d.name} – ${f(d.point)}`);
  marks.forEach((m, i) => lines.push(`P${i + 1}: ${m.kind} ${m.name} – ${f(m.point)}`));
  if (marks.length === 2) {
    const [a, b] = marks.map((m) => m.point);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    lines.push(`ΔX ${dx.toFixed(1)} · ΔY ${dy.toFixed(1)} · ΔZ ${dz.toFixed(1)} · distance ${Math.hypot(dx, dy, dz).toFixed(1)} mm (straight line)`);
  }
  $("pick-info").textContent = lines.join("\n") || (measuring
    ? "Measure: click two points (terminals, component corners, ties, duct ends, plate corners)."
    : "Drag to rotate, right-drag to pan, scroll to zoom. Select a wire in the wire list to highlight its route.");
}
function render3d() {
  if (!state.project || !state.library) return;
  view3d().render(state.project, state.library, { angle: Number($("hinge-slider").value), selected: state.selected, selectedOnly: $("sel-only").checked, measure: measuring, marks });
}
$("hinge-slider").addEventListener("input", (e) => { $("hinge-deg").textContent = `${e.target.value}°`; render3d(); });
$("sel-only").addEventListener("change", render3d);
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { const v = view3d(); if (b.dataset.view === "fit") v.fit(); else v.view(b.dataset.view); }));
$("measure-btn").addEventListener("click", () => { measuring = !measuring; $("measure-btn").classList.toggle("on", measuring); showPick(null); render3d(); });
$("clear-marks").addEventListener("click", () => { marks.length = 0; showPick(null); render3d(); });

// ---- Render everything after a change
const counts = $("issue-counts");
function renderAll(fromUser = true) {
  renderProject($("project-view"), state, renderAll);
  renderLayout($("layout-view"), state, renderAll);
  renderReports($("outputs-view"), state);
  const n = state.issueCounts;
  counts.textContent = n ? `${n.error} errors · ${n.warning} warnings · ${n.note} notes · ${n.accepted} accepted` : "";
  counts.className = n ? (n.error ? "bad" : n.warning ? "warn" : "ok") : "";
  const ha = state.project?.hinge?.openAngle;
  $("hinge-slider").max = typeof ha === "number" && ha > 0 ? ha : 90;
  render3d();
  if (fromUser !== false) { state.dirty = true; autosave(); }
}

// ---- Autosave (this browser only)
let saveTimer = null;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ libraryText: state.libraryText, libraryName: state.libraryName, project: state.project, dirty: state.dirty, at: new Date().toISOString() }));
      $("autosave").textContent = `Autosaved ${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}${state.dirty ? " · not saved to a file" : ""}`;
    } catch (e) {
      $("autosave").textContent = `Autosave failed: ${e.message}`;
    }
  }, 400);
}
window.addEventListener("beforeunload", (e) => { if (state.dirty && state.project?.wires.length) { e.preventDefault(); e.returnValue = ""; } });

// ---- Library
function loadLibrary(text, fileName, quiet = false) {
  const det = $("library-details");
  let lib;
  try {
    lib = JSON.parse(text);
  } catch (e) {
    renderLibrary($("library-view"), null, { ok: false, errors: [{ path: "(file)", msg: `not valid JSON: ${e.message}` }], warnings: [], unconfirmed: [], stats: {} }, fileName);
    det.open = true;
    det.querySelector("summary").textContent = `Library: ${fileName} – NOT loaded (not valid JSON).`;
    det.querySelector("summary").className = "bad";
    state.library = null;
    renderAll(!quiet);
    return;
  }
  const result = validateLibrary(lib);
  state.library = result.ok ? lib : null;
  if (result.ok) { state.libraryText = text; state.libraryName = fileName.replace(/ \(restored\)$/, ""); }
  renderLibrary($("library-view"), lib, result, fileName);
  det.open = !result.ok;
  det.querySelector("summary").textContent = result.ok
    ? `Library: ${fileName}, rev ${lib.libraryRev} – loaded (${result.unconfirmed.length} unconfirmed values). Click for details.`
    : `Library: ${fileName} – NOT loaded (${result.errors.length} errors).`;
  det.querySelector("summary").className = result.ok ? "ok" : "bad";
  if (state.library && state.project) resolveAll(state.project, state.library);
  if (!quiet) renderAll();
}

$("library-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  loadLibrary(await file.text(), file.name);
  e.target.value = "";
});
$("library-sample").addEventListener("click", async () => {
  const res = await fetch("samples/sample-library.json", { cache: "no-store" });
  loadLibrary(await res.text(), "sample-library.json (dummy)");
});

// ---- Project file
$("save-project").addEventListener("click", () => {
  if (!state.project) return;
  const p = state.project;
  p.appVersion = APP_VERSION;
  p.savedAt = new Date().toISOString();
  const name = `${(p.name || "project").replace(/[^\w.-]+/g, "_")}_${p.savedAt.slice(0, 10)}.p8loom.json`;
  download(name, JSON.stringify(p, null, 2), "application/json");
  state.dirty = false;
  autosave();
});
$("open-project").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (err) { window.alert(`${file.name}: not valid JSON (${err.message})`); return; }
  const problem = checkProjectFile(obj);
  if (problem) { window.alert(`${file.name}: ${problem}`); return; }
  if (state.project?.wires.length && state.dirty && !window.confirm("Replace the current project? It has changes not saved to a file.")) return;
  state.project = upgradeProject(obj);
  state.selected = null; state.importReport = null;
  if (state.library) resolveAll(state.project, state.library);
  if (state.library && obj.library?.rev && obj.library.rev !== state.library.libraryRev)
    window.alert(`This project was saved with library rev ${obj.library.rev}; rev ${state.library.libraryRev} is loaded.`);
  if (view) view.fitted = false;
  state.dirty = false;
  renderAll(false);
  autosave();
});

// ---- Start: restore the autosave
try {
  const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? "null");
  if (saved?.libraryText) loadLibrary(saved.libraryText, `${saved.libraryName} (restored)`, true);
  if (saved?.project) {
    state.project = upgradeProject(saved.project);
    if (state.library) resolveAll(state.project, state.library);
    state.dirty = !!saved.dirty;
  }
  renderAll(false);
  if (saved?.at) $("autosave").textContent = `Restored autosave from ${new Date(saved.at).toLocaleString("en-AU")}${state.dirty ? " · not saved to a file" : ""}`;
} catch (e) {
  console.error(e);
  renderAll(false);
}
