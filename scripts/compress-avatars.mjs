// Compress without quantization: decoded morphs, skin weights and UVs must
// be numerically identical to the Blender export. Meshopt may rotate each
// triangle's index triplet cyclically, preserving vertex order and winding.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { AVATAR_PRESETS } from '../src/avatars.mjs';

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const signatures = doc => doc.getRoot().listAccessors().map(a => {
  const data = a.getArray().slice();
  for (let i = 0; i < data.length; i++) if (data[i] === 0) data[i] = 0; // signed zero
  if (a.getType() === 'SCALAR' && a.getComponentType() !== 5126) {
    for (let i = 0; i < data.length; i += 3) {
      const t = [data[i], data[i + 1], data[i + 2]];
      const start = t.indexOf(Math.min(...t));
      for (let k = 0; k < 3; k++) data[i + k] = t[(start + k) % 3];
    }
  }
  return `${a.getType()}:${a.getComponentType()}:${a.getNormalized()}:` +
    createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
}).sort().join('\n');

for (const avatar of AVATAR_PRESETS) {
  const path = new URL(`../public/${avatar.model}`, import.meta.url);
  const original = readFileSync(path);
  const doc = await io.readBinary(original);
  const before = signatures(doc);
  // Sparse accessors bypass Meshopt compression. Dense zero runs compress
  // better and avoid large repeated sparse-index tables for the head morphs.
  for (const accessor of doc.getRoot().listAccessors()) accessor.setSparse(false);
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const packed = await io.writeBinary(doc);
  if (signatures(await io.readBinary(packed)) !== before) throw new Error(`${avatar.id}: accessor data changed`);
  if (packed.byteLength > 6 * 1024 * 1024) throw new Error(`${avatar.id}: exceeds 6 MiB budget`);
  writeFileSync(path, packed);
  console.log(`${avatar.name}: ${(original.byteLength / 1048576).toFixed(2)} → ${(packed.byteLength / 1048576).toFixed(2)} MiB; exact geometry verified`);
}
