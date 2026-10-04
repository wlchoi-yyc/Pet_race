// 萌寵大賽跑 Pet Dash 3D
import * as THREE from './lib/three.module.js';
import { Sound } from './audio.js';
import { createPet } from './models.js';

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const TRACK_LEN = 1500;
const RUNOUT = 220;
const TRACK_W = 14;
const X_LIMIT = 6.0;
const GRAVITY = 30;

const CHARS = [
  {
    id: 'poodle', name: '冬菇', tag: '跳得最高！', img: 'assets/poodle.png', color: 0xffa04d, css: '#ffa04d',
    maxSpeed: 34, accel: 15, steer: 12.5, jump: 10.6, boostMul: 1.5,
    stats: { 速度: 4, 加速: 4, 靈活: 4, 跳躍: 5 },
  },
  {
    id: 'fold', name: '墨墨', tag: '極速衝刺王！', img: 'assets/fold.png', color: 0x9a8cff, css: '#9a8cff',
    maxSpeed: 35.2, accel: 13, steer: 11.2, jump: 9.4, boostMul: 1.58,
    stats: { 速度: 5, 加速: 3, 靈活: 3, 跳躍: 3 },
  },
  {
    id: 'exotic', name: '粉粉', tag: '轉彎最靈活！', img: 'assets/exotic.png', color: 0xff6fae, css: '#ff6fae',
    maxSpeed: 33.6, accel: 18, steer: 14.5, jump: 9.8, boostMul: 1.5,
    stats: { 速度: 3, 加速: 5, 靈活: 5, 跳躍: 4 },
  },
];
const START_X = [-3.2, 0, 3.2];

// ---------------------------------------------------------------- renderer
const sound = new Sound();
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffe6f6, 160, 620);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 1500);
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

scene.add(new THREE.HemisphereLight(0xffffff, 0xd8c8ec, 1.9));
const sun = new THREE.DirectionalLight(0xfff0dc, 1.7);
sun.position.set(-40, 80, 30);
scene.add(sun);

const U = { time: { value: 0 }, camZ: { value: 0 }, excite: { value: 0 } };

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function paw(g, x, y, s) {
  g.beginPath();
  g.ellipse(x, y + s * 0.25, s * 0.45, s * 0.38, 0, 0, Math.PI * 2);
  g.fill();
  for (const [dx, dy] of [[-0.48, -0.25], [-0.17, -0.55], [0.17, -0.55], [0.48, -0.25]]) {
    g.beginPath();
    g.ellipse(x + dx * s, y + dy * s, s * 0.16, s * 0.2, dx * 0.6, 0, Math.PI * 2);
    g.fill();
  }
}
function star(g, x, y, r1, r2, n = 5) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
}
const RAINBOW = ['#ff4d6d', '#ff9f1c', '#ffd23f', '#5ce17a', '#3fb8ff', '#7a4dff', '#ff5fa2'];
const PALETTE = [0xff5fa2, 0xffd23f, 0x3fb8ff, 0x7a4dff, 0x5ce17a, 0xff8a3d, 0xffffff, 0x4de1d2];

// ---------------------------------------------------------------- sky & far scenery
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x3d9cff) }, mid: { value: new THREE.Color(0x9fdcff) }, bot: { value: new THREE.Color(0xffe1f4) } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform vec3 top, mid, bot; varying vec3 vP;
    void main(){ float h = vP.y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.6, h)) : mix(bot, mid, smoothstep(-0.05, 0.08, h));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), skyMat);
sky.renderOrder = -10;
scene.add(sky);

const far = new THREE.Group();
scene.add(far);
{
  const cloudTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#fff';
    for (let i = 0; i < 9; i++) {
      const x = 50 + Math.random() * 156, y = 70 + Math.random() * 20, r = 22 + Math.random() * 26;
      g.beginPath(); g.arc(x, y - r * 0.3, r, 0, Math.PI * 2); g.fill();
    }
    g.fillRect(40, 80, 176, 30);
  });
  for (let i = 0; i < 34; i++) {
    const m = new THREE.SpriteMaterial({ map: cloudTex, fog: false, transparent: true, opacity: rand(0.75, 1), depthWrite: false });
    const s = new THREE.Sprite(m);
    const a = rand(-1.2, 1.2);
    const d = rand(380, 900);
    s.position.set(Math.sin(a) * d, rand(60, 230), -Math.cos(a) * d);
    const sc = rand(90, 190);
    s.scale.set(sc, sc * 0.5, 1);
    s.userData.drift = rand(1, 4);
    far.add(s);
  }
  // 遠山
  const hillCols = [0x8ee3a1, 0xb9e88c, 0xc7a8ff, 0xffb4d9, 0x7fd8c8, 0xa5d6ff];
  for (let i = 0; i < 46; i++) {
    const a = rand(-1.5, 1.5);
    const d = rand(420, 700);
    const r = rand(60, 150);
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12), new THREE.MeshLambertMaterial({ color: pick(hillCols) }));
    m.scale.y = rand(0.5, 0.9);
    m.position.set(Math.sin(a) * d, -r * 0.25, -Math.cos(a) * d);
    far.add(m);
  }
  // 彩虹
  const rb = new THREE.Group();
  RAINBOW.slice(0, 7).forEach((c, i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(330 - i * 13, 6.8, 6, 64, Math.PI),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, fog: false, depthWrite: false }));
    rb.add(m);
  });
  rb.position.set(220, -40, -820);
  rb.rotation.y = -0.35;
  far.add(rb);
}

// ---------------------------------------------------------------- ground, track, stands
const L_TOTAL = TRACK_LEN + RUNOUT;
{
  const grass = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#7fd864';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#74cf5a';
    g.fillRect(0, 0, w, h / 2);
    const fl = ['#fff', '#ffd23f', '#ff8fc5', '#c9a7ff'];
    for (let i = 0; i < 70; i++) {
      g.fillStyle = pick(fl);
      g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 2.5, 0, Math.PI * 2); g.fill();
    }
  }, true);
  grass.repeat.set(60, (L_TOTAL + 1400) / 20);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, L_TOTAL + 1400), new THREE.MeshLambertMaterial({ map: grass }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.12, -(L_TOTAL / 2) + 200);
  scene.add(ground);

  const trackTex = canvasTex(512, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#7650d8'); grd.addColorStop(0.5, '#9c7bf0'); grd.addColorStop(1, '#7650d8');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.1})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = 'rgba(255,255,255,.9)';
    for (const fx of [1 / 3, 2 / 3]) { g.fillRect(fx * w - 5, 0, 10, h * 0.25); g.fillRect(fx * w - 5, h * 0.5, 10, h * 0.25); }
    g.fillRect(10, 0, 12, h); g.fillRect(w - 22, 0, 12, h);
    g.fillStyle = 'rgba(255,255,255,.08)';
    paw(g, w / 6, h * 0.62, 30); paw(g, w / 2, h * 0.12, 30); paw(g, w * 5 / 6, h * 0.62, 30);
  }, true);
  const len = L_TOTAL + 80;
  trackTex.repeat.set(1, len / 14);
  const track = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, len), new THREE.MeshLambertMaterial({ map: trackTex }));
  track.rotation.x = -Math.PI / 2;
  track.position.set(0, 0.03, -(len / 2) + 60);
  scene.add(track);

  // 起點與終點線
  const checker = canvasTex(256, 64, (g, w, h) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? '#222' : '#fff'; g.fillRect(x * 16, y * 16, 16, 16);
    }
  });
  for (const z of [0, -TRACK_LEN]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 2.4), new THREE.MeshLambertMaterial({ map: checker }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.07, z);
    scene.add(m);
  }

  // 路肩
  const curb = canvasTex(64, 64, (g) => { g.fillStyle = '#ff3d5e'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#fff'; g.fillRect(0, 32, 64, 32); }, true);
  curb.repeat.set(1, len / 3);
  const curbMat = new THREE.MeshLambertMaterial({ map: curb });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, len), [curbMat, curbMat, curbMat, curbMat, curbMat, curbMat]);
    m.geometry.attributes.uv.array.forEach(() => {});
    m.position.set(s * (TRACK_W / 2 + 0.45), 0.15, -(len / 2) + 60);
    scene.add(m);
  }

  // 圍欄廣告板（爪印）
  const fence = canvasTex(512, 96, (g, w, h) => {
    const cols = ['#ff5fa2', '#3fb8ff', '#ffd23f', '#7a4dff'];
    cols.forEach((c, i) => {
      g.fillStyle = c; g.fillRect(i * 128, 0, 128, h);
      g.fillStyle = 'rgba(255,255,255,.9)'; paw(g, i * 128 + 64, h / 2 + 4, 26);
      g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(i * 128, 0, 4, h);
    });
  }, true);
  fence.repeat.set(len / 18, 1);
  const fenceMat = new THREE.MeshLambertMaterial({ map: fence, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.2), fenceMat);
    m.rotation.y = s * Math.PI / 2;
    m.position.set(s * 8.4, 0.6, -(len / 2) + 60);
    scene.add(m);
  }

  // 看台
  const standCols = [0xffffff, 0xd7ecff, 0xffe3f2];
  for (const s of [-1, 1]) {
    for (let r = 0; r < 3; r++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5 + r * 0.7, len + 120), new THREE.MeshLambertMaterial({ color: standCols[r] }));
      m.position.set(s * (9.8 + r * 1.7), (0.5 + r * 0.7) / 2, -(len / 2) + 100);
      scene.add(m);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.2, len + 120), new THREE.MeshLambertMaterial({ color: 0x7a4dff }));
    back.position.set(s * 14.6, 2.1, -(len / 2) + 100);
    scene.add(back);
  }
}

