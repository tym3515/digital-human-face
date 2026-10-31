import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { Vector3, Matrix4 } from 'three';

// Reuse the licensed body's leg topology and weights for opaque straight jeans.
// Keep this separate from skin material so hands, neck and face stay untouched.
export function denimJeans(doc) {
  const body = doc.getRoot().listMeshes().find(m=>/Body/.test(m.getName()));
  const source = body.listPrimitives().find(p=>/Body.*SKIN/.test(p.getMaterial().getName()));
  const positions = source.getAttribute('POSITION').getArray();
  const nodes = doc.getRoot().listNodes();
  const at = name => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(nodes.find(n=>n.getName()===name).getWorldMatrix()));
  const hips = at('Hips').y, ankle = (at('LeftFoot').y+at('RightFoot').y)/2;
  const top = hips+.065, bottom = ankle+.025;
  const oldIndices = source.getIndices().getArray(), pantIndices = [], keepIndices = [];
  for (let i=0;i<oldIndices.length;i+=3) {
    const tri = Array.from(oldIndices.slice(i,i+3));
    const ys = tri.map(v=>positions[v*3+1]);
    if (Math.max(...ys)<top && Math.min(...ys)>bottom-.025) pantIndices.push(...tri);
    else keepIndices.push(...tri);
  }
  if (pantIndices.length<1500) throw new Error('Native leg coverage missing');
  source.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(keepIndices)));
  for (const primitive of body.listPrimitives()) if (/Bottoms/.test(primitive.getMaterial().getName())) body.removePrimitive(primitive);
  const used = [...new Set(pantIndices)], map = new Map(used.map((old,i)=>[old,i]));
  const jeans = doc.createPrimitive();
  for (const semantic of source.listSemantics()) {
    if (semantic==='TEXCOORD_0' || semantic==='TANGENT') continue;
    const original = source.getAttribute(semantic), size = original.getElementSize(), array = original.getArray();
    const next = new array.constructor(used.length*size);
    used.forEach((old,i)=>next.set(array.slice(old*size,(old+1)*size),i*size));
    jeans.setAttribute(semantic,doc.createAccessor().setType(original.getType()).setNormalized(original.getNormalized()).setArray(next));
  }
  const p = jeans.getAttribute('POSITION').getArray(), colors = new Float32Array(used.length*4);
  const norm = jeans.getAttribute('NORMAL').getArray();
  const legs = Object.fromEntries(['Left','Right'].map(side=>[side,[at(side+'UpLeg'),at(side+'Leg'),at(side+'Foot')]]));
  const hem = Math.min(...used.map(i=>positions[i*3+1]));
  for (let i=0;i<used.length;i++) {
    const x=p[i*3], y=p[i*3+1], z=p[i*3+2], side=x<0?'Left':'Right';
    const [hip,knee,foot]=legs[side];
    const t=Math.max(0,Math.min(1,(y-foot.y)/(knee.y-foot.y)));
    const center=y<knee.y ? foot.clone().lerp(knee,t) : knee.clone().lerp(hip,Math.min(1,(y-knee.y)/(hip.y-knee.y)));
    const dx=x-center.x, dz=z-center.z, radius=Math.hypot(dx,dz)||1;
    // Extra ease at calves/ankles yields trousers rather than recolored tights.
    const ease=Math.max(0,Math.min(1,(top-y)/.13));
    const straight=Math.max(0,Math.min(1,(knee.y+.1-y)/.1));
    const padding=((.009*(1-straight))+(Math.max(radius,.046)-radius)*straight)*ease;
    p[i*3]+=dx/radius*padding; p[i*3+2]+=dz/radius*padding;
    // Extend the cuff over the former stocking ankle to meet the shoes.
    p[i*3+1]-=.025*Math.max(0,1-(y-hem)/.045);
    const shade=.77+.2*Math.max(0,-norm[i*3+2])+.08*Math.exp(-(((y-knee.y)/.12)**2));
    const grain=.018*Math.sin(y*850+x*410+z*930);
    colors.set([(.08+grain)*shade,(.20+grain)*shade,(.37+grain)*shade,1],i*4);
  }
  // Body expression slots are zero here; retain mesh target cardinality.
  for (const target of source.listTargets()) {
    const next=doc.createPrimitiveTarget();
    for (const semantic of target.listSemantics()) next.setAttribute(semantic,doc.createAccessor().setType('VEC3').setArray(new Float32Array(used.length*3)));
    jeans.addTarget(next);
  }
  jeans.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(pantIndices.map(i=>map.get(i)))));
  jeans.setAttribute('COLOR_0',doc.createAccessor().setType('VEC4').setArray(colors));
  const unlit=doc.createExtension(KHRMaterialsUnlit);
  const material=doc.createMaterial('Blue denim straight-leg jeans').setBaseColorFactor([1,1,1,1]).setRoughnessFactor(.95).setMetallicFactor(0).setDoubleSided(true).setAlphaMode('OPAQUE').setExtension('KHR_materials_unlit',unlit.createUnlit());
  jeans.setMaterial(material); body.addPrimitive(jeans);
}
