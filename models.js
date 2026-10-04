// 三隻角色的立體模型：以關節（骨架）層級組成，程式設定跑步、跳躍、暈眩、歡呼等動作
// 座標：角色面向 -Z，+Y 向上，腳底在 y = 0
import * as THREE from './lib/three.module.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- 雜訊
function hash3(x, y, z, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return L(
    L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm(x, y, z, seed) {
  return noise3(x, y, z, seed) * 0.6 + noise3(x * 2.1, y * 2.1, z * 2.1, seed + 3) * 0.3 + noise3(x * 4.3, y * 4.3, z * 4.3, seed + 5) * 0.1;
}

// 毛茸茸的球體：沿法線加入雜訊起伏；curl > 0 時加上一粒粒捲毛
function blob(r, o = {}) {
  const { sx = 1, sy = 1, sz = 1, amp = 0.02, freq = 5, curl = 0, seed = 1, ws = 40, hs = 28 } = o;
  const g = new THREE.SphereGeometry(r, ws, hs);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.copy(v).normalize();
    let d = (fbm(n.x * freq + 10, n.y * freq + 10, n.z * freq + 10, seed) - 0.5) * 2 * amp;
    if (curl) {
      const c = noise3(n.x * curl + 20, n.y * curl + 20, n.z * curl + 20, seed + 11);
      d += c * c * r * 0.11;
    }
    v.addScaledVector(n, d);
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  g.computeVertexNormals();
  return g;
}

// 毛皮貼圖
function furTex(base, dark, light, o = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  if (o.belly) {
    const gr = g.createLinearGradient(0, 120, 0, 256);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, o.belly);
    g.fillStyle = gr;
    g.fillRect(0, 120, 256, 136);
  }
  if (o.stripes) {
    g.strokeStyle = dark;
    for (let k = 0; k < o.stripes; k++) {
      const x0 = (k + 0.5) * (256 / o.stripes);
      g.globalAlpha = 0.45;
      g.lineWidth = 7 + Math.random() * 7;
      g.beginPath();
      for (let y = 10; y < 175; y += 8) g.lineTo(x0 + Math.sin(y * 0.05 + k) * 6, y);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  const strokes = o.curls ? 0 : 2600;
  for (let i = 0; i < strokes; i++) {
    g.strokeStyle = Math.random() < 0.5 ? dark : light;
    g.globalAlpha = 0.12 + Math.random() * 0.15;
    g.lineWidth = 1 + Math.random();
    const x = Math.random() * 256, y = Math.random() * 256, l = 3 + Math.random() * 6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 2, y + l);
    g.stroke();
  }
  if (o.curls) {
    for (let i = 0; i < 1300; i++) {
      g.strokeStyle = Math.random() < 0.55 ? dark : light;
      g.globalAlpha = 0.25 + Math.random() * 0.3;
      g.lineWidth = 1.5 + Math.random() * 1.5;
      const r = 3 + Math.random() * 4;
      g.beginPath();
      g.arc(Math.random() * 256, Math.random() * 256, r, Math.random() * 6, Math.random() * 6 + 4);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 絨毛外層：同一形狀略放大、帶點點透明，令輪廓看起來毛茸茸
let _fuzzTex = null;
function fuzzTex() {
  if (_fuzzTex) return _fuzzTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 120 + Math.random() * 135;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 2.5);
  }
  _fuzzTex = new THREE.CanvasTexture(c);
  _fuzzTex.wrapS = _fuzzTex.wrapT = THREE.RepeatWrapping;
  return _fuzzTex;
}
function fuzz(mesh, color, k = 1.045) {
  const m = new THREE.Mesh(mesh.geometry, new THREE.MeshLambertMaterial({ color, alphaMap: fuzzTex(), transparent: true, depthWrite: false, opacity: 0.85 }));
  m.scale.setScalar(k);
  m.renderOrder = 1;
  mesh.add(m);
  return m;
}
function pads(paw, size, color) {
  const mat = new THREE.MeshLambertMaterial({ color });
  const g = new THREE.Group();
  const main = new THREE.Mesh(new THREE.SphereGeometry(size * 0.42, 14, 10), mat);
  main.scale.set(1.15, 0.35, 0.95);
  main.position.set(0, -size * 0.58, size * 0.18);
  g.add(main);
  for (const [x, z] of [[-0.42, -0.2], [-0.15, -0.42], [0.15, -0.42], [0.42, -0.2]]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(size * 0.15, 10, 8), mat);
    b.scale.set(1, 0.45, 1.1);
    b.position.set(x * size, -size * 0.52, (z - 0.05) * size);
    g.add(b);
  }
  paw.add(g);
}

// ---------------------------------------------------------------- 部件
function makeLeg(mat, pawMat, { upper, lower, r, paw, curl = 0, seed = 1, pad = 0x6b5560 }) {
  const hip = new THREE.Group();
  const up = new THREE.Mesh(blob(r, { sy: (upper / 2 + r) / r, amp: 0.012, curl, seed, ws: 20, hs: 14 }), mat);
  up.position.y = -upper / 2;
  hip.add(up);
  const knee = new THREE.Group();
  knee.position.y = -upper;
  hip.add(knee);
  const lr = r * 0.82;
  const lo = new THREE.Mesh(blob(lr, { sy: (lower / 2 + lr) / lr, amp: 0.01, curl, seed: seed + 1, ws: 20, hs: 14 }), mat);
  lo.position.y = -lower / 2;
  knee.add(lo);
  const pw = new THREE.Mesh(blob(paw, { sy: 0.62, sz: 1.3, amp: 0.008, curl: curl ? curl * 0.8 : 0, seed: seed + 2, ws: 20, hs: 14 }), pawMat);
  pw.position.set(0, -lower, -paw * 0.3);
  knee.add(pw);
  pads(pw, paw, pad);
  return { hip, knee, reach: upper + lower + paw * 0.62 };
}

function makeEye(r, iris, slit) {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), new THREE.MeshStandardMaterial({ color: iris, roughness: 0.12, metalness: 0 }));
  ball.scale.z = 0.62;
  g.add(ball);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.58, 18, 12), new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.1 }));
  pupil.scale.set(slit ? 0.32 : 1, slit ? 1.05 : 1, 0.5);
  pupil.position.z = -r * 0.36;
  g.add(pupil);
  const hl = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  hl.position.set(-r * 0.3, r * 0.34, -r * 0.6);
  g.add(hl);
  const hl2 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  hl2.position.set(r * 0.28, -r * 0.25, -r * 0.6);
  g.add(hl2);
  return g;
}

