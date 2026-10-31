import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { AVATAR_PRESETS } from './avatars.mjs';
import { resolveMorphName } from './model-bindings.mjs';
import { Matrix4, Quaternion, Vector3 } from 'three';

await MeshoptDecoder.ready;

function readModel(model) {
  const file = readFileSync(new URL(`../public/${model}`, import.meta.url));
  const length = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + length));
  const binary = file.subarray(28 + length);
  const views = new Map();
  const view = index => {
    if (views.has(index)) return views.get(index);
    const v = json.bufferViews[index], c = v.extensions?.EXT_meshopt_compression;
    let data;
    if (c) {
      data = Buffer.alloc(c.count * c.byteStride);
      MeshoptDecoder.decodeGltfBuffer(data, c.count, c.byteStride,
        binary.subarray(c.byteOffset || 0, (c.byteOffset || 0) + c.byteLength), c.mode, c.filter);
    } else data = binary.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    views.set(index, data);
    return data;
  };
  // Our export intentionally uses Float32 morphs. This checks actual
  // deformation data, not just target names (the old asset had empty deltas).
  const values = index => {
    const a = json.accessors[index], v = json.bufferViews[a.bufferView];
    assert.equal(a.componentType, 5126);
    const size = { VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const out = new Float32Array(a.count * size);
    if (v) for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = view(a.bufferView).readFloatLE((a.byteOffset || 0) + i * (v.byteStride || size * 4) + k * 4);
    if (a.sparse) {
      const sparse = a.sparse;
      const bytes = { 5121: 1, 5123: 2, 5125: 4 }[sparse.indices.componentType];
      const read = { 1: 'readUInt8', 2: 'readUInt16LE', 4: 'readUInt32LE' }[bytes];
      for (let i = 0; i < sparse.count; i++) {
        const index = view(sparse.indices.bufferView)[read]((sparse.indices.byteOffset || 0) + i * bytes);
        for (let k = 0; k < size; k++) out[index * size + k] = view(sparse.values.bufferView).readFloatLE((sparse.values.byteOffset || 0) + (i * size + k) * 4);
      }
    }
    return out;
  };
  return { json, values, size: file.length };
}

for (const avatar of AVATAR_PRESETS) test(`${avatar.id} has working mouth/eyelid deformations and a complete humanoid rig`, () => {
  const name = avatar.id;
  const { json, values, size } = readModel(avatar.model);
  if (avatar.gender === 'female') {
    const material = json.materials.findIndex(m=>m.name === 'Blue denim straight-leg jeans');
    assert.ok(material >= 0, 'female has a separate denim garment');
    assert.equal(json.materials[material].alphaMode || 'OPAQUE', 'OPAQUE');
    assert.ok(!json.materials.some(m=>/Bottoms/.test(m.name)), 'original shorts removed');
    const pants = json.meshes.flatMap(m=>m.primitives).find(p=>p.material===material);
    const positions = values(pants.attributes.POSITION);
    const heights = Array.from({length:positions.length/3},(_,i)=>positions[i*3+1]);
    assert.ok(Math.max(...heights)-Math.min(...heights)>.75, 'jeans cover thigh through ankle');
    const coatMaterial=json.materials.findIndex(m=>m.name==='Sand knee-length coat');
    assert.ok(coatMaterial>=0,'female has a separate long coat');
    const coat=json.meshes.flatMap(m=>m.primitives).find(p=>p.material===coatMaterial);
    const coatPositions=values(coat.attributes.POSITION);
    const hem=Math.min(...Array.from({length:coatPositions.length/3},(_,i)=>coatPositions[i*3+1]));
    assert.ok(hem>.4 && hem<.6,'coat hem reaches knee region');
  }
  assert.ok(size < (avatar.maxModelBytes || 6 * 1024 * 1024));
  const bones = new Set(json.nodes.map(n => n.name));
  const parents = new Map(json.nodes.flatMap((n,i)=>(n.children || []).map(child=>[child,i])));
  const matrices = new Map();
  const world = i => {
    if (matrices.has(i)) return matrices.get(i);
    const n = json.nodes[i];
    const local = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(new Vector3().fromArray(n.translation || [0,0,0]),new Quaternion().fromArray(n.rotation || [0,0,0,1]),new Vector3().fromArray(n.scale || [1,1,1]));
    const result = parents.has(i) ? world(parents.get(i)).clone().multiply(local) : local;
    matrices.set(i,result); return result;
  };
  for (const skin of json.skins) {
    const inverse = values(skin.inverseBindMatrices);
    skin.joints.forEach((joint,i)=>{
      const neutral = world(joint).clone().multiply(new Matrix4().fromArray(inverse,i*16));
      assert.ok(neutral.elements.every((v,k)=>Math.abs(v-(k%5===0 ? 1 : 0))<.00001), `${name}: adjusted bind pose stays neutral at ${json.nodes[joint].name}`);
    });
  }
  for (const bone of ['Hips', 'Head', 'LeftEye', 'RightEye', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot']) assert.ok(bones.has(bone), `${name}: ${bone}`);
  const active = new Set();
  for (const mesh of json.meshes) {
    const names = (mesh.extras?.targetNames || []).map(resolveMorphName);
    for (const primitive of mesh.primitives) {
      const positions = values(primitive.attributes.POSITION);
      assert.ok(positions.every(Number.isFinite), `${name}: finite sculpted geometry`);
      const weights = primitive.attributes.WEIGHTS_0 === undefined ? new Float32Array() : values(primitive.attributes.WEIGHTS_0);
      for (let i = 0; i < weights.length; i += 4) {
        const total = weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3];
        assert.ok(Number.isFinite(total) && total > .99 && total < 1.01, `${name}: subdivided vertex retains skin weights`);
      }
      for (let i = 0; i < names.length; i++) {
        const deltas = values(primitive.targets[i].POSITION);
        assert.equal(deltas.length, positions.length, `${name}: morph topology agrees with body`);
        assert.ok(deltas.every(Number.isFinite), `${name}: finite ${names[i]} morph`);
        if (deltas.some(v => Math.abs(v) > 1e-5)) active.add(names[i]);
      }
    }
  }
  const required = avatar.mouthProfile === 'vowels' ? ['eyeBlinkLeft','eyeBlinkRight','mouthSmileLeft',...['aa','E','I','O','U'].map(v=>'viseme_'+v)] : ['jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight', 'mouthSmileLeft', 'mouthSmileRight', ...['PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'].map(v => 'viseme_' + v)];
  for (const morph of required) assert.ok(active.has(morph), `${name}: nonempty ${morph}`);
});
