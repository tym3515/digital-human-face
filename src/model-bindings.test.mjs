import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMorphName, cartoonVowelWeights } from './model-bindings.mjs';

test('MetaPerson native mouth shapes map all 15 slots, including its vowel spellings', () => {
  const names = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'ih', 'oh', 'ou'];
  assert.deepEqual(names.map(resolveMorphName), ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'].map(n => `viseme_${n}`));
});

test('existing ARKit and Rocketbox names remain unchanged', () => {
  for (const name of ['eyeBlinkLeft', 'jawOpen', 'mouthSmileRight', 'viseme_aa', 'viseme_I', 'viseme_O']) assert.equal(resolveMorphName(name), name);
  assert.equal(resolveMorphName('toString'), 'toString');
});

test('cartoon mouth closes for silence/PP, separates vowels and bounds blended deformations', () => {
  const weights = new Float32Array(15);
  weights[1]=1; assert.deepEqual(cartoonVowelWeights(weights),[0,0,0,0,0]);
  for (const [slot,target] of [[10,0],[12,1],[14,2],[11,3],[13,4]]) {
    weights.fill(0); weights[slot]=1;
    const out=cartoonVowelWeights(weights); assert.equal(out[target],1); assert.equal(out.reduce((a,b)=>a+b),1);
  }
  weights.fill(1); assert.ok(cartoonVowelWeights(weights).every(x=>x>=0&&x<=1));
});