// 尾巴：一整條蒙皮網格（SkinnedMesh），由一串骨骼帶動彎曲，表面平滑
function tailGeo(n, len, r0, r1, plume, seed, curl, grow) {
  const H = n * len;
  const pts = [];
  const rows = n * 6;
  pts.push(new THREE.Vector2(0.001, -r0 * 0.5));
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    let r = (r0 + (r1 - r0) * t) * grow;
    if (t < 0.12) r *= 0.75 + 0.25 * Math.sin((t / 0.12) * Math.PI / 2);
    if (t > 0.82) r *= Math.sqrt(Math.max(0, 1 - ((t - 0.82) / 0.18) ** 2)) * 0.85 + 0.15;
    pts.push(new THREE.Vector2(r, t * H));
  }
  pts.push(new THREE.Vector2(0.001, H + r1 * 0.35));
  const g = new THREE.LatheGeometry(pts, 18);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const idx = [], wts = [];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const rr = Math.hypot(v.x, v.z);
    if (rr > 0.01) {
      const nx = v.x / rr, nz = v.z / rr;
      let d = (fbm(nx * 3 + 5, v.y * 6, nz * 3 + 5, seed) - 0.5) * 0.25 * rr;
      if (curl) { const c = noise3(nx * 4 + 9, v.y * curl * 0.6, nz * 4 + 9, seed + 2); d += c * c * rr * 0.35; }
      p.setXYZ(i, (v.x + nx * d) * plume, v.y, (v.z + nz * d) * plume);
    }
    const f = clamp(v.y / len, 0, n - 1.0001);
    const b = Math.floor(f);
    idx.push(b, Math.min(b + 1, n - 1), 0, 0);
    wts.push(1 - (f - b), f - b, 0, 0);
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
  g.computeVertexNormals();
  return g;
}
function makeTail(mat, { n, len, r0, r1, curve, curl = 0, seed = 3, plume = 1, fuzzColor = null }) {
  const bones = [];
  for (let i = 0; i < n; i++) {
    const b = new THREE.Bone();
    if (i > 0) { b.position.y = len; bones[i - 1].add(b); }
    b.rotation.x = curve[i] || 0;
    bones.push(b);
  }
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(tailGeo(n, len, r0, r1, plume, seed, curl, 1), mat);
  mesh.add(bones[0]);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;
  if (fuzzColor !== null) {
    const fm = new THREE.SkinnedMesh(tailGeo(n, len, r0, r1, plume, seed, curl, 1.07),
      new THREE.MeshLambertMaterial({ color: fuzzColor, alphaMap: fuzzTex(), transparent: true, depthWrite: false, opacity: 0.85 }));
    fm.bind(skeleton, mesh.bindMatrix);
    fm.frustumCulled = false;
    fm.renderOrder = 1;
    mesh.add(fm);
  }
  const tip = new THREE.Group();
  tip.position.y = len;
  bones[n - 1].add(tip);
  return { root: mesh, segs: bones, tip };
}

