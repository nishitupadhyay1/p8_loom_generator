// Library viewer. Shows every value, and marks unconfirmed ones instead of hiding them.
import { h, table } from "./dom.js";
import { isUnconfirmed, markingEnd, voltageClassOf } from "./library.js";

const UNC = () => h("span", { class: "unc", title: "Not confirmed from a source" }, "unconfirmed");

// Show o[key] formatted, with an "unconfirmed" badge where it applies.
function val(o, key, fmt = (v) => String(v)) {
  const v = o?.[key];
  if (v === null || v === undefined) return UNC();
  const text = fmt(v);
  return isUnconfirmed(o, key) ? h("span", {}, text, " ", UNC()) : text;
}

const fmtRange = (unit) => (r) => {
  if (r.allowed === false) return "not allowed";
  const lo = r.min ?? r.minEach;
  const hi = r.max ?? r.maxEach;
  const each = r.minEach !== undefined || r.maxEach !== undefined ? " each" : "";
  if (lo !== undefined && hi !== undefined) return `${lo}–${hi} ${unit}${each}`;
  if (hi !== undefined) return `up to ${hi} ${unit}${each}`;
  if (lo !== undefined) return `from ${lo} ${unit}${each}`;
  return r.allowed ? "allowed" : "–";
};
const fmtXYZ = (p) => `${p.x}, ${p.y}, ${p.z}`;

function issueList(title, items, cls) {
  if (!items.length) return null;
  return h("details", { class: `issues ${cls}`, open: cls === "bad" },
    h("summary", {}, `${title} (${items.length})`),
    h("ul", {}, items.map((i) => h("li", {}, h("code", {}, i.path), " – ", i.msg ?? (i.value === null ? "no value" : `value ${JSON.stringify(i.value)} not confirmed`)))),
  );
}

export function renderLibrary(container, lib, result, fileName) {
  container.replaceChildren();
  const s = result.stats;

  // Node.append() prints null as the text "null", so drop empty parts first.
  const add = (...parts) => container.append(...parts.flat().filter((x) => x !== null && x !== undefined && x !== false));

  add(
    h("div", { class: "summary" },
      h("p", {}, h("strong", {}, fileName), lib?.libraryRev ? ` – rev ${lib.libraryRev}, ${lib.date}` : ""),
      lib?.note ? h("p", { class: "muted" }, lib.note) : null,
      h("p", { class: result.ok ? "ok" : "bad" },
        result.ok ? "Loaded." : "Not loaded: fix the errors below.",
        ` ${result.errors.length} errors, ${result.warnings.length} warnings, ${result.unconfirmed.length} unconfirmed values.`),
      result.ok ? h("p", {}, `${s.components} components, ${s.connectors} connectors, ${s.terminals} terminals, ${s.colours} colours, ${s.wireTypes} wire types.`) : null,
    ),
    issueList("Errors", result.errors, "bad"),
    issueList("Warnings", result.warnings, "warn"),
    issueList("Unconfirmed values", result.unconfirmed, "unc-list"),
  );
  if (!result.ok) return;

  // Rules
  const r = lib.rules;
  add(
    h("h3", {}, "Rules"),
    table(["Wire size", "Stationary bend (mm)", "Flexible bend (mm)"],
      r.bend.map((b, i) => [`${i === 0 ? "≤" : `> ${r.bend[i - 1].maxSize} to ≤`} ${b.maxSize} mm²`, b.stationary, b.flexible])),
    h("p", {}, `Termination straight: ${r.terminationStraight.length} mm for wires up to ${r.terminationStraight.maxSize} mm². `,
      `Maximum wires per terminal: ${r.maxWiresPerTerminal}. Blocked colours: ${r.blockedColours.join(", ") || "none"}.`),
    r.sizeRule ? table(["Variant", "Default size (mm²)", "Notes", "Source"],
      Object.entries(r.sizeRule).map(([v, rule]) => [v, val(rule, "default"), rule.notes ?? "", rule.source ?? ""])) : null,
  );

  // Colours and wire types
  add(
    h("h3", {}, "Colours"),
    table(["Code", "Name", "Screen"], lib.colours.map((c) => [c.code, c.name ?? "", c.screen ? h("span", { class: "swatch", style: `background:${c.screen}` }) : ""])),
    h("h3", {}, "Wire types"),
    table(["Type", "Kind", "Size (mm²)", "Stranding", "OD (mm)", "Ferrule OD (mm)", "Bend (mm)", "Term. straight (mm)", "Stock colours", "Source"],
      lib.wireTypes.map((w) => {
        const cable = (w.kind ?? "single") === "cable";
        return [w.id, cable ? "cable" : "single core", cable ? "–" : w.size, cable ? "–" : val(w, "stranding"),
          val(w, "od"), cable ? "–" : val(w, "ferruleOd"),
          cable ? `${w.bend.stationary} / ${w.bend.flexible}` : "by rule",
          cable ? w.terminationStraight : "by rule",
          w.stock === undefined ? UNC() : (w.stock.join(", ") || "none listed"), w.source ?? ""];
      })),
  );

  // Components
  add(h("h3", {}, "Components"));
  for (const c of lib.components) {
    const env = c.envelope
      ? h("span", {}, val(c.envelope, "l"), " × ", val(c.envelope, "w"), " × ", val(c.envelope, "h"), " mm", isUnconfirmed(c, "envelope") && c.envelope.l !== null ? [" ", UNC()] : null)
      : UNC();
    const tag = c.defaultTag ?? "TAG";
    add(
      h("details", { class: "comp" },
        h("summary", {}, h("strong", {}, c.defaultTag ?? "(tag per placement)"), ` – ${c.name ?? ""} – ${c.partNumber ?? ""}`),
        h("p", {}, "Envelope L × W × H: ", env, ` · Mounting: ${c.mounting ?? "–"}`, c.source ? ` · Source: ${c.source}` : ""),
        c.notes ? h("p", { class: "muted" }, c.notes) : null,
        c.connectors.map((k) => h("div", { class: "conn" },
          h("h4", {}, `Connector ${k.id}`),
          table(["Mark", "Pitch (mm)", "Accepts", "Twin ferrule", "Strip (mm)", "Torque (N·m)", "Termination", "Voltage", "Source"], [[
            k.mark === "" ? h("em", {}, "(left out)") : k.mark,
            val(k, "pitch"), val(k, "accepts", fmtRange("mm²")), val(k, "twin", fmtRange("mm²")),
            k.strip === undefined ? "–" : val(k, "strip"),
            k.torque === undefined ? "–" : val(k, "torque", fmtRange("")),
            k.termination ?? "ferrule", k.voltageClass, k.source ?? "",
          ]]),
          k.holeBundle ? h("p", { class: "muted" }, `Bundle per hole: inner holes up to ${k.holeBundle.inner} mm, outer holes up to ${k.holeBundle.outer} mm.`) : null,
          k.notes ? h("p", { class: "muted" }, k.notes) : null,
          table(["Terminal", "Name", "Marking end", "Position x, y, z (mm)", "Exit", "Hole", "Voltage"],
            k.terminals.map((t) => [t.id, t.name ?? "", h("code", {}, markingEnd(tag, k, t)),
              val(t, "pos", fmtXYZ), val(t, "exit", fmtXYZ), t.hole ?? "–", voltageClassOf(k, t)])),
        )),
      ),
    );
  }
}
