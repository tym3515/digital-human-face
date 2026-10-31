// Adapt licensed VRoid samples without repainting the face or moving UVs.
// Native mouth, eyelids, skin weights and covered body geometry stay intact.
import { readFileSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { adultProportions } from './adult-proportions.mjs';
import { denimJeans } from './denim-jeans.mjs';
import { longCoat } from './long-coat.mjs';

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const bones = { hips:'Hips', spine:'Spine', chest:'Spine1', upperChest:'Spine2', neck:'Neck', head:'Head' };
for (const side of ['left','right']) {
  const prefix = side === 'left' ? 'Left' : 'Right';
  for (const [from,to] of Object.entries({ eye:'Eye', shoulder:'Shoulder', upperArm:'Arm', lowerArm:'ForeArm', hand:'Hand', upperLeg:'UpLeg', lowerLeg:'Leg', foot:'Foot', toes:'ToeBase' })) bones[side + from[0].toUpperCase() + from.slice(1)] = prefix + to;
  for (const finger of ['Thumb','Index','Middle','Ring','Little']) for (const [i,part] of ['Proximal','Intermediate','Distal'].entries()) bones[side + finger + part] = prefix + 'Hand' + (finger === 'Little' ? 'Pinky' : finger) + (i + 1);
}
const morphs = { Fcl_MTH_A:'viseme_aa', Fcl_MTH_I:'viseme_I', Fcl_MTH_U:'viseme_U', Fcl_MTH_E:'viseme_E', Fcl_MTH_O:'viseme_O', Fcl_EYE_Close_L:'eyeBlinkLeft', Fcl_EYE_Close_R:'eyeBlinkRight', Fcl_MTH_Fun:'mouthSmileLeft', Fcl_MTH_Sorrow:'mouthFrownLeft', Fcl_MTH_Surprised:'jawOpen', Fcl_BRW_Surprised:'browInnerUp', Fcl_BRW_Angry:'browDownLeft', Fcl_EYE_Surprised:'eyeWideLeft' };
for (const [source,target,gender] of [['A','cartoon-female','female'],['C','cartoon-male','male']]) {
  const bytes = readFileSync(new URL(`../assets/vroid-sources/AvatarSample_${source}.vrm`,import.meta.url));
  const n = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20,20+n));
  const vrm = json.extensions.VRM;
  for (const bone of vrm.humanoid.humanBones) if (bones[bone.bone]) json.nodes[bone.node].name = bones[bone.bone];
  for (const mesh of json.meshes) {
    const names = mesh.primitives[0].extras?.targetNames;
    if (names) mesh.extras = { ...mesh.extras, targetNames: names.map(name => { const native = name.slice(name.lastIndexOf('Fcl_')); return morphs[native] || name; }) };
  }
  delete json.extensions.VRM;
  json.extensionsUsed = json.extensionsUsed.filter(x => x !== 'VRM');
  for (const material of json.materials) {
    const pbr = material.pbrMetallicRoughness;
    // Material tinting changes the wardrobe, not the facial registration.
    if (/HAIR/.test(material.name)) pbr.baseColorFactor = gender === 'female' ? [.14,.16,.20,1] : [.28,.30,.34,1];
    if (/EyeIris/.test(material.name) && gender === 'male') pbr.baseColorFactor = [.35,.28,.18,1];
    if (/Tops/.test(material.name)) pbr.baseColorFactor = gender === 'female' ? [.72,.84,.92,1] : [.28,.34,.48,1];
    if (/Bottoms/.test(material.name)) pbr.baseColorFactor = [.24,.28,.36,1];
    pbr.metallicFactor = 0; pbr.roughnessFactor = .9;
    delete material.normalTexture; delete material.emissiveTexture;
  }
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const aligned = Buffer.alloc(Math.ceil(jsonBytes.length/4)*4,0x20); jsonBytes.copy(aligned);
  const binChunk = bytes.subarray(20+n);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67,0); header.writeUInt32LE(2,4); header.writeUInt32LE(20+aligned.length+binChunk.length,8); header.writeUInt32LE(aligned.length,12); header.writeUInt32LE(0x4e4f534a,16);
  const doc = await io.readBinary(Buffer.concat([header,aligned,binChunk]));
  adultProportions(doc, gender);
  if (gender === 'female') { denimJeans(doc); longCoat(doc); }
  await doc.transform(prune(), textureCompress({ encoder:sharp,targetFormat:'webp',resize:[1024,1024],quality:88 }));
  for (const accessor of doc.getRoot().listAccessors()) accessor.setSparse(false);
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
  const out = await io.writeBinary(doc);
  writeFileSync(new URL(`../public/avatars/${target}.glb`,import.meta.url),out);
  console.log(`${target}: ${(out.length/1048576).toFixed(2)} MiB; native VRoid mouth/eyelid shapes retained`);
}