// ---------------------------------------------------------------- 角色
function baseRig(cfg) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  return { group, body, cfg, mats: [], legs: {}, ears: [], eyes: [], tail: [], head: null, neck: null };
}
function attachLegs(rig, mat, pawMat, spec, front, back) {
  const fl = makeLeg(mat, pawMat, { ...spec, seed: 31 });
  const fr = makeLeg(mat, pawMat, { ...spec, seed: 41 });
  const hl = makeLeg(mat, pawMat, { ...spec, upper: spec.upper * (spec.hind || 1), seed: 51 });
  const hr = makeLeg(mat, pawMat, { ...spec, upper: spec.upper * (spec.hind || 1), seed: 61 });
  fl.hip.position.set(-front[0], front[1], front[2]);
  fr.hip.position.set(front[0], front[1], front[2]);
  hl.hip.position.set(-back[0], back[1], back[2]);
  hr.hip.position.set(back[0], back[1], back[2]);
  rig.body.add(fl.hip, fr.hip, hl.hip, hr.hip);
  rig.legs = { fl, fr, hl, hr };
  // 讓前腳剛好踏地
  rig.cfg.bodyY = fl.reach - front[1];
  rig.body.position.y = rig.cfg.bodyY;
}

function buildFold() {
  const rig = baseRig({ stride: 1, wag: 5, tailCurve: [0.5, 0.25, 0.15, 0.05, -0.15, -0.3, -0.35] });
  const fur = new THREE.MeshLambertMaterial({ map: furTex('#8a8491', '#6f6977', '#aaa4b1', { belly: '#9c96a3' }) });
  const furL = new THREE.MeshLambertMaterial({ map: furTex('#a19ba7', '#827c89', '#bdb7c2') });
  rig.mats.push(fur, furL);
  const torso = new THREE.Mesh(blob(0.66, { sx: 1.22, sy: 0.98, sz: 1.2, amp: 0.03, seed: 2 }), fur);
  rig.body.add(torso);
  fuzz(torso, 0xb2acb8);
  const rump = new THREE.Mesh(blob(0.6, { sx: 1.3, sy: 1.0, sz: 0.95, amp: 0.03, seed: 3 }), fur);
  rump.position.set(0, -0.02, 0.42);
  rig.body.add(rump);
  fuzz(rump, 0xb2acb8);
  const chest = new THREE.Mesh(blob(0.46, { sx: 1.15, sy: 1.05, amp: 0.03, seed: 4 }), furL);
  chest.position.set(0, -0.06, -0.6);
  rig.body.add(chest);
  fuzz(chest, 0xc4bfc9);
  attachLegs(rig, fur, furL, { upper: 0.26, lower: 0.18, r: 0.2, paw: 0.22, pad: 0x8a6670 }, [0.36, -0.32, -0.55], [0.46, -0.3, 0.6]);

  const neck = new THREE.Group();
  neck.position.set(0, 0.36, -0.78);
  rig.body.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.2, -0.12);
  neck.add(head);
  const hm = new THREE.Mesh(blob(0.6, { sx: 1.15, sy: 1.0, sz: 0.95, amp: 0.03, seed: 6 }), fur);
  head.add(hm);
  fuzz(hm, 0xb2acb8);
  for (const s of [-1, 1]) {
    const cheek = new THREE.Mesh(blob(0.2, { sx: 1.1, amp: 0.02, seed: 8 + s }), furL);
    cheek.position.set(s * 0.13, -0.2, -0.42);
    head.add(cheek);
    const eye = makeEye(0.135, 0xf2a21a, true);
    eye.position.set(s * 0.22, 0.04, -0.44);
    eye.rotation.y = -s * 0.32;
    head.add(eye);
    rig.eyes.push(eye);
    // 摺耳：向前摺下的小耳朵
    const ear = new THREE.Group();
    ear.position.set(s * 0.29, 0.43, -0.08);
    const e = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.2, 14), fur);
    e.rotation.x = -1.9;
    e.position.set(0, 0.02, -0.06);
    e.scale.z = 0.55;
    ear.add(e);
    ear.rotation.z = -s * 0.35;
    head.add(ear);
    rig.ears.push({ g: ear, side: s, floppy: false });
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), new THREE.MeshStandardMaterial({ color: 0x4d3e47, roughness: 0.4 }));
  nose.scale.set(1.3, 0.8, 0.8);
  nose.position.set(0, -0.09, -0.54);
  head.add(nose);
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff8fa3, roughness: 0.5 }));
  tongue.scale.set(1.2, 0.7, 0.8);
  tongue.position.set(0, -0.3, -0.48);
  head.add(tongue);
  rig.neck = neck;
  rig.head = head;

  const tail = makeTail(fur, { n: 7, len: 0.17, r0: 0.21, r1: 0.17, curve: rig.cfg.tailCurve, seed: 70, plume: 1.1, fuzzColor: 0xb2acb8 });
  tail.root.position.set(0, 0.3, 0.92);
  rig.body.add(tail.root);
  rig.tail = tail.segs;
  return rig;
}

