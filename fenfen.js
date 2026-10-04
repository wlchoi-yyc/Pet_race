// 粉粉（立體掃描模型版）：讀取 assets/fenfen.glb，建立蒙皮網格和骨架，由程式驅動動作
// 只用一個網格（約一萬個三角形）、一張 1024 貼圖，比多層殼毛髮輕得多
// 座標：角色面向 -Z，+Y 向上，腳底在 y = 0（與 models.js 其他角色相同）
import * as THREE from './lib/three.module.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SCALE = 3.0; // 模型原高約 0.8，放大到和其他角色一樣（約 2.3）

// ---------------------------------------------------------------- 讀取 GLB（只支援本遊戲用的簡單格式）
const COMP = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

async function loadImage(bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function loadFenfen(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('fenfen.glb ' + res.status);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004e4942) bin = buf.slice(off + 8, off + 8 + len);
    off += 8 + len;
  }
  const view = (i) => {
    const v = json.bufferViews[i];
    return new Uint8Array(bin, v.byteOffset || 0, v.byteLength);
  };
  const accessor = (i) => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView];
    const T = COMP[a.componentType], n = SIZE[a.type];
    return { array: new T(bin, (v.byteOffset || 0) + (a.byteOffset || 0), a.count * n), itemSize: n };
  };
  const prim = json.meshes[0].primitives[0];
  const geo = new THREE.BufferGeometry();
  const attr = (name, key) => { const a = accessor(prim.attributes[key]); geo.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize)); };
  attr('position', 'POSITION');
  attr('normal', 'NORMAL');
  attr('uv', 'TEXCOORD_0');
  attr('skinIndex', 'JOINTS_0');
  attr('skinWeight', 'WEIGHTS_0');
  geo.setIndex(new THREE.BufferAttribute(accessor(prim.indices).array, 1));
  geo.computeBoundingSphere();

  const mat = json.materials[0];
  const tex = async (info, srgb) => {
    if (!info) return null;
    const im = json.images[json.textures[info.index].source];
    const t = new THREE.Texture(await loadImage(view(im.bufferView), im.mimeType));
    t.flipY = false;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  const [map, normalMap] = await Promise.all([tex(mat.pbrMetallicRoughness.baseColorTexture, true), tex(mat.normalTexture, false)]);

  const skin = json.skins[0];
  const ibm = accessor(skin.inverseBindMatrices).array;
  const joints = skin.joints.map((j, k) => ({
    name: json.nodes[j].name,
    pos: json.nodes[j].translation || [0, 0, 0],
    children: (json.nodes[j].children || []).map((c) => skin.joints.indexOf(c)),
    inverse: new THREE.Matrix4().fromArray(ibm, k * 16),
  }));
  return { geo, map, normalMap, joints };
}

// ---------------------------------------------------------------- 建立角色（每次呼叫都有獨立骨架，網格和貼圖共用）
export function buildFenfenRig(data) {
  const bones = data.joints.map((j) => {
    const b = new THREE.Bone();
    b.name = j.name;
    b.position.fromArray(j.pos);
    return b;
  });
  data.joints.forEach((j, i) => j.children.forEach((c) => bones[i].add(bones[c])));
  const skeleton = new THREE.Skeleton(bones, data.joints.map((j) => j.inverse.clone()));
  const material = new THREE.MeshLambertMaterial({ map: data.map, normalMap: data.normalMap });
  if (data.normalMap) material.normalScale.set(0.8, -0.8);
  const mesh = new THREE.SkinnedMesh(data.geo, material);
  mesh.add(bones[0]);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;
  mesh.castShadow = false;

  const B = Object.fromEntries(bones.map((b) => [b.name, b]));
  const group = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(SCALE);
  model.add(mesh);
  group.add(model);
  const rest = Object.fromEntries(bones.map((b) => [b.name, b.position.clone()]));
  return { group, B, rest, mats: [material], body: B.hips, head: B.head, neck: B.neck };
}

