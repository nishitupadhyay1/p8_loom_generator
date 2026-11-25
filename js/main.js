import { APP_VERSION, APP_STEP } from "./version.js";

document.getElementById("version").textContent = `v${APP_VERSION}`;
document.getElementById("step").textContent = APP_STEP;

// Browser features the app relies on later (file import/export, autosave).
const checks = [
  ["ES modules", true],
  ["File reading (FileReader)", "FileReader" in window],
  ["Browser storage (localStorage)", (() => {
    try { localStorage.setItem("p8lg-test", "1"); localStorage.removeItem("p8lg-test"); return true; }
    catch { return false; }
  })()],
  ["File download (Blob)", "Blob" in window && "URL" in window],
];

const list = document.getElementById("checks");
for (const [name, pass] of checks) {
  const li = document.createElement("li");
  li.textContent = `${name}: ${pass ? "OK" : "not available"}`;
  li.className = pass ? "ok" : "bad";
  list.appendChild(li);
}
