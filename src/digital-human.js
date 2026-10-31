import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as pinyinPro from 'pinyin-pro';
import { createSSEParser } from './stream.mjs';
import { AVATAR_PRESETS } from './avatars.mjs';
import { resolveMorphName, cartoonVowelWeights } from './model-bindings.mjs';
import { anatomicalBodyFrame } from './body-frame.mjs';
import { voiceGender, voicesFor, pickVoice } from './voices.mjs';
import { audioTrack, speechGain, alignPlanToAudio, captionWindow, splitSpeech } from './lip-sync.mjs';

// 单文件版（scripts/build-single.mjs）走 CDN 全局 window.pinyinPro，Vite 版走 npm 包
const PINYIN = window.pinyinPro || pinyinPro;
const COVER = new URLSearchParams(location.search).get('cover') === '1';
if (COVER) document.documentElement.dataset.cover = 'true';

/* ================================================================
   配置区：以后加形象、改性别和声音，只改这里
   ================================================================ */

// 云端使用独立的男女声，音高默认不变。手动音高仅用于声音实验。
const VOICE_PRESETS = {
  female: { pitch: 1, rate: 1, synth: { f0: 215, formant: 1.17 }, zh: { lang: 'zh-CN', cloudVoice: 'ara' }, en: { lang: 'en-US', cloudVoice: 'ara' } },
  male: { pitch: 1, rate: 1, synth: { f0: 118, formant: 1 }, zh: { lang: 'zh-CN', cloudVoice: 'rex' }, en: { lang: 'en-US', cloudVoice: 'rex' } },
};
const AVATARS = AVATAR_PRESETS.map(av => ({ ...av, credit: av.credit || 'Microsoft Rocketbox · MIT',
  voice: { zh: { cloudVoice: av.voiceId }, en: { cloudVoice: av.voiceId } },
  greeting: `[wave]你好，我是${av.name}。[smile]很高兴认识你。[explain]你可以和我对话，观察我的口型、表情、手势和旁边的机器人表情屏联动。`,
}));

// 云端 TTS：你的后端地址。约定见 README（返回音频 + viseme 或字级时间戳）。
const CLOUD_TTS = { endpoint: null };                     // 例：'/api/tts'

// 形态键名字映射（名字不是 ARKit / Oculus viseme 时）。已内置 VRoid 常用名。
const ALIASES = {
  Fcl_EYE_Close_L: 'eyeBlinkLeft', Fcl_EYE_Close_R: 'eyeBlinkRight',
  Fcl_MTH_A: 'viseme_aa', Fcl_MTH_I: 'viseme_I', Fcl_MTH_U: 'viseme_U', Fcl_MTH_E: 'viseme_E', Fcl_MTH_O: 'viseme_O',
};

/* ================================================================ */

const ARKIT = [
  'browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight',
  'cheekPuff','cheekSquintLeft','cheekSquintRight',
  'eyeBlinkLeft','eyeBlinkRight','eyeLookDownLeft','eyeLookDownRight','eyeLookInLeft','eyeLookInRight',
  'eyeLookOutLeft','eyeLookOutRight','eyeLookUpLeft','eyeLookUpRight','eyeSquintLeft','eyeSquintRight',
  'eyeWideLeft','eyeWideRight','jawForward','jawLeft','jawOpen','jawRight',
  'mouthClose','mouthDimpleLeft','mouthDimpleRight','mouthFrownLeft','mouthFrownRight','mouthFunnel',
  'mouthLeft','mouthLowerDownLeft','mouthLowerDownRight','mouthPressLeft','mouthPressRight','mouthPucker',
  'mouthRight','mouthRollLower','mouthRollUpper','mouthShrugLower','mouthShrugUpper','mouthSmileLeft',
  'mouthSmileRight','mouthStretchLeft','mouthStretchRight','mouthUpperUpLeft','mouthUpperUpRight',
  'noseSneerLeft','noseSneerRight','tongueOut'
];
const VISEMES = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'];
const SLOTS = [...ARKIT, ...VISEMES.map(v => 'viseme_' + v)];
const NS = SLOTS.length;
const SLOT = Object.fromEntries(SLOTS.map((n, i) => [n, i]));
const VIS = Object.fromEntries(VISEMES.map((v, i) => [v, i]));

// 模型没有 viseme 形态键时，用 ARKit 组合出口型
const VISEME_ARKIT = {
  sil: {},
  PP: { mouthPressLeft: .5, mouthPressRight: .5, mouthRollLower: .3, mouthRollUpper: .2, mouthClose: .1 },
  FF: { mouthRollLower: .6, mouthUpperUpLeft: .25, mouthUpperUpRight: .25, jawOpen: .06 },
  TH: { jawOpen: .12, tongueOut: .35, mouthLowerDownLeft: .15, mouthLowerDownRight: .15 },
  DD: { jawOpen: .2, mouthStretchLeft: .15, mouthStretchRight: .15, mouthLowerDownLeft: .15, mouthLowerDownRight: .15 },
  kk: { jawOpen: .25, mouthStretchLeft: .12, mouthStretchRight: .12 },
  CH: { jawOpen: .12, mouthFunnel: .45, mouthPucker: .2, mouthUpperUpLeft: .15, mouthUpperUpRight: .15 },
  SS: { jawOpen: .06, mouthStretchLeft: .35, mouthStretchRight: .35, mouthSmileLeft: .1, mouthSmileRight: .1 },
  nn: { jawOpen: .12, mouthStretchLeft: .1, mouthStretchRight: .1 },
  RR: { jawOpen: .14, mouthFunnel: .3, mouthPucker: .15 },
  aa: { jawOpen: .6, mouthLowerDownLeft: .3, mouthLowerDownRight: .3, mouthUpperUpLeft: .12, mouthUpperUpRight: .12 },
  E: { jawOpen: .35, mouthStretchLeft: .35, mouthStretchRight: .35, mouthSmileLeft: .12, mouthSmileRight: .12 },
  I: { jawOpen: .2, mouthStretchLeft: .45, mouthStretchRight: .45, mouthSmileLeft: .22, mouthSmileRight: .22 },
  O: { jawOpen: .4, mouthFunnel: .55, mouthPucker: .2 },
  U: { jawOpen: .18, mouthPucker: .7, mouthFunnel: .35 },
};
const OPENNESS = { sil: 0, PP: 0, FF: .1, TH: .2, DD: .3, kk: .35, CH: .25, SS: .1, nn: .2, RR: .3, aa: 1, E: .7, I: .45, O: .75, U: .4 };

// Azure TTS 的 22 个 viseme ID → Oculus 15
const AZURE_VISEME = ['sil','aa','aa','O','E','RR','I','U','O','aa','O','aa','kk','RR','nn','SS','CH','TH','FF','DD','kk','PP'];

const EXPRESSIONS = {
  neutral: {},
  smile: { mouthSmileLeft: .7, mouthSmileRight: .7, cheekSquintLeft: .45, cheekSquintRight: .45, eyeSquintLeft: .25, eyeSquintRight: .25, mouthDimpleLeft: .2, mouthDimpleRight: .2 },
  surprise: { browInnerUp: .85, browOuterUpLeft: .75, browOuterUpRight: .75, eyeWideLeft: .6, eyeWideRight: .6, jawOpen: .14 },
  frown: { browDownLeft: .7, browDownRight: .7, mouthFrownLeft: .5, mouthFrownRight: .5, mouthPressLeft: .3, mouthPressRight: .3, noseSneerLeft: .25, noseSneerRight: .25 },
  doubt: { browDownLeft: .45, browOuterUpRight: .65, browInnerUp: .15, mouthLeft: .25, mouthPressLeft: .25, eyeSquintLeft: .3 },
};

/* ---------------- 小工具 ---------------- */
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = v => clamp(v, 0, 1);
const rand = (a, b) => a + Math.random() * (b - a);
const ease = t => t * t * (3 - 2 * t);
const smooth = (e0, e1, x) => ease(clamp01((x - e0) / (e1 - e0)));
const follow = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
const $ = id => document.getElementById(id);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const noise = (t, a, b, c) => Math.sin(t * a) * 0.6 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 0.5) * 0.1;
const voiceOf = av => {
  const base = VOICE_PRESETS[av.gender] || VOICE_PRESETS.female, o = av.voice || {};
  return { ...base, ...o, zh: { ...base.zh, ...(o.zh || {}) }, en: { ...base.en, ...(o.en || {}) } };
};

function canon(name) {
  let s = ALIASES[name] || resolveMorphName(name);
  const dot = s.lastIndexOf('.');
  if (dot >= 0 && s.length - dot - 1 > 2) s = s.slice(dot + 1);
  s = s.replace(/[\s._-]+(l|left)$/i, 'Left').replace(/[\s._-]+(r|right)$/i, 'Right');
  return s.replace(/[\s._-]/g, '').toLowerCase();
}
const SLOT_BY_CANON = new Map(SLOTS.map((n, i) => [canon(n), i]));

// 骨骼名统一成 Mixamo 命名：支持 mixamorig: 前缀、VRoid(J_Bip_*)、Character Creator(CC_Base_*)
const CENTER = { J_Bip_C_Hips: 'Hips', J_Bip_C_Spine: 'Spine', J_Bip_C_Chest: 'Spine1', J_Bip_C_UpperChest: 'Spine2',
  J_Bip_C_Neck: 'Neck', J_Bip_C_Head: 'Head', J_Adj_L_FaceEye: 'LeftEye', J_Adj_R_FaceEye: 'RightEye',
  CC_Base_Hip: 'Hips', CC_Base_Waist: 'Spine', CC_Base_Spine01: 'Spine1', CC_Base_Spine02: 'Spine2',
  CC_Base_NeckTwist01: 'Neck', CC_Base_Head: 'Head' };
const LIMB = { Shoulder: 'Shoulder', Clavicle: 'Shoulder', UpperArm: 'Arm', Upperarm: 'Arm', LowerArm: 'ForeArm', Forearm: 'ForeArm',
  Hand: 'Hand', UpperLeg: 'UpLeg', Thigh: 'UpLeg', LowerLeg: 'Leg', Calf: 'Leg', Foot: 'Foot', ToeBase: 'ToeBase', Eye: 'Eye' };
const FINGER = { Thumb: 'Thumb', Index: 'Index', Middle: 'Middle', Mid: 'Middle', Ring: 'Ring', Little: 'Pinky', Pinky: 'Pinky' };
function boneCanon(name) {
  const n = name.replace(/^mixamorig\d*[:_]?/i, '').replace(/^Armature[|:_]/, '');
  if (CENTER[n]) return CENTER[n];
  const m = n.match(/^(?:J_Bip|CC_Base)_([LR])_([A-Za-z]+?)(\d?)$/);
  if (m) {
    const side = m[1] === 'L' ? 'Left' : 'Right';
    if (FINGER[m[2]] && m[3]) return side + 'Hand' + FINGER[m[2]] + m[3];
    if (LIMB[m[2]]) return m[2] === 'Eye' ? side + 'Eye' : side + LIMB[m[2]];
  }
  return n;
}

/* ---------------- 渲染 ---------------- */
const canvas = $('c'), stageEl = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;
const key = new THREE.DirectionalLight(0xfff8f2, 1.65); key.position.set(-1.8, 3.2, 3.4); scene.add(key);
const fill = new THREE.DirectionalLight(0xf4f7ff, 1.1); fill.position.set(2.4, 2, 4); scene.add(fill);
const rim = new THREE.DirectionalLight(0xcfe2ff, 1.6); rim.position.set(2.6, 2.2, -2.8); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x78808b, 0.65));

// 脚下的柔和阴影
{
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.38)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.12)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.002; scene.add(shadow);
}

const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 100);
const cam = { mode: 'half', pos: V3(0, 1, 5), target: V3(0, 0.9, 0), wantPos: V3(0, 1, 5), wantTarget: V3(0, 0.9, 0), snap: true };
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true; orbit.enablePan = false;
orbit.rotateSpeed = 0.65; orbit.zoomSpeed = 0.6;
orbit.minPolarAngle = Math.PI / 3; orbit.maxPolarAngle = Math.PI * 0.58;
orbit.addEventListener('start', () => {
  cam.mode = 'orbit';
  document.querySelectorAll('[data-cam]').forEach(b => b.setAttribute('aria-pressed', 'false'));
});

function resize() {
  const r = stageEl.getBoundingClientRect();
  renderer.setSize(Math.max(1, r.width | 0), Math.max(1, r.height | 0), false);
  camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
  camera.updateProjectionMatrix();
  frameCamera();
}
new ResizeObserver(resize).observe(stageEl);