function buildExotic() {
  const rig = baseRig({ stride: 1, wag: 5.5, tailCurve: [0.45, 0.3, 0.15, 0, -0.2, -0.35] });
  const fur = new THREE.MeshLambertMaterial({ map: furTex('#f6d2a2', '#e2a970', '#fde6c8', { stripes: 10, belly: '#fdeedb' }) });
  const white = new THREE.MeshLambertMaterial({ map: furTex('#fff4e6', '#f1dfc6', '#ffffff') });
  const tailMat = new THREE.MeshLambertMaterial({ map: furTex('#f5cd9a', '#e0a468', '#fde6c8', { stripes: 4 }) });
  const cream = new THREE.MeshLambertMaterial({ map: furTex('#fde7c9', '#f2d3aa', '#fff6ea') });
  rig.mats.push(fur, white, tailMat, cream);
  const torso = new THREE.Mesh(blob(0.65, { sx: 1.2, sy: 0.95, sz: 1.2, amp: 0.03, seed: 12 }), fur);
  rig.body.add(torso);
  fuzz(torso, 0xfde3c0);
  const rump = new THREE.Mesh(blob(0.58, { sx: 1.28, sy: 1.0, sz: 0.95, amp: 0.03, seed: 13 }), fur);
  rump.position.set(0, -0.02, 0.42);
  rig.body.add(rump);
  fuzz(rump, 0xfde3c0);
  const chest = new THREE.Mesh(blob(0.46, { sx: 1.15, sy: 1.05, amp: 0.03, seed: 14 }), white);
  chest.position.set(0, -0.08, -0.6);
  rig.body.add(chest);
  fuzz(chest, 0xffffff);
  attachLegs(rig, fur, white, { upper: 0.26, lower: 0.18, r: 0.2, paw: 0.22, pad: 0xf0a0a8 }, [0.36, -0.32, -0.55], [0.45, -0.3, 0.58]);

  const neck = new THREE.Group();
  neck.position.set(0, 0.36, -0.78);
  rig.body.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.2, -0.1);
  neck.add(head);
  const hm = new THREE.Mesh(blob(0.6, { sx: 1.16, sy: 1.0, sz: 0.88, amp: 0.03, seed: 16 }), fur);
  head.add(hm);
  fuzz(hm, 0xfde3c0);
  // 扁臉：白色口鼻和下巴
  for (const s of [-1, 1]) {
    const cheek = new THREE.Mesh(blob(0.17, { sx: 1.15, amp: 0.02, seed: 18 + s }), cream);
    cheek.position.set(s * 0.12, -0.2, -0.43);
    head.add(cheek);
    const eye = makeEye(0.16, 0xe9a23b, false);
    eye.position.set(s * 0.23, 0.05, -0.41);
    eye.rotation.y = -s * 0.3;
    head.add(eye);
    rig.eyes.push(eye);
    const ear = new THREE.Group();
    ear.position.set(s * 0.33, 0.42, 0.02);
    ear.rotation.z = -s * 0.42;
    const e = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.28, 14), fur);
    e.position.y = 0.1;
    e.scale.z = 0.55;
    ear.add(e);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0xffb3bd, roughness: 0.8 }));
    inner.position.set(0, 0.08, -0.06);
    inner.scale.z = 0.4;
    ear.add(inner);
    head.add(ear);
    rig.ears.push({ g: ear, side: s, floppy: false });
  }
  const chin = new THREE.Mesh(blob(0.15, { amp: 0.02, seed: 21 }), white);
  chin.position.set(0, -0.33, -0.36);
  head.add(chin);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), new THREE.MeshStandardMaterial({ color: 0xf29a9e, roughness: 0.45 }));
  nose.scale.set(1.3, 0.85, 0.8);
  nose.position.set(0, -0.08, -0.47);
  head.add(nose);
  rig.neck = neck;
  rig.head = head;

  const tail = makeTail(tailMat, { n: 6, len: 0.2, r0: 0.22, r1: 0.2, curve: rig.cfg.tailCurve, seed: 80, plume: 1.15, fuzzColor: 0xfde3c0 });
  tail.root.position.set(0, 0.3, 0.9);
  rig.body.add(tail.root);
  rig.tail = tail.segs;
  return rig;
}

