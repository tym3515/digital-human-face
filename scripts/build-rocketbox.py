"""Convert the MIT Rocketbox Business_Female_04 facial FBX with Blender 5.2.

Download FBX + *_color.tga + body/head normal maps from this source:
https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars/Professions/Business_Female_04
Run: blender --background --python scripts/build-rocketbox.py -- SOURCE_DIRECTORY
"""
import bpy
import re
import sys
from pathlib import Path

args = sys.argv[sys.argv.index('--') + 1:]
source = Path(args[0]).resolve()
target = Path(__file__).resolve().parents[1] / 'public/avatars' / (args[1] if len(args) > 1 else 'rocketbox-business.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(next(source.glob('*_facial.fbx'))))
texture_prefix = next(source.glob('*_head_color.tga')).name.removesuffix('_head_color.tga')
armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
center = {'Pelvis': 'Hips', 'Spine': 'Spine', 'Spine1': 'Spine1', 'Spine2': 'Spine2', 'Neck': 'Neck', 'Head': 'Head', 'LEye': 'LeftEye', 'REye': 'RightEye'}
limbs = {'Clavicle': 'Shoulder', 'UpperArm': 'Arm', 'Forearm': 'ForeArm', 'Hand': 'Hand', 'Thigh': 'UpLeg', 'Calf': 'Leg', 'Foot': 'Foot', 'Toe0': 'ToeBase'}
mapping = {}
for bone in armature.data.bones:
    name = bone.name.removeprefix('Bip01 ')
    new = center.get(name)
    match = re.fullmatch(r'([LR]) (.+)', name)
    if match:
        side, part = match.groups()
        prefix = 'Left' if side == 'L' else 'Right'
        if part in limbs:
            new = prefix + limbs[part]
        else:
            finger = re.fullmatch(r'Finger([0-4])([12]?)', part)
            if finger:
                f, segment = finger.groups()
                new = prefix + 'Hand' + ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'][int(f)] + str(int(segment or '0') + 1)
    if new:
        mapping[bone.name] = new
        bone.name = new

visemes = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U']
for mesh in [o for o in bpy.data.objects if o.type == 'MESH']:
    for old, new in mapping.items():
        if old in mesh.vertex_groups:
            mesh.vertex_groups[old].name = new
    keys = mesh.data.shape_keys
    if keys:
        for key in list(keys.key_blocks)[1:]:
            if key.name.startswith('AA_VI_'):
                key.name = 'viseme_' + visemes[int(key.name.split('_')[2])]
            elif key.name.startswith('AK_'):
                name = key.name.split('_', 2)[2]
                key.name = name[0].lower() + name[1:]
            else:
                mesh.shape_key_remove(key)
    for polygon in mesh.data.polygons:
        polygon.use_smooth = True

# Rebuild materials explicitly: FBX's legacy specular wiring is unsuitable for
# glTF PBR. Keep diffuse/normal detail and proper alpha only for hair/eyelashes.
for material in bpy.data.materials:
    kind = 'opacity' if 'opacity' in material.name else 'head' if 'head' in material.name else 'body'
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Metallic'].default_value = 0
    shader.inputs['Roughness'].default_value = .68 if kind == 'body' else .56
    links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    color = nodes.new('ShaderNodeTexImage')
    color.image = bpy.data.images.load(str(source / f'{texture_prefix}_{kind}_color.tga'), check_existing=False)
    if max(color.image.size) > 2048:
        color.image.scale(2048, 2048)
    color.image.pack()
    links.new(color.outputs['Color'], shader.inputs['Base Color'])
    if kind == 'opacity':
        links.new(color.outputs['Alpha'], shader.inputs['Alpha'])
        material.surface_render_method = 'DITHERED'
    else:
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(str(source / f'{texture_prefix}_{kind}_normal.tga'), check_existing=False)
        texture.image.colorspace_settings.name = 'Non-Color'
        texture.image.scale(1024, 1024)
        texture.image.pack()
        normal = nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = .35
        links.new(texture.outputs['Color'], normal.inputs['Color'])
        links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    material.use_backface_culling = False

for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
for obj in bpy.data.objects:
    obj.animation_data_clear()
target.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', export_animations=False, export_morph=True, export_morph_normal=False, export_morph_tangent=False, export_image_format='WEBP', export_image_quality=88, export_unused_images=False)
print('EXPORTED', target, target.stat().st_size)