function frameCamera() {
  if (!rig) return;
  const { H, eyeY } = rig.metrics;
  const narrow = camera.aspect < 0.8;
  const spans = { full: narrow ? [H * 0.68, H * 1.6] : [H * 0.52, H * 1.12], half: narrow ? [H * 0.84, H * 0.69] : [H * 0.8, H * 0.53], close: [eyeY - 0.04, 0.42] };
  if (!spans[cam.mode]) return;
  const [ty, span] = spans[cam.mode];
  const halfTan = Math.tan(camera.fov * DEG / 2);
  const dist = Math.max((span / 2) / halfTan, (span * 0.62 / 2) / (halfTan * camera.aspect));
  cam.wantTarget.set(0, ty, 0);
  cam.wantPos.set(0, ty + span * 0.06, dist);
  orbit.minDistance = dist * 0.65; orbit.maxDistance = dist * 1.45;
  if (cam.snap) { cam.pos.copy(cam.wantPos); cam.target.copy(cam.wantTarget); cam.snap = false; }
}

/* ---------------- 载入 ---------------- */
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.register(parser => { parser.textureLoader = new THREE.TextureLoader(parser.options.manager); return { name: 'img_texture_loader' }; });
(async () => {
  try {
    const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
    loader.setDRACOLoader(new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/libs/draco/gltf/'));
    const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
    loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/libs/basis/').detectSupport(renderer));
  } catch (e) { /* 解码器不可用时忽略 */ }
})();

let rig = null, current = null;
let avatarGeneration = 0;
let avatarLoading = false;
const bufferCache = new Map();

async function getBuffer(av) {
  if (av.buffer) return av.buffer;
  if (bufferCache.has(av.model)) return bufferCache.get(av.model);
  const emb = document.getElementById('embedded:' + av.model);   // 在线预览版把模型内嵌在页面里
  if (emb) {
    const bin = atob(emb.textContent.trim()), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    emb.remove(); bufferCache.set(av.model, u8.buffer);
    return u8.buffer;
  }
  const res = await fetch(av.assetVersion ? `${av.model}?v=${av.assetVersion}` : av.model);
  if (!res.ok) throw new Error(`HTTP ${res.status}：${av.model}`);
  const buf = await res.arrayBuffer();
  bufferCache.set(av.model, buf);
  return buf;
}

async function switchAvatar(id, flip) {
  const av = AVATARS.find(a => a.id === id); if (!av) return;
  const generation = ++avatarGeneration;
  avatarLoading = true;
  setChatEnabled(conv.ok);
  for (const id of ['bSay', 'bLinkDemo']) $(id).disabled = true;
  interrupt(); active.length = 0; mouthPreview = null; tagExpr = null; setState('idle');
  $('loading').hidden = false; $('loading').textContent = `正在载入 ${av.name}…`;
  $('modelNote').textContent = '';
  try {
    const buf = await getBuffer(av);
    const gltf = await new Promise((res, rej) => loader.parse(buf.slice(0), '', res, rej));
    if (generation !== avatarGeneration) { disposeTree(gltf.scene); return; }
    setupAvatar(gltf, av, flip);
    current = av;
    renderAvatarList();
    applyVoiceDefaults();
  } catch (err) {
    if (generation !== avatarGeneration) return;
    console.error(err);
    const msg = String(err && err.message || err);
    $('modelNote').textContent = /draco|meshopt|ktx|basis|decoder/i.test(msg)
      ? '这个模型用了压缩（Draco / Meshopt / KTX2），预览页加载不了解码器。导出时关掉压缩，或在本地版里打开。'
      : `载入失败：${msg}`;
  } finally {
    if (generation === avatarGeneration) {
      avatarLoading = false; $('loading').hidden = true;
      setChatEnabled(conv.ok);
      for (const id of ['bSay', 'bLinkDemo']) $(id).disabled = !current;
    }
  }
}

function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }
  });
}

/* ---------------- 绑定：骨骼、形态键、眼睛、身体 ---------------- */
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qI = new THREE.Quaternion();
const _v1 = V3(), _v2 = V3(), _v3 = V3();
const _m4 = new THREE.Matrix4();
const wpos = o => o.getWorldPosition(V3());
const wquat = o => o.getWorldQuaternion(new THREE.Quaternion());

function setupAvatar(gltf, av, flipOverride) {
  if (rig) { scene.remove(rig.root); disposeTree(rig.root); }
  const content = gltf.scene;
  const root = new THREE.Group();
  root.add(content); scene.add(root);
  root.updateMatrixWorld(true);

  // 骨骼
  const bones = {};
  let boneCount = 0;
  content.traverse(o => { if (o.isBone) { boneCount++; const c = boneCanon(o.name); if (!bones[c]) bones[c] = o; } });

  // 形态键
  const slots = SLOTS.map(() => []);
  const unknown = new Set();
  content.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    if (o.material) for (const m of [].concat(o.material)) if (m.isMeshStandardMaterial && !m.roughnessMap && m.roughness < 0.45 && !/eye|teeth|tooth|cornea/i.test(m.name)) m.roughness = 0.55;
    if (!o.morphTargetDictionary) return;
    for (const [n, i] of Object.entries(o.morphTargetDictionary)) {
      const idx = SLOT_BY_CANON.get(canon(n));
      if (idx === undefined) { unknown.add(n); continue; }
      slots[idx].push({ infl: o.morphTargetInfluences, i });
    }
  });
  const arkitCount = slots.slice(0, 52).filter(s => s.length).length;
  const visemeCount = slots.slice(52).filter(s => s.length).length;

  // 尺寸、朝向、落地
  const measure = () => { root.updateMatrixWorld(true); return new THREE.Box3().setFromObject(content); };
  let box = measure();
  const eyeL = bones.LeftEye, eyeR = bones.RightEye, head = bones.Head;
  const nativeFacesNegativeZ = eyeL && eyeR && head
    ? (wpos(eyeL).z + wpos(eyeR).z) / 2 < wpos(head).z - 0.005
    : bones.LeftToeBase && bones.LeftFoot ? wpos(bones.LeftToeBase).z < wpos(bones.LeftFoot).z : false;
  const flip = flipOverride === undefined ? nativeFacesNegativeZ : flipOverride;
  if (flip) { root.rotation.y = Math.PI; box = measure(); }
  const hips = bones.Hips ? wpos(bones.Hips) : box.getCenter(V3());
  root.position.set(-hips.x, -box.min.y, -hips.z);
  box = measure();
  const H = box.max.y - box.min.y;

  // 眼睛
  let eyes = null, eyeKind = 'morph';
  if (eyeL && eyeR) { eyeKind = 'bone'; eyes = { L: eyeL, R: eyeR }; }
  const eyeMid = eyes ? wpos(eyes.L).add(wpos(eyes.R)).multiplyScalar(0.5)
                      : (head ? wpos(head).add(V3(0, 0.09, 0.08)) : V3(0, H * 0.93, 0.08));
  const leftIsPlusX = eyes ? wpos(eyes.L).x > wpos(eyes.R).x
                           : (bones.LeftArm && bones.RightArm ? wpos(bones.LeftArm).x > wpos(bones.RightArm).x : true);

  // 静止姿态快照
  const rest = new Map();
  for (const b of Object.values(bones)) rest.set(b, { local: b.quaternion.clone(), world: wquat(b) });

  rig = {
    av, root, content, bones, rest, slots, flip, leftIsPlusX, eyes, eyeKind,
    hasVisemes: visemeCount >= 10,
    vowelMode: visemeCount < 10 && ['aa','I','U','E','O'].every(v => slots[SLOT['viseme_' + v]].length),
    metrics: { H, eyeY: eyeMid.y, eyeMid },
    body: buildBody(bones, rest, root, nativeFacesNegativeZ),
  };

  cam.snap = true; frameCamera();
  describeModel(av, { boneCount, arkitCount, visemeCount, unknown, eyeKind, anims: gltf.animations.length });
  buildEq();
}

function describeModel(av, info) {
  const b = rig.body;
  $('modelName').textContent = av.name;
  $('sub').textContent = `${av.name} · ${av.gender === 'male' ? '男' : '女'} · ${av.credit || '自定义形象'}`;
  const mb = $('mBones');
  mb.textContent = b ? `${info.boneCount} 根，身体动画 ${b.coverage}` : `${info.boneCount} 根，缺少手臂/脊柱骨骼，只驱动头部`;
  mb.className = b && b.full ? 'ok' : 'warn';
  const mm = $('mMorph');
  mm.textContent = rig.vowelMode ? '五元音口型 · 独立眨眼与表情' : `ARKit ${info.arkitCount}/52 · viseme ${info.visemeCount}/15`;
  mm.className = rig.vowelMode || info.arkitCount >= 40 || info.visemeCount >= 10 ? 'ok' : 'warn';
  $('mEyes').textContent = info.eyeKind === 'bone' ? '眼球骨骼 LeftEye / RightEye' : '无眼球骨骼，只用 eyeLook* 形态键';
  $('mEyes').className = info.eyeKind === 'bone' ? 'ok' : 'warn';
  const unk = [...info.unknown];
  $('mExtra').textContent = [info.anims ? `${info.anims} 段动画（未使用）` : '无内置动画',
    unk.length ? `未识别形态键 ${unk.length} 个：${unk.slice(0, 5).join('、')}${unk.length > 5 ? '…' : ''}` : ''].filter(Boolean).join('；');
  $('visMode').textContent = rig.vowelMode ? '卡通五元音 · 音频对时' : rig.hasVisemes ? '标准 viseme · 完整面部' : 'ARKit 组合';
  if (rig.vowelMode) $('modelNote').textContent = '卡通形象使用原生五元音、眨眼与表情形态键；声母口型为近似映射。';
  if (info.arkitCount === 0 && info.visemeCount === 0) $('modelNote').textContent = '这个模型没有可识别的形态键，眨眼和口型不会生效。';
}

/* ---- 身体：用“方向”描述姿势，和骨骼本地轴向无关，Mixamo / VRoid / CC4 通用 ---- */
function buildBody(bones, rest, root, nativeFacesNegativeZ) {
  const need = ['Hips', 'Spine', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'];
  const missing = need.filter(n => !bones[n]);
  if (missing.length > 2 || !bones.LeftArm || !bones.RightArm) return null;
  const rootQ = anatomicalBodyFrame(wquat(root), nativeFacesNegativeZ);
  const bodyToWorld = v => v.clone().applyQuaternion(rootQ);
  const parentRestWorld = b => (rest.get(b.parent)?.world) || wquat(b.parent);
  const localAxis = (b, bodyAxis) => bodyToWorld(bodyAxis).applyQuaternion(parentRestWorld(b).clone().invert()).normalize();

  const spine = ['Spine', 'Spine1', 'Spine2'].map(n => bones[n]).filter(Boolean).map((b, i, arr) => ({
    b, share: 1 / arr.length, ax: localAxis(b, V3(1, 0, 0)), ay: localAxis(b, V3(0, 1, 0)), az: localAxis(b, V3(0, 0, 1)),
  }));
  const chest = bones.Spine2 || bones.Spine1 || bones.Spine;
  const sideSign = side => {
    const p = wpos(bones[side + 'Arm']).sub(wpos(chest)).applyQuaternion(rootQ.clone().invert());
    return Math.sign(p.x) || (side === 'Left' ? 1 : -1);
  };

  const arms = {};
  let fingerCount = 0;
  for (const side of ['Left', 'Right']) {
    const up = bones[side + 'Arm'], fore = bones[side + 'ForeArm'], hand = bones[side + 'Hand'];
    if (!up || !fore || !hand) continue;
    const s = sideSign(side);
    const dirLocal = (b, child) => child.position.clone().normalize();
    const mid = bones[side + 'HandMiddle1'] || bones[side + 'HandIndex1'] || hand.children.find(c => c.isBone);
    const handDirW = mid ? wpos(mid).sub(wpos(hand)).normalize() : wpos(hand).sub(wpos(fore)).normalize();
    // 掌心法线：指节横轴 × 手指方向；静止姿势里掌心大致朝下（T/A pose）
    const idx = bones[side + 'HandIndex1'], pky = bones[side + 'HandPinky1'] || bones[side + 'HandRing1'];
    let palmW;
    if (idx && pky) palmW = V3().crossVectors(handDirW, wpos(idx).sub(wpos(pky)).normalize()).normalize();
    else palmW = V3(0, -1, 0).addScaledVector(handDirW, handDirW.y).normalize();
    const down = V3(0, -1, 0).addScaledVector(handDirW, handDirW.y);
    if (down.length() > 0.3 ? palmW.dot(down) < 0 : false) palmW.negate();
    const handRestInv = rest.get(hand).world.clone().invert();
    const handDirL = handDirW.clone().applyQuaternion(handRestInv);
    const palmL = palmW.clone().applyQuaternion(handRestInv);
    // 上臂“前侧”（屈肘方向）= 身体前方
    const upDirW = wpos(fore).sub(wpos(up)).normalize();
    const fwd = bodyToWorld(V3(0, 0, 1));
    const antW = fwd.clone().addScaledVector(upDirW, -fwd.dot(upDirW)).normalize();
    const upRestInv = rest.get(up).world.clone().invert();

    // 手指：绕“朝掌心弯”的轴转
    const fingers = [];
    for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      for (let k = 1; k <= 3; k++) {
        const b = bones[side + 'Hand' + f + k]; if (!b) continue;
        const nx = bones[side + 'Hand' + f + (k + 1)];
        const seg = nx ? wpos(nx).sub(wpos(b)).normalize() : (b.children[0] ? wpos(b.children[0]).sub(wpos(b)).normalize() : handDirW.clone());
        const axisW = V3().crossVectors(seg, palmW).normalize();
        fingers.push({ b, f, k, axis: axisW.applyQuaternion(parentRestWorld(b).clone().invert()).normalize() });
        fingerCount++;
      }
    }
    arms[side] = {
      s, up, fore, hand, sh: bones[side + 'Shoulder'],
      shAxis: bones[side + 'Shoulder'] ? localAxis(bones[side + 'Shoulder'], V3(0, 0, 1)) : null,
      upDirL: dirLocal(up, fore), foreDirL: dirLocal(fore, hand),
      upAntL: antW.clone().applyQuaternion(upRestInv), handDirL, palmL,
      handFrameL: frameQuat(handDirL, palmL, new THREE.Quaternion()),
      upFrameL: frameQuat(dirLocal(up, fore), antW.clone().applyQuaternion(upRestInv), new THREE.Quaternion()),
      fingers,
    };
  }
  const full = !!(arms.Left && arms.Right && spine.length);
  return { rootQ, spine, chest, arms, full, coverage: `${full ? '完整' : '部分'}${fingerCount ? ` · 手指 ${fingerCount} 节` : ''}` };
}