// 觀眾：實例化，並在著色器中隨鏡頭循環擺放（永遠在鏡頭附近），各自跳動
function crowdMat(color, extra = '') {
  const m = new THREE.MeshLambertMaterial({ color });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time;
    sh.uniforms.uCamZ = U.camZ;
    sh.uniforms.uExcite = U.excite;
    sh.vertexShader = 'uniform float uTime; uniform float uCamZ; uniform float uExcite;\n' + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      float fid = float(gl_InstanceID);
      float ph = fract(sin(fid * 12.9898) * 43758.5453) * 6.2831;
      float spd = 5.0 + fract(fid * 0.618) * 5.0;
      float jumpH = abs(sin(uTime * spd + ph)) * (0.1 + 0.4 * uExcite);
      mvPosition.y += jumpH;
      ${extra}
      float W = 300.0;
      float lo = uCamZ - 220.0;
      mvPosition.z -= W * floor((mvPosition.z - lo) / W);
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return m;
}
function mergeGeos(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  geos.forEach((g) => (n += g.attributes.position.count));
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  geos.forEach((g) => {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
{
  const fans = [];
  for (const s of [-1, 1]) for (let r = 0; r < 3; r++) {
    for (let z = 0; z < 300; z += rand(0.9, 1.3)) fans.push([s * (9.8 + r * 1.7 + rand(-0.35, 0.35)), 0.5 + r * 0.7, z, s]);
  }
  const N = fans.length;
  const bodyG = new THREE.CapsuleGeometry(0.32, 0.35, 3, 7);
  bodyG.translate(0, 0.5, 0);
  const headG = new THREE.SphereGeometry(0.3, 9, 7);
  headG.translate(0, 1.15, 0);
  const e1 = new THREE.ConeGeometry(0.1, 0.25, 5); e1.translate(-0.17, 1.42, 0);
  const e2 = new THREE.ConeGeometry(0.1, 0.25, 5); e2.translate(0.17, 1.42, 0);
  const earG = mergeGeos([e1, e2]);
  const armG = mergeGeos([
    new THREE.CapsuleGeometry(0.08, 0.45, 2, 5).translate(-0.38, 1.05, 0).rotateZ(0),
    new THREE.CapsuleGeometry(0.08, 0.45, 2, 5).translate(0.38, 1.05, 0),
  ]);
  const armWave = `
      if (position.y > 0.7) { float wv = sin(uTime * 9.0 + ph) * 0.25 * (0.4 + uExcite); mvPosition.x += wv * sign(position.x); }`;
  const body = new THREE.InstancedMesh(bodyG, crowdMat(0xffffff), N);
  const head = new THREE.InstancedMesh(headG, crowdMat(0xffffff), N);
  const ears = new THREE.InstancedMesh(earG, crowdMat(0xffffff), N);
  const arms = new THREE.InstancedMesh(armG, crowdMat(0xffffff, armWave), N);
  const furs = [0xfff1dc, 0xf3b27a, 0x8d8a96, 0xffffff, 0xe39552, 0x6b4a3a, 0xffd9a8];
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  fans.forEach(([x, y, z, s], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -s * Math.PI / 2 + rand(-0.4, 0.4));
    const sc = rand(0.85, 1.15);
    mtx.compose(new THREE.Vector3(x, y, -z), q, new THREE.Vector3(sc, sc, sc));
    for (const m of [body, head, ears, arms]) m.setMatrixAt(i, mtx);
    body.setColorAt(i, col.setHex(pick(PALETTE)));
    const fur = pick(furs);
    head.setColorAt(i, col.setHex(fur));
    ears.setColorAt(i, col.setHex(fur));
    arms.setColorAt(i, col.setHex(fur));
  });
  for (const m of [body, head, ears, arms]) {
    m.frustumCulled = false;
    scene.add(m);
  }
}

// 樹、旗、彩旗串、氣球
{
  const tN = 900;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 6).translate(0, 1.5, 0), new THREE.MeshLambertMaterial({ color: 0x9a6a45 }), tN);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 1).translate(0, 4.6, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), tN);
  const tcols = [0xff9fd0, 0xc7a8ff, 0x7ddc7a, 0x9be8b0, 0xffc2e0, 0xb18cff, 0x5fcf6a];
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  for (let i = 0; i < tN; i++) {
    const s = i % 2 ? 1 : -1;
    const x = s * rand(19, 90);
    const z = rand(-L_TOTAL - 300, 200);
    const sc = rand(0.8, 1.7);
    m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, 6)), new THREE.Vector3(sc, sc * rand(0.9, 1.3), sc));
    trunk.setMatrixAt(i, m);
    crown.setMatrixAt(i, m);
    crown.setColorAt(i, c.setHex(pick(tcols)));
  }
  scene.add(trunk, crown);

  // 旗桿
  const poles = [];
  for (let z = 30; z > -L_TOTAL; z -= 22) for (const s of [-1, 1]) poles.push([s * 8.9, z]);
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6).translate(0, 3, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), poles.length);
  const flagG = new THREE.BufferGeometry();
  flagG.setAttribute('position', new THREE.Float32BufferAttribute([0, 6, 0, 0, 5, 0, 0, 5.5, 1.6], 3));
  flagG.computeVertexNormals();
  const flag = new THREE.InstancedMesh(flagG, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), poles.length);
  poles.forEach(([x, z], i) => {
    m.makeTranslation(x, 0, z);
    pole.setMatrixAt(i, m);
    flag.setMatrixAt(i, m);
    flag.setColorAt(i, c.setHex(pick(PALETTE)));
  });
  scene.add(pole, flag);

  // 頭頂彩旗串
  const pennants = [];
  for (let z = -40; z > -TRACK_LEN; z -= 55) {
    for (let k = 0; k < 22; k++) {
      const t = k / 21;
      const x = lerp(-8.9, 8.9, t);
      pennants.push([x, 7.4 - Math.sin(t * Math.PI) * 1.6, z, k]);
    }
  }
  const pG = new THREE.BufferGeometry();
  pG.setAttribute('position', new THREE.Float32BufferAttribute([-0.38, 0, 0, 0.38, 0, 0, 0, -0.9, 0], 3));
  pG.computeVertexNormals();
  const pen = new THREE.InstancedMesh(pG, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), pennants.length);
  pennants.forEach(([x, y, z, k], i) => {
    m.makeTranslation(x, y, z);
    pen.setMatrixAt(i, m);
    pen.setColorAt(i, c.set(RAINBOW[k % 7]));
  });
  scene.add(pen);

  // 氣球
  const bN = 260;
  const balloons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 12, 10).scale(1, 1.2, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), bN);
  for (let i = 0; i < bN; i++) {
    const s = i % 2 ? 1 : -1;
    m.makeTranslation(s * rand(12, 16), rand(5.5, 9), rand(-L_TOTAL, 40));
    balloons.setMatrixAt(i, m);
    balloons.setColorAt(i, c.setHex(pick(PALETTE)));
  }
  scene.add(balloons);
}