function buildPoodle() {
  const rig = baseRig({ stride: 1.1, wag: 9, tailCurve: [0.2, -0.1, -0.1] });
  const curlTex = furTex('#ecb47a', '#d08f55', '#fbd4a4', { curls: true });
  const fur = new THREE.MeshLambertMaterial({ map: curlTex });
  const furL = new THREE.MeshLambertMaterial({ map: furTex('#f0bd86', '#d4975e', '#fddcb2', { curls: true }) });
  rig.mats.push(fur, furL);
  const C = 13;
  const torso = new THREE.Mesh(blob(0.56, { sx: 1.0, sy: 0.95, sz: 1.25, amp: 0.03, curl: C, seed: 22 }), fur);
  rig.body.add(torso);
  const rump = new THREE.Mesh(blob(0.48, { sx: 1.15, amp: 0.03, curl: C, seed: 23 }), fur);
  rump.position.set(0, 0, 0.42);
  rig.body.add(rump);
  const chest = new THREE.Mesh(blob(0.42, { sy: 1.1, amp: 0.03, curl: C, seed: 24 }), fur);
  chest.position.set(0, 0.0, -0.55);
  rig.body.add(chest);
  attachLegs(rig, fur, furL, { upper: 0.34, lower: 0.28, r: 0.18, paw: 0.2, curl: C, hind: 1.05, pad: 0x3a2826 }, [0.28, -0.3, -0.5], [0.34, -0.25, 0.55]);

  const neck = new THREE.Group();
  neck.position.set(0, 0.42, -0.7);
  rig.body.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.32, -0.12);
  neck.add(head);
  head.add(new THREE.Mesh(blob(0.48, { sx: 1.05, amp: 0.03, curl: C, seed: 26 }), fur));
  const top = new THREE.Mesh(blob(0.36, { sx: 1.15, amp: 0.03, curl: C, seed: 28 }), furL);
  top.position.set(0, 0.36, 0.04);
  head.add(top);
  const muzzle = new THREE.Mesh(blob(0.21, { sz: 1.35, sy: 0.85, amp: 0.02, curl: 12, seed: 30 }), furL);
  muzzle.position.set(0, -0.14, -0.42);
  head.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1d1412, roughness: 0.25 }));
  nose.scale.set(1.25, 0.9, 0.9);
  nose.position.set(0, -0.07, -0.68);
  head.add(nose);
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), new THREE.MeshStandardMaterial({ color: 0xff7d93, roughness: 0.45 }));
  tongue.scale.set(1, 0.45, 1.2);
  tongue.position.set(0, -0.3, -0.54);
  head.add(tongue);
  rig.tongue = tongue;
  for (const s of [-1, 1]) {
    const eye = makeEye(0.1, 0x2a170c, false);
    eye.position.set(s * 0.19, 0.06, -0.4);
    eye.rotation.y = -s * 0.28;
    head.add(eye);
    rig.eyes.push(eye);
    // 長長的捲毛垂耳
    const ear = new THREE.Group();
    ear.position.set(s * 0.4, 0.12, -0.02);
    const e = new THREE.Mesh(blob(0.24, { sx: 0.75, sy: 1.6, sz: 0.65, amp: 0.03, curl: C, seed: 33 + s }), fur);
    e.position.y = -0.3;
    ear.add(e);
    head.add(ear);
    rig.ears.push({ g: ear, side: s, floppy: true });
  }
  rig.neck = neck;
  rig.head = head;

  const tail = makeTail(fur, { n: 3, len: 0.16, r0: 0.12, r1: 0.11, curve: rig.cfg.tailCurve, curl: C, seed: 90 });
  tail.root.position.set(0, 0.3, 0.66);
  tail.root.rotation.x = 0.35;
  const pom = new THREE.Mesh(blob(0.27, { amp: 0.03, curl: C, seed: 95 }), furL);
  pom.position.y = 0.08;
  tail.tip.add(pom);
  rig.body.add(tail.root);
  rig.tail = tail.segs;
  return rig;
}

