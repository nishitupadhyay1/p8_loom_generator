import { APP_VERSION, APP_STEP } from "./version.js";
import { validateLibrary } from "./library.js";
import { renderLibrary } from "./ui-library.js";
import { renderProject } from "./ui-project.js";
import { resolveAll } from "./project.js";

document.getElementById("version").textContent = `v${APP_VERSION}`;
document.getElementById("step").textContent = APP_STEP;

// App state lives in this browser tab only (autosave and project files come in step 4).
const state = { library: null, project: null, selected: null, importReport: null, importSource: "" };

const libOut = document.getElementById("library-view");
const prjOut = document.getElementById("project-view");

const renderAll = () => renderProject(prjOut, state, renderAll);

function loadLibrary(text, fileName) {
  let lib;
  try {
    lib = JSON.parse(text);
  } catch (e) {
    renderLibrary(libOut, null, { ok: false, errors: [{ path: "(file)", msg: `not valid JSON: ${e.message}` }], warnings: [], unconfirmed: [], stats: {} }, fileName);
    const det = document.getElementById("library-details");
    det.open = true;
    det.querySelector("summary").textContent = `Library: ${fileName} – NOT loaded (not valid JSON).`;
    det.querySelector("summary").className = "bad";
    state.library = null;
    renderAll();
    return;
  }
  const result = validateLibrary(lib);
  state.library = result.ok ? lib : null;
  renderLibrary(libOut, lib, result, fileName);
  const det = document.getElementById("library-details");
  det.open = !result.ok;
  det.querySelector("summary").textContent = result.ok
    ? `Library: ${fileName}, rev ${lib.libraryRev} – loaded (${result.unconfirmed.length} unconfirmed values). Click for details.`
    : `Library: ${fileName} – NOT loaded (${result.errors.length} errors).`;
  det.querySelector("summary").className = result.ok ? "ok" : "bad";
  if (state.library && state.project) resolveAll(state.project, state.library);
  renderAll();
}

document.getElementById("library-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  loadLibrary(await file.text(), file.name);
  e.target.value = ""; // allow re-loading the same file after editing it
});

document.getElementById("library-sample").addEventListener("click", async () => {
  const res = await fetch("samples/sample-library.json", { cache: "no-store" });
  loadLibrary(await res.text(), "sample-library.json (dummy)");
});

renderAll();
