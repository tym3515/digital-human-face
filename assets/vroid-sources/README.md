# Native VRoid sources

Official sample metadata identifies the author as VRoid. Model conditions are linked in `../../public/avatars/VRoid-LICENSE.md`; the mirror repository's code license does not replace the model conditions.

Download these source VRMs into this directory, then run `npm ci` and `npm run avatars:cartoon` from the app directory. Raw sources and extracted thumbnails are local working inputs and are not committed or deployed.

| Input | Public mirror | SHA-256 |
| --- | --- | --- |
| AvatarSample_A.vrm | https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_A.vrm | b86b0b8a66d48911431d6f920a5211a974226f83aa672eca3f3dfade58ac346e |
| AvatarSample_C.vrm | https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_C.vrm | 395d5b04696e888f07bc856ae01bf72a974b7e773132c7443dc59d1688045b8a |

Use the hashes to detect upstream replacement. Final GLBs are about 1 MiB each. Native five-vowel targets remain distinct; consonant controls are approximate mixtures and cloud speech has no precise phoneme timestamps. Native full-body geometry and garment masks are preserved, rather than painting a new face over an old rig.