const BUILDERS = { fold: buildFold, exotic: buildExotic, poodle: buildPoodle };

// ---------------------------------------------------------------- 動作
const _flash = new THREE.Color();
export function createPet(id, glow) {
  const rig = BUILDERS[id]();
  rig.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  const glowCol = new THREE.Color(glow);
  const L = rig.legs;
  const setLeg = (leg, hip, knee) => { leg.hip.rotation.x = hip; leg.knee.rotation.x = knee; };

  // o: { t, phase, amp(0–1.3), air, vy, steer(-1..1), stun, cheer, idle, frozen }
  rig.pose = (o) => {
    const { body, head, neck, cfg } = rig;
    const p = o.phase, A = o.amp, t = o.t;
    body.rotation.set(0, 0, 0);
    body.position.set(0, cfg.bodyY, 0);
    body.scale.set(1, 1, 1);
    head.rotation.set(0, 0, 0);
    neck.rotation.set(0, 0, 0);
    if (o.frozen) {
      for (const k in L) setLeg(L[k], 0, 0);
      rig.tail.forEach((s, i) => { s.rotation.set(cfg.tailCurve[i] || 0, 0, 0); });
      rig.ears.forEach((e) => { if (e.floppy) e.g.rotation.set(0, 0, e.side * 0.12); });
      rig.eyes.forEach((e) => (e.scale.y = 1));
      return;
    }
    if (o.air) {
      // 跳躍：前腳伸前、後腳蹬後，身體隨上升／下降抬頭或俯衝
      const k = clamp(o.vy / 10, -1, 1);
      setLeg(L.fl, 0.85 + k * 0.2, -0.5);
      setLeg(L.fr, 0.75 + k * 0.2, -0.4);
      setLeg(L.hl, -0.7 - k * 0.2, -1.1);
      setLeg(L.hr, -0.6 - k * 0.2, -1.0);
      body.rotation.x = k * 0.28;
      head.rotation.x = -k * 0.15;
    } else if (o.cheer) {
      // 歡呼：後腳站立、前腳揮動
      body.rotation.x = 0.55 + Math.sin(t * 6) * 0.05;
      body.position.y = cfg.bodyY + 0.25;
      setLeg(L.hl, -0.55, 0.1);
      setLeg(L.hr, -0.55, 0.1);
      setLeg(L.fl, 0.4 + Math.sin(t * 14) * 0.6, -0.6);
      setLeg(L.fr, 0.4 + Math.sin(t * 14 + 2) * 0.6, -0.6);
      head.rotation.x = -0.45;
      head.rotation.z = Math.sin(t * 5) * 0.12;
    } else {
      // 奔跑：前後腳交替（飛奔步法），膝蓋在提腳時屈曲
      const a = 0.9 * A * cfg.stride;
      setLeg(L.fl, Math.sin(p) * a, -Math.max(0, Math.cos(p)) * 1.2 * A);
      setLeg(L.fr, Math.sin(p + 0.55) * a, -Math.max(0, Math.cos(p + 0.55)) * 1.2 * A);
      // 後腳向後蹬時腳掌翻起，露出肉球
      setLeg(L.hl, Math.sin(p + Math.PI) * a, -Math.max(0, -Math.sin(p + Math.PI) + 0.2) * 1.5 * A);
      setLeg(L.hr, Math.sin(p + Math.PI + 0.55) * a, -Math.max(0, -Math.sin(p + Math.PI + 0.55) + 0.2) * 1.5 * A);
      body.rotation.x = Math.sin(p - 0.6) * 0.1 * A;
      body.position.y = cfg.bodyY + Math.abs(Math.sin(p)) * 0.16 * A;
      const sq = Math.sin(p * 2) * 0.04 * A;
      body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.3);
      head.rotation.x = -body.rotation.x * 0.8 + Math.sin(p * 2 + 0.5) * 0.05 * A;
      if (A < 0.05) {
        const br = Math.sin(t * 2.5) * 0.015;
        body.scale.set(1 + br, 1 + br, 1);
        head.rotation.z = Math.sin(t * 0.9) * 0.08;
        neck.rotation.x = Math.sin(t * 1.3) * 0.04;
      }
    }
    // 轉向：身體側傾、頭望向前進方向
    body.rotation.z = -o.steer * 0.14;
    head.rotation.y = -o.steer * 0.3;
    if (o.stun > 0) {
      body.rotation.z += Math.sin(t * 22) * 0.18;
      head.rotation.z = Math.sin(t * 9) * 0.35;
      head.rotation.y += Math.cos(t * 9) * 0.3;
    }
    // 尾巴：隨步伐上下擺動，同時左右搖
    const wag = cfg.wag * (o.cheer ? 2.2 : 1) * (A > 0.6 ? 1.3 : 1);
    rig.tail.forEach((s, i) => {
      s.rotation.x = (cfg.tailCurve[i] || 0) + Math.sin(p - i * 0.7) * 0.14 * A - (o.air ? 0.1 : 0);
      s.rotation.z = Math.sin(t * wag - i * 0.65) * (0.1 + 0.08 * A + (o.cheer ? 0.15 : 0));
    });
    // 耳朵
    rig.ears.forEach((e) => {
      if (e.floppy) {
        e.g.rotation.x = Math.sin(p + 1.2) * 0.35 * A + (o.air ? 0.5 * clamp(-o.vy / 10, -1, 1) : 0);
        e.g.rotation.z = e.side * (0.12 + Math.max(0, Math.sin(p * 2)) * 0.25 * A + (o.air ? 0.4 : 0));
      } else {
        e.g.rotation.x = Math.sin(t * 0.7 + e.side) * 0.04;
      }
    });
    if (rig.tongue) rig.tongue.scale.y = 0.45 + Math.max(0, Math.sin(p * 2)) * 0.15 * A;
    // 眨眼
    const blink = (t + rig.cfg.stride * 1.3) % 3.4 < 0.12 ? 0.12 : 1;
    rig.eyes.forEach((e) => (e.scale.y = blink));
  };

  // flash：撞擊時泛紅；boost：加速時發光
  rig.tint = (flash, boost, t) => {
    _flash.setRGB(0.9 * flash, 0.15 * flash, 0.2 * flash);
    const b = boost * (0.22 + 0.1 * Math.sin(t * 25));
    _flash.r += glowCol.r * b;
    _flash.g += glowCol.g * b;
    _flash.b += glowCol.b * b;
    rig.mats.forEach((m) => m.emissive.copy(_flash));
  };
  rig.pose({ t: 0, phase: 0, amp: 0, steer: 0, stun: 0, frozen: true });
  return rig;
}
