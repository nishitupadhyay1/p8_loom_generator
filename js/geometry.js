// 3D geometry, routing and length estimate (Phase 0 steps 5 and 7).
//
// Frame: global X right, Y up, Z out of the backplate (mm). All coordinates are entered with the
// hinge CLOSED. Plates are rectangles in a plane of constant Z; a plate that "moves" rotates
// about the hinge axis (a line parallel to Y through hinge.x, hinge.z).
//
// A placement's X, Y, Z is the component datum: the envelope corner at min X, min Y on the plate
// surface. Envelope L runs along X, W along Y, H away from the plate (plate.facing: +1 = +Z, -1 = -Z).
// Library terminal positions and exit directions are relative to that datum in the same axes.
import { resolveRef, componentById } from "./project.js";

export const DEFAULT_BOX = { l: 20, w: 20, h: 20 }; // drawn when an envelope is unconfirmed

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, s) => v(a.x * s, a.y * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const unit = (a) => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : v(); };
export const vec = { v, add, sub, mul, dot, len, unit };
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const hasXYZ = (p) => p && isNum(p.x) && isNum(p.y) && isNum(p.z);

export const plateById = (prj, id) => (prj.plates ?? []).find((p) => p.id === id) ?? null;

// Hinge rotation of a point or direction (about the axis parallel to Y through hinge.x, hinge.z).
export function hingeAngle(prj, mode) {
  const hg = prj.hinge;
  if (!hg || !isNum(hg.x) || !isNum(hg.z)) return 0;
  if (typeof mode === "number") return (mode * Math.PI) / 180; // view angle in degrees
  const open = mode === "open" || (mode === undefined && hg.lengthsAt === "open");
  return open && isNum(hg.openAngle) ? (hg.openAngle * Math.PI) / 180 : 0;
}
function rotHinge(prj, p, ang, isDir) {
  if (!ang) return p;
  const hx = isDir ? 0 : prj.hinge.x;
  const hz = isDir ? 0 : prj.hinge.z;
  const dx = p.x - hx, dz = p.z - hz;
  const c = Math.cos(ang), s = Math.sin(ang);
  return v(hx + dx * c + dz * s, p.y, hz - dx * s + dz * c);
}

// Component-local -> global (rotation about the plate normal in 90° steps, facing, hinge).
function toGlobal(prj, placement, local, isDir, ang) {
  const plate = plateById(prj, placement.plate);
  const facing = plate?.facing === -1 ? -1 : 1;
  const r = ((placement.rot ?? 0) * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e6) / 1e6, s = Math.round(Math.sin(r) * 1e6) / 1e6;
  const q = v(local.x * c - local.y * s, local.x * s + local.y * c, local.z * facing);
  let g = isDir ? q : add(v(placement.x, placement.y, placement.z), q);
  if (plate?.moves) g = rotHinge(prj, g, ang, isDir);
  return g;
}

export function placementPlaced(pl) { return pl && isNum(pl.x) && isNum(pl.y) && isNum(pl.z) && !!pl.plate; }

export function envelopeOf(component) {
  const e = component?.envelope;
  const ok = e && isNum(e.l) && isNum(e.w) && isNum(e.h);
  return { l: ok ? e.l : DEFAULT_BOX.l, w: ok ? e.w : DEFAULT_BOX.w, h: ok ? e.h : DEFAULT_BOX.h, approx: !ok };
}

// The 8 corners of a placed component's envelope (global).
export function boxCorners(prj, lib, pl, ang) {
  const env = envelopeOf(componentById(lib, pl.component));
  const out = [];
  for (const x of [0, env.l]) for (const y of [0, env.w]) for (const z of [0, env.h]) out.push(toGlobal(prj, pl, v(x, y, z), false, ang));
  return { corners: out, env };
}

/** Global position and exit direction of a wire end. approx = library position or exit unconfirmed. */
export function terminalPoint(prj, lib, ref, ang) {
  const r = resolveRef(prj, lib, ref);
  if (!r.terminal || !placementPlaced(r.placement)) return null;
  const env = envelopeOf(r.component);
  const t = r.terminal;
  const posKnown = hasXYZ(t.pos) && !(t.unconfirmed ?? []).includes("pos");
  const exitKnown = hasXYZ(t.exit) && len(t.exit) > 0 && !(t.unconfirmed ?? []).includes("exit");
  const local = hasXYZ(t.pos) ? t.pos : v(env.l / 2, env.w / 2, env.h);
  const dir = hasXYZ(t.exit) && len(t.exit) > 0 ? unit(t.exit) : v(0, 0, 1);
  const plate = plateById(prj, r.placement.plate);
  return {
    p: toGlobal(prj, r.placement, local, false, ang),
    dir: unit(toGlobal(prj, r.placement, dir, true, ang)),
    moves: !!plate?.moves,
    approx: !posKnown || !exitKnown || env.approx,
    r,
  };
}

