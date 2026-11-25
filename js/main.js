import { APP_VERSION, APP_STEP } from "./version.js";
import { validateLibrary } from "./library.js";
import { renderLibrary } from "./ui-library.js";

document.getElementById("version").textContent = `v${APP_VERSION}`;
document.getElementById("step").textContent = APP_STEP;

// App state. The library lives only in this browser tab (autosave comes in step 4).
export const state = { library: null };

const out = document.getElementById("library-view");

function load(text, fileName) {
  let lib;
  try {
    lib = JSON.parse(text);
  } catch (e) {
    renderLibrary(out, null, { ok: false, errors: [{ path: "(file)", msg: `not valid JSON: ${e.message}` }], warnings: [], unconfirmed: [], stats: {} }, fileName);
    state.library = null;
    return;
  }
  const result = validateLibrary(lib);
  state.library = result.ok ? lib : null;
  renderLibrary(out, lib, result, fileName);
}

document.getElementById("library-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  load(await file.text(), file.name);
  e.target.value = ""; // allow re-loading the same file after editing it
});

document.getElementById("library-sample").addEventListener("click", async () => {
  const res = await fetch("samples/sample-library.json", { cache: "no-store" });
  load(await res.text(), "sample-library.json (dummy)");
});
