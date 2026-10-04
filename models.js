// 三隻角色的立體模型：以關節（骨架）層級組成，程式設定跑步、跳躍、暈眩、歡呼等動作
// 毛髮用「多層殼」技法：同一形狀沿法線向外疊多層，每層按毛髮貼圖丟棄部分像素，形成一根根的毛
// 座標：角色面向 -Z，+Y 向上，腳底在 y = 0
import * as THREE from './lib/three.module.js';
import { loadFenfen, buildFenfenRig, fenfenPose } from './fenfen.js';

// 粉粉改用立體模型（assets/fenfen.glb）；讀取失敗或超過 8 秒就用回下面的程式模型
let FENFEN = null;
try {
  FENFEN = await Promise.race([
    loadFenfen(new URL('./assets/fenfen.glb', import.meta.url)),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
  ]);
} catch (e) {
  console.warn('粉粉模型讀取失敗，改用程式模型', e);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const SHELLS = COARSE ? 10 : 15;

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

// 柔和起伏的球體（可帶捲毛顆粒）
function blob(r, o = {}) {
  const { sx = 1, sy = 1, sz = 1, amp = 0.015, freq = 4, curl = 0, seed = 1, ws = 40, hs = 28 } = o;
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
      d += c * c * r * 0.1;
    }
    v.addScaledVector(n, d);
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- 貼圖
function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
// 毛色貼圖：底色＋細毛紋，可加虎紋、額頭紋、腹部淺色
function furTex(base, dark, light, o = {}) {
  const c = canvas(512, 256, (g, W, H) => {
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    if (o.belly) {
      const gr = g.createLinearGradient(0, H * 0.5, 0, H);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, o.belly);
      g.fillStyle = gr;
      g.fillRect(0, H * 0.5, W, H * 0.5);
    }
    if (o.back) {
      const gr = g.createLinearGradient(0, 0, 0, H * 0.45);
      gr.addColorStop(0, o.back);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H * 0.45);
    }
    g.lineCap = 'round';
    if (o.stripes) {
      g.strokeStyle = dark;
      for (let k = 0; k < o.stripes; k++) {
        const x0 = (k + 0.5) * (W / o.stripes);
        g.globalAlpha = 0.35;
        g.lineWidth = 10 + Math.random() * 8;
        g.beginPath();
        for (let y = 6; y < H * 0.62; y += 6) g.lineTo(x0 + Math.sin(y * 0.04 + k) * 8, y);
        g.stroke();
      }
    }
    if (o.forehead) {
      // 額頭的 M 形虎紋（頭部正面 u≈0.75）
      g.strokeStyle = dark;
      g.globalAlpha = 0.5;
      for (const dx of [-30, -12, 6, 24]) {
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(W * 0.75 + dx * 1.2, 8);
        g.quadraticCurveTo(W * 0.75 + dx * 1.1, 40, W * 0.75 + dx * 0.8, 70);
        g.stroke();
      }
      g.globalAlpha = 0.35;
      for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
        g.lineWidth = 6;
        g.beginPath();
        const x = W * 0.75 + sx * (95 + k * 16);
        g.moveTo(x, 70 + k * 6);
        g.quadraticCurveTo(x + sx * 10, 90, x + sx * 4, 118);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 5000; i++) {
      g.strokeStyle = Math.random() < 0.5 ? dark : light;
      g.globalAlpha = 0.06 + Math.random() * 0.1;
      g.lineWidth = 1 + Math.random();
      const x = Math.random() * W, y = Math.random() * H, l = 4 + Math.random() * 8;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 3, y + l);
      g.stroke();
    }
    if (o.curls) {
      for (let i = 0; i < 2600; i++) {
        g.strokeStyle = Math.random() < 0.5 ? dark : light;
        g.globalAlpha = 0.18 + Math.random() * 0.25;
        g.lineWidth = 1.5 + Math.random() * 1.5;
        g.beginPath();
        g.arc(Math.random() * W, Math.random() * H, 2.5 + Math.random() * 4, Math.random() * 6, Math.random() * 6 + 4);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// 毛髮分佈貼圖：直毛（每格隨機長度）和捲毛（一團團）
function strandTex(kind) {
  const S = 128;
  const c = canvas(S, S, (g) => {
    if (kind === 'hair') {
      const img = g.createImageData(S, S);
      for (let i = 0; i < S * S; i++) {
        const v = Math.pow(Math.random(), 0.8) * 255;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    } else {
      g.fillStyle = '#000';
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 520; i++) {
        const x = Math.random() * S, y = Math.random() * S, r = 2.5 + Math.random() * 3.5;
        for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
          const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          gr.addColorStop(0, 'rgba(255,255,255,1)');
          gr.addColorStop(0.7, 'rgba(255,255,255,.55)');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr;
          g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (kind === 'hair') { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; }
  return t;
}
let HAIR = null, CURL = null;

// 毛髮材質：底層（濃密底毛）＋殼層（一根根毛）
function furMaterials(map, spec) {
  HAIR = HAIR || strandTex('hair');
  CURL = CURL || strandTex('curl');
  const strand = spec.curly ? CURL : HAIR;
  const base = new THREE.MeshLambertMaterial({ map, color: spec.curly ? 0xd8d8d8 : 0xc8c8c8 });
  const all = [base];
  const make = (layerBase, total) => {
    const m = new THREE.MeshLambertMaterial({ map });
    const u = {
      uLen: { value: spec.len }, uShells: { value: total }, uLayerBase: { value: layerBase }, uGrav: { value: spec.grav ?? 0.3 },
      uStrand: { value: strand }, uDensity: { value: new THREE.Vector2(...(spec.density || [10, 5])) }, uThin: { value: spec.thin ?? 0.82 },
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'uniform float uLen, uShells, uLayerBase, uGrav;\nvarying float vLayer;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float layer = (uLayerBase + float(gl_InstanceID) + 1.0) / uShells;
        vLayer = layer;
        transformed += objectNormal * uLen * layer;
        transformed.y -= uGrav * uLen * layer * layer;`);
      sh.fragmentShader = 'uniform sampler2D uStrand; uniform vec2 uDensity; uniform float uThin;\nvarying float vLayer;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float sn = texture2D(uStrand, vMapUv * uDensity).r;
        if (sn < mix(0.04, uThin, vLayer)) discard;
        diffuseColor.rgb *= mix(0.72, 1.12, vLayer);`);
    };
    m.customProgramCacheKey = () => 'fur-shell-v1';
    all.push(m);
    return m;
  };
  const shell = make(0, SHELLS);
  return { base, shell, make, all, spec };
}
// 把毛髮加到一個形狀上：底層網格＋一個實例化網格（每個實例是一層殼）
function furry(geo, fm) {
  const base = new THREE.Mesh(geo, fm.base);
  const inst = new THREE.InstancedMesh(geo, fm.shell, SHELLS);
  const id = new THREE.Matrix4();
  for (let i = 0; i < SHELLS; i++) inst.setMatrixAt(i, id);
  inst.frustumCulled = false;
  base.add(inst);
  return base;
}

// ---------------------------------------------------------------- 眼睛、鼻子、鬍鬚
function eyeTex(iris, light, slit) {
  const c = canvas(256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 8, 128, 128, 128);
    gr.addColorStop(0, light);
    gr.addColorStop(0.45, iris);
    gr.addColorStop(0.86, iris);
    gr.addColorStop(0.95, '#2a1a0c');
    gr.addColorStop(1, '#120a05');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    g.globalAlpha = 0.18;
    g.strokeStyle = '#3a2005';
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath();
      g.moveTo(128 + Math.cos(a) * 30, 128 + Math.sin(a) * 30);
      g.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#050302';
    g.beginPath();
    if (slit) g.ellipse(128, 128, 20, 92, 0, 0, Math.PI * 2);
    else g.arc(128, 128, 70, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(88, 82, 30, 24, -0.5, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 0.85;
    g.beginPath(); g.arc(170, 170, 12, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// 圓頂形眼球，平面投影貼圖（正面看就是一個圓形眼睛）
function makeEye(r, iris, light, slit, depth = 0.5) {
  const geo = new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.rotateX(-Math.PI / 2);
  geo.scale(1, 1, depth);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 - p.getX(i) / (2 * r), 0.5 + p.getY(i) / (2 * r));
  const m = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ map: eyeTex(iris, light, slit), shininess: 120, specular: 0x888888 }));
  const g = new THREE.Group();
  g.add(m);
  return g;
}
function whiskers(head, side, y, z) {
  const pts = [];
  for (let k = 0; k < 3; k++) {
    const a = -0.25 + k * 0.22;
    const x0 = side * 0.14, y0 = y + 0.02 - k * 0.03;
    let px = x0, py = y0, pz = z;
    for (let s = 1; s <= 4; s++) {
      const nx = x0 + side * 0.13 * s, ny = y0 + Math.sin(a) * 0.1 * s - 0.008 * s * s, nz = z + 0.03 * s;
      pts.push(px, py, pz, nx, ny, nz);
      px = nx; py = ny; pz = nz;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  head.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })));
}
function smoothMat(color, shininess = 40) {
  return new THREE.MeshPhongMaterial({ color, shininess, specular: 0x333333 });
}
function pads(paw, size, color) {
  const mat = smoothMat(color, 20);
  const g = new THREE.Group();
  const main = new THREE.Mesh(new THREE.SphereGeometry(size * 0.46, 14, 10), mat);
  main.scale.set(1.2, 0.4, 1.0);
  main.position.set(0, -size * 0.74, size * 0.16);
  g.add(main);
  for (const [x, z] of [[-0.42, -0.2], [-0.15, -0.42], [0.15, -0.42], [0.42, -0.2]]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(size * 0.17, 10, 8), mat);
    b.scale.set(1, 0.5, 1.1);
    b.position.set(x * size * 1.05, -size * 0.68, (z - 0.12) * size);
    g.add(b);
  }
  paw.add(g);
}

// ---------------------------------------------------------------- 四肢、尾巴
function makeLeg(fm, pawFm, { upper, lower, r, paw, curl = 0, seed = 1, pad = 0x6b5560 }) {
  const hip = new THREE.Group();
  const up = furry(blob(r, { sy: (upper / 2 + r) / r, amp: 0.008, curl, seed, ws: 22, hs: 16 }), fm);
  up.position.y = -upper / 2;
  hip.add(up);
  const knee = new THREE.Group();
  knee.position.y = -upper;
  hip.add(knee);
  const lr = r * 0.85;
  const lo = furry(blob(lr, { sy: (lower / 2 + lr) / lr, amp: 0.008, curl, seed: seed + 1, ws: 22, hs: 16 }), fm);
  lo.position.y = -lower / 2;
  knee.add(lo);
  const pw = furry(blob(paw, { sy: 0.62, sz: 1.3, sx: 1.05, amp: 0.006, curl: curl ? curl * 0.8 : 0, seed: seed + 2, ws: 22, hs: 16 }), pawFm);
  pw.position.set(0, -lower, -paw * 0.3);
  knee.add(pw);
  pads(pw, paw, pad);
  return { hip, knee, reach: upper + lower + paw * 0.62 };
}

// 尾巴：一整條蒙皮網格（SkinnedMesh），由一串骨骼帶動彎曲；毛髮殼層共用同一骨架
function tailGeo(n, len, r0, r1, plume, seed, curl) {
  const H = n * len;
  const pts = [new THREE.Vector2(0.001, -r0 * 0.5)];
  const rows = n * 6;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    let r = r0 + (r1 - r0) * t;
    if (t < 0.12) r *= 0.75 + 0.25 * Math.sin((t / 0.12) * Math.PI / 2);
    if (t > 0.82) r *= Math.sqrt(Math.max(0, 1 - ((t - 0.82) / 0.18) ** 2)) * 0.85 + 0.15;
    pts.push(new THREE.Vector2(r, t * H));
  }
  pts.push(new THREE.Vector2(0.001, H + r1 * 0.35));
  const g = new THREE.LatheGeometry(pts, 20);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const idx = [], wts = [];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const rr = Math.hypot(v.x, v.z);
    if (rr > 0.01) {
      const nx = v.x / rr, nz = v.z / rr;
      let d = (fbm(nx * 3 + 5, v.y * 5, nz * 3 + 5, seed) - 0.5) * 0.15 * rr;
      if (curl) { const c = noise3(nx * 4 + 9, v.y * curl * 0.6, nz * 4 + 9, seed + 2); d += c * c * rr * 0.3; }
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
function makeTail(fm, { n, len, r0, r1, curve, curl = 0, seed = 3, plume = 1 }) {
  const bones = [];
  for (let i = 0; i < n; i++) {
    const b = new THREE.Bone();
    if (i > 0) { b.position.y = len; bones[i - 1].add(b); }
    b.rotation.x = curve[i] || 0;
    bones.push(b);
  }
  const skeleton = new THREE.Skeleton(bones);
  const geo = tailGeo(n, len, r0, r1, plume, seed, curl);
  const mesh = new THREE.SkinnedMesh(geo, fm.base);
  mesh.add(bones[0]);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;
  const nt = Math.round(SHELLS * 0.75);
  for (let k = 0; k < nt; k++) {
    const sm = new THREE.SkinnedMesh(geo, fm.make(k, nt));
    sm.bind(skeleton, mesh.bindMatrix);
    sm.frustumCulled = false;
    mesh.add(sm);
  }
  const tip = new THREE.Group();
  tip.position.y = len;
  bones[n - 1].add(tip);
  return { root: mesh, segs: bones, tip };
}

// ---------------------------------------------------------------- 骨架
function baseRig(cfg) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  return { group, body, cfg, mats: [], legs: {}, ears: [], eyes: [], tail: [], head: null, neck: null };
}
function attachLegs(rig, fm, pawFm, spec, front, back) {
  const fl = makeLeg(fm, pawFm, { ...spec, seed: 31 });
  const fr = makeLeg(fm, pawFm, { ...spec, seed: 41 });
  const hl = makeLeg(fm, pawFm, { ...spec, upper: spec.upper * (spec.hind || 1), seed: 51 });
  const hr = makeLeg(fm, pawFm, { ...spec, upper: spec.upper * (spec.hind || 1), seed: 61 });
  fl.hip.position.set(-front[0], front[1], front[2]);
  fr.hip.position.set(front[0], front[1], front[2]);
  hl.hip.position.set(-back[0], back[1], back[2]);
  hr.hip.position.set(back[0], back[1], back[2]);
  rig.body.add(fl.hip, fr.hip, hl.hip, hr.hip);
  rig.legs = { fl, fr, hl, hr };
  rig.cfg.bodyY = fl.reach - front[1] + 0.03;
  rig.body.position.y = rig.cfg.bodyY;
}
function addPart(parent, mesh, x, y, z) {
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
function neckHead(rig, neckPos, headPos) {
  const neck = new THREE.Group();
  neck.position.set(...neckPos);
  rig.body.add(neck);
  const head = new THREE.Group();
  head.position.set(...headPos);
  neck.add(head);
  rig.neck = neck;
  rig.head = head;
  return head;
}

// ---------------------------------------------------------------- 墨墨（藍灰摺耳貓）
function buildFold() {
  const rig = baseRig({ stride: 1, wag: 5, tailCurve: [0.9, 0.2, 0.05, -0.1, -0.2, -0.25, -0.25], tailSide: [0.15, 0.12, 0.12, 0.1, 0.08, 0.06, 0.04] });
  const tex = furTex('#9a95a5', '#7a7486', '#c3bec9', { belly: '#b0abb8', back: '#8b8597' });
  const texL = furTex('#b3aebb', '#918b9a', '#d3cfd8');
  const body = furMaterials(tex, { len: 0.1, density: [9, 5], thin: 0.72 });
  const head = furMaterials(tex, { len: 0.06, density: [9, 5], thin: 0.72 });
  const light = furMaterials(texL, { len: 0.065, density: [8, 5], thin: 0.72 });
  const leg = furMaterials(tex, { len: 0.035, density: [6, 6] });
  const paw = furMaterials(texL, { len: 0.03, density: [5, 5] });
  for (const f of [body, head, light, leg, paw]) rig.mats.push(...f.all);

  addPart(rig.body, furry(blob(0.64, { sx: 1.22, sy: 1.0, sz: 1.2, seed: 2 }), body), 0, 0, 0);
  addPart(rig.body, furry(blob(0.58, { sx: 1.3, sy: 1.0, sz: 0.95, seed: 3 }), body), 0, -0.02, 0.44);
  addPart(rig.body, furry(blob(0.46, { sx: 1.15, sy: 1.05, seed: 4 }), light), 0, -0.06, -0.62);
  attachLegs(rig, leg, paw, { upper: 0.26, lower: 0.18, r: 0.2, paw: 0.22, pad: 0x8a6670 }, [0.36, -0.32, -0.55], [0.46, -0.3, 0.6]);

  const h = neckHead(rig, [0, 0.36, -0.8], [0, 0.22, -0.1]);
  addPart(h, furry(blob(0.6, { sx: 1.16, sy: 1.02, sz: 0.98, seed: 6 }), head), 0, 0, 0);
  for (const s of [-1, 1]) {
    // 鬍鬚墊（白色帶點灰的圓臉頰）
    addPart(h, furry(blob(0.15, { sx: 1.15, sy: 0.9, seed: 8 + s }), light), s * 0.11, -0.2, -0.5);
    const eye = makeEye(0.175, '#f0a21c', '#ffd75a', true, 0.55);
    eye.position.set(s * 0.25, 0.06, -0.54);
    eye.rotation.y = -s * 0.32;
    h.add(eye);
    rig.eyes.push(eye);
    // 摺耳：貼着頭頂向前摺下的小耳
    const ear = new THREE.Group();
    ear.position.set(s * 0.3, 0.48, -0.1);
    ear.rotation.set(-0.75, 0, -s * 0.45);
    const flap = furry(new THREE.SphereGeometry(0.19, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.05, 0.5, 0.9), head);
    ear.add(flap);
    h.add(ear);
    rig.ears.push({ g: ear, side: s, floppy: false });
    whiskers(h, s, -0.2, -0.6);
  }
  addPart(h, furry(blob(0.12, { sx: 1.1, sy: 0.8, seed: 12 }), light), 0, -0.33, -0.44);
  const nose = addPart(h, new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), smoothMat(0x5e4b55, 60)), 0, -0.1, -0.64);
  nose.scale.set(1.35, 0.8, 0.8);
  const tongue = addPart(h, new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), smoothMat(0xff8fa3)), 0, -0.3, -0.56);
  tongue.scale.set(1.2, 0.7, 0.8);

  const tail = makeTail(body, { n: 7, len: 0.16, r0: 0.17, r1: 0.12, curve: rig.cfg.tailCurve, seed: 70, plume: 1.05 });
  tail.root.position.set(0, 0.3, 0.92);
  rig.body.add(tail.root);
  rig.tail = tail.segs;
  return rig;
}