export function anchorPoints(prj, a, ang) {
  const plate = plateById(prj, a.plate);
  const g = (p) => (plate?.moves ? rotHinge(prj, p, ang, false) : p);
  const p1 = g(v(a.x, a.y, a.z));
  const p2 = a.type === "line" ? g(v(a.x2, a.y2, a.z2)) : null;
  return { p1, p2, moves: !!plate?.moves };
}

// Point on duct line a->b nearest to q, snapped to slot positions if a pitch is given.
function onLine(a, b, q, pitch) {
  const d = sub(b, a);
  const L = len(d);
  if (L < 1e-9) return { p: a, s: 0 };
  let s = Math.max(0, Math.min(L, dot(sub(q, a), d) / L));
  if (isNum(pitch) && pitch > 0) s = Math.max(0, Math.min(L, Math.round(s / pitch) * pitch));
  return { p: add(a, mul(unit(d), s)), s };
}

// ---- Rules from the library
export function bendRadius(lib, type, flexible) {
  if (!type) return null;
  if ((type.kind ?? "single") === "cable") return flexible ? type.bend?.flexible : type.bend?.stationary;
  const band = lib.rules.bend.find((b) => type.size <= b.maxSize);
  return band ? (flexible ? band.flexible : band.stationary) : null;
}
export function terminationStraight(lib, type) {
  if (!type) return 0;
  if ((type.kind ?? "single") === "cable") return type.terminationStraight ?? 0;
  const ts = lib.rules.terminationStraight;
  return type.size <= ts.maxSize ? ts.length : 0;
}

function bendAt(prev, at, next) {
  const a = unit(sub(at, prev)), b = unit(sub(next, at));
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  return Math.acos(c); // deflection angle, 0 = straight on
}

/**
 * Route and length estimate for one wire.
 * Returns { ok, reason?, points[], bends[], length, parts{straights, runs, arcs, external}, problems[], approx }
 */