function frameQuat(dir, up, out) {
  const x = _v1.copy(dir).normalize();
  const y = _v2.copy(up).addScaledVector(x, -up.dot(x));
  if (y.lengthSq() < 1e-6) y.set(0, 1, 0).addScaledVector(x, -x.y);
  y.normalize();
  const z = _v3.crossVectors(x, y);
  _m4.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m4);
}

/* ---------------- 姿势库（身体坐标：+Y 上，+Z 前，x 乘以左右符号 s） ---------------- */
const POSES = {
  rest:    { up: [0.27, -0.96, 0.06], fore: [0.18, -0.98, 0.13], hand: [0.12, -0.99, 0.08], palm: [-1, 0, 0.10], curl: 0.25 },
  explain: { up: [0.3, -0.9, 0.32], fore: [0.42, 0.04, 0.91], hand: [0.55, 0.12, 0.83], palm: [-0.35, 0.94, 0], curl: 0.12 },
  shrug:   { up: [0.3, -0.93, 0.18], fore: [0.52, -0.04, 0.85], hand: [0.6, 0.06, 0.8], palm: [-0.25, 0.97, 0], curl: 0.1 },
  wave:    { up: [0.92, 0.2, 0.32], fore: [0.2, 0.97, 0.16], hand: [0.14, 0.98, 0.12], palm: [0, 0, 1], curl: 0.05 },
  point:   { up: [0.62, -0.3, 0.72], fore: [0.64, 0.02, 0.77], hand: [0.62, 0.04, 0.78], palm: [-0.9, -0.4, 0.05], curl: 'point' },
  beat:    { up: [0.24, -0.95, 0.2], fore: [0.3, -0.3, 0.9], hand: [0.34, -0.14, 0.93], palm: [-0.65, 0.72, 0], curl: 0.2 },
};
const GESTURES = {
  wave:    { dur: 2.6, arms: { R: 'wave' }, face: { mouthSmileLeft: .45, mouthSmileRight: .45, cheekSquintLeft: .2, cheekSquintRight: .2 } },
  explain: { dur: 2.6, arms: { L: 'explain', R: 'explain' }, face: { browInnerUp: .15 } },
  shrug:   { dur: 1.9, arms: { L: 'shrug', R: 'shrug' }, shoulders: 0.2, headRoll: 0.12,
             face: { browInnerUp: .5, browOuterUpLeft: .45, browOuterUpRight: .45, mouthShrugUpper: .4, mouthShrugLower: .35, mouthFrownLeft: .2, mouthFrownRight: .2 } },
  point:   { dur: 2.1, arms: { R: 'point' }, face: { browInnerUp: .1 } },
  bow:     { dur: 2.4, spinePitch: 0.42, headPitch: 0.3 },
  nod:     { dur: 1.1, osc: t => ({ headPitch: Math.sin(t * Math.PI * 2 * 2.2) * 0.13 }) },
  shake:   { dur: 1.3, osc: t => ({ headYaw: Math.sin(t * Math.PI * 2 * 2.4) * 0.18 }) },
};
const active = [];   // 进行中的手势
function gesture(name) {
  const g = GESTURES[name]; if (!g) return;
  for (const a of active) if (a.name === name) a.t0 = -99;   // 同名手势重新开始
  active.push({ name, g, t0: clock });
  // 指向时顺着手指看过去，再看回来
  if (name === 'point' && rig && rig.body && rig.body.arms.Right) {
    const d = V3(0.64 * rig.body.arms.Right.s, 0, 0.77).applyQuaternion(rig.body.rootQ);
    G.wYaw = Math.atan2(d.x, d.z) * 0.85; G.wPitch = -0.04; G.away = clock + 1.3;
  }
}
function gestureWeight(a) {
  const t = clock - a.t0, d = a.g.dur, atk = Math.min(0.4, d * 0.3), rel = Math.min(0.5, d * 0.35);
  if (t < 0 || t > d) return 0;
  return t < atk ? ease(t / atk) : t > d - rel ? ease((d - t) / rel) : 1;
}

/* ---------------- 状态 ---------------- */
const opts = { gaze: !COVER, blink: !COVER, breath: true, sway: !COVER, bpm: 14 };
const pointer = { x: 0, y: 0, inside: false, lastMove: -99 };
let clock = 0;
let userState = 'idle';          // idle / listening / thinking（说话时自动切到 speaking）
let exprName = 'neutral', tagExpr = null;

const blink = { next: rand(1.5, 3.5), t: -1, doubleNext: false, count: 0, value: 0 };
function startBlink() { if (blink.t < 0) { blink.t = 0; blink.count++; } }
function updateBlink(dt) {
  if (opts.blink) { blink.next -= dt; if (blink.next <= 0 && blink.t < 0) startBlink(); }
  if (blink.t >= 0) {
    blink.t += dt;
    const close = 0.075, hold = 0.035, open = 0.15, t = blink.t;
    blink.value = t < close ? ease(t / close) : t < close + hold ? 1 : 1 - ease(clamp01((t - close - hold) / open));
    if (t > close + hold + open) {
      blink.t = -1; blink.value = 0;
      if (!blink.doubleNext && Math.random() < 0.15) { blink.doubleNext = true; blink.next = 0.09; }
      else { blink.doubleNext = false; blink.next = Math.min(9, -Math.log(1 - Math.random()) * 2.6 + 1.2); }
    }
  }
}

const G = { fixYaw: 0, fixPitch: 0, eyeYaw: 0, eyePitch: 0, hYaw: 0, hPitch: 0, vYaw: 0, vPitch: 0, lastSacc: 0, micro: 1, wander: 0, wYaw: 0, wPitch: 0, away: 0 };
const raycaster = new THREE.Raycaster();
function anglesFrom(origin, p) { const d = _v1.copy(p).sub(origin); return [Math.atan2(d.x, Math.max(d.z, 0.05)), Math.atan2(d.y, Math.hypot(d.x, d.z))]; }
function updateGaze(dt) {
  const eye = rig.metrics.eyeMid;
  const camAng = anglesFrom(eye, camera.position);
  const st = speech.active ? 'speaking' : userState;
  let dy, dp;
  const idle = !pointer.inside || clock - pointer.lastMove > 4;
  if (st === 'thinking') { dy = 0.38 + Math.sin(clock * 0.4) * 0.06; dp = 0.2 + Math.sin(clock * 0.3) * 0.03; }
  else if (G.away > clock) { dy = G.wYaw; dp = G.wPitch; }
  else if (!opts.gaze || st === 'listening' || (st === 'speaking' && idle)) { dy = camAng[0]; dp = camAng[1]; }
  else if (!idle) {
    raycaster.setFromCamera({ x: pointer.x, y: pointer.y }, camera);
    const p = _v2.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, camera.position.distanceTo(eye) * 0.62);
    [dy, dp] = anglesFrom(eye, p);
  } else {
    G.wander -= dt;
    if (G.wander <= 0) {
      if (Math.random() < 0.65) { G.wYaw = camAng[0] + rand(-3, 3) * DEG; G.wPitch = camAng[1] + rand(-2, 2) * DEG; G.wander = rand(1.4, 3.8); }
      else { G.wYaw = rand(-30, 30) * DEG; G.wPitch = rand(-14, 8) * DEG; G.wander = rand(0.7, 1.8); }
    }
    dy = G.wYaw; dp = G.wPitch;
  }
  dy = clamp(dy, -65 * DEG, 65 * DEG); dp = clamp(dp, -35 * DEG, 30 * DEG);
  const diff = Math.hypot(dy - G.fixYaw, dp - G.fixPitch);
  if (diff > 6 * DEG) {
    if (clock - G.lastSacc > 0.12) {
      if (diff > 18 * DEG && Math.random() < 0.4) startBlink();
      G.fixYaw = dy + rand(-.4, .4) * DEG; G.fixPitch = dp + rand(-.3, .3) * DEG; G.lastSacc = clock;
    }
  } else { G.fixYaw = follow(G.fixYaw, dy, dt, 0.07); G.fixPitch = follow(G.fixPitch, dp, dt, 0.07); }
  G.micro -= dt;
  if (G.micro <= 0) { G.fixYaw += rand(-.5, .5) * DEG; G.fixPitch += rand(-.4, .4) * DEG; G.micro = rand(0.5, 1.8); }
  G.eyeYaw = follow(G.eyeYaw, G.fixYaw, dt, 0.028);
  G.eyePitch = follow(G.eyePitch, G.fixPitch, dt, 0.028);
  const tY = clamp(G.fixYaw * 0.6, -40 * DEG, 40 * DEG), tP = clamp(G.fixPitch * 0.45, -22 * DEG, 22 * DEG);
  const w = 2 * Math.PI * 1.4, z = 0.8;
  G.vYaw += (w * w * (tY - G.hYaw) - 2 * z * w * G.vYaw) * dt; G.hYaw += G.vYaw * dt;
  G.vPitch += (w * w * (tP - G.hPitch) - 2 * z * w * G.vPitch) * dt; G.hPitch += G.vPitch * dt;
}

const breath = { phase: 0, value: 0, inhale: false };
function updateBreath(dt) {
  breath.phase = (breath.phase + dt * opts.bpm / 60) % 1;
  const p = breath.phase; breath.inhale = p < 0.4;
  breath.value = follow(breath.value, opts.breath ? (p < 0.4 ? ease(p / 0.4) : 1 - ease((p - 0.4) / 0.6)) : 0, dt, 0.15);
}

/* ================================================================
   语音：文本 → 计划（每个字的口型和时间）→ 引擎播放 → 按时钟取口型
   ================================================================ */
const PAUSE = { '，': .2, ',': .2, '、': .16, '：': .2, ':': .2, '；': .3, ';': .3, '。': .38, '.': .3, '！': .38, '!': .3, '？': .4, '?': .3, '…': .4, '\n': .35, ' ': .05, '—': .2, '～': .2, '~': .2 };
const SENT_END = /[。！？!?；;\n…]/;
const INITIAL = { b: 'PP', p: 'PP', m: 'PP', f: 'FF', d: 'DD', t: 'DD', n: 'nn', l: 'nn', g: 'kk', k: 'kk', h: 'kk', j: 'SS', q: 'SS', x: 'SS',
                  zh: 'CH', ch: 'CH', sh: 'CH', r: 'RR', z: 'SS', c: 'SS', s: 'SS', y: 'I', w: 'U' };
const LATIN = { a: 'aa', e: 'E', i: 'I', o: 'O', u: 'U', y: 'I', b: 'PP', p: 'PP', m: 'PP', f: 'FF', v: 'FF', t: 'DD', d: 'DD', n: 'nn', l: 'nn',
                k: 'kk', g: 'kk', c: 'kk', q: 'kk', x: 'kk', h: 'kk', j: 'CH', s: 'SS', z: 'SS', r: 'RR', w: 'U' };
const DIGIT_ZH = '零一二三四五六七八九';
const TAGS = new Set([...Object.keys(GESTURES), ...Object.keys(EXPRESSIONS)]);

