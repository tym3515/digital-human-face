import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceGender, voicesFor, pickVoice } from './voices.mjs';
const voices = [
  { name: 'Microsoft Huihui - Chinese', lang: 'zh-CN', localService: true },
  { name: 'Microsoft Kangkang - Chinese', lang: 'zh-CN', localService: true },
  { name: 'Unknown', lang: 'zh-CN' },
  { name: 'Microsoft David', lang: 'en-US' },
  { name: 'Microsoft Zira', lang: 'en-US' },
];
test('female/male voice selection never falls back to unknown or opposite-gender voices', () => {
  assert.equal(pickVoice(voices, { lang: 'zh-CN' }, 'male', voices[0].name).v.name, voices[1].name);
  assert.equal(pickVoice([voices[0], voices[2]], { lang: 'zh-CN' }, 'male'), null);
  assert.equal(pickVoice(voices, { lang: 'en-US' }, 'female', voices[1].name).v.name, 'Microsoft Zira');
  assert.deepEqual(voicesFor(voices, 'zh-CN', 'female').map(v => v.name), [voices[0].name]);
});
test('voice labels do not classify female as male or Alexandra as Alex', () => {
  assert.equal(voiceGender({ name: 'en-US-AvaNeural' }), 'female');
  assert.equal(voiceGender({ name: 'female voice' }), 'female');
  assert.equal(voiceGender({ name: 'Alexandra' }), null);
  assert.equal(voiceGender({ name: 'Google 普通话' }), null);
});