// 拱門
function textTex(lines, bg, fg) {
  return canvasTex(1024, 128, (g, w, h) => {
    if (bg === 'checker') {
      for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#222' : '#fff'; g.fillRect(x * 32, y * 32, 32, 32); }
      g.fillStyle = 'rgba(122,77,255,.92)';
      g.fillRect(170, 14, w - 340, h - 28);
    } else {
      const grd = g.createLinearGradient(0, 0, w, 0);
      bg.forEach((c, i) => grd.addColorStop(i / (bg.length - 1), c));
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.35)';
      for (let i = 0; i < 14; i++) star(g, Math.random() * w, Math.random() * h, 10, 4);
    }
    g.font = '900 78px "Fredoka","Noto Sans TC",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 12;
    g.strokeStyle = '#2b1a55';
    g.strokeText(lines, w / 2, h / 2 + 4);
    g.fillStyle = fg;
    g.fillText(lines, w / 2, h / 2 + 4);
  });
}
const arches = [];
function makeArch(dist, text, bg, fg, pillarCol) {
  const g = new THREE.Group();
  const pm = new THREE.MeshLambertMaterial({ color: pillarCol });
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, 1.2), pm);
    p.position.set(s * 8.1, 4.5, 0);
    g.add(p);
    for (let k = 0; k < 5; k++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10), new THREE.MeshLambertMaterial({ color: pick(PALETTE) }));
      b.scale.y = 1.2;
      b.position.set(s * 8.1 + rand(-1, 1), 10 + rand(0, 1.6), rand(-0.6, 0.6));
      g.add(b);
    }
  }
  const tex = textTex(text, bg, fg);
  const side = new THREE.MeshLambertMaterial({ color: pillarCol });
  const front = new THREE.MeshLambertMaterial({ map: tex });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(17.4, 2.2, 0.8), [side, side, side, side, front, front]);
  beam.position.y = 8.4;
  g.add(beam);
  g.position.z = -dist;
  scene.add(g);
  arches.push(g);
}
makeArch(-4, 'START  起點', ['#ff5fa2', '#7a4dff', '#3fb8ff'], '#fff', 0xff5fa2);
makeArch(TRACK_LEN * 0.25, '加油！ 25%', ['#3fb8ff', '#5ce17a'], '#ffd23f', 0x3fb8ff);
makeArch(TRACK_LEN * 0.5, '一半了！ 50%', ['#ffd23f', '#ff8a3d'], '#fff', 0xffd23f);
makeArch(TRACK_LEN * 0.75, '衝呀！ 75%', ['#7a4dff', '#ff5fa2'], '#ffd23f', 0x7a4dff);
makeArch(TRACK_LEN, 'FINISH  終點', 'checker', '#ffd23f', 0x2b1a55);