function finalVisemes(fin) {
  const out = [];
  let f = fin.replace('ü', 'v');
  if (f === 'er') return ['E', 'RR'];
  if (f.endsWith('ng')) { f = f.slice(0, -2); var tail = 'kk'; } else if (f.endsWith('n')) { f = f.slice(0, -1); var tail = 'nn'; }
  for (const ch of f) { const v = { a: 'aa', o: 'O', e: 'E', i: 'I', u: 'U', v: 'U' }[ch]; if (v && out[out.length - 1] !== v) out.push(v); }
  if (!out.length) out.push('E');
  if (tail) out.push(tail);
  return out;
}

function parseTags(text) {
  const tags = []; let clean = '';
  const re = /\[([a-zA-Z]+)\]/g; let last = 0, m;
  while ((m = re.exec(text))) {
    clean += text.slice(last, m.index); last = re.lastIndex;
    if (TAGS.has(m[1].toLowerCase())) tags.push({ i: clean.length, name: m[1].toLowerCase() });
  }
  clean += text.slice(last);
  return { clean, tags };
}

// 计划：events=[{t,d,v,kind}]，chars=[{t,d}]，sentences=[{text,i0,i1,t0,t1}]，beats=[t]
function buildPlan(clean, rate = 1) {
  const P = PINYIN;
  const events = [], chars = new Array(clean.length), sentences = [], beats = [];
  let t = 0.05, sentStart = 0, sentT0 = t, sinceBeat = 99, clauseStart = true;
  const push = (v, dt, kind) => { events.push({ t, d: dt, v, kind }); t += dt; };
  const items = [];
  // 汉字 → 拼音；其他字符原样
  const zh = P ? P.pinyin(clean.replace(/[0-9]/g, d => DIGIT_ZH[+d]), { type: 'all', toneType: 'none' }) : null;
  if (zh) { let i = 0; for (const it of zh) for (const ch of it.origin) { items.push({ ch: clean[i], i, py: it.isZh ? it : null }); i++; } }
  else for (let i = 0; i < clean.length; i++) items.push({ ch: clean[i], i, py: null });

  const closeSentence = (i1) => {
    if (i1 > sentStart) sentences.push({ text: clean.slice(sentStart, i1), i0: sentStart, i1, t0: sentT0, t1: t });
    sentStart = i1; sentT0 = t;
  };
  for (let k = 0; k < items.length; k++) {
    const { ch, i, py } = items[k];
    const c0 = t;
    if (py || /[一-鿿]/.test(ch)) {
      const tone = py ? py.num : 1;
      const dur = 0.23 * (tone === 3 ? 1.1 : tone === 0 || tone === 5 ? 0.72 : 1);
      const ini = py ? py.initial : '', fin = py ? py.final : 'a';
      const semi = ini === 'y' || ini === 'w';
      const iniDur = ini ? dur * (semi ? 0.14 : 0.3) : 0;
      if (ini && INITIAL[ini]) push(INITIAL[ini], iniDur, 'c');
      const fv = finalVisemes(fin);
      const rem = dur - iniDur;
      const shares = fv.map((v, j) => (v === 'nn' || v === 'kk') && j === fv.length - 1 ? 0.3 : 1);
      const sum = shares.reduce((a, b) => a + b, 0);
      fv.forEach((v, j) => push(v, rem * shares[j] / sum, v === 'nn' || v === 'kk' ? 'n' : 'v'));
      events[events.length - 1].tone = tone;
      if (clauseStart || (sinceBeat > 4 && (tone === 4 || tone === 1) && Math.random() < 0.5)) { beats.push(c0); sinceBeat = 0; }
      sinceBeat++; clauseStart = false;
    } else if (/[a-zA-Z]/.test(ch)) {
      // 拉丁字母：按字母近似
      const lower = ch.toLowerCase(), prev = (clean[i - 1] || '').toLowerCase();
      let v = LATIN[lower] || 'E';
      if (lower === 'h' && /[tsc]/.test(prev)) v = prev === 't' ? 'TH' : 'CH';
      const last = events[events.length - 1];
      if (last && last.v === v && last.kind !== 'pause') { last.d += 0.065; t += 0.065; }
      else push(v, 0.065, /[aeiouy]/.test(lower) ? 'v' : 'c');
      if (clauseStart) { beats.push(c0); clauseStart = false; }
    } else if (PAUSE[ch] !== undefined) {
      push('sil', PAUSE[ch], 'pause');
      if (ch !== ' ') clauseStart = true;
    } else if (!/\s/.test(ch)) {
      push('E', 0.12, 'v');
    }
    chars[i] = { t: c0, d: t - c0 };
    if (SENT_END.test(ch) || i === clean.length - 1) closeSentence(i + 1);
  }
  const scale = 1 / rate;
  for (const e of events) { e.t *= scale; e.d *= scale; }
  for (const c of chars) if (c) { c.t *= scale; c.d *= scale; }
  for (const s of sentences) { s.t0 *= scale; s.t1 *= scale; }
  return { clean, events, chars, sentences, beats: beats.map(b => b * scale), dur: t * scale };
}

/* ---- 共享的音频上下文 ---- */
const audio = { ctx: null, analyser: null, out: null, td: null, fd: null, env: 0, wide: 0, round: 0 };
function ensureCtx() {
  if (!audio.ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    audio.ctx = new C();
    audio.analyser = audio.ctx.createAnalyser(); audio.analyser.fftSize = 2048; audio.analyser.smoothingTimeConstant = 0.2;
    audio.td = new Float32Array(2048); audio.fd = new Float32Array(1024);
    audio.out = audio.ctx.createGain(); audio.out.connect(audio.ctx.destination);
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  return audio.ctx;
}

/* ---- 引擎 1：离线合成音节（按计划发声，口型完全同步；性别=基频+共振峰） ---- */
const FORMANTS = { aa: [800, 1250, 2600], E: [530, 1840, 2480], I: [300, 2250, 2900], O: [520, 880, 2500], U: [330, 760, 2300],
                   RR: [480, 1350, 1700], nn: [260, 1500, 2500], kk: [260, 1100, 2400] };
const NOISE = { SS: [6500, .3], CH: [3400, .28], FF: [4800, .1], TH: [5200, .1], kk: [1800, .12] };
function engineSynth(plan, voice) {
  const ctx = ensureCtx();
  const sx = voice.synth || VOICE_PRESETS.female.synth;
  const f0 = sx.f0 * (voice.pitchMul || 1), fs = sx.formant;
  const bp = (f, q) => { const n = ctx.createBiquadFilter(); n.type = 'bandpass'; n.frequency.value = f; n.Q.value = q; return n; };
  const gn = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f0;
  const vib = ctx.createOscillator(); vib.frequency.value = 5.2; const vg = gn(f0 * 0.012); vib.connect(vg).connect(osc.frequency);
  const tilt = ctx.createBiquadFilter(); tilt.type = 'lowpass'; tilt.frequency.value = 3600 * fs;
  const env = gn(0); osc.connect(tilt).connect(env);
  const F = [bp(700, 7), bp(1200, 11), bp(2600, 14)];
  const sum = ctx.createDynamicsCompressor();
  [1, 0.6, 0.22].forEach((g, i) => env.connect(F[i]).connect(gn(g)).connect(sum));
  const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), ch = nb.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const nz = ctx.createBufferSource(); nz.buffer = nb; nz.loop = true;
  const nf = bp(6000, 0.9), ng = gn(0); nz.connect(nf).connect(ng).connect(sum);
  const out = gn(1.3); sum.connect(out); out.connect(audio.analyser); out.connect(audio.out);
  const T0 = ctx.currentTime + 0.12;
  for (const e of plan.events) {
    const t = T0 + e.t, d = e.d;
    if (e.kind === 'pause' || e.v === 'sil') { env.gain.setTargetAtTime(0, t, 0.025); ng.gain.setTargetAtTime(0, t, 0.02); continue; }
    const fm = FORMANTS[e.v], nzp = NOISE[e.v];
    if (e.kind === 'c' && e.v === 'PP') { env.gain.setTargetAtTime(0, t, 0.01); ng.gain.setTargetAtTime(0, t, 0.01); ng.gain.setTargetAtTime(0.16, t + d * 0.8, 0.004); ng.gain.setTargetAtTime(0, t + d, 0.01); continue; }
    if (e.kind === 'c' && e.v === 'DD') { env.gain.setTargetAtTime(0, t, 0.008); ng.gain.setTargetAtTime(0.18, t + d * 0.75, 0.004); ng.gain.setTargetAtTime(0, t + d, 0.01); continue; }
    if (e.kind === 'c' && nzp) { env.gain.setTargetAtTime(e.v === 'kk' ? 0.05 : 0, t, 0.012); nf.frequency.setValueAtTime(nzp[0], t); ng.gain.setTargetAtTime(nzp[1], t, 0.012); ng.gain.setTargetAtTime(0, t + d * 0.85, 0.01); continue; }
    ng.gain.setTargetAtTime(0, t, 0.015);
    if (fm) { F.forEach((f, i) => f.frequency.setTargetAtTime(fm[i] * fs, t, 0.02)); }
    const amp = e.kind === 'n' || e.v === 'nn' || e.v === 'kk' ? 0.35 : e.v === 'I' || e.v === 'U' ? 0.8 : 1;
    env.gain.setTargetAtTime(amp, t, 0.018);
    if (e.tone !== undefined || e.kind === 'v') {
      // 声调：1 高平 2 升 3 降升 4 降
      const tone = e.tone, base = f0;
      if (tone === 1) osc.frequency.setTargetAtTime(base * 1.18, t, 0.02);
      else if (tone === 2) { osc.frequency.setTargetAtTime(base * 0.95, t, 0.02); osc.frequency.setTargetAtTime(base * 1.22, t + d * 0.4, 0.05); }
      else if (tone === 3) { osc.frequency.setTargetAtTime(base * 0.86, t, 0.03); osc.frequency.setTargetAtTime(base * 0.78, t + d * 0.4, 0.04); }
      else if (tone === 4) { osc.frequency.setTargetAtTime(base * 1.25, t, 0.01); osc.frequency.setTargetAtTime(base * 0.82, t + d * 0.25, 0.05); }
      else if (tone !== undefined) osc.frequency.setTargetAtTime(base * 0.95, t, 0.03);
    }
  }
  env.gain.setTargetAtTime(0, T0 + plan.dur, 0.04);
  osc.start(); vib.start(); nz.start();
  let stopped = false;
  const job = {
    name: '离线合成音节',
    clock: () => ctx.currentTime - T0,
    stop() {
      if (stopped) return; stopped = true;
      const now = ctx.currentTime;
      for (const p of [env.gain, ng.gain, osc.frequency, nf.frequency, ...F.map(f => f.frequency)]) p.cancelScheduledValues(now);
      env.gain.setTargetAtTime(0, now, 0.02); ng.gain.setTargetAtTime(0, now, 0.02);
      setTimeout(() => { try { osc.stop(); vib.stop(); nz.stop(); } catch (e) {} out.disconnect(); }, 250);
    },
  };
  job.done = new Promise(res => { const iv = setInterval(() => { if (stopped || job.clock() > plan.dur + 0.1) { clearInterval(iv); job.stop(); res(); } }, 50); });
  return job;
}

