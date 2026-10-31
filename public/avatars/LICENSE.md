# Avatar licenses

Current picker: two VRoid cartoon avatars. Their separate conditions and attribution are in [VRoid-LICENSE.md](VRoid-LICENSE.md); they are not MIT or CC0. The following Rocketbox files remain historical assets and are no longer preset choices. They are not included in the Git repository.

## Microsoft Rocketbox avatars (historical)

Source: https://github.com/microsoft/Microsoft-Rocketbox (MIT). The complete upstream license is preserved in [MICROSOFT-LICENSE.md](MICROSOFT-LICENSE.md).

| File | Upstream avatar | Demo identity |
| --- | --- | --- |
| rocketbox-business.glb | Assets/Avatars/Professions/Business_Female_04 | 小夏 / female business |
| rocketbox-male.glb | Assets/Avatars/Professions/Business_Male_06 | 小宇 / male business |
| rocketbox-casual.glb | Assets/Avatars/Adults/Female_Adult_01 | 小琳 / female casual |
| rocketbox-longhair.glb | Assets/Avatars/Adults/Female_Adult_08 | 念念 / long-haired casual female |
| rocketbox-elegant.glb | Assets/Avatars/Adults/Female_Adult_11 | 晚晴 / dress female |
| rocketbox-executive.glb | Assets/Avatars/Professions/Business_Male_03 | 慕言 / suited male |

Converted with Blender 5.2 using `scripts/build-rocketbox.py`: original skin weights and complete body are preserved; bones are renamed to the app's canonical rig, 15 visemes and 52 ARKit targets retained, color and normal textures packed as WebP. Each asset is under 6 MB. Automated checks read actual morph deltas, including sparse accessors, rather than trusting target names.

These are stock licensed characters, not face clones of the résumé author. To add another rigged avatar, register its `.glb` in `src/avatars.mjs`, or drag a compatible GLB into the viewport.