// ---------------------------------------------------------------- particles
function softTex() {
  const t = canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
function starTex() {
  const t = canvasTex(64, 64, (g) => { g.fillStyle = '#fff'; star(g, 32, 34, 30, 12); });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
function squareTex() {
  const t = canvasTex(16, 16, (g) => { g.fillStyle = '#fff'; g.fillRect(2, 4, 12, 8); });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
class Particles {
  constructor(max, tex, additive) {
    this.max = max;
    this.i = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.siz = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxL = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSiz = new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('acolor', this.aCol);
    g.setAttribute('size', this.aSiz);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uPx: { value: 500 } },
      vertexShader: `attribute float size; attribute vec4 acolor; varying vec4 vC; uniform float uPx;
        void main(){ vC = acolor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uPx / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); float a = vC.a * t.a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb * t.rgb, a); }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, color, a = 1, grav = 0, drag = 0) {
    const i = this.i;
    this.i = (this.i + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.maxL[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a;
    this.grav[i] = grav; this.drag[i] = drag;
    const c = color instanceof THREE.Color ? color : _c.set(color);
    this.col[i * 4] = c.r; this.col[i * 4 + 1] = c.g; this.col[i * 4 + 2] = c.b;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.siz[i] = 0; continue; }
      this.life[i] -= dt;
      const k = 1 - this.drag[i] * dt;
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05) { this.pos[i * 3 + 1] = 0.05; this.vel[i * 3 + 1] *= -0.3; }
      const t = 1 - Math.max(0, this.life[i]) / this.maxL[i];
      this.siz[i] = lerp(this.s0[i], this.s1[i], t);
      this.col[i * 4 + 3] = this.a0[i] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
    }
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSiz.needsUpdate = true;
  }
}
const _c = new THREE.Color();
const dust = new Particles(600, softTex(), false);
const sparkle = new Particles(700, starTex(), true);
const confetti = new Particles(900, squareTex(), false);

// ---------------------------------------------------------------- racers
function glowTex(color) {
  return canvasTex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, color); r.addColorStop(0.45, color + '88'); r.addColorStop(1, color + '00');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });
}
function labelTex(text, bg) {
  return canvasTex(256, 96, (g) => {
    g.font = '900 46px "Fredoka","Noto Sans TC",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = Math.min(240, g.measureText(text).width + 40);
    g.fillStyle = bg;
    g.beginPath(); g.roundRect(128 - w / 2, 8, w, 60, 30); g.fill();
    g.beginPath(); g.moveTo(112, 66); g.lineTo(144, 66); g.lineTo(128, 90); g.fill();
    g.fillStyle = '#fff';
    g.lineWidth = 6; g.strokeStyle = '#2b1a55';
    g.strokeText(text, 128, 40);
    g.fillText(text, 128, 40);
  });
}
const shadowTex = canvasTex(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(40,20,80,.55)'); r.addColorStop(1, 'rgba(40,20,80,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
});

const racers = [];
function createRacer(def, idx) {
  const model = createPet(def.id, def.color);
  const pivot = new THREE.Group();
  pivot.add(model.group);
  const root = new THREE.Group();
  root.add(pivot);

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.9), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.1;
  root.add(shadow);

  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(def.css), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  aura.scale.set(4, 4, 1);
  aura.position.y = 1.1;
  root.add(aura);

  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(def.name, def.css), transparent: true, depthWrite: false }));
  label.scale.set(2.2, 0.83, 1);
  label.position.y = 3.0;
  label.renderOrder = 10;
  root.add(label);
  scene.add(root);

  return {
    def, idx, root, pivot, model, shadow, aura, label, isPlayer: false, flash: 0, boostGlow: 0, amp: 0, yaw: 0,
    dist: 0, x: START_X[idx], y: 0, vy: 0, vx: 0, speed: 0, boost: 0, stun: 0, slow: 0, invul: 0,
    finished: false, finishTime: 0, phase: rand(0, 6), land: 0, stepAcc: 0, dustAcc: 0, celebrate: 0,
    score: 0, foods: 0, combo: 0, hits: 0, jumps: 0,
    ai: { think: 0, targetX: START_X[idx], jumpAt: null, skill: 0.8, cruise: START_X[idx] },
  };
}
CHARS.forEach((d, i) => racers.push(createRacer(d, i)));

// ---------------------------------------------------------------- obstacles & food
const obstacles = [];
const foods = [];
const pads = [];
const levelGroup = new THREE.Group();
scene.add(levelGroup);

const OB = {};
{
  const stripe = canvasTex(64, 16, (g) => { for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#fff' : '#ff3d5e'; g.fillRect(i * 16, 0, 16, 16); } }, true);
  const ballTex = canvasTex(256, 128, (g) => { RAINBOW.slice(0, 6).forEach((c, i) => { g.fillStyle = c; g.fillRect(0, 0, 0, 0); g.fillRect(i * 256 / 6, 0, 256 / 6 + 1, 128); }); g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 6, 20, 0, 7); g.fill(); g.beginPath(); g.arc(128, 122, 20, 0, 7); g.fill(); });
  const crateTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#e8a35a'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#a5622a'; g.lineWidth = 12; g.strokeRect(6, 6, 116, 116);
    g.beginPath(); g.moveTo(10, 10); g.lineTo(118, 118); g.stroke();
    g.fillStyle = '#fff'; g.font = '900 54px sans-serif'; g.textAlign = 'center'; g.fillText('!', 92, 60);
  });
  OB.cone = () => {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 14), new THREE.MeshLambertMaterial({ color: 0xff7a1a }));
    c.position.y = 0.7;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.38, 0.22, 14), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    band.position.y = 0.72;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 1.05), new THREE.MeshLambertMaterial({ color: 0xff7a1a }));
    base.position.y = 0.06;
    g.add(c, band, base);
    return { mesh: g, hw: 0.55, hd: 0.5, h: 1.2 };
  };
  OB.hurdle = () => {
    const g = new THREE.Group();
    const pm = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.0, 8), pm);
      p.position.set(s * 1.35, 0.5, 0);
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.9), pm);
      f.position.set(s * 1.35, 0.04, 0);
      g.add(p, f);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.32, 0.12), new THREE.MeshLambertMaterial({ map: stripe }));
    bar.position.y = 0.88;
    g.add(bar);
    return { mesh: g, hw: 1.45, hd: 0.3, h: 1.05 };
  };
  OB.rock = () => {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 0), new THREE.MeshLambertMaterial({ color: 0xa79bc8, flatShading: true }));
    m.scale.set(1.1, 0.8, 1);
    m.position.y = 0.5;
    m.rotation.set(rand(0, 3), rand(0, 3), 0);
    const g = new THREE.Group();
    g.add(m);
    return { mesh: g, hw: 0.85, hd: 0.75, h: 1.05 };
  };
  OB.crates = () => {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ map: crateTex });
    const a = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mat); a.position.set(-0.72, 0.7, 0);
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mat); b.position.set(0.72, 0.7, 0.05); b.rotation.y = 0.15;
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mat); c.position.set(0, 2.1, 0); c.rotation.y = -0.2;
    g.add(a, b, c);
    return { mesh: g, hw: 1.45, hd: 0.75, h: 2.8, tall: true };
  };
  OB.ball = () => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 16), new THREE.MeshLambertMaterial({ map: ballTex }));
    m.position.y = 1.05;
    m.rotation.x = Math.PI / 2;
    const inner = new THREE.Group();
    inner.add(m);
    const g = new THREE.Group();
    g.add(inner);
    g.userData.inner = inner;
    return { mesh: g, hw: 1.05, hd: 1.0, h: 2.1, tall: true };
  };
  OB.puddle = () => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1.4, 20), new THREE.MeshLambertMaterial({ color: 0x7a5236 }));
    m.rotation.x = -Math.PI / 2;
    m.scale.set(1.2, 0.8, 1);
    m.position.y = 0.07;
    const s = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), new THREE.MeshBasicMaterial({ color: 0xb08866 }));
    s.rotation.x = -Math.PI / 2;
    s.position.set(-0.4, 0.09, -0.2);
    const g = new THREE.Group();
    g.add(m, s);
    return { mesh: g, hw: 1.6, hd: 1.0, h: 0.3, puddle: true };
  };
}

const FOOD = {};
{
  const mk = (color) => new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 });
  FOOD.bone = () => {
    const g = new THREE.Group();
    const m = mk(0xfff4e0);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.9, 10), m);
    c.rotation.z = Math.PI / 2;
    g.add(c);
    for (const x of [-0.45, 0.45]) for (const y of [-0.14, 0.14]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), m);
      s.position.set(x, y, 0);
      g.add(s);
    }
    return g;
  };
  FOOD.fish = () => {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), mk(0x4fb5ff));
    b.scale.set(1.3, 0.75, 0.4);
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.45, 3), mk(0x2b7fe0));
    t.rotation.z = Math.PI / 2;
    t.position.x = -0.62;
    t.scale.z = 0.3;
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    e.position.set(0.3, 0.07, 0.15);
    g.add(b, t, e);
    return g;
  };
  FOOD.donut = () => {
    const g = new THREE.Group();
    const d = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.17, 10, 20), mk(0xd99a5b));
    const ic = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.12, 8, 20), mk(0xff7cc0));
    ic.position.z = 0.07;
    g.add(d, ic);
    return g;
  };
  FOOD.berry = () => {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 10), mk(0xff3d5e));
    b.scale.set(1, 1.15, 1);
    const l = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.2, 6), mk(0x3fc45a));
    l.position.y = 0.42;
    l.rotation.x = Math.PI;
    g.add(b, l);
    return g;
  };
}
const foodGlow = glowTex('#fff6a8');
const padTex = canvasTex(128, 256, (g, w, h) => {
  const grd = g.createLinearGradient(0, h, 0, 0);
  RAINBOW.forEach((c, i) => grd.addColorStop(i / 6, c));
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.95)';
  for (let k = 0; k < 2; k++) {
    const y = k * 128 + 20;
    g.beginPath(); g.moveTo(64, y); g.lineTo(118, y + 60); g.lineTo(92, y + 60); g.lineTo(64, y + 32); g.lineTo(36, y + 60); g.lineTo(10, y + 60); g.closePath(); g.fill();
  }
}, true);
const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.95 });

function clearLevel() {
  for (const o of [...obstacles, ...foods, ...pads]) levelGroup.remove(o.mesh);
  obstacles.length = foods.length = pads.length = 0;
}
function addObstacle(type, dist, x, opts = {}) {
  const o = OB[type]();
  Object.assign(o, { type, dist, x, baseX: x, alive: true, fly: null, hitBy: new Set(), jumped: new Set() }, opts);
  o.mesh.position.set(x, 0, -dist);
  levelGroup.add(o.mesh);
  obstacles.push(o);
  return o;
}
function freeSpot(dist, x, r) {
  for (const o of obstacles) if (Math.abs(o.dist - dist) < o.hd + r + 1.5 && Math.abs(o.x - x) < o.hw + r + (o.amp || 0) + 0.5) return false;
  return true;
}
function addFood(dist, x) {
  if (!freeSpot(dist, x, 0.8)) return;
  const type = pick(Object.keys(FOOD));
  const inner = FOOD[type]();
  inner.scale.setScalar(1.3);
  const g = new THREE.Group();
  g.add(inner);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: foodGlow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
  glow.scale.set(2.4, 2.4, 1);
  g.add(glow);
  g.position.set(x, 1.1, -dist);
  levelGroup.add(g);
  foods.push({ type, dist, x, mesh: g, inner, taken: false, ph: rand(0, 6) });
}
function buildLevel() {
  clearLevel();
  let d = 75;
  while (d < TRACK_LEN - 45) {
    const prog = d / TRACK_LEN;
    const r = Math.random();
    if (r < 0.2) {
      // 一排三角錐，留一個缺口
      const gap = rand(-4.2, 4.2);
      for (let x = -5.4; x <= 5.4; x += 1.8) if (Math.abs(x - gap) > 1.6) addObstacle('cone', d, x);
    } else if (r < 0.34) {
      addObstacle('ball', d, rand(-2, 2), { amp: rand(2.5, 3.6), freq: rand(1.1, 1.9), ph: rand(0, 6) });
    } else if (r < 0.48) {
      const x = rand(-4.4, 4.4);
      addObstacle('crates', d, x);
      if (prog > 0.35 && Math.random() < 0.5) addObstacle('crates', d + rand(8, 12), clamp(-x + rand(-1, 1), -4.4, 4.4));
    } else if (r < 0.64) {
      addObstacle('hurdle', d, rand(-4.4, 4.4));
      if (Math.random() < 0.5) addObstacle('hurdle', d, clamp(rand(-4.4, 4.4), -4.4, 4.4));
    } else if (r < 0.8) {
      addObstacle('rock', d, rand(-5, 5));
      addObstacle('rock', d + rand(3, 7), rand(-5, 5));
    } else {
      addObstacle('puddle', d, rand(-4.2, 4.2));
      if (Math.random() < 0.6) addObstacle('cone', d + rand(5, 8), rand(-5, 5));
    }
    d += lerp(30, 17, prog) + rand(-3, 5);
  }
  // 重疊清理：避免同一距離的障礙物完全封路
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    for (let j = 0; j < i; j++) {
      const p = obstacles[j];
      if (p.type !== 'cone' && o.type !== 'cone' && Math.abs(p.dist - o.dist) < 1.5 && Math.abs(p.x - o.x) < p.hw + o.hw + 0.2) {
        levelGroup.remove(o.mesh); obstacles.splice(i, 1); break;
      }
    }
  }
  // 食物：單個或一串
  d = 45;
  while (d < TRACK_LEN - 30) {
    const x = rand(-5.2, 5.2);
    if (Math.random() < 0.35) {
      const dx = rand(-0.25, 0.25);
      for (let k = 0; k < 3; k++) addFood(d + k * 3.2, clamp(x + dx * k * 3, -5.4, 5.4));
      d += 6;
    } else addFood(d, x);
    d += rand(13, 22);
  }
  // 彩虹加速板
  for (let pd = 140; pd < TRACK_LEN - 60; pd += rand(120, 170)) {
    const x = rand(-4.5, 4.5);
    if (!freeSpot(pd, x, 1.5)) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.4), padMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.07, -pd);
    levelGroup.add(m);
    pads.push({ dist: pd, x, mesh: m });
  }
}

// ---------------------------------------------------------------- input
const keys = {};
const touchState = { left: false, right: false };
let jumpQueued = false;
addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;
  if ((e.key === ' ' || e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') && !e.repeat) jumpQueued = true;
  if ((e.key === 'Escape' || e.key.toLowerCase() === 'p') && (state === 'race' || state === 'countdown')) togglePause();
  if (e.key === 'Enter' && state === 'menu') startGame();
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'race') togglePause(true); });
function bindHold(id, prop) {
  const el = $(id);
  const on = (e) => { e.preventDefault(); touchState[prop] = true; el.classList.add('on'); };
  const off = (e) => { e.preventDefault(); touchState[prop] = false; el.classList.remove('on'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}
bindHold('tLeft', 'left');
bindHold('tRight', 'right');
$('tJump').addEventListener('pointerdown', (e) => { e.preventDefault(); jumpQueued = true; $('tJump').classList.add('on'); });
$('tJump').addEventListener('pointerup', () => $('tJump').classList.remove('on'));
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
function steerInput() {
  let s = 0;
  if (keys.arrowleft || keys.a || touchState.left) s -= 1;
  if (keys.arrowright || keys.d || touchState.right) s += 1;
  return s;
}

// ---------------------------------------------------------------- game state
let state = 'menu';
let selected = 0;
let player = racers[0];
let raceTime = 0;
let stateTime = 0;
let cdStep = -1;
let shake = 0;
let camBack = 7;
let finishOrder = [];
let lastRank = 1;
let paused = false;
const camLook = new THREE.Vector3();

function resetRace() {
  buildLevel();
  finishOrder = [];
  raceTime = 0;
  racers.forEach((r, i) => {
    Object.assign(r, {
      dist: 0, x: START_X[i], y: 0, vy: 0, vx: 0, speed: 0, boost: 0, stun: 0, slow: 0, invul: 0,
      finished: false, finishTime: 0, land: 0, celebrate: 0, score: 0, foods: 0, combo: 0, hits: 0, jumps: 0,
    });
    r.isPlayer = i === selected;
    r.ai.think = 0;
    r.ai.targetX = r.ai.cruise = START_X[i];
    r.ai.jumpAt = null;
    r.label.material.map = labelTex(r.isPlayer ? '你 YOU' : r.def.name, r.isPlayer ? '#ffb700' : r.def.css);
    r.label.scale.set(r.isPlayer ? 2.6 : 2.0, r.isPlayer ? 0.98 : 0.75, 1);
  });
  player = racers[selected];
  const others = racers.filter((r) => !r.isPlayer);
  others[0].ai.skill = 0.86;
  others[1].ai.skill = 0.74;
  [0, 1, 2].forEach((i) => {
    const h = $('head' + i);
    h.src = CHARS[i].img;
    h.classList.toggle('me', i === selected);
  });
}

function startGame() {
  sound.init();
  resetRace();
  state = 'countdown';
  stateTime = 0;
  cdStep = -1;
  $('menu').classList.add('hidden');
  $('result').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('pauseBtn').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !isTouch);
  sound.setCrowd(0.45);
  sound.stopMusic(0.1);
}
function toMenu() {
  state = 'menu';
  paused = false;
  sound.pause(false);
  $('pause').classList.add('hidden');
  $('result').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  $('pauseBtn').classList.add('hidden');
  $('menu').classList.remove('hidden');
  resetRace();
  sound.setCrowd(0.15);
  if (sound.ctx) sound.startMusic();
}
function togglePause(force) {
  if (state !== 'race' && state !== 'countdown') return;
  paused = force === true ? true : !paused;
  $('pause').classList.toggle('hidden', !paused);
  sound.pause(paused);
}

function banner(text) {
  const b = $('banner');
  b.textContent = text;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
}
const _v = new THREE.Vector3();
function popup(text, cls = '', r = player) {
  _v.set(r.x, r.y + 3.2, -r.dist).project(camera);
  const el = document.createElement('div');
  el.className = 'popup ' + cls;
  el.textContent = text;
  el.style.left = ((_v.x * 0.5 + 0.5) * innerWidth + rand(-20, 20)) + 'px';
  el.style.top = ((-_v.y * 0.5 + 0.5) * innerHeight) + 'px';
  $('popups').appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
function addScore(n) {
  player.score = Math.max(0, player.score + n);
  const s = $('score');
  s.classList.remove('bump');
  void s.offsetWidth;
  s.classList.add('bump');
}
function screenFlash() {
  const f = $('flash');
  f.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
}

// ---------------------------------------------------------------- AI
function obstacleXAt(o, t) {
  if (o.type === 'ball') return clamp(o.baseX + Math.sin(t * o.freq + o.ph) * o.amp, -X_LIMIT + 0.5, X_LIMIT - 0.5);
  return o.x;
}
function laneBlocked(r, x, d0, d1, t) {
  for (const o of obstacles) {
    if (!o.alive || o.puddle) continue;
    if (o.dist < d0 || o.dist > d1) continue;
    const ox = obstacleXAt(o, t + (o.dist - r.dist) / Math.max(10, r.speed));
    if (Math.abs(ox - x) < o.hw + 0.9) return o;
  }
  return null;
}
function aiThink(r) {
  const ai = r.ai;
  const look = 8 + r.speed * 0.9;
  ai.jumpAt = null;
  const threat = laneBlocked(r, r.x, r.dist + 1, r.dist + look, raceTime);
  if (threat) {
    if (Math.random() > ai.skill * 0.97 && Math.random() < 0.5) return; // 一時大意
    if (!threat.tall && Math.random() < 0.45) {
      ai.jumpAt = threat;
      return;
    }
    let best = null;
    let bestCost = 1e9;
    for (let x = -X_LIMIT + 0.6; x <= X_LIMIT - 0.6; x += 0.8) {
      if (laneBlocked(r, x, r.dist + 1, r.dist + look + 6, raceTime)) continue;
      const cost = Math.abs(x - r.x) + Math.random() * 1.5;
      if (cost < bestCost) { bestCost = cost; best = x; }
    }
    if (best !== null) ai.targetX = best;
    else if (!threat.tall) ai.jumpAt = threat;
    return;
  }
  // 找食物
  if (Math.random() < ai.skill) {
    let tgt = null;
    for (const f of foods) {
      if (f.taken || f.dist < r.dist + 4 || f.dist > r.dist + 40) continue;
      if (Math.abs(f.x - r.x) > 6) continue;
      if (laneBlocked(r, f.x, r.dist + 1, f.dist + 1, raceTime)) continue;
      if (!tgt || f.dist < tgt.dist) tgt = f;
    }
    if (tgt) { ai.targetX = tgt.x; return; }
    for (const p of pads) {
      if (p.dist < r.dist + 4 || p.dist > r.dist + 45) continue;
      if (!laneBlocked(r, p.x, r.dist + 1, p.dist + 1, raceTime)) { ai.targetX = p.x; return; }
    }
  }
  if (Math.random() < 0.08) ai.cruise = rand(-4, 4);
  ai.targetX = lerp(ai.targetX, ai.cruise, 0.3);
}

// ---------------------------------------------------------------- racer update
function doJump(r) {
  if (r.y > 0.01 || r.stun > 0.3) return false;
  r.vy = r.def.jump;
  r.jumps++;
  for (let i = 0; i < 8; i++) dust.spawn(r.x + rand(-0.6, 0.6), 0.2, -r.dist + rand(-0.5, 0.5), rand(-2, 2), rand(1, 3), rand(1, 4), 0.6, 0.8, 1.8, 0xfff2e6, 0.7, 2, 2);
  if (r.isPlayer) sound.jump();
  return true;
}
function hitObstacle(r, o) {
  o.hitBy.add(r);
  if (o.puddle) {
    r.slow = 1.1;
    r.combo = 0;
    for (let i = 0; i < 18; i++) dust.spawn(r.x + rand(-0.5, 0.5), 0.3, -r.dist, rand(-4, 4), rand(3, 7), rand(-6, 2), 0.7, 0.5, 0.9, 0x8a5a3a, 0.9, 18, 1);
    if (r.isPlayer) { sound.splash(); popup('泥漿！減速了', 'bad'); addScore(-20); shake = Math.max(shake, 0.2); }
    return;
  }
  r.stun = 0.85;
  r.invul = 1.6;
  r.speed *= 0.35;
  r.boost = 0;
  r.combo = 0;
  r.hits++;
  r.vx = (r.x >= o.x ? 1 : -1) * 9;
  r.flash = 1;
  // 障礙物被撞飛
  o.alive = false;
  o.fly = { vx: (o.x - r.x) * 3 + rand(-3, 3), vy: rand(7, 11), vz: -r.speed * 0.6 - 8, sx: rand(-6, 6), sz: rand(-6, 6), t: 0 };
  for (let i = 0; i < 14; i++) sparkle.spawn(r.x, 1.6, -r.dist - 0.5, rand(-6, 6), rand(2, 8), rand(-6, 2), 0.7, 0.9, 0.3, pick([0xffd23f, 0xffffff, 0xff7a1a]), 1, 10, 1);
  if (r.isPlayer) {
    sound.hit();
    shake = 0.8;
    screenFlash();
    popup(pick(['哎呀！', '撞到了！', '好痛！']), 'bad');
    addScore(-50);
    sound.setCrowd(0.8);
    sound.woo(1);
  }
}
function eatFood(r, f) {
  f.taken = true;
  levelGroup.remove(f.mesh);
  r.boost = Math.min(r.boost + 2.6, 5.5);
  r.speed += 5;
  r.foods++;
  for (let i = 0; i < 20; i++) sparkle.spawn(f.x, 1.2, -f.dist, rand(-5, 5), rand(1, 7), rand(-5, 3), 0.8, 1.2, 0.2, pick([0xffd23f, 0xff8fc5, 0x8fe3ff, 0xffffff]), 1, 4, 1.5);
  if (r.isPlayer) {
    r.combo = Math.min(r.combo + 1, 5);
    const pts = 100 * r.combo;
    addScore(pts);
    sound.eat();
    sound.boost();
    popup(`+${pts} 加速！`, 'good');
    const c = $('combo');
    c.textContent = r.combo > 1 ? `COMBO ×${r.combo}` : '';
    c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
  }
}
function updateRacer(r, dt) {
  const racing = state === 'race' || state === 'finish';
  // --- 速度
  let target = r.def.maxSpeed;
  if (r.boost > 0) { target *= r.def.boostMul; r.boost = Math.max(0, r.boost - dt); }
  if (r.slow > 0) { target *= 0.5; r.slow -= dt; }
  if (r.stun > 0) { target *= 0.2; r.stun -= dt; }
  if (!r.isPlayer && !r.finished && racing) {
    const gap = r.dist - player.dist;
    if (gap > 35) target *= 0.93;
    else if (gap < -35) target *= 1.07;
    target *= 0.985;
  }
  if (r.finished) target = r.dist > TRACK_LEN + 60 ? 0 : r.def.maxSpeed * 0.35;
  if (!racing) target = 0;
  if (r.speed < target) r.speed = Math.min(target, r.speed + r.def.accel * (r.boost > 0 ? 2.2 : 1) * dt);
  else r.speed = Math.max(target, r.speed - 22 * dt);
  r.invul = Math.max(0, r.invul - dt);

  // --- 轉向
  let input = 0;
  if (racing && !r.finished) {
    if (r.isPlayer) input = steerInput();
    else input = clamp((r.ai.targetX - r.x) * 0.7, -1, 1);
  }
  const steer = r.def.steer * (r.y > 0.01 ? 0.75 : 1) * (r.stun > 0 ? 0.3 : 1);
  r.vx = damp(r.vx, input * steer, r.stun > 0 ? 3 : 10, dt);
  r.x += r.vx * dt;
  if (Math.abs(r.x) > X_LIMIT) {
    r.x = Math.sign(r.x) * X_LIMIT;
    r.vx *= -0.4;
  }

  // --- 跳躍
  if (racing && !r.finished) {
    if (r.isPlayer && jumpQueued) { doJump(r); }
    if (!r.isPlayer && r.ai.jumpAt) {
      const o = r.ai.jumpAt;
      const dz = o.dist - r.dist;
      const lead = r.speed * (r.def.jump / GRAVITY) * 0.95;
      if (dz < lead + o.hd && dz > 0) { if (doJump(r)) r.ai.jumpAt = null; }
      if (dz < 0) r.ai.jumpAt = null;
    }
  }
  if (r.y > 0 || r.vy > 0) {
    r.vy -= GRAVITY * dt;
    r.y += r.vy * dt;
    if (r.y <= 0) {
      r.y = 0;
      r.vy = 0;
      r.land = 0.18;
      for (let i = 0; i < 10; i++) dust.spawn(r.x + rand(-0.8, 0.8), 0.15, -r.dist + rand(-0.4, 0.4), rand(-3, 3), rand(0.5, 2), rand(-1, 3), 0.6, 0.8, 2, 0xfff2e6, 0.7, 1, 2);
      if (r.isPlayer) sound.land();
    }
  }
  if (r.celebrate > 0 && r.y === 0 && Math.random() < dt * 3) r.vy = 8;

  r.dist += r.speed * dt;

  // --- 碰撞
  if (racing && !r.finished) {
    for (const o of obstacles) {
      if (!o.alive) continue;
      const dz = o.dist - r.dist;
      if (dz > 3 || dz < -3) continue;
      if (Math.abs(dz) < o.hd + 0.45 && Math.abs(r.x - o.x) < o.hw + 0.55) {
        if (r.y < o.h - 0.1 && !o.hitBy.has(r) && (r.invul <= 0 || o.puddle)) hitObstacle(r, o);
        else if (r.y >= o.h - 0.1 && !o.jumped.has(r) && !o.puddle) {
          o.jumped.add(r);
          if (r.isPlayer) { addScore(50); popup('+50 漂亮跳躍！'); }
        }
      }
    }
    for (const f of foods) {
      if (f.taken) continue;
      if (Math.abs(f.dist - r.dist) < 1.3 && Math.abs(f.x - r.x) < 1.35 && r.y < 2.4) eatFood(r, f);
    }
    for (const p of pads) {
      if (Math.abs(p.dist - r.dist) < 2.3 && Math.abs(p.x - r.x) < 1.4 && r.y < 0.5 && r.boost < 1.6) {
        r.boost = Math.max(r.boost, 1.8);
        r.speed += 6;
        if (r.isPlayer) { sound.pad(); sound.boost(); popup('彩虹加速！', 'good'); addScore(30); }
      }
    }
    if (r.dist >= TRACK_LEN) {
      r.finished = true;
      r.finishTime = raceTime - (r.dist - TRACK_LEN) / Math.max(1, r.speed);
      finishOrder.push(r);
      r.celebrate = 1;
      for (let i = 0; i < 120; i++) confetti.spawn(rand(-8, 8), rand(8, 11), -TRACK_LEN + rand(-2, 2), rand(-4, 4), rand(0, 4), rand(-4, 4), rand(2.5, 4), 0.35, 0.35, pick(PALETTE), 1, 3, 1.4);
      sound.cheer(1);
      if (!r.isPlayer && finishOrder.length === 1) banner(`${r.def.name} 先衝線了！`);
    }
  }

  // --- 動畫（骨架模型）
  const onGround = r.y <= 0.001;
  const sp = r.speed / r.def.maxSpeed;
  r.phase += dt * (r.speed > 0.5 ? 6 + r.speed * 0.42 : 0);
  r.amp = damp(r.amp, r.speed > 0.5 ? clamp(0.3 + sp * 0.85, 0, 1.25) : 0, 8, dt);
  r.flash = r.invul > 0 ? (Math.sin(raceTime * 30) > 0 ? 0.6 : 0) : damp(r.flash, 0, 10, dt);
  r.boostGlow = damp(r.boostGlow, r.boost > 0 ? 1 : 0, 8, dt);
  r.land = Math.max(0, r.land - dt);
  const turn = clamp(r.vx / r.def.steer, -1, 1);
  r.yaw = damp(r.yaw, r.finished ? 0 : -turn * 0.45, 10, dt);
  r.model.pose({ t: U.time.value + r.idx * 1.7, phase: r.phase, amp: r.amp, air: !onGround, vy: r.vy, steer: turn, stun: r.stun, cheer: r.celebrate > 0 && onGround && r.speed < 6 });
  r.model.tint(r.flash, r.boostGlow, U.time.value);
  r.root.position.set(r.x, 0, -r.dist);
  r.root.rotation.y = r.yaw;
  r.pivot.position.y = r.y;
  r.pivot.scale.set(r.land > 0 ? 1.08 : 1, r.land > 0 ? 0.88 : 1, 1);
  const sh = 1 / (1 + r.y * 0.5);
  r.shadow.scale.set(sh, sh, 1);
  r.aura.material.opacity = damp(r.aura.material.opacity, r.boost > 0 ? 0.55 + Math.sin(raceTime * 20) * 0.15 : 0, 8, dt);
  r.aura.position.y = r.y + 1.1;
  r.label.position.y = r.y + 3.0 + Math.sin(raceTime * 4 + r.idx) * 0.08;

  // --- 粒子
  if (onGround && r.speed > 3) {
    r.dustAcc += dt * (r.speed * 0.6);
    while (r.dustAcc > 1) {
      r.dustAcc -= 1;
      dust.spawn(r.x + rand(-0.5, 0.5), 0.15, -r.dist + 0.4, rand(-1, 1), rand(0.3, 1.5), rand(1, 4), 0.5, 0.5, 1.4, 0xf3e6ff, 0.55, 0, 1);
    }
  }
  if (r.boost > 0) {
    for (let i = 0; i < 3; i++) sparkle.spawn(r.x + rand(-0.8, 0.8), r.y + rand(0.4, 2.2), -r.dist + rand(0.5, 1.5), rand(-1, 1), rand(-0.5, 1), rand(4, 9), 0.45, 0.7, 0.1, pick([r.def.color, 0xffd23f, 0xffffff]), 1, 0, 1);
  }
  if (r.stun > 0 && Math.random() < 0.6) {
    const a = raceTime * 10 + Math.random();
    sparkle.spawn(r.x + Math.cos(a) * 0.8, r.y + 3.0, -r.dist + Math.sin(a) * 0.8, 0, 0.5, -r.speed, 0.3, 0.6, 0.3, 0xffe14d, 1, 0, 0);
  }
  if (r.isPlayer && onGround && r.speed > 2) {
    r.stepAcc += dt * (7 + r.speed * 0.42) / Math.PI;
    if (r.stepAcc > 1) { r.stepAcc -= 1; sound.step(); }
  }
}

function separateRacers() {
  for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) {
    const a = racers[i], b = racers[j];
    const dz = Math.abs(a.dist - b.dist), dx = b.x - a.x;
    if (dz < 1.3 && Math.abs(dx) < 1.3 && Math.abs(a.y - b.y) < 1.2) {
      const push = (1.3 - Math.abs(dx)) * 0.5 * (dx >= 0 ? 1 : -1);
      a.x -= push; b.x += push;
      a.vx -= push * 6; b.vx += push * 6;
      if ((a.isPlayer || b.isPlayer) && Math.abs(push) > 0.15) { sound.bump(); shake = Math.max(shake, 0.25); }
    }
  }
}

function updateObstacles(dt) {
  for (const o of obstacles) {
    if (o.type === 'ball' && o.alive) {
      const nx = obstacleXAt(o, raceTime);
      o.mesh.userData.inner.rotation.z -= (nx - o.x) / 1.05;
      o.x = nx;
      o.mesh.position.x = nx;
    }
    if (o.fly) {
      const f = o.fly;
      f.t += dt;
      f.vy -= 25 * dt;
      o.mesh.position.x += f.vx * dt;
      o.mesh.position.y = Math.max(0, o.mesh.position.y + f.vy * dt);
      o.mesh.position.z += f.vz * dt;
      o.mesh.rotation.x += f.sx * dt;
      o.mesh.rotation.z += f.sz * dt;
      if (o.mesh.position.y <= 0 && f.vy < 0) { f.vy *= -0.4; f.vx *= 0.6; f.vz *= 0.6; }
      if (f.t > 2.5) { o.fly = null; o.mesh.visible = false; }
    }
  }
  for (const f of foods) {
    if (f.taken) continue;
    f.inner.rotation.y += dt * 2.5;
    f.mesh.position.y = 1.1 + Math.sin(U.time.value * 3 + f.ph) * 0.2;
  }
  padTex.offset.y = (U.time.value * 1.5) % 1;
}

// ---------------------------------------------------------------- camera & fx
const fxCanvas = $('speedfx');
const fx = fxCanvas.getContext('2d');
function drawSpeedLines(intensity) {
  fx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  if (intensity < 0.03) return;
  const w = fxCanvas.width, h = fxCanvas.height;
  const cx = w * 0.55, cy = h * 0.42;
  const n = Math.floor(10 + intensity * 50);
  fx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = (0.42 + Math.random() * 0.35) * Math.max(w, h) * 0.6;
    const len = (40 + Math.random() * 160) * intensity * (w / 1200 + 0.4);
    fx.strokeStyle = `rgba(255,255,255,${(0.15 + Math.random() * 0.4) * Math.min(1, intensity)})`;
    fx.lineWidth = 1 + Math.random() * 3;
    fx.beginPath();
    fx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    fx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
    fx.stroke();
  }
}

// 鏡頭在跑手後方略偏右
const CHASE = new THREE.Vector3(1.4, 3.3, 0);
function chase() {
  const portrait = camera.aspect < 1;
  return portrait ? { x: 0.8, back: 7.2, look: -0.2, fov: 68 } : { x: 1.3, back: 5.8, look: -0.4, fov: 58 };
}
function updateCamera(dt) {
  const p = player;
  let pos = new THREE.Vector3();
  let look = new THREE.Vector3();
  let fov = 62;
  const pz = -p.dist;
  if (state === 'menu' || state === 'result') {
    const t = U.time.value * 0.25;
    const sel = racers[selected];
    pos.set(Math.sin(t) * 3.5 + sel.x * 0.4, 2.6 + Math.sin(t * 0.7) * 0.5, -9.5);
    look.set(sel.x * 0.5, 1.4, 0);
    fov = 55;
  } else if (state === 'countdown') {
    const k = clamp(stateTime / 3.2, 0, 1);
    const e = k * k * (3 - 2 * k);
    const a = lerp(Math.PI * 0.95, 0, e);
    const rad = lerp(9.5, chase().back, e);
    const c = chase();
    pos.set(p.x + Math.sin(a) * rad + c.x * e, lerp(2.4, CHASE.y, e), pz + Math.cos(a) * rad);
    look.set(lerp(p.x * 0.6, p.x + c.look, e), lerp(1.4, 1.3, e), pz - lerp(0, 14, e));
    fov = lerp(55, c.fov, e);
  } else if (state === 'finish') {
    const k = clamp(stateTime / 1.5, 0, 1);
    const e = k * k * (3 - 2 * k);
    const a = lerp(0, Math.PI * 0.85, e) + stateTime * 0.1;
    const rad = lerp(camBack, 7.5, e);
    pos.set(p.x + Math.sin(a) * rad + chase().x * (1 - e), lerp(CHASE.y, 2.4, e), pz + Math.cos(a) * rad);
    look.set(p.x, 1.5 + p.y * 0.5, pz);
    fov = 58;
  } else {
    const sp = p.speed / p.def.maxSpeed;
    const boosting = p.boost > 0;
    const c = chase();
    camBack = damp(camBack, c.back + (boosting ? 0.7 : 0) + sp * 0.3, boosting ? 3 : 2, dt);
    pos.set(p.x * 0.85 + c.x, CHASE.y + p.y * 0.35 - sp * 0.2, pz + camBack);
    look.set(p.x * 0.9 + c.look, 1.4 + p.y * 0.45, pz - 14);
    fov = c.fov + sp * 5 + (boosting ? 7 : 0);
  }
  if (state === 'race' || state === 'finish' || state === 'countdown') {
    camera.position.x = damp(camera.position.x, pos.x, 6, dt);
    camera.position.y = damp(camera.position.y, pos.y, 6, dt);
    camera.position.z = state === 'race' ? pos.z : damp(camera.position.z, pos.z, 8, dt);
    camLook.lerp(look, 1 - Math.exp(-10 * dt));
    if (state === 'race') camLook.z = look.z;
  } else {
    camera.position.lerp(pos, 1 - Math.exp(-3 * dt));
    camLook.lerp(look, 1 - Math.exp(-4 * dt));
  }
  if (shake > 0) {
    camera.position.x += rand(-1, 1) * shake * 0.35;
    camera.position.y += rand(-1, 1) * shake * 0.3;
    shake = Math.max(0, shake - dt * 2.2);
  }
  camera.lookAt(camLook);
  if (state === 'race') camera.rotateZ(-p.vx * 0.006);
  camera.fov = damp(camera.fov, fov, 4, dt);
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
  far.position.set(camera.position.x * 0.2, 0, camera.position.z);
  U.camZ.value = camera.position.z;
  const px = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  dust.mat.uniforms.uPx.value = sparkle.mat.uniforms.uPx.value = confetti.mat.uniforms.uPx.value = px * 0.5;
}

// ---------------------------------------------------------------- HUD
function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
const ORD = ['st', 'nd', 'rd'];
function currentRank() {
  if (player.finished) return finishOrder.indexOf(player) + 1;
  const ahead = racers.filter((r) => r !== player && (r.finished || r.dist > player.dist)).length;
  return ahead + 1;
}
function updateHUD() {
  $('time').textContent = fmtTime(raceTime);
  $('score').textContent = Math.floor(player.score + player.dist * 0.5);
  const rank = currentRank();
  const rk = $('rank');
  rk.innerHTML = `${rank}<small>${ORD[rank - 1]}</small>`;
  rk.classList.toggle('r1', rank === 1);
  if (rank !== lastRank && state === 'race') {
    rk.classList.remove('pop'); void rk.offsetWidth; rk.classList.add('pop');
    if (rank < lastRank) { popup(rank === 1 ? '領先！' : '超越！', 'good'); sound.cheer(0.6); }
    lastRank = rank;
  }
  const kmh = Math.round(player.speed * 3.3);
  $('speedVal').textContent = kmh;
  $('speedBar').style.width = clamp(player.speed / (player.def.maxSpeed * 1.6), 0, 1) * 100 + '%';
  $('boostBar').style.width = clamp(player.boost / 5.5, 0, 1) * 100 + '%';
  racers.forEach((r) => { $('head' + r.idx).style.left = clamp(r.dist / TRACK_LEN, 0, 1) * 100 + '%'; });
  if (player.combo === 0) $('combo').textContent = '';
}

// ---------------------------------------------------------------- flow
function countdownTick() {
  const step = Math.floor((stateTime - 0.6) / 0.9);
  if (step !== cdStep && stateTime >= 0.6) {
    cdStep = step;
    const cd = $('countdown');
    cd.classList.remove('anim', 'go');
    void cd.offsetWidth;
    if (step < 3) {
      cd.textContent = String(3 - step);
      sound.beep(false);
    } else {
      cd.textContent = 'GO!';
      cd.classList.add('go');
      sound.beep(true);
      sound.cheer(1);
      sound.startMusic();
      state = 'race';
      stateTime = 0;
      lastRank = currentRank();
    }
    cd.classList.add('anim');
  }
}

function finishRace() {
  state = 'finish';
  stateTime = 0;
  const rank = finishOrder.indexOf(player) + 1;
  $('touch').classList.add('hidden');
  $('pauseBtn').classList.add('hidden');
  const bonus = [1000, 500, 200][rank - 1] + Math.max(0, Math.round((70 - player.finishTime) * 20));
  player.score += bonus;
  banner(rank === 1 ? '🏆 第一名衝線！' : `第 ${rank} 名到達終點`);
  sound.setCrowd(1.1);
  sound.cheer(1.2);
  if (rank === 1) for (let i = 0; i < 300; i++) confetti.spawn(player.x + rand(-9, 9), rand(6, 14), -player.dist + rand(-12, 6), rand(-3, 3), rand(-1, 3), rand(-3, 3), rand(3, 5), 0.4, 0.4, pick(PALETTE), 1, 2.5, 1.2);
}
function showResult() {
  state = 'result';
  const rank = finishOrder.indexOf(player) + 1;
  const win = rank === 1;
  // 未完成的電腦跑手：估算時間
  racers.forEach((r) => {
    if (!r.finished) r.finishTime = raceTime + (TRACK_LEN - r.dist) / Math.max(10, r.def.maxSpeed * 0.95);
  });
  const order = [...racers].sort((a, b) => (a.finished && b.finished ? finishOrder.indexOf(a) - finishOrder.indexOf(b) : a.finishTime - b.finishTime));
  const finalScore = Math.floor(player.score + TRACK_LEN * 0.5);
  let best = 0;
  try { best = +localStorage.getItem('petdash-best') || 0; } catch (e) { /* ignore */ }
  const isBest = finalScore > best;
  if (isBest) try { localStorage.setItem('petdash-best', String(finalScore)); } catch (e) { /* ignore */ }
  $('resultImg').src = win ? 'assets/win.jpg' : 'assets/gameover.jpg';
  $('resultTitle').textContent = win ? `🏆 ${player.def.name} 勝出！` : `第 ${rank} 名！${order[0].def.name} 搶先衝線`;
  $('resultStats').innerHTML = `
    <div><small>名次</small><b>${rank} / 3</b></div>
    <div><small>完成時間</small><b>${fmtTime(player.finishTime)}</b></div>
    <div><small>分數</small><b>${finalScore}</b>${isBest ? '<div class="best">新紀錄！</div>' : `<div class="best" style="color:#7a5fb0">最佳 ${Math.max(best, finalScore)}</div>`}</div>
    <div><small>食物 / 撞擊</small><b>${player.foods} / ${player.hits}</b></div>
    <div class="standings">${order.map((r, i) => `<span class="${r.isPlayer ? 'me' : ''}"><img src="${r.def.img}" alt="">${i + 1}. ${r.def.name} ${fmtTime(r.finishTime)}</span>`).join('')}</div>`;
  $('hud').classList.add('hidden');
  $('result').classList.remove('hidden');
  sound.stopMusic(0.6);
  if (win) sound.win(); else sound.lose();
  sound.setCrowd(win ? 0.9 : 0.25);
}

// ---------------------------------------------------------------- menu
function buildMenu() {
  const wrap = $('cards');
  wrap.innerHTML = '';
  CHARS.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'card' + (i === selected ? ' sel' : '');
    el.innerHTML = `<div class="you">你的跑手</div><div class="pic"><img src="${c.img}" alt="${c.name}"></div><h3>${c.name}</h3><div class="tag">${c.tag}</div>` +
      Object.entries(c.stats).map(([k, v]) => `<div class="stat"><b>${k}</b><span class="dots">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= v ? 'on' : ''}"></i>`).join('')}</span></div>`).join('');
    el.addEventListener('click', () => {
      selected = i;
      sound.init();
      if (!sound.musicOn) { sound.startMusic(); sound.setCrowd(0.15); }
      sound.eat();
      [...wrap.children].forEach((k, j) => k.classList.toggle('sel', j === i));
      racers.forEach((r) => (r.isPlayer = r.idx === i));
    });
    wrap.appendChild(el);
  });
}
buildMenu();
$('startBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
$('charBtn').addEventListener('click', toMenu);
$('resumeBtn').addEventListener('click', () => togglePause());
$('quitBtn').addEventListener('click', toMenu);
$('pauseBtn').addEventListener('click', () => togglePause());
$('muteBtn').addEventListener('click', () => {
  sound.init();
  sound.setMuted(!sound.muted);
  $('muteBtn').textContent = sound.muted ? '🔇' : '🔊';
});

// ---------------------------------------------------------------- loop
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  fxCanvas.width = w * dpr;
  fxCanvas.height = h * dpr;
}
addEventListener('resize', resize);
resize();