/* ---- 引擎 2：浏览器语音（真实人声；口型按拼音估时，逐句 + 词边界校准） ---- */
let voicesReady = null;
function loadVoices() {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  if (voicesReady) return voicesReady;
  voicesReady = new Promise(res => {
    const got = () => { const v = speechSynthesis.getVoices(); if (v.length) { res(v); return true; } return false; };
    if (got()) return;
    speechSynthesis.addEventListener('voiceschanged', () => got(), { once: true });
    setTimeout(() => res(speechSynthesis.getVoices()), 1500);
  });
  return voicesReady;
}
// 一句话是中文还是英文：有汉字就按中文（中文声音也能读夹杂的英文单词）
function langOf(text) {
  const cjk = (text.match(/[㐀-鿿]/g) || []).length, latin = (text.match(/[a-zA-Z]/g) || []).length;
  return cjk > 0 && cjk * 4 >= latin * 0.5 ? 'zh' : latin ? 'en' : 'zh';
}
let calib = 1.0;     // 实际语速 / 计划语速，每说完一句学习一次
function engineBrowser(plan, langCfg, picked, pitch, rate) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const sents = plan.sentences;
  let cur = -1, wall = null, ended = false, factor = calib, stopped = false;
  let anchorTime = 0, anchorWall = 0;
  let resolveDone; const done = new Promise(r => (resolveDone = r));
  const now = () => performance.now() / 1000;
  const job = {
    name: picked ? picked.name : '浏览器语音',
    clock() {
      if (cur < 0) return -1;
      const s = sents[cur];
      if (ended || wall === null) return ended ? s.t1 : s.t0;
      return Math.min(anchorTime + (now() - anchorWall) / factor, s.t1 - 0.01);
    },
    stop() { if (stopped) return; stopped = true; synth.cancel(); resolveDone(); },
    done,
  };
  sents.forEach((s, k) => {
    const u = new SpeechSynthesisUtterance(s.text);
    u.lang = langCfg.lang; if (picked) u.voice = picked; u.pitch = pitch; u.rate = rate;
    u.onstart = () => { cur = k; wall = now(); ended = false; factor = calib; anchorTime = s.t0; anchorWall = wall; };
    u.onboundary = e => {
      if (cur !== k || wall === null) return;
      const c = plan.chars[s.i0 + e.charIndex]; if (!c) return;
      const planned = c.t - s.t0, actual = now() - wall;
      if (planned > 0.2 && actual > 0.2) factor = clamp(factor * 0.4 + (actual / planned) * 0.6, 0.4, 2.5);
      anchorTime = c.t; anchorWall = now();
    };
    u.onend = () => {
      if (wall !== null) { const r = (now() - wall) / Math.max(0.2, s.t1 - s.t0); calib = clamp(calib * 0.5 + r * 0.5, 0.4, 2.5); }
      cur = k; ended = true;
      if (k === sents.length - 1) { stopped = true; resolveDone(); }
    };
    u.onerror = e => { if (!stopped && e.error !== 'interrupted' && e.error !== 'canceled') { job.error = e.error; stopped = true; resolveDone(); } };
    synth.speak(u);
  });
  // 有些浏览器不触发 onstart：2.5 秒还没开始就判定失败
  setTimeout(() => { if (cur < 0 && !stopped) { job.error = 'no-start'; job.stop(); } }, 2500);
  return job;
}

