// 3D view of the plates, components, anchors and wire routes, with a measure tool.
// Three.js (MIT) is vendored in js/vendor so the site makes no outside calls.
import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { componentById } from "./project.js";
import { boxCorners, placementPlaced, anchorPoints, routeWire, plateById, terminalPoint } from "./geometry.js";

const COLOURS = { plate: 0x9fb3c8, movingPlate: 0xc8b39f, box: 0x5b7fa6, boxApprox: 0xd08a00, terminal: 0x2e7d32, terminalApprox: 0xd08a00,
  tie: 0xe65100, duct: 0x607d8b, exit: 0x8e24aa, route: 0x37474f, routeSel: 0xd32f2f, pick: 0x1565c0 };

function label(text, size = 14) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = `600 ${size * 4}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  c.width = w; c.height = size * 5;
  ctx.font = `600 ${size * 4}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect(0, 0, w, c.height);
  ctx.fillStyle = "#1d232b"; ctx.textBaseline = "middle"; ctx.fillText(text, 8, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(w / 8, c.height / 8, 1);
  s.renderOrder = 10;
  return s;
}

export class View3D {
  constructor(container, onPick) {
    this.container = container;
    this.onPick = onPick;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0xf6f7f9);
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 100000);
    this.camera.position.set(600, 400, 1500);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(1, 2, 3); this.scene.add(dl);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.pickables = [];
    this.measure = false;
    this.fitted = false;
    this.raycaster = new THREE.Raycaster();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container);
    let down = null;
    this.renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; // a drag, not a click
      this.click(e);
    });
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(loop); };
    loop();
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 500;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  click(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(m, this.camera);
    this.raycaster.params.Line = { threshold: 4 };
    const hits = this.raycaster.intersectObjects(this.pickables.filter((o) => o.visible), false);
    if (hits.length) this.onPick(hits[0].object.userData);
  }

  clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.traverse?.((x) => { x.geometry?.dispose?.(); if (x.material) { x.material.map?.dispose?.(); x.material.dispose?.(); } });
    }
    this.pickables = [];
  }

  sphere(p, r, colour, data, visible = true) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshLambertMaterial({ color: colour }));
    m.position.set(p.x, p.y, p.z);
    m.userData = { ...data, point: { x: p.x, y: p.y, z: p.z } };
    m.visible = visible;
    this.group.add(m);
    this.pickables.push(m);
    return m;
  }

  render(prj, lib, opts = {}) {
    this.clear();
    if (!prj || !lib) return;
    const ang = typeof opts.angle === "number" ? opts.angle : 0; // view hinge angle, degrees
    const showCorners = !!opts.measure;
    const bounds = new THREE.Box3();
    const grow = (p) => bounds.expandByPoint(new THREE.Vector3(p.x, p.y, p.z));

    // Plates
    for (const pl of prj.plates ?? []) {
      if (![pl.x, pl.y, pl.z, pl.w, pl.h].every((x) => typeof x === "number")) continue;
      const corners = [[0, 0], [pl.w, 0], [pl.w, pl.h], [0, pl.h]].map(([dx, dy]) => {
        return anchorPoints(prj, { type: "point", plate: pl.id, x: pl.x + dx, y: pl.y + dy, z: pl.z }, ang * Math.PI / 180).p1;
      });
      const g = new THREE.BufferGeometry().setFromPoints([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]].map((p) => new THREE.Vector3(p.x, p.y, p.z)));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: pl.moves ? COLOURS.movingPlate : COLOURS.plate, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
      this.group.add(mesh);
      const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners.map((p) => new THREE.Vector3(p.x, p.y, p.z))), new THREE.LineBasicMaterial({ color: 0x546e7a }));
      this.group.add(edge);
      const lb = label(`${pl.id}${pl.moves ? " (moves)" : ""}`, 12); lb.position.set(corners[3].x, corners[3].y + 15, corners[3].z); this.group.add(lb);
      corners.forEach((c, i) => { grow(c); if (showCorners) this.sphere(c, 3, COLOURS.pick, { kind: "plate corner", name: `${pl.id} corner ${i + 1}` }); });
    }

    // Hinge axis
    const hg = prj.hinge;
    if (hg && typeof hg.x === "number" && typeof hg.z === "number" && !bounds.isEmpty()) {
      const ax = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(hg.x, bounds.min.y - 50, hg.z), new THREE.Vector3(hg.x, bounds.max.y + 50, hg.z)]),
        new THREE.LineDashedMaterial({ color: 0xc62828, dashSize: 20, gapSize: 10 }));
      ax.computeLineDistances(); this.group.add(ax);
    }

    // Components
    const a = ang * Math.PI / 180;
    for (const pl of prj.placements) {
      if (!placementPlaced(pl) || !plateById(prj, pl.plate)) continue;
      const { corners, env } = boxCorners(prj, lib, pl, a);
      const pts = corners.map((c) => new THREE.Vector3(c.x, c.y, c.z));
      const idx = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
      const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(idx.flatMap(([i, j]) => [pts[i], pts[j]])),
        new THREE.LineBasicMaterial({ color: env.approx ? COLOURS.boxApprox : COLOURS.box }));
      this.group.add(lines);
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: env.approx ? COLOURS.boxApprox : COLOURS.box, transparent: true, opacity: 0.12, depthWrite: false }));
      const bb = new THREE.Box3().setFromPoints(pts); bb.getCenter(hull.position); bb.getSize(hull.scale);
      this.group.add(hull);
      const lb = label(pl.tag); lb.position.set(hull.position.x, bb.max.y + 12, hull.position.z); this.group.add(lb);
      corners.forEach((c, i) => { grow(c); if (showCorners) this.sphere(c, 2.5, COLOURS.pick, { kind: "corner", name: `${pl.tag} corner ${i + 1}` }); });

      // All terminals of the component, for measuring (shown with the measure tool on)
      if (showCorners) {
        const comp = componentById(lib, pl.component);
        for (const k of comp?.connectors ?? []) for (const t of k.terminals) {
          const tp = terminalPoint(prj, lib, { tag: pl.tag, connector: k.id, terminal: t.id }, a);
          if (tp) this.sphere(tp.p, 2, tp.approx ? COLOURS.terminalApprox : COLOURS.terminal, { kind: tp.approx ? "terminal (approx.)" : "terminal", name: `${pl.tag} ${k.id === "-" ? "" : k.id + " "}${t.id}` });
        }
      }
    }

    // Terminals actually used by wires (position may be approximate)
    const seen = new Set();
    for (const w of prj.wires) {
      const route = routeWire(prj, lib, w, ang);
      if (!route.ok) continue;
      const sel = w.id === opts.selected;
      const P = route.points.map((q) => new THREE.Vector3(q.p.x, q.p.y, q.p.z));
      if (sel) {
        const curve = new THREE.CatmullRomCurve3(P, false, "catmullrom", 0);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, P.length * 12), 2.2, 8, false), new THREE.MeshLambertMaterial({ color: COLOURS.routeSel }));
        this.group.add(tube);
      } else if (!opts.selectedOnly) {
        this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(P), new THREE.LineBasicMaterial({ color: COLOURS.route, transparent: true, opacity: 0.55 })));
      }
      for (const [end, q] of [["from", route.points[0]], ["to", route.points[route.points.length - 1]]]) {
        if (q.kind !== "terminal") continue;
        const ref = w[end];
        const k = `${ref.tag}|${ref.connector}|${ref.terminal}`;
        if (seen.has(k)) continue;
        seen.add(k);
        this.sphere(q.p, 3.5, route.approx ? COLOURS.terminalApprox : COLOURS.terminal, { kind: "terminal", name: `${ref.tag} ${ref.connector === "-" ? "" : ref.connector + " "}${ref.terminal}` });
        grow(q.p);
      }
      if (sel) for (const q of route.points) grow(q.p);
    }

    // Anchors
    for (const an of prj.anchors ?? []) {
      if (![an.x, an.y, an.z].every((x) => typeof x === "number")) continue;
      const { p1, p2 } = anchorPoints(prj, an, a);
      if (an.type === "line" && p2 && [an.x2, an.y2, an.z2].every((x) => typeof x === "number")) {
        const d = new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
        const L = d.length();
        const duct = new THREE.Mesh(new THREE.BoxGeometry(an.width || 25, an.height || 25, L),
          new THREE.MeshLambertMaterial({ color: COLOURS.duct, transparent: true, opacity: 0.35, depthWrite: false }));
        duct.position.set((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (p1.z + p2.z) / 2);
        duct.lookAt(p2.x, p2.y, p2.z);
        this.group.add(duct);
        this.sphere(p1, 4, COLOURS.duct, { kind: "duct start", name: `${an.id} start` });
        this.sphere(p2, 4, COLOURS.duct, { kind: "duct end", name: `${an.id} end` });
        grow(p2);
      } else {
        this.sphere(p1, 5, an.type === "exit" ? COLOURS.exit : COLOURS.tie, { kind: an.type === "exit" ? "exit point" : "cable tie", name: an.id });
      }
      const lb = label(an.id, 11); lb.position.set(p1.x, p1.y + 14, p1.z); this.group.add(lb);
      grow(p1);
    }

    // Measure marks
    for (const [i, m] of (opts.marks ?? []).entries()) {
      const s = this.sphere(m.point, 6, 0xff1744, { kind: "mark", name: `P${i + 1}` });
      s.material.depthTest = false; s.renderOrder = 20;
    }
    if ((opts.marks ?? []).length === 2) {
      const [p, q] = opts.marks.map((m) => new THREE.Vector3(m.point.x, m.point.y, m.point.z));
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, q]), new THREE.LineBasicMaterial({ color: 0xff1744, depthTest: false }));
      l.renderOrder = 20; this.group.add(l);
    }

    if (!this.fitted && !bounds.isEmpty()) { this.fit(bounds); this.fitted = true; }
    this.lastBounds = bounds;
  }

  fit(bounds = this.lastBounds) {
    if (!bounds || bounds.isEmpty()) return;
    const c = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3()).length() || 500;
    this.controls.target.copy(c);
    this.camera.position.set(c.x + size * 0.6, c.y + size * 0.4, c.z + size * 1.1);
    this.camera.near = size / 1000; this.camera.far = size * 20; this.camera.updateProjectionMatrix();
  }

  view(dir) {
    const b = this.lastBounds; if (!b || b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3()); const s = b.getSize(new THREE.Vector3()).length() || 500;
    const d = { front: [0, 0, 1], top: [0, 1, 0.0001], side: [1, 0, 0] }[dir];
    this.controls.target.copy(c);
    this.camera.position.set(c.x + d[0] * s * 1.3, c.y + d[1] * s * 1.3, c.z + d[2] * s * 1.3);
  }
}