export function routeWire(prj, lib, w, mode) {
  const ang = hingeAngle(prj, mode);
  const type = lib.wireTypes.find((t) => t.id === w.type) ?? null;
  const problems = [];
  if (!type) return { ok: false, reason: "size / type not set" };

  const ends = [["from", w.from], ["to", w.to]].map(([name, ref]) => {
    const r = resolveRef(prj, lib, ref);
    const ext = w.extLength?.[name];
    if (!r.terminal) return { name, missing: "end not found in the library" };
    if (!placementPlaced(r.placement)) {
      if (isNum(ext)) return { name, external: ext, r };
      return { name, missing: `${ref.tag} has no position${r.component?.mounting === "external" ? " (external: enter an external length)" : ""}` };
    }
    return { name, tp: terminalPoint(prj, lib, ref, ang), external: isNum(ext) ? ext : 0, r };
  });
  for (const e of ends) if (e.missing) return { ok: false, reason: `${e.name} end: ${e.missing}` };

  const ids = anchorIds(prj, w);
  const anchors = ids.map((id) => (prj.anchors ?? []).find((a) => a.id === id));
  const unknown = ids.filter((id, i) => !anchors[i]);
  if (unknown.length) return { ok: false, reason: `anchor(s) not found: ${unknown.join(", ")}` };
  if (ends.some((e) => !e.tp) && !anchors.length) return { ok: false, reason: "an off-plate end needs at least one anchor (the exit point)" };

  const Ls = terminationStraight(lib, type);
  const pts = []; // { p, moves, kind }
  const [A, B] = ends;
  if (A.tp) { pts.push({ p: A.tp.p, moves: A.tp.moves, kind: "terminal" }); pts.push({ p: add(A.tp.p, mul(A.tp.dir, Ls)), moves: A.tp.moves, kind: "straight-end", dir: A.tp.dir, base: A.tp.p }); }

  // Anchors in order; lines resolved against neighbours afterwards
  const seq = anchors.map((a) => ({ a, ...anchorPoints(prj, a, ang) }));
  const tailTarget = B.tp ? add(B.tp.p, mul(B.tp.dir, Ls)) : null;
  for (let i = 0; i < seq.length; i++) {
    const s = seq[i];
    if (s.a.type !== "line") { pts.push({ p: s.p1, moves: s.moves, kind: s.a.type, id: s.a.id }); continue; }
    const prev = pts.length ? pts[pts.length - 1].p : null;
    const nxt = i + 1 < seq.length ? seq[i + 1].p1 : tailTarget;
    const inn = onLine(s.p1, s.p2, prev ?? nxt ?? s.p1, s.a.slotPitch);
    const out = onLine(s.p1, s.p2, nxt ?? prev ?? s.p2, s.a.slotPitch);
    pts.push({ p: inn.p, moves: s.moves, kind: "duct-in", id: s.a.id });
    if (Math.abs(out.s - inn.s) > 1e-6) pts.push({ p: out.p, moves: s.moves, kind: "duct-out", id: s.a.id, run: Math.abs(out.s - inn.s) });
  }
  if (B.tp) { pts.push({ p: tailTarget, moves: B.tp.moves, kind: "straight-end", dir: B.tp.dir, base: B.tp.p }); pts.push({ p: B.tp.p, moves: B.tp.moves, kind: "terminal" }); }

  // Drop zero-length steps
  const P = pts.filter((q, i) => i === 0 || len(sub(q.p, pts[i - 1].p)) > 1e-6);
  if (P.length < 2) return { ok: false, reason: "route has fewer than two points" };

  // Bends: radius by size, flexible if a neighbouring segment crosses the hinge
  const segCross = (i) => P[i].moves !== P[i + 1].moves;
  const computeBends = () => {
    const out = [];
    for (let i = 1; i < P.length - 1; i++) {
      const th = bendAt(P[i - 1].p, P[i].p, P[i + 1].p);
      if (th < 1e-6) { out.push({ i, th: 0, r: 0, T: 0, flex: false }); continue; }
      const flex = segCross(i - 1) || segCross(i);
      const r = bendRadius(lib, type, flex);
      out.push({ i, th, r, T: r ? r * Math.tan(th / 2) : 0, flex });
    }
    return out;
  };
  // Keep the termination straight truly straight: push the first bend out by its tangent length (3 passes).
  // A near-U-turn has a huge tangent (r·tan(θ/2)); the push is capped and the turn reported instead.
  const maxPush = Math.max(Ls, 50);
  let bends = computeBends();
  for (let pass = 0; pass < 3 && Ls > 0; pass++) {
    for (const k of [1, P.length - 2]) {
      const q = P[k];
      if (q.kind !== "straight-end") continue;
      const b = bends.find((x) => x.i === k);
      q.p = add(q.base, mul(q.dir, Ls + Math.min(b?.T ?? 0, maxPush)));
    }
    bends = computeBends();
  }
  for (const k of [1, P.length - 2]) {
    const b = bends.find((x) => x.i === k);
    if (P[k]?.kind === "straight-end" && b && b.T > maxPush + 0.5)
      problems.push({ code: "STRAIGHT", msg: `tight turn of ${(b.th * 180 / Math.PI).toFixed(0)}° right after the termination straight (needs ${b.T.toFixed(0)} mm to form at ${b.r} mm radius) – check the terminal's exit direction or add an anchor` });
  }

  // Checks: bend radius rule exists, tangents fit on each segment, termination straight kept
  for (const b of bends) if (b.th > 0 && !b.r) problems.push({ code: "BEND-RULE", msg: `no bend radius rule for ${type.id}` });
  const T = new Map(bends.map((b) => [b.i, b.T]));
  let straights = 0, runs = 0, chord = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const L = len(sub(P[i + 1].p, P[i].p));
    chord += L;
    const need = (T.get(i) ?? 0) + (T.get(i + 1) ?? 0);
    if (need > L + 0.5) problems.push({ code: "BEND", msg: `bend radius cannot be met between route points ${i} and ${i + 1}: needs ${need.toFixed(0)} mm, has ${L.toFixed(0)} mm` });
    if (P[i].kind === "duct-in" && P[i + 1].kind === "duct-out") runs += L; else straights += L;
  }
  let arcs = 0, cut = 0;
  for (const b of bends) if (b.th > 0 && b.r) { arcs += b.r * b.th; cut += 2 * b.T; }
  const external = (A.external ?? 0) + (B.external ?? 0);
  const length = chord - cut + arcs + external;

  // Termination straight: a route point (tie, duct) nearer the terminal than the straight forces a bend inside it
  for (const k of [1, P.length - 2]) {
    if (P[k]?.kind !== "straight-end") continue;
    const nb = k === 1 ? P[2] : P[P.length - 3];
    if (!nb || nb.kind === "straight-end") continue;
    const d = len(sub(nb.p, P[k].base));
    if (d < Ls - 0.5) problems.push({ code: "STRAIGHT", msg: `${nb.id ?? "the next route point"} is ${d.toFixed(0)} mm from the terminal; the ${Ls} mm termination straight cannot be kept` });
  }

  return {
    ok: true,
    points: P,
    bends: bends.filter((b) => b.th > 0),
    length,
    parts: (() => {
      const term = (A.tp ? Ls : 0) + (B.tp ? Ls : 0);
      return { termination: term, straights: chord - runs - cut - term, runs, arcs, external };
    })(),
    flexible: bends.some((b) => b.th > 0 && b.flex),
    approx: (A.tp?.approx ?? false) || (B.tp?.approx ?? false),
    termination: Ls,
    problems,
  };
}

/** Anchor sequence of a wire: its own list, or the pack default when it has none (null). */
export function anchorIds(prj, w) {
  if (Array.isArray(w.anchors)) return w.anchors;
  return prj.packs.find((p) => p.id === w.pack)?.defaultAnchors ?? [];
}

/** Length used in the schedule: measured if entered, else the estimate. */
export function lengthUsed(prj, lib, w) {
  if (w.measured && isNum(w.measured.length)) return { length: w.measured.length, source: w.measured.source || "measured" };
  const r = routeWire(prj, lib, w);
  if (r.ok) return { length: Math.round(r.length), source: r.approx ? "estimate (approx.)" : "estimate" };
  if (w.measured?.source) return { length: null, source: w.measured.source };
  return { length: null, source: "" };
}