/* ---- 引擎 3：云端 TTS（本地后端 /api/tts：Azure 返回 viseme + 词时间；OpenAI 只返回音频） ---- */
// 先取回音频（入队时就开始请求，前一句还在说时下一句已经在合成）
async function cloudFetch(clean, voice, lang, avatar) {
  const ctx = ensureCtx();
  const cfg = voice[lang] || voice.zh;
  const res = await fetch(CLOUD_TTS.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: clean, lang, avatarId: avatar.id, gender: avatar.gender }) });
  if (!res.ok) throw new Error(`TTS 接口返回 ${res.status}${res.status === 500 ? '：' + (await res.text()).slice(0, 160) : ''}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  if (j.gender !== avatar.gender) throw new Error('语音性别不匹配，已停止播放');
  const bin = Uint8Array.from(atob(j.audio), c => c.charCodeAt(0));
  const buf = await ctx.decodeAudioData(bin.buffer);
  return { buf, visemes: j.visemes, words: j.words, voiceName: j.voice || cfg.cloudVoice, provider: j.provider };
}
function scalePlan(plan, dur) {
  const k = dur / Math.max(0.05, plan.dur);
  for (const e of plan.events) { e.t *= k; e.d *= k; }
  for (const c of plan.chars) if (c) { c.t *= k; c.d *= k; }
  for (const s of plan.sentences) { s.t0 *= k; s.t1 *= k; }
  plan.beats = plan.beats.map(b => b * k);
  plan.dur = dur;
}
function engineCloud(plan, fetched, rate = 1, pitch = 1) {
  const ctx = ensureCtx();
  const { buf, visemes, words } = fetched;
  const track = audioTrack(buf);
  if (Array.isArray(words) && words.length) retimePlan(plan, words);   // 字幕、标签、节拍按真实时间走
  else if (visemes?.length || !alignPlanToAudio(plan, track)) scalePlan(plan, buf.duration);                                  // 没有时间戳：按音频总长等比缩放
  if (Array.isArray(visemes) && visemes.length) {                      // 有 viseme：口型直接用 TTS 给的
    const vs = visemes.map(x => ({ t: x.t ?? 0, v: typeof x.id === 'number' ? AZURE_VISEME[x.id] || 'sil' : x.v }));
    plan.events = vs.map((x, i) => ({ t: x.t, d: Math.max(0.03, (vs[i + 1] ? vs[i + 1].t : x.t + 0.1) - x.t), v: x.v, kind: 'v' }));
  }
  plan.dur = buf.duration;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const speed = clamp(rate * pitch, 0.5, 2);
  src.playbackRate.value = speed;
  const g = ctx.createGain(); src.connect(g); g.connect(audio.analyser); g.connect(audio.out);
  const T0 = ctx.currentTime + 0.05; src.start(T0);
  let stopped = false, resolveDone; const done = new Promise(r => (resolveDone = r));
  src.onended = () => { stopped = true; resolveDone(); };
  return { name: fetched.voiceName, track, syncLabel: words?.length || visemes?.length ? '语音时间戳' : '音节口型 · 音频对时', clock: () => (ctx.currentTime - T0) * speed, stop() { if (!stopped) { try { src.stop(); } catch (e) {} stopped = true; resolveDone(); } }, done };
}
// 用字/词级时间戳把计划重新对时（每段文字的口型按比例塞进 [start, end]）
function retimePlan(plan, words) {
  let from = 0;
  const lower = plan.clean.toLowerCase();
  for (const w of words) {
    const txt = String(w.text || '').toLowerCase(); if (!txt) continue;
    const i0 = lower.indexOf(txt, from); if (i0 < 0) continue;
    const i1 = i0 + txt.length; from = i1;
    const a = plan.chars[i0], b = plan.chars[i1 - 1]; if (!a || !b) continue;
    const p0 = a.t, p1 = b.t + b.d, k = (w.end - w.start) / Math.max(0.01, p1 - p0);
    for (const e of plan.events) if (e.t >= p0 - 1e-6 && e.t < p1 - 1e-6) { e.t = w.start + (e.t - p0) * k; e.d *= k; }
    for (let i = i0; i < i1; i++) if (plan.chars[i]) { plan.chars[i].t = w.start + (plan.chars[i].t - p0) * k; plan.chars[i].d *= k; }
    plan.beats = plan.beats.map(bt => bt >= p0 - 1e-6 && bt < p1 - 1e-6 ? w.start + (bt - p0) * k : bt);
  }
  plan.events.sort((x, y) => x.t - y.t);
  for (const s of plan.sentences) { const c0 = plan.chars[s.i0], c1 = plan.chars[s.i1 - 1]; if (c0) s.t0 = c0.t; if (c1) s.t1 = c1.t + c1.d; }
}

/* ---- 引擎 4：音频文件（按音量和频谱推口型） ---- */
async function engineFile(file) {
  const ctx = ensureCtx();
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain(); src.connect(g); g.connect(audio.analyser); g.connect(audio.out);
  const T0 = ctx.currentTime + 0.05; src.start(T0);
  let stopped = false, resolveDone; const done = new Promise(r => (resolveDone = r));
  src.onended = () => { stopped = true; resolveDone(); };
  return { name: file.name, analyse: true, clock: () => ctx.currentTime - T0, stop() { if (!stopped) { try { src.stop(); } catch (e) {} stopped = true; resolveDone(); } }, done };
}

/* ---- 说话队列：大模型流式输出时，一句一句 speak() 进来即可 ---- */
const speech = { active: false, queue: [], job: null, plan: null, tags: [], firedTag: 0, beatIdx: 0, sentIdx: -1, engineName: '—', gen: 0 };
const listeners = {};
function emit(ev, data) { (listeners[ev] || []).forEach(f => { try { f(data); } catch (e) { console.error(e); } }); }

function speak(text, opt = {}) {
  if (!current || avatarLoading) return Promise.resolve();
  mouthPreview = null;
  if (!opt.chunk && (opt.engine || $('engine').value) === 'cloud') {
    const chunks = splitSpeech(text);
    if (chunks.length > 1) return Promise.all(chunks.map(chunk => speak(chunk, { ...opt, chunk: true })));
  }
  const { clean, tags } = parseTags(text);
  if (!clean.trim()) { tags.forEach(t => fireTag(t.name)); return Promise.resolve(); }
  const lang = opt.lang || langOf(clean);
  const engine = opt.engine || $('engine').value;
  const item = { text, clean, tags, lang, engine, opt, rate: +$('rate').value, pitch: +$('pitch').value };
  return new Promise(resolve => { item.resolve = resolve; speech.queue.push(item); if (!speech.active) runQueue(); });
}
function fallbackSynth(item, voice, note) {
  if (note) $('sayNote').textContent = note;
  const plan = buildPlan(item.clean, item.rate);
  return { plan, job: engineSynth(plan, { ...voice, pitchMul: item.pitch }) };
}
async function runQueue() {
  const item = speech.queue.shift();
  if (!item) { speech.active = false; syncSayUI(); emit('idle'); return; }
  const gen = speech.gen;
  speech.active = true; speech.engineName = '合成中…'; syncSayUI();
  const av = current, voice = voiceOf(av), langCfg = voice[item.lang] || voice.zh;
  const { clean, tags, rate, pitch, engine } = item;
  let plan = buildPlan(clean, 1), job = null;
  try {
    if (engine === 'cloud' && CLOUD_TTS.endpoint) {
      const fetched = await cloudFetch(clean, voice, item.lang, av);
      if (gen !== speech.gen) { item.resolve(); return; }          // 等待期间被打断
      job = engineCloud(plan, fetched, item.rate, item.pitch);
    } else if (engine === 'browser' && 'speechSynthesis' in window) {
      const all = await loadVoices();
      const pick = pickVoice(all, langCfg, av.gender, $('voiceSel').value);
      if (pick) {
        plan = buildPlan(clean, rate);
        job = engineBrowser(plan, langCfg, pick.v, clamp(pitch, 0.1, 2), rate);
      }
    }
    if (!job) {
      if (engine === 'synth') ({ plan, job } = fallbackSynth(item, voice, '离线合成音节仅用于口型演示，不是真人朗读。'));
      else throw new Error('未找到可用语音');
    }
  } catch (err) {
    if (gen !== speech.gen) { item.resolve(); return; }
    console.error(err);
    const pick = 'speechSynthesis' in window ? pickVoice(await loadVoices(), langCfg, av.gender, $('voiceSel').value) : null;
    if (gen !== speech.gen) { item.resolve(); return; }
    if (pick) {
      plan = buildPlan(clean, rate);
      job = engineBrowser(plan, langCfg, pick.v, pitch, rate);
      $('sayNote').textContent = `云端语音暂不可用，已使用系统${av.gender === 'male' ? '男' : '女'}声按原文朗读。`;
    } else {
      $('sayNote').textContent = `未找到对应${av.gender === 'male' ? '男' : '女'}声，暂不朗读。可重试云端或安装对应的系统语音。`;
      item.resolve(); speech.active = false; runQueue(); return;
    }
  }
  if (gen !== speech.gen) { job?.stop(); item.resolve(); return; }
  const setJob = (j, p) => {
    speech.job = j; speech.plan = p; speech.engineName = j.name; speech.firedTag = 0; speech.beatIdx = 0; speech.sentIdx = -1;
    speech.tags = tags.map(tg => ({ ...tg, t: p.chars[tg.i] ? p.chars[tg.i].t : (p.chars[tg.i - 1] ? p.chars[tg.i - 1].t + p.chars[tg.i - 1].d : 0) }));
  };
  setJob(job, plan);
  emit('speechstart', { text: item.text, lang: item.lang });
  await job.done;
  if (job.error && gen === speech.gen) {
    $('sayNote').textContent = '系统语音没有响应，请重试云端语音或安装可用的系统语音。';
  }
  if (gen !== speech.gen) { item.resolve(); return; }
  speech.job = null; speech.plan = null; $('caption').hidden = true;
  setTimeout(() => { if (!speech.active) tagExpr = null; }, 1200);
  emit('speechend', { text: item.text });
  item.resolve();
  if (gen === speech.gen) runQueue();
}
function stopSpeech() {
  speech.gen++;
  speech.queue.forEach(q => q.resolve()); speech.queue.length = 0;
  if (speech.job) speech.job.stop();
  speech.active = false; speech.job = null; speech.plan = null; speech.tags = []; visW.fill(0); talk = 0; lipGain = 0; tagExpr = null;
  $('caption').hidden = true; syncSayUI();
}
async function playAudioFile(file) {
  stopSpeech();
  const gen = speech.gen;
  try {
    const job = await engineFile(file);
    if (gen !== speech.gen) { job.stop(); return; }
    speech.active = true; speech.job = job; speech.plan = null; speech.tags = []; speech.engineName = job.name; syncSayUI();
    await job.done;
  } catch (e) { $('sayNote').textContent = `无法播放 ${file.name}。试试 mp3、wav 或 m4a。`; }
  if (gen === speech.gen) { speech.job = null; speech.active = false; syncSayUI(); }
}

/* ---- 每帧：从计划或音频里取出 15 个 viseme 的权重 ---- */
const visW = new Float32Array(15);
let talk = 0, pulse = 0, beatEnv = 0, beatSide = 1, lipGain = 0;
let mouthPreview = null;
function updateSpeech(dt) {
  visW.fill(0);
  const job = speech.job;
  let tt = -1;
  if (job) tt = job.clock();
  if (job && job.analyse) {
    // 音频分析：电平 → 开口，频谱 → 扁唇/圆唇
    const a = audio.analyser; a.getFloatTimeDomainData(audio.td); a.getFloatFrequencyData(audio.fd);
    let s = 0; for (let i = 0; i < audio.td.length; i++) s += audio.td[i] ** 2;
    const db = 20 * Math.log10(Math.sqrt(s / audio.td.length) + 1e-9);
    const lvl = clamp01((db + 50) / 34);
    const hz = audio.ctx.sampleRate / a.fftSize;
    const band = (lo, hi) => { let e = 0; for (let i = Math.floor(lo / hz); i <= Math.ceil(hi / hz); i++) e += 10 ** (audio.fd[i] / 10); return e; };
    const lo = band(200, 900), mi = band(900, 1600), hi = band(1600, 3200), tot = lo + mi + hi + 1e-12;
    audio.wide = follow(audio.wide, smooth(0.18, 0.45, hi / tot), dt, 0.06);
    audio.round = follow(audio.round, smooth(0.55, 0.85, lo / tot) * (1 - audio.wide), dt, 0.06);
    audio.env = follow(audio.env, lvl, dt, lvl > audio.env ? 0.03 : 0.1);
    const e = audio.env, w = audio.wide, r = audio.round;
    visW[VIS.aa] = e * (1 - w) * (1 - r); visW[VIS.E] = e * w * 0.6; visW[VIS.I] = e * w * 0.4; visW[VIS.O] = e * r * 0.6; visW[VIS.U] = e * r * 0.4;
  } else if (speech.plan && tt >= 0) {
    const ev = speech.plan.events;
    const A = 0.05, R = 0.07;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i]; if (e.t - A > tt) break;
      if (tt > e.t + e.d + R) continue;
      const w = tt < e.t ? ease((tt - (e.t - A)) / A) : tt <= e.t + e.d ? 1 : 1 - ease((tt - e.t - e.d) / R);
      const k = VIS[e.v]; if (k > 0) visW[k] = Math.max(visW[k], w);
    }
    let sum = 0; for (let i = 1; i < 15; i++) sum += visW[i];
    if (sum > 1) for (let i = 1; i < 15; i++) visW[i] /= sum;
    const targetGain = job?.track ? speechGain(job.track, tt) : 1;
    lipGain = follow(lipGain, targetGain, dt, targetGain > lipGain ? .025 : .045);
    for (let i = 1; i < 15; i++) visW[i] *= lipGain;
    // 标签、节拍、字幕
    while (speech.firedTag < speech.tags.length && speech.tags[speech.firedTag].t <= tt) fireTag(speech.tags[speech.firedTag++].name);
    const beats = speech.plan.beats;
    while (speech.beatIdx < beats.length && beats[speech.beatIdx] <= tt) { speech.beatIdx++; pulse = 1; beatEnv = 1; beatSide = Math.random() < 0.65 ? -1 : 1; }
    updateCaption(tt);
  }
  if (!job && mouthPreview && clock < mouthPreview.until) visW[VIS[mouthPreview.v]] = 1;
  let open = 0; for (let i = 0; i < 15; i++) open += visW[i] * OPENNESS[VISEMES[i]];
  talk = follow(talk, clamp01(open * 1.4), dt, 0.08);
  pulse = Math.max(0, pulse - dt / 0.35);
  beatEnv = Math.max(0, beatEnv - dt / 0.7);
}
function fireTag(name) {
  if (GESTURES[name]) gesture(name);
  else if (EXPRESSIONS[name]) tagExpr = name;
  emit('tag', { name });
}
function updateCaption(tt) {
  const p = speech.plan; if (!p) return;
  const caption = captionWindow(p, tt);
  $('caption').hidden = !caption;
  if (!caption) return;
  $('capDone').textContent = caption.done;
  $('capTodo').textContent = caption.todo;
}

/* ================================================================
   每帧：合成形态键 + 驱动骨骼
   ================================================================ */
const W = new Float32Array(NS);
const add = (n, v) => { W[SLOT[n]] += v; };
const exprCur = new Float32Array(52);
const faceExtra = {};

function applyWorld(obj, restWorld, delta) {
  obj.parent.getWorldQuaternion(_q1);
  _q2.multiplyQuaternions(delta, restWorld);
  obj.quaternion.copy(_q1.invert().multiply(_q2));
}
function bodyVec(arr, s) { return V3(arr[0] * s, arr[1], arr[2]); }

const qHead = new THREE.Quaternion(), qEye = new THREE.Quaternion(), qChestD = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
const eul = new THREE.Euler(0, 0, 0, 'YXZ');

function driveBody(dt, headAng, gest) {
  const b = rig.body, R = rig.rest;
  const st = speech.active ? 'speaking' : userState;
  // 脊柱：呼吸、微动、倾听前倾、鞠躬
  const sw = opts.sway ? 1 : 0;
  let pitch = -breath.value * 0.018 + (st === 'listening' ? 0.05 : 0) + gest.spinePitch;
  let yaw = sw * noise(clock, 0.21, 0.47, 0.93) * 0.02 + talk * 0.01 * Math.sin(clock * 1.3);
  let roll = sw * noise(clock, 0.17, 0.41, 0.83) * 0.018 + (st === 'thinking' ? 0.03 : 0);
  for (const s of b.spine) {
    const q = _q3.setFromAxisAngle(s.ay, yaw * s.share);
    q.multiply(qTmp.setFromAxisAngle(s.ax, pitch * s.share)).multiply(qTmp.setFromAxisAngle(s.az, roll * s.share));
    s.b.quaternion.copy(q).multiply(R.get(s.b).local);
  }
  b.chest.getWorldQuaternion(qChestD).multiply(qTmp.copy(R.get(b.chest).world).invert());

  // 手臂
  for (const side of ['Left', 'Right']) {
    const A = b.arms[side]; if (!A) continue;
    const key = side === 'Left' ? 'L' : 'R';
    const s = A.s;
    let pose = { up: bodyVec(POSES.rest.up, s), fore: bodyVec(POSES.rest.fore, s), hand: bodyVec(POSES.rest.hand, s), palm: bodyVec(POSES.rest.palm, s), curl: POSES.rest.curl, point: 0 };
    // 待机时手臂轻微摆动
    pose.fore.x += sw * noise(clock + (s > 0 ? 0 : 7), 0.33, 0.71, 1.21) * 0.03 * s;
    pose.fore.z += breath.value * 0.02;
    let gw = 0;
    for (const a of active) {
      const pk = a.g.arms && a.g.arms[key]; if (!pk) continue;
      const w = gestureWeight(a); if (w <= 0) continue;
      const P = POSES[pk];
      pose.up.lerp(bodyVec(P.up, s), w); pose.fore.lerp(bodyVec(P.fore, s), w); pose.hand.lerp(bodyVec(P.hand, s), w); pose.palm.lerp(bodyVec(P.palm, s), w);
      if (P.curl === 'point') pose.point = Math.max(pose.point, w); else pose.curl += (P.curl - pose.curl) * w;
      if (pk === 'wave') { const o = Math.sin((clock - a.t0) * Math.PI * 2 * 1.7) * w; pose.hand.x += o * 0.45 * s; pose.fore.x += o * 0.08 * s; }
      gw = Math.max(gw, w);
    }
    // 说话节拍手势（主要是一只手）
    if (st === 'speaking' && beatEnv > 0) {
      const side01 = (beatSide > 0) === (key === 'L');
      const bw = ease(Math.sin(Math.min(1, (1 - beatEnv) * 1.6) * Math.PI) ** 1) * (side01 ? 0.75 : 0.3) * (1 - gw);
      const P = POSES.beat;
      pose.up.lerp(bodyVec(P.up, s), bw); pose.fore.lerp(bodyVec(P.fore, s), bw); pose.hand.lerp(bodyVec(P.hand, s), bw); pose.palm.lerp(bodyVec(P.palm, s), bw);
    }
    // 肩膀
    if (A.sh && A.shAxis) {
      const raise = breath.value * 0.025 + gest.shoulders;
      A.sh.quaternion.setFromAxisAngle(A.shAxis, raise * s).multiply(R.get(A.sh).local);
    }
    solveArm(A, pose, R);
    // 手指
    for (const f of A.fingers) {
      let c = pose.curl * (f.f === 'Thumb' ? [0.3, 0.45, 0.35][f.k - 1] : [0.8, 1.0, 0.7][f.k - 1] * { Index: 0.85, Middle: 1, Ring: 1.1, Pinky: 1.2 }[f.f]);
      if (pose.point > 0) { const pc = f.f === 'Index' ? 0 : f.f === 'Thumb' ? 0.25 : 1.35; c += (pc - c) * pose.point; }
      f.b.quaternion.setFromAxisAngle(f.axis, c).multiply(R.get(f.b).local);
    }
  }
}

const _t1 = V3(), _t2 = V3(), _t3 = V3(), _t4 = V3();
const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qC = new THREE.Quaternion(), qD = new THREE.Quaternion();
function toWorld(v, out) { return out.copy(v).applyQuaternion(rig.body.rootQ).applyQuaternion(qChestD).normalize(); }
function solveArm(A, pose, R) {
  const upT = toWorld(pose.up, _t1), foreT = toWorld(pose.fore, _t2), handT = toWorld(pose.hand, _t3), palmT = toWorld(pose.palm, _t4);
  // 上臂：方向 + 让肘部“前侧”朝向前臂弯折方向（肘关节像铰链）
  A.up.parent.getWorldQuaternion(qA);
  const Wk = qB.multiplyQuaternions(qA, R.get(A.up).local);
  const cur = V3().copy(A.upDirL).applyQuaternion(Wk);
  const swing = qC.setFromUnitVectors(cur, upT);
  const Wsw = qD.multiplyQuaternions(swing, Wk);
  const bend = foreT.clone().addScaledVector(upT, -foreT.dot(upT));
  const bw = smooth(0.08, 0.3, bend.length());
  let Wup = Wsw;
  if (bw > 0) {
    const Wfr = frameQuat(upT, bend, new THREE.Quaternion()).multiply(A.upFrameL.clone().invert());
    Wup = Wsw.clone().slerp(Wfr, bw);
  }
  A.up.quaternion.copy(qA.clone().invert().multiply(Wup));
  // 前臂：只转方向
  const Wf0 = new THREE.Quaternion().multiplyQuaternions(Wup, R.get(A.fore).local);
  const fcur = V3().copy(A.foreDirL).applyQuaternion(Wf0);
  let Wf = new THREE.Quaternion().setFromUnitVectors(fcur, foreT).multiply(Wf0);
  // 手：方向 + 掌心朝向；绕前臂的扭转一半分给前臂，避免手腕拧麻花
  const Hd = frameQuat(handT, palmT, new THREE.Quaternion()).multiply(A.handFrameL.clone().invert());
  const Hk = new THREE.Quaternion().multiplyQuaternions(Wf, R.get(A.hand).local);
  const delta = Hd.clone().multiply(Hk.invert());
  const ax = foreT;
  const p = ax.x * delta.x + ax.y * delta.y + ax.z * delta.z;
  const tw = new THREE.Quaternion(ax.x * p, ax.y * p, ax.z * p, delta.w);
  if (tw.lengthSq() > 1e-8) { tw.normalize(); Wf = new THREE.Quaternion().slerp(tw, 0.5).multiply(Wf); }
  A.fore.quaternion.copy(Wup.clone().invert().multiply(Wf));
  A.hand.quaternion.copy(Wf.clone().invert().multiply(Hd));
}

let readoutTimer = 0;
let frames = 0, frozen = false, frozenOffset = 0, lastReal = 0;
function tick(time) {
  frames++;
  const real = time / 1000;
  if (frozen) frozenOffset += real - (lastReal || real);
  lastReal = real;
  const now = real - frozenOffset;
  const dt = Math.min(1 / 30, Math.max(0, now - (clock || now)));
  clock = now;
  // 镜头缓动
  if (cam.mode === 'orbit') {
    orbit.update();
    cam.pos.copy(camera.position); cam.wantPos.copy(camera.position);
    cam.target.copy(orbit.target); cam.wantTarget.copy(orbit.target);
  } else {
    cam.pos.lerp(cam.wantPos, 1 - Math.exp(-dt / 0.35)); cam.target.lerp(cam.wantTarget, 1 - Math.exp(-dt / 0.35));
    camera.position.copy(cam.pos); orbit.target.copy(cam.target); orbit.update();
  }

  if (rig) {
    updateBlink(dt); updateGaze(dt); updateBreath(dt); updateSpeech(dt);
    const st = speech.active ? 'speaking' : userState;

    // 手势叠加量
    const gest = { spinePitch: 0, headPitch: 0, headYaw: 0, headRoll: 0, shoulders: 0 };
    for (const k in faceExtra) faceExtra[k] = 0;
    for (let i = active.length - 1; i >= 0; i--) {
      const a = active[i], w = gestureWeight(a);
      if (clock - a.t0 > a.g.dur) { active.splice(i, 1); continue; }
      if (a.g.spinePitch) gest.spinePitch += a.g.spinePitch * w;
      if (a.g.headPitch) gest.headPitch += a.g.headPitch * w;
      if (a.g.headRoll) gest.headRoll += a.g.headRoll * w;
      if (a.g.shoulders) gest.shoulders += a.g.shoulders * w;
      if (a.g.osc) { const o = a.g.osc(clock - a.t0); for (const k in o) gest[k] += o[k] * w; }
      if (a.g.face) for (const k in a.g.face) faceExtra[k] = Math.max(faceExtra[k] || 0, a.g.face[k] * w);
    }
    // 倾听时偶尔点头
    if (st === 'listening' && Math.random() < dt / 3.2) gesture('nod');

    if (rig.body) driveBody(dt, null, gest);
    else qChestD.identity();

    // 头：跟随视线 + 呼吸 + 微动 + 说话点头 + 手势；大部分跟着胸口走
    const sw = opts.sway ? 1 : 0;
    const yaw = G.hYaw + sw * noise(clock, 0.31, 0.73, 1.37) * (1.3 + talk * 1.4) * DEG + gest.headYaw;
    const pitch = G.hPitch + (breath.value - 0.5) * 1.2 * DEG + sw * noise(clock, 0.23, 0.61, 1.19) * 0.8 * DEG
                  - pulse * 2.5 * DEG + talk * 0.8 * DEG - gest.headPitch;
    const roll = -yaw * 0.12 + sw * noise(clock, 0.19, 0.53, 1.07) * 1.2 * DEG + gest.headRoll + (st === 'thinking' ? 0.07 : st === 'listening' ? 0.04 : 0);
    qHead.setFromEuler(eul.set(-pitch, yaw, roll));
    const B = rig.bones, R = rig.rest;
    const chestFollow = qTmp.copy(_qI).slerp(qChestD, 0.85);
    if (B.Neck) applyWorld(B.Neck, R.get(B.Neck).world, qA.copy(chestFollow).multiply(qB.copy(_qI).slerp(qHead, 0.35)));
    if (B.Head) applyWorld(B.Head, R.get(B.Head).world, qA.copy(chestFollow).multiply(qHead));

    // 眼睛
    const relYaw = clamp(G.eyeYaw - yaw, -30 * DEG, 30 * DEG), relPitch = clamp(G.eyePitch - pitch, -20 * DEG, 20 * DEG);
    if (rig.eyes) {
      qEye.setFromEuler(eul.set(-(pitch + relPitch - 3 * DEG * blink.value), yaw + relYaw, 0));
      qEye.premultiply(qB.copy(_qI).slerp(qChestD, 0.85));
      applyWorld(rig.eyes.L, R.get(rig.eyes.L).world, qEye);
      applyWorld(rig.eyes.R, R.get(rig.eyes.R).world, qEye);
    }

    // 形态键
    W.fill(0);
    const ex = EXPRESSIONS[tagExpr || exprName];
    for (let i = 0; i < 52; i++) { exprCur[i] = follow(exprCur[i], ex[ARKIT[i]] || 0, dt, 0.18); W[i] += exprCur[i]; }
    for (const k in faceExtra) if (faceExtra[k]) add(k, faceExtra[k]);
    if (st === 'listening') { add('browInnerUp', 0.1); add('mouthSmileLeft', 0.08); add('mouthSmileRight', 0.08); }
    if (st === 'thinking') { add('browInnerUp', 0.25); add('browDownRight', 0.15); add('mouthPressLeft', 0.2); add('eyeSquintLeft', 0.12); }
    add('browInnerUp', pulse * 0.35); add('browOuterUpLeft', pulse * 0.2); add('browOuterUpRight', pulse * 0.2);
    add('noseSneerLeft', breath.value * 0.05); add('noseSneerRight', breath.value * 0.05);
    // 口型
    if (rig.hasVisemes) {
      // Keep a smile from closing the lips while a vowel is being spoken. Drive
      // Native visemes already deform the complete face, teeth and tongue together.
      const speakingWeight = visW.reduce((n, v) => n + v, 0);
      for (let i = 0; i < 52; i++) if (/^mouth/.test(ARKIT[i])) W[i] *= 1 - speakingWeight * .65;
      for (let i = 1; i < 15; i++) if (visW[i]) {
        W[52 + i] += visW[i] * .95;
      }
    }
    else if (rig.vowelMode) {
      const speakingWeight = Math.min(1, visW.slice(1).reduce((n,v)=>n+v,0));
      for (let i=0;i<52;i++) if (/^mouth|jawOpen/.test(ARKIT[i])) W[i] *= 1 - speakingWeight * .85;
      const vowels = cartoonVowelWeights(visW);
      for (const [i,name] of ['aa','I','U','E','O'].entries()) W[SLOT['viseme_' + name]] += vowels[i] * .85;
    }
    else for (let i = 1; i < 15; i++) { if (!visW[i]) continue; const m = VISEME_ARKIT[VISEMES[i]]; for (const k in m) W[SLOT[k]] += m[k] * visW[i]; }
    // 眼睑随视线
    const ry = relYaw / (30 * DEG), rp = relPitch / (20 * DEG), toL = rig.leftIsPlusX ? ry : -ry, kk = rig.eyes ? 0.5 : 0.9;
    add('eyeLookOutLeft', Math.max(0, toL) * kk); add('eyeLookInRight', Math.max(0, toL) * kk);
    add('eyeLookInLeft', Math.max(0, -toL) * kk); add('eyeLookOutRight', Math.max(0, -toL) * kk);
    add('eyeLookUpLeft', Math.max(0, rp) * kk * .8); add('eyeLookUpRight', Math.max(0, rp) * kk * .8);
    add('eyeLookDownLeft', Math.max(0, -rp) * kk); add('eyeLookDownRight', Math.max(0, -rp) * kk);
    const lid = Math.max(0, -rp) * 0.2;
    W[SLOT.eyeBlinkLeft] = Math.max(W[SLOT.eyeBlinkLeft], lid + blink.value * (1 - lid));
    W[SLOT.eyeBlinkRight] = Math.max(W[SLOT.eyeBlinkRight], lid + blink.value * (1 - lid));
    for (let i = 0; i < NS; i++) { const l = rig.slots[i]; if (!l.length) continue; const v = clamp01(W[i]); for (const s of l) s.infl[s.i] = v; }
  }
  renderer.render(scene, camera);
  readoutTimer -= dt;
  if (readoutTimer <= 0) { readoutTimer = 0.08; updateReadouts(); }
}

/* ---------------- 读数 ---------------- */
const fmtDeg = r => { const d = Math.round(r / DEG); return (d >= 0 ? '+' : '−') + Math.abs(d) + '°'; };
let eqBars = [];
function buildEq() {
  const el = $('eq'); el.textContent = '';
  eqBars = VISEMES.map((v, i) => {
    const col = document.createElement('div'); col.className = 'col';
    const has = !rig || rig.hasVisemes ? (!rig || rig.slots[52 + i].length > 0) : true;
    const tr = document.createElement('div'); tr.className = 'tr' + (has ? '' : ' off'); const fill = document.createElement('i'); tr.append(fill);
    const lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = v;
    col.append(tr, lb); el.append(col); return fill;
  });
}
const STATE_ZH = { idle: '待机', listening: '倾听', thinking: '思考', speaking: '说话' };
function updateReadouts() {
  const st = speech.active ? 'speaking' : userState;
  $('roState').textContent = STATE_ZH[st];
  let top = 0; for (let i = 1; i < 15; i++) if (visW[i] > visW[top]) top = i;
  $('roVis').textContent = visW[top] > 0.2 ? VISEMES[top] : 'sil';
  $('roGaze').textContent = `${fmtDeg(G.eyeYaw)} / ${fmtDeg(G.eyePitch)}`;
  $('roBlink').textContent = blink.count;
  $('roVoice').textContent = speech.active ? speech.engineName : voiceSummary();
  eqBars.forEach((f, i) => { f.style.height = (clamp01(visW[i]) * 100).toFixed(0) + '%'; });
}

/* ---------------- 界面 ---------------- */
let voiceList = [];
function voiceSummary() {
  if (!current) return '—';
  const e = $('engine').value, v = voiceOf(current), g = current.gender === 'male' ? '男' : '女';
  if (e === 'synth') return `合成音节 · ${g}`;
  if (e === 'cloud') return CLOUD_TTS.endpoint ? `Grok TTS · ${g}声 · ${v.zh.cloudVoice}` : '云端未连接';
  const pz = voiceList.length ? pickVoice(voiceList, v.zh, current.gender, $('voiceSel').value) : null;
  return pz ? pz.v.name : '浏览器语音';
}
function renderAvatarList() {
  const el = $('avatars'); el.textContent = '';
  for (const av of AVATARS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'av'; b.setAttribute('aria-pressed', !!current && current.id === av.id);
    const v = voiceOf(av);
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.append(av.name + ' ', Object.assign(document.createElement('span'), { className: 'pill', textContent: av.gender === 'male' ? '男' : '女' }));
    const meta = document.createElement('span'); meta.className = 'meta'; meta.style.whiteSpace = 'pre-line';
    meta.textContent = `${av.style || '自定义形象'}\n中英文${av.gender === 'male' ? '男' : '女'}声 · 手势联动`;
    b.append(nm, meta);
    b.addEventListener('click', () => { if (!current || current.id !== av.id) switchAvatar(av.id); });
    el.append(b);
  }
  $('avCount').textContent = `${AVATARS.length} 个`;
}
function applyVoiceDefaults() {
  const v = voiceOf(current);
  $('pitch').value = v.pitch; $('pitchOut').textContent = (+v.pitch).toFixed(2);
  $('rate').value = v.rate; $('rateOut').textContent = (+v.rate).toFixed(2);
  if (!$('sayText').dataset.touched) $('sayText').value = current.greeting || '[wave]你好，很高兴见到你。[smile]我可以换成任何形象和声音。';
  fillVoiceSelect();
}
async function fillVoiceSelect() {
  voiceList = await loadVoices();
  const sel = $('voiceSel'), keep = sel.value;
  sel.textContent = '';
  sel.append(new Option('自动（按性别和语言）', ''));
  let n = 0;
  for (const [lang, label] of [['zh', '中文'], ['en', 'English']]) {
    const list = current ? voicesFor(voiceList, voiceOf(current)[lang].lang, current.gender) : [];
    if (!list.length) continue;
    const grp = document.createElement('optgroup'); grp.label = label;
    for (const v of list) { const g = voiceGender(v); grp.append(new Option(`${v.name}${g ? (g === 'male' ? ' · 男' : ' · 女') : ''}`, v.name)); n++; }
    sel.append(grp);
  }
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : '';
  if (!n && $('engine').value === 'browser') $('sayNote').textContent = '系统未提供该人物对应的男声或女声，请使用云端语音。';
  sel.disabled = !n;
}
function syncSayUI() {
  $('bStop').disabled = !speech.active;
  $('sayState').textContent = speech.active ? `正在说（队列 ${speech.queue.length}）` : '空闲';
}

$('sayText').addEventListener('input', () => { $('sayText').dataset.touched = '1'; });
$('bSay').addEventListener('click', () => { const t = $('sayText').value.trim(); if (t) { ensureCtx(); $('sayNote').textContent = ''; mouthPreview = null; speak(t); } });
document.querySelectorAll('[data-mouth]').forEach(button => button.addEventListener('click', () => {
  stopSpeech(); mouthPreview = { v: button.dataset.mouth, until: Infinity };
}));
$('bStop').addEventListener('click', stopSpeech);
$('bAudio').addEventListener('click', () => $('audioInput').click());
$('audioInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) playAudioFile(f); });
$('rate').addEventListener('input', e => { $('rateOut').textContent = (+e.target.value).toFixed(2); });
$('pitch').addEventListener('input', e => { $('pitchOut').textContent = (+e.target.value).toFixed(2); });
$('engine').addEventListener('change', () => { $('sayNote').textContent = ''; });
if (!CLOUD_TTS.endpoint) $('engine').querySelector('option[value="cloud"]').textContent = '云端 TTS（未配置）';
else $('engine').querySelector('option[value="cloud"]').textContent = '云端 TTS';

document.querySelectorAll('[data-state]').forEach(b => b.addEventListener('click', () => setState(b.dataset.state)));
function setState(s) {
  userState = s;
  document.querySelectorAll('[data-state]').forEach(x => x.setAttribute('aria-pressed', x.dataset.state === s));
  emit('state', { state: s });
}
document.querySelectorAll('[data-gesture]').forEach(b => b.addEventListener('click', () => gesture(b.dataset.gesture)));
document.querySelectorAll('[data-expr]').forEach(b => b.addEventListener('click', () => setExpression(b.dataset.expr)));
function setExpression(n) {
  exprName = n; tagExpr = null;
  document.querySelectorAll('[data-expr]').forEach(x => x.setAttribute('aria-pressed', x.dataset.expr === n));
}
for (const [id, k] of [['tGaze', 'gaze'], ['tBlink', 'blink'], ['tBreath', 'breath'], ['tSway', 'sway']]) $(id).addEventListener('change', e => { opts[k] = e.target.checked; });
document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => {
  cam.mode = b.dataset.cam; frameCamera();
  document.querySelectorAll('[data-cam]').forEach(x => x.setAttribute('aria-pressed', x === b));
}));
$('bFlip').addEventListener('click', () => { if (current && rig) switchAvatar(current.id, !rig.flip); });

// 添加形象
function addAvatarFromFile(file) {
  const gender = document.querySelector('input[name="addGender"]:checked').value;
  const name = ($('addName').value.trim() && $('addName').value.trim() !== '我的形象') ? $('addName').value.trim() : file.name.replace(/\.(glb|gltf|vrm)$/i, '');
  file.arrayBuffer().then(buf => {
    const av = { id: 'u' + Date.now(), name, gender, model: file.name, buffer: buf, credit: file.name, voice: {} };
    AVATARS.push(av); renderAvatarList(); switchAvatar(av.id);
  });
}
$('addPick').addEventListener('click', () => $('modelInput').click());
$('modelInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) addAvatarFromFile(f); });

let dragDepth = 0;
document.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; $('dropOverlay').hidden = false; } });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropOverlay').hidden = true; } });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('dropOverlay').hidden = true;
  const f = e.dataTransfer.files[0]; if (!f) return;
  if (/\.(glb|gltf|vrm)$/i.test(f.name)) addAvatarFromFile(f);
  else if ((f.type || '').startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac)$/i.test(f.name)) playAudioFile(f);
});

// 视线跟随鼠标
function setPointer(e) {
  const r = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1; pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  pointer.inside = true; pointer.lastMove = clock;
}
window.addEventListener('pointermove', setPointer);
window.addEventListener('pointerdown', setPointer);
document.documentElement.addEventListener('mouseleave', () => { pointer.inside = false; });
window.addEventListener('blur', () => { pointer.inside = false; });

/* ================================================================
   对话：本地后端 /api/chat（流式）→ 分句 → speak() 排队；按住说话 → /api/asr
   ================================================================ */
const conv = { ok: false, cfg: null, history: [], abort: null, rec: null, recT0: 0, holding: false, micPending: false, recTimer: null, generation: 0 };
const stripTags = t => t.replace(/\[[a-zA-Z]+\]/g, '');

function setChatEnabled(on) {
  for (const id of ['chatInput', 'bSend', 'bTalk', 'bClear']) $(id).disabled = !on || avatarLoading || !current;
}
async function detectBackend() {
  try {
    const r = await fetch('api/config', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const cfg = await r.json();
    if (!cfg || !cfg.ok) throw new Error('bad config');
    conv.ok = true; conv.cfg = cfg;
    CLOUD_TTS.endpoint = 'api/tts';
    $('engine').querySelector('option[value="cloud"]').textContent = `云端 TTS（${cfg.tts.label}）`;
    $('engine').value = 'cloud';
    $('chatState').textContent = cfg.mock ? '模拟模式' : '已连接';
    $('chatInfo').textContent = `大模型 ${cfg.llm.label} · 语音合成 ${cfg.tts.label} · 语音识别 ${cfg.asr.label}`;
    if (cfg.mock) $('chatNote').textContent = `${cfg.mockList.join('、')} 还没填密钥，先用模拟数据跑通流程。在 .env 里填好后重启服务即可。`;
    setChatEnabled(true);
  } catch (e) {
    setChatEnabled(false);
    $('chatInfo').textContent = '对话服务暂时无法连接，请刷新重试。也可以先使用下方的说话、手势和联动示例。';
  }
}
function addMsg(who, text) {
  const p = document.createElement('p'); p.className = 'msg ' + who;
  const b = document.createElement('b'); b.textContent = who === 'me' ? '你' : current.name;
  const t = document.createElement('span'); t.textContent = text;
  p.append(b, t); $('chatLog').append(p); $('chatLog').scrollTop = 1e9;
  return t;
}
function interrupt() {
  conv.generation++;
  stopSpeech();
  if (conv.abort) { conv.abort.abort(); conv.abort = null; }
}
// 把一段文字切成句子（中文标点，或英文句号 + 空格）
function splitSentences(seg) {
  return seg.split(/(?<=[。！？!?；;\n]|[.](?=\s))/).map(x => x.trim()).filter(x => x);
}
async function chat(text) {
  text = text.trim(); if (!text || !conv.ok || avatarLoading || !current) return;
  interrupt(); ensureCtx();
  const generation = conv.generation;
  $('chatNote').textContent = conv.cfg && conv.cfg.mock ? $('chatNote').textContent : '';
  addMsg('me', text); conv.history.push({ role: 'user', content: text });
  setState('thinking');
  const ac = new AbortController(); conv.abort = ac;
  const out = addMsg('ai', '…');
  let full = '', spoken = 0;
  const flush = final => {
    if (generation !== conv.generation) return;
    const rest = full.slice(spoken);
    let cut = -1;
    const m = rest.match(/^[\s\S]*(?:[。！？!?；;\n]|[.](?=\s))/);
    if (m) cut = m[0].length;
    else if (rest.length > 48) { const k = Math.max(rest.lastIndexOf('，'), rest.lastIndexOf(', ')); if (k > 8) cut = k + 1; }
    if (final) cut = rest.length;
    if (cut > 0) { spoken += cut; for (const s of splitSentences(rest.slice(0, cut))) speak(s); }
  };
  try {
    const res = await fetch('api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac.signal,
      body: JSON.stringify({ messages: conv.history.slice(-16), avatarId: current.id }),
    });
    if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `HTTP ${res.status}`); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    const parser = createSSEParser(delta => { if (generation !== conv.generation) return; full += delta; out.textContent = stripTags(full); $('chatLog').scrollTop = 1e9; flush(false); });
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break; parser.push(dec.decode(value, { stream: true })); }
      parser.push(dec.decode()); parser.finish();
    } finally { reader.releaseLock(); }
    flush(true);
  } catch (e) {
    if (generation === conv.generation && e.name !== 'AbortError') { $('chatNote').textContent = `对话失败：${e.message}`; if (!full) out.textContent = '（没有回复）'; }
  } finally { if (conv.abort === ac) conv.abort = null; }
  if (generation !== conv.generation) return;
  if (full) conv.history.push({ role: 'assistant', content: full });
  if (!speech.active && !speech.queue.length && userState === 'thinking') setState('idle');
}
listeners.idle = [() => { if (userState === 'thinking' && !conv.abort && !conv.rec) setState('idle'); }];
listeners.speechstart = [() => { if (userState === 'thinking') setState('idle'); }];

async function startTalk() {
  if (!conv.ok || avatarLoading || !current || conv.rec || conv.micPending) return;
  conv.holding = true; conv.micPending = true;
  interrupt(); ensureCtx();
  $('chatNote').textContent = '';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (!conv.holding) { stream.getTracks().forEach(t => t.stop()); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [], generation = conv.generation;
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      clearTimeout(conv.recTimer);
      const blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
      conv.rec = null;
      if (generation === conv.generation) transcribe(blob, generation);
    };
    rec.start(); conv.rec = rec; conv.recT0 = performance.now();
    conv.recTimer = setTimeout(endTalk, 30000);
    setState('listening');
    $('bTalk').setAttribute('aria-pressed', 'true'); $('bTalk').textContent = '松开发送';
  } catch (e) {
    conv.holding = false; setState('idle');
    $('chatNote').textContent = '无法使用麦克风，请在浏览器的网站权限中允许麦克风，或改用文字对话。';
  } finally { conv.micPending = false; }
}
function endTalk() {
  conv.holding = false;
  if (!conv.rec) return;
  $('bTalk').setAttribute('aria-pressed', 'false'); $('bTalk').textContent = '按住说话';
  if (conv.rec.state === 'recording') conv.rec.stop();
}
async function transcribe(blob, generation) {
  if (performance.now() - conv.recT0 < 400 || blob.size < 1500) { setState('idle'); $('chatNote').textContent = '按住按钮说话，说完再松开。'; return; }
  setState('thinking');
  try {
    const r = await fetch('api/asr', { method: 'POST', headers: { 'content-type': blob.type || 'audio/webm' }, body: blob });
    const j = await r.json();
    if (generation !== conv.generation) return;
    if (j.error) throw new Error(j.error);
    if (j.text && j.text.trim()) chat(j.text);
    else { setState('idle'); $('chatNote').textContent = '没听清，再说一次？'; }
  } catch (e) { if (generation === conv.generation) { setState('idle'); $('chatNote').textContent = `语音识别失败：${e.message}`; } }
}
$('chatForm').addEventListener('submit', e => { e.preventDefault(); const v = $('chatInput').value; $('chatInput').value = ''; chat(v); });
$('bTalk').addEventListener('pointerdown', e => { e.preventDefault(); startTalk(); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('bTalk').addEventListener(ev, endTalk);
$('bTalk').addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startTalk(); } });
$('bTalk').addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); endTalk(); } });
$('bClear').addEventListener('click', () => { interrupt(); endTalk(); conv.history = []; $('chatLog').textContent = ''; setState('idle'); });
window.addEventListener('pagehide', () => { interrupt(); endTalk(); });

/* ---------------- 对外接口：接大模型时用 ----------------
   digitalHuman.setState('listening')        用户说话时
   digitalHuman.setState('thinking')         等大模型时
   digitalHuman.speak('[smile]一句话')        大模型每输出一句就调用一次，会自动排队
   digitalHuman.on('speechend', fn)          一句说完
------------------------------------------------------------ */
window.digitalHuman = {
  speak, stop: stopSpeech, chat, interrupt, setState, gesture, setExpression,
  switchAvatar, addAvatar(cfg) { AVATARS.push(cfg); renderAvatarList(); }, avatars: AVATARS,
  on(ev, fn) { (listeners[ev] ||= []).push(fn); },
  // 给表情屏等外部模块读取的实时信号（只读快照）
  _signals() {
    const st = speech.active ? 'speaking' : userState;
    const idle = !pointer.inside || clock - pointer.lastMove > 4;
    const wandering = st !== 'thinking' && !(G.away > clock) && opts.gaze && st !== 'listening' && !(st === 'speaking' && idle) && idle;
    return { clock, state: st, userState, expr: tagExpr || exprName, speaking: speech.active, visW, visNames: VISEMES,
      gazeYaw: G.eyeYaw, gazePitch: G.eyePitch, present: !wandering,
      tt: speech.job ? speech.job.clock() : -1, tags: speech.tags, dur: speech.plan ? speech.plan.dur : 0 };
  },
  _freeze(on) { frozen = !!on; },
  _cam(px, py, pz, tx, ty, tz) { cam.wantPos.set(px, py, pz); cam.wantTarget.set(tx, ty, tz); cam.pos.copy(cam.wantPos); cam.target.copy(cam.wantTarget); cam.mode = 'custom'; },
  _hold(name, t) { active.length = 0; if (name) { gesture(name); active[0].t0 = clock - t; } frozen = true; },
  _debug: () => ({ clock, frames, active: active.map(a => [a.name, +(clock - a.t0).toFixed(2), +gestureWeight(a).toFixed(2)]),
    rArm: rig && rig.bones.RightArm.quaternion.toArray().map(x => +x.toFixed(3)) }),
};

/* ---------------- 启动 ---------------- */
buildEq();
resize();
renderer.setAnimationLoop(tick);
renderAvatarList();
switchAvatar(AVATARS[0].id);
loadVoices().then(() => { if (current) fillVoiceSelect(); });
detectBackend();
if (!PINYIN || !PINYIN.pinyin) console.warn('pinyin-pro 未加载，中文口型会退化为近似');