// 測試用：?ts=4 以四倍速運行
const TIME_SCALE = +new URLSearchParams(location.search).get('ts') || 1;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000) * TIME_SCALE;
  last = now;
  if (paused) { renderer.render(scene, camera); return; }
  U.time.value += dt;
  stateTime += dt;

  if (state === 'countdown') countdownTick();
  if (state === 'race' || state === 'finish') raceTime += state === 'race' ? dt : 0;

  if (state === 'race') {
    for (const r of racers) {
      if (r.isPlayer || r.finished) continue;
      r.ai.think -= dt;
      if (r.ai.think <= 0) { r.ai.think = rand(0.08, 0.2) + (1 - r.ai.skill) * 0.25; aiThink(r); }
    }
  }
  if (state === 'menu' || state === 'result') {
    for (const r of racers) {
      if (r.y > 0 || r.vy > 0) { r.vy -= GRAVITY * dt; r.y = Math.max(0, r.y + r.vy * dt); if (r.y === 0) { r.vy = 0; r.land = 0.18; } }
      r.model.pose({ frozen: true });
      r.model.tint(0, 0, 0);
      r.root.position.set(r.x, 0, -r.dist);
      r.root.rotation.y = 0;
      r.pivot.position.y = r.y;
      r.pivot.scale.set(1, 1, 1);
      r.aura.material.opacity = 0;
      r.label.visible = false;
      r.shadow.scale.setScalar(1 / (1 + r.y * 0.5));
    }
  } else {
    for (const r of racers) { r.label.visible = true; updateRacer(r, dt); }
    separateRacers();
    jumpQueued = false;
    updateObstacles(dt);
    if (state === 'race' && player.finished) finishRace();
    if (state === 'finish' && stateTime > 3.2) showResult();
    // 觀眾熱度
    const near = clamp((player.dist - TRACK_LEN * 0.8) / (TRACK_LEN * 0.2), 0, 1);
    U.excite.value = damp(U.excite.value, state === 'finish' ? 1 : 0.3 + near * 0.6 + (player.boost > 0 ? 0.2 : 0), 2, dt);
    if (state === 'race') sound.setCrowd(0.35 + near * 0.6);
  }
  jumpQueued = false;

  updateCamera(dt);
  dust.update(dt);
  sparkle.update(dt);
  confetti.update(dt);
  far.children.forEach((c) => { if (c.userData.drift) c.position.x += c.userData.drift * dt; });

  if (state === 'race' || state === 'finish') updateHUD();
  const sp = player.speed / player.def.maxSpeed;
  drawSpeedLines(state === 'race' ? (player.boost > 0 ? 1 : Math.max(0, sp - 0.8) * 1.5) : 0);

  renderer.render(scene, camera);
}

resetRace();
camera.position.set(0, 3, -10);
camLook.set(0, 1.4, 0);
window.__petdash = { racers, get state() { return state; }, get time() { return raceTime; } };
requestAnimationFrame(frame);
Promise.all(CHARS.map((c) => new Promise((res) => { const i = new Image(); i.onload = i.onerror = res; i.src = c.img; })))
  .then(() => {
    // 瀏覽器要求先有一次點擊才可播放聲音：點一下即開始音樂和觀眾聲
    const ld = $('loading');
    ld.innerHTML = '<div class="tap">👆 點一下開始</div>';
    ld.classList.add('ready');
    ld.addEventListener('pointerdown', () => {
      sound.init();
      sound.startMusic();
      sound.setCrowd(0.15);
      ld.classList.add('hidden');
    }, { once: true });
  });