// ---------------------------------------------------------------- 粉粉（奶油色虎紋異國短毛貓）
function buildExotic() {
  const rig = baseRig({ stride: 1, wag: 5.5, tailCurve: [0.85, 0.15, -0.15, -0.35, -0.45, -0.5], tailSide: [-0.12, -0.1, -0.08, -0.06, -0.04, -0.02] });
  const tex = furTex('#f6d3a4', '#dfa468', '#fde8cc', { stripes: 12, belly: '#fdeedb' });
  const headTex = furTex('#f6d3a4', '#dfa468', '#fde8cc', { forehead: true });
  const whiteTex = furTex('#fff3e4', '#efdcc2', '#ffffff');
  const tailTex = furTex('#f4cc98', '#dc9c5e', '#fde6c8', { stripes: 5 });
  const body = furMaterials(tex, { len: 0.095, density: [9, 5], thin: 0.72 });
  const head = furMaterials(headTex, { len: 0.055, density: [9, 5], thin: 0.72 });
  const white = furMaterials(whiteTex, { len: 0.065, density: [8, 5], thin: 0.72 });
  const leg = furMaterials(tex, { len: 0.035, density: [6, 6] });
  const paw = furMaterials(whiteTex, { len: 0.03, density: [5, 5] });
  const tailF = furMaterials(tailTex, { len: 0.12, density: [7, 6], thin: 0.7 });
  for (const f of [body, head, white, leg, paw, tailF]) rig.mats.push(...f.all);

  addPart(rig.body, furry(blob(0.64, { sx: 1.2, sy: 0.96, sz: 1.2, seed: 12 }), body), 0, 0, 0);
  addPart(rig.body, furry(blob(0.58, { sx: 1.28, sy: 1.0, sz: 0.95, seed: 13 }), body), 0, -0.02, 0.43);
  addPart(rig.body, furry(blob(0.4, { sx: 1.1, sy: 1.0, seed: 14 }), white), 0, -0.12, -0.66);
  attachLegs(rig, leg, paw, { upper: 0.26, lower: 0.18, r: 0.2, paw: 0.22, pad: 0xf0a0a8 }, [0.36, -0.32, -0.55], [0.45, -0.3, 0.58]);

  const h = neckHead(rig, [0, 0.36, -0.8], [0, 0.22, -0.08]);
  addPart(h, furry(blob(0.61, { sx: 1.18, sy: 1.0, sz: 0.88, seed: 16 }), head), 0, 0, 0);
  for (const s of [-1, 1]) {
    addPart(h, furry(blob(0.14, { sx: 1.15, sy: 0.9, seed: 18 + s }), white), s * 0.1, -0.19, -0.5);
    // 大大的圓眼睛（異國短毛貓扁臉、眼睛很近鼻子）
    const eye = makeEye(0.17, '#e7a134', '#ffd36a', false, 0.55);
    eye.position.set(s * 0.25, 0.04, -0.49);
    eye.rotation.y = -s * 0.3;
    h.add(eye);
    rig.eyes.push(eye);
    // 小而圓的耳朵，內側粉紅
    const ear = new THREE.Group();
    ear.position.set(s * 0.36, 0.43, 0.02);
    ear.rotation.z = -s * 0.5;
    const outer = furry(new THREE.ConeGeometry(0.17, 0.26, 16).translate(0, 0.1, 0).scale(1, 1, 0.55), head);
    ear.add(outer);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.19, 14).translate(0, 0.08, 0).scale(1, 1, 0.4), smoothMat(0xffb4bf, 10));
    inner.position.z = -0.05;
    ear.add(inner);
    h.add(ear);
    rig.ears.push({ g: ear, side: s, floppy: false });
    whiskers(h, s, -0.19, -0.6);
  }
  addPart(h, furry(blob(0.13, { sx: 1.1, sy: 0.85, seed: 21 }), white), 0, -0.32, -0.42);
  const nose = addPart(h, new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), smoothMat(0xf09aa2, 60)), 0, -0.08, -0.6);
  nose.scale.set(1.35, 0.85, 0.8);

  const tail = makeTail(tailF, { n: 6, len: 0.18, r0: 0.15, r1: 0.15, curve: rig.cfg.tailCurve, seed: 80, plume: 1.1 });
  tail.root.position.set(0, 0.3, 0.9);
  rig.body.add(tail.root);
  rig.tail = tail.segs;
  return rig;
}