// ---------------------------------------------------------------- 動作（輸入和 models.js 的 pose 相同）
// o: { t, phase, amp(0–1.3), air, vy, steer(-1..1), stun, cheer, frozen }
export function fenfenPose(rig, o) {
  const { B, rest } = rig;
  for (const k in B) { B[k].rotation.set(0, 0, 0); B[k].position.copy(rest[k]); }
  if (o.frozen) return;
  const p = o.phase, A = o.amp, t = o.t;
  // 每隻腳：上節（肩／大腿）、中節（肘／小腿）、下節（腕／踝）
  const leg = (s, up, mid, low) => {
    const n = s[0] === 'f' ? ['shoulder', 'elbow', 'wrist'] : ['thigh', 'shin', 'ankle'];
    const side = s[1] === 'l' ? '_L' : '_R';
    B[n[0] + side].rotation.x = up;
    B[n[1] + side].rotation.x = mid;
    B[n[2] + side].rotation.x = low;
  };
  const hips = B.hips, spine = B.spine, chest = B.chest, head = B.head, neck = B.neck;

  if (o.air) {
    // 跳躍：前腳伸前、後腳蹬後
    const k = clamp(o.vy / 10, -1, 1);
    leg('fl', 0.75 + k * 0.15, -0.2, -0.5);
    leg('fr', 0.65 + k * 0.15, -0.15, -0.45);
    leg('hl', -0.6 - k * 0.15, -0.3, 0.6);
    leg('hr', -0.5 - k * 0.15, -0.25, 0.55);
    hips.rotation.x = k * 0.2;
    spine.rotation.x = -0.08;
    head.rotation.x = -k * 0.15;
  } else if (o.cheer) {
    // 歡呼：以後腳站起、前腳揮動
    hips.rotation.x = 0.5 + Math.sin(t * 6) * 0.05;
    hips.position.y += 0.03;
    leg('hl', -0.5, 0.05, 0.1);
    leg('hr', -0.5, 0.05, 0.1);
    leg('fl', 0.3 + Math.sin(t * 14) * 0.5, -0.3, -0.5);
    leg('fr', 0.3 + Math.sin(t * 14 + 2) * 0.5, -0.3, -0.5);
    head.rotation.x = -0.4;
    head.rotation.z = Math.sin(t * 5) * 0.12;
  } else {
    // 奔跑：飛奔步法，前後腳交替；提腳時腕／踝屈曲
    const a = 0.52 * A;
    const front = (ph) => { const lift = Math.max(0, Math.cos(ph)); return [Math.sin(ph) * a, -lift * 0.35 * A, -lift * 1.0 * A]; };
    const hind = (ph) => { const push = Math.max(0, -Math.sin(ph) + 0.2); return [Math.sin(ph) * a, -push * 0.45 * A, push * 0.9 * A]; };
    leg('fl', ...front(p));
    leg('fr', ...front(p + 0.55));
    leg('hl', ...hind(p + Math.PI));
    leg('hr', ...hind(p + Math.PI + 0.55));
    // 背部隨步伐一弓一伸（貓奔跑的特色）
    hips.rotation.x = Math.sin(p - 0.6) * 0.07 * A;
    spine.rotation.x = Math.sin(p + 0.4) * 0.1 * A;
    chest.rotation.x = -Math.sin(p + 0.4) * 0.06 * A;
    hips.position.y += Math.abs(Math.sin(p)) * 0.045 * A;
    head.rotation.x = -(hips.rotation.x + spine.rotation.x) * 0.7 + Math.sin(p * 2 + 0.5) * 0.04 * A;
    if (A < 0.05) {
      // 站着：呼吸、輕輕擺頭
      chest.rotation.x = Math.sin(t * 2.5) * 0.02;
      head.rotation.z = Math.sin(t * 0.9) * 0.08;
      head.rotation.y = Math.sin(t * 0.6 + 1) * 0.12;
      neck.rotation.x = Math.sin(t * 1.3) * 0.04;
    }
  }
  // 轉向：身體側傾、頭望向前進方向
  hips.rotation.z = -o.steer * 0.12;
  head.rotation.y += -o.steer * 0.3;
  if (o.stun > 0) {
    hips.rotation.z += Math.sin(t * 22) * 0.15;
    head.rotation.z = Math.sin(t * 9) * 0.35;
    head.rotation.y += Math.cos(t * 9) * 0.3;
  }
  // 尾巴：隨步伐上下擺，同時左右搖
  const wag = 5.5 * (o.cheer ? 2.2 : 1) * (A > 0.6 ? 1.3 : 1);
  ['tail_1', 'tail_2', 'tail_3', 'tail_4'].forEach((n, i) => {
    B[n].rotation.x = Math.sin(p - i * 0.7) * 0.12 * A - (o.air ? 0.15 : 0);
    B[n].rotation.z = Math.sin(t * wag - i * 0.65) * (0.1 + 0.06 * A + (o.cheer ? 0.15 : 0));
  });
}
