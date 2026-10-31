import { Matrix4, Vector3, Matrix3 } from 'three';

// Bake one continuous deformation into the body, facial shape keys and rig.
// Rebuilding inverse bind matrices keeps the new rest pose neutral when skinned.
export function adultProportions(doc, gender) {
  const nodes = doc.getRoot().listNodes();
  const named = name => nodes.find(n => n.getName() === name);
  const point = n => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(n.getWorldMatrix()));
  const hips = point(named('Hips')).y, neck = point(named('Neck')).y;
  const leg = gender === 'female' ? .94 : .97;
  const torso = gender === 'female' ? 1.06 : 1.03;
  const head = gender === 'female' ? .92 : .96;
  const ease = t => { t = Math.max(0, Math.min(1, t)); return t*t*(3-2*t); };
  const warp = p => {
    const y = p.y;
    const headBlend = ease((y-neck+.015)/.065);
    const width = (gender === 'female' ? 1.11 : 1.06) +
      ((gender === 'female' ? 1.04 : 1.02) - (gender === 'female' ? 1.11 : 1.06))*ease((y-hips+.12)/.25);
    const sx = width + (head-width)*headBlend;
    const sy = y <= hips ? y*leg : y <= neck ? hips*leg+(y-hips)*torso : hips*leg+(neck-hips)*torso+(y-neck)*head;
    return new Vector3(p.x*sx, sy, p.z*(1.04+(head-1.04)*headBlend));
  };
  const oldWorld = new Map(nodes.map(n => [n,new Matrix4().fromArray(n.getWorldMatrix())]));
  const newWorld = new Map(nodes.map(n => { const m = oldWorld.get(n).clone(); m.setPosition(warp(point(n))); return [n,m]; }));
  const transformed = new Set();
  for (const node of nodes) {
    if (!node.getMesh()) continue;
    const world = oldWorld.get(node), inv = world.clone().invert();
    const worldNormal = new Matrix3().getNormalMatrix(world), localNormal = new Matrix3().getNormalMatrix(inv);
    for (const primitive of node.getMesh().listPrimitives()) {
      const pos = primitive.getAttribute('POSITION');
      if (transformed.has(pos)) continue;
      transformed.add(pos);
      const original = pos.getArray().slice(), result = original.slice();
      const normal = primitive.getAttribute('NORMAL');
      const normals = normal?.getArray().slice();
      const targets = primitive.listTargets().map(t => ({p:t.getAttribute('POSITION'),n:t.getAttribute('NORMAL')}));
      const targetOriginal = targets.map(t => t.p?.getArray().slice());
      const targetNormals = targets.map(t => t.n?.getArray().slice());
      for (let i=0; i<original.length; i+=3) {
        const base = new Vector3().fromArray(original,i).applyMatrix4(world), next = warp(base);
        next.clone().applyMatrix4(inv).toArray(result,i);
        // Inverse-transpose of the local deformation, including the neck blend.
        const eps = .00001, columns = [new Vector3(eps,0,0),new Vector3(0,eps,0),new Vector3(0,0,eps)].map(d=>warp(base.clone().add(d)).sub(next).multiplyScalar(1/eps));
        const jacobian = new Matrix3().set(columns[0].x,columns[1].x,columns[2].x,columns[0].y,columns[1].y,columns[2].y,columns[0].z,columns[1].z,columns[2].z).invert().transpose();
        const mapNormal = n => n.applyMatrix3(worldNormal).applyMatrix3(jacobian).applyMatrix3(localNormal).normalize();
        const originalNormal = normal ? new Vector3().fromArray(normal.getArray(),i) : null;
        const nextNormal = originalNormal && mapNormal(originalNormal.clone());
        nextNormal?.toArray(normals,i);
        targets.forEach((target,k)=>{
          if (target.p) {
            const endpoint = new Vector3().fromArray(original,i).add(new Vector3().fromArray(targetOriginal[k],i)).applyMatrix4(world);
            warp(endpoint).applyMatrix4(inv).sub(new Vector3().fromArray(result,i)).toArray(target.p.getArray(),i);
          }
          if (target.n && originalNormal) mapNormal(originalNormal.clone().add(new Vector3().fromArray(targetNormals[k],i))).sub(nextNormal).toArray(target.n.getArray(),i);
        });
      }
      pos.setArray(result); if (normal) normal.setArray(normals);
    }
  }
  for (const node of nodes) {
    const parent = node.getParentNode();
    const local = parent ? newWorld.get(parent).clone().invert().multiply(newWorld.get(node)) : newWorld.get(node);
    node.setTranslation(new Vector3().setFromMatrixPosition(local).toArray());
  }
  for (const skin of doc.getRoot().listSkins()) {
    const matrices = new Float32Array(skin.listJoints().length*16);
    skin.listJoints().forEach((joint,i)=>new Matrix4().fromArray(joint.getWorldMatrix()).invert().toArray(matrices,i*16));
    skin.getInverseBindMatrices().setArray(matrices);
  }
}
