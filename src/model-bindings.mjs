// MetaPerson exports the same Oculus mouth shapes without a "viseme_"
// prefix. Map both the face and lower-teeth meshes to the same slots.
const METAPERSON_VISEMES = Object.freeze({
  sil: 'sil', PP: 'PP', FF: 'FF', TH: 'TH', DD: 'DD', kk: 'kk',
  CH: 'CH', SS: 'SS', nn: 'nn', RR: 'RR', aa: 'aa', E: 'E',
  ih: 'I', oh: 'O', ou: 'U',
});

export function resolveMorphName(name) {
  return Object.hasOwn(METAPERSON_VISEMES, name)
    ? `viseme_${METAPERSON_VISEMES[name]}` : String(name);
}

// VRoid has five native vowels. Consonants are conservative approximations;
// sil/PP stay closed rather than opening the jaw for a bilabial consonant.
export function cartoonVowelWeights(weights) {
  const out = [0,0,0,0,0]; // A, I, U, E, O
  const mix = [[],[],[[1,.1]],[[0,.13]],[[0,.2]],[[0,.28]],[[2,.3],[4,.2]],[[1,.15]],[[0,.12]],[[2,.22]],[[0,1]],[[3,1]],[[1,1]],[[4,1]],[[2,1]]];
  for (let i=1;i<mix.length;i++) for (const [slot,gain] of mix[i]) out[slot] += (Number.isFinite(weights[i]) ? Math.max(0,weights[i]) : 0) * gain;
  return out.map(v=>Math.min(1,v));
}