// ---------------------------------------------------------------- 冬菇（杏色玩具貴賓）
function buildPoodle() {
  const rig = baseRig({ stride: 1.1, wag: 9, tailCurve: [0.2, -0.1, -0.1] });
  const tex = furTex('#e9ad72', '#c9894e', '#fbd2a0', { curls: true });
  const texL = furTex('#f0bb85', '#d0965d', '#fddcb2', { curls: true });
  const C = 14;
  const body = furMaterials(tex, { len: 0.09, density: [9, 5], curly: true, grav: 0.1, thin: 0.75 });
  const light = furMaterials(texL, { len: 0.08, density: [8, 5], curly: true, grav: 0.1, thin: 0.75 });
  const leg = furMaterials(tex, { len: 0.06, density: [5, 5], curly: true, grav: 0.1, thin: 0.75 });
  const paw = furMaterials(texL, { len: 0.03, density: [5, 5], curly: true, grav: 0.05, thin: 0.75 });
  for (const f of [body, light, leg, paw]) rig.mats.push(...f.all);

  addPart(rig.body, furry(blob(0.55, { sx: 1.0, sy: 0.95, sz: 1.25, curl: C, seed: 22 }), body), 0, 0, 0);
  addPart(rig.body, furry(blob(0.48, { sx: 1.15, curl: C, seed: 23 }), body), 0, 0, 0.42);
  addPart(rig.body, furry(blob(0.42, { sy: 1.1, curl: C, seed: 24 }), body), 0, 0, -0.55);
  attachLegs(rig, leg, paw, { upper: 0.34, lower: 0.28, r: 0.17, paw: 0.2, curl: C, hind: 1.05, pad: 0x3a2826 }, [0.28, -0.3, -0.5], [0.34, -0.25, 0.55]);

  const h = neckHead(rig, [0, 0.42, -0.7], [0, 0.32, -0.12]);
  // 圓圓的泰迪熊頭＋頭頂蓬鬆毛球
  addPart(h, furry(blob(0.5, { sx: 1.06, curl: C, seed: 26 }), body), 0, 0, 0);
  addPart(h, furry(blob(0.38, { sx: 1.15, curl: C, seed: 28 }), light), 0, 0.36, 0.04);
  addPart(h, furry(blob(0.22, { sz: 1.25, sy: 0.85, curl: C, seed: 30 }), light), 0, -0.15, -0.42);
  const nose = addPart(h, new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), smoothMat(0x1d1412, 90)), 0, -0.07, -0.7);
  nose.scale.set(1.25, 0.9, 0.9);
  const tongue = addPart(h, new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), smoothMat(0xff7d93, 50)), 0, -0.31, -0.56);
  tongue.scale.set(1, 0.45, 1.2);
  rig.tongue = tongue;
  for (const s of [-1, 1]) {
    const eye = makeEye(0.11, '#3a2214', '#6a4128', false, 0.6);
    eye.position.set(s * 0.2, 0.07, -0.5);
    eye.rotation.y = -s * 0.3;
    h.add(eye);
    rig.eyes.push(eye);
    // 長長的捲毛垂耳
    const ear = new THREE.Group();
    ear.position.set(s * 0.42, 0.14, -0.02);
    const e = furry(blob(0.24, { sx: 0.75, sy: 1.6, sz: 0.65, curl: C, seed: 33 + s }), body);
    e.position.y = -0.3;
    ear.add(e);
    h.add(ear);
    rig.ears.push({ g: ear, side: s, floppy: true });
  }

  const tail = makeTail(body, { n: 3, len: 0.16, r0: 0.11, r1: 0.1, curve: rig.cfg.tailCurve, curl: C, seed: 90 });
  tail.root.position.set(0, 0.3, 0.66);
  tail.root.rotation.x = 0.35;
  const pom = furry(blob(0.26, { curl: C, seed: 95 }), light);
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
  if (id === 'exotic' && FENFEN) return createFenfen(glow);
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
      rig.tail.forEach((s, i) => { s.rotation.set(cfg.tailCurve[i] || 0, 0, (cfg.tailSide || [])[i] || 0); });
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
      s.rotation.z = ((cfg.tailSide || [])[i] || 0) + Math.sin(t * wag - i * 0.65) * (0.08 + 0.06 * A + (o.cheer ? 0.15 : 0));
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

// 粉粉（立體模型版）：介面與其他角色相同（group、pose、tint）
function createFenfen(glow) {
  const rig = buildFenfenRig(FENFEN);
  const glowCol = new THREE.Color(glow);
  rig.pose = (o) => fenfenPose(rig, o);
  rig.tint = (flash, boost, t) => {
    _flash.setRGB(0.9 * flash, 0.15 * flash, 0.2 * flash);
    const b = boost * (0.22 + 0.1 * Math.sin(t * 25));
    _flash.r += glowCol.r * b;
    _flash.g += glowCol.g * b;
    _flash.b += glowCol.b * b;
    rig.mats.forEach((m) => m.emissive.copy(_flash));
  };
  rig.pose({ frozen: true });
  return rig;
}
