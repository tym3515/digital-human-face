import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { BufferGeometry, Float32BufferAttribute } from 'three';

// Extend the licensed cardigan topology into a tailored, knee-length coat.
// Sleeves retain their native arm weights; the lower skirt follows the pelvis.
export function longCoat(doc) {
  const body = doc.getRoot().listMeshes().find(m=>/Body/.test(m.getName()));
  const source = body.listPrimitives().find(p=>/Tops/.test(p.getMaterial().getName()));
  const indices = source.getIndices().getArray();
  const used = [...new Set(indices)], map = new Map(used.map((old,i)=>[old,i]));
  const coat = doc.createPrimitive();
  for (const semantic of source.listSemantics()) {
    if (semantic==='TEXCOORD_0' || semantic==='TANGENT') continue;
    const accessor=source.getAttribute(semantic), size=accessor.getElementSize(), array=accessor.getArray();
    const next=new array.constructor(used.length*size);
    used.forEach((old,i)=>next.set(array.slice(old*size,(old+1)*size),i*size));
    coat.setAttribute(semantic,doc.createAccessor().setType(accessor.getType()).setNormalized(accessor.getNormalized()).setArray(next));
  }
  const p=coat.getAttribute('POSITION').getArray();
  const joints=coat.getAttribute('JOINTS_0').getArray(), weights=coat.getAttribute('WEIGHTS_0').getArray();
  const skin=doc.getRoot().listNodes().find(n=>n.getMesh()===body).getSkin();
  const hip=skin.listJoints().findIndex(n=>n.getName()==='Hips');
  const colors=new Float32Array(used.length*4);
  for(let i=0;i<used.length;i++) {
    const x=p[i*3], y=p[i*3+1], z=p[i*3+2];
    const skirt=Math.abs(x)<.20 && y<.98;
    if(skirt) {
      const t=Math.max(0,Math.min(1,(.98-y)/(.98-.742)));
      p[i*3+1]-=.255*t;
      p[i*3]*=1+.12*t;
      p[i*3+2]*=1+.09*t;
      // The coat hangs over both legs without twisting as one leg moves.
      if(y<.89) {joints.set([hip,0,0,0],i*4);weights.set([1,0,0,0],i*4);}
    }
    const n=coat.getAttribute('NORMAL').getArray();
    const shade=.83+.16*Math.max(0,-n[i*3+2]);
    // Recolor the garment only; keep face, hands and denim independent.
    colors.set([.50*shade,.44*shade,.35*shade,1],i*4);
  }
  const newIndices=new Uint16Array(Array.from(indices,i=>map.get(i)));
  coat.setIndices(doc.createAccessor().setType('SCALAR').setArray(newIndices));
  const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(p,3)).setIndex(Array.from(newIndices));
  geometry.computeVertexNormals();
  coat.getAttribute('NORMAL').setArray(new Float32Array(geometry.getAttribute('normal').array));
  geometry.dispose();
  for(const target of source.listTargets()) {
    const next=doc.createPrimitiveTarget();
    for(const semantic of target.listSemantics()) next.setAttribute(semantic,doc.createAccessor().setType('VEC3').setArray(new Float32Array(used.length*3)));
    coat.addTarget(next);
  }
  coat.setAttribute('COLOR_0',doc.createAccessor().setType('VEC4').setArray(colors));
  const unlit=doc.createExtension(KHRMaterialsUnlit);
  coat.setMaterial(doc.createMaterial('Sand knee-length coat').setBaseColorFactor([1,1,1,1]).setDoubleSided(true).setRoughnessFactor(.9).setAlphaMode('OPAQUE').setExtension('KHR_materials_unlit',unlit.createUnlit()));
  body.removePrimitive(source);body.addPrimitive(coat);
  // Small fabric details hug the native chest surface rather than floating
  // as a large pointed badge. A shallow round neckline reveals a plain tee.
  const chest=skin.listJoints().findIndex(n=>n.getName()==='Spine1');
  const detail=(name,points,triangles,color,joint)=> {
    const count=points.length/3,j=new Uint16Array(count*4),w=new Float32Array(count*4);
    for(let i=0;i<count;i++){j[i*4]=joint;w[i*4]=1;}
    const g=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(points,3)).setIndex(triangles);g.computeVertexNormals();
    const lapel=doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(points))).setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.getAttribute('normal').array))).setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(j)).setAttribute('WEIGHTS_0',doc.createAccessor().setType('VEC4').setArray(w)).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(triangles)));
    for(const target of source.listTargets()) {
      const next=doc.createPrimitiveTarget();for(const semantic of target.listSemantics()) next.setAttribute(semantic,doc.createAccessor().setType('VEC3').setArray(new Float32Array(points.length)));lapel.addTarget(next);
    }
    lapel.setMaterial(doc.createMaterial(name).setBaseColorFactor(color).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit()));body.addPrimitive(lapel);g.dispose();
  };
  const surface=(x,y)=> {
    let front=Infinity;
    for(let i=0;i<newIndices.length;i+=3) {
      const ids=Array.from(newIndices.slice(i,i+3)),a=ids.map(id=>[p[id*3],p[id*3+1],p[id*3+2]]);
      const den=(a[1][1]-a[2][1])*(a[0][0]-a[2][0])+(a[2][0]-a[1][0])*(a[0][1]-a[2][1]);
      if(Math.abs(den)<1e-9)continue;
      const u=((a[1][1]-a[2][1])*(x-a[2][0])+(a[2][0]-a[1][0])*(y-a[2][1]))/den;
      const v=((a[2][1]-a[0][1])*(x-a[2][0])+(a[0][0]-a[2][0])*(y-a[2][1]))/den,w=1-u-v;
      if(u>=-1e-5 && v>=-1e-5 && w>=-1e-5)front=Math.min(front,u*a[0][2]+v*a[1][2]+w*a[2][2]);
    }
    if(!Number.isFinite(front))throw new Error('Coat chest surface missing');
    return front-.0018;
  };
  const panel=(name,columns,color)=> {
    const points=[],triangles=[];
    columns.forEach(([x,top,bottom],i)=> {
      points.push(x,top,surface(x,top),x,bottom,surface(x,bottom));
      if(i)triangles.push((i-1)*2,(i-1)*2+1,i*2,(i-1)*2+1,i*2+1,i*2);
    });
    detail(name,points,triangles,color,chest);
  };
  panel('Coat ivory crew-neck trim',Array.from({length:17},(_,i)=> {
    const x=(i/16*2-1)*.036;
    const curve=Math.sqrt(Math.max(0,1-(x/.036)**2));
    return [x,1.234-.024*curve,1.221-.025*curve];
  }),[.82,.80,.74,1]);
  // Small front buttons add scale and tailoring without borrowing face textures.
  for(const y of [1.15,1.08,1.02,.92,.81,.70]) {
    const upper=y>1.02;
    const z=upper?surface(.017,y)-.001:y>1?-.138:y>.85?-.127:-.120,points=[.017,y,z];
    for(let k=0;k<10;k++){
      const a=k*Math.PI/5,x=.017+.006*Math.cos(a),height=y+.006*Math.sin(a);
      points.push(x,height,upper?surface(x,height)-.002:z-.002);
    }
    const triangles=[];for(let k=0;k<10;k++)triangles.push(0,k+1,(k+1)%10+1);
    detail('Coat button '+y,points,triangles,[.15,.13,.10,1],y>.95?chest:hip);
  }
}
