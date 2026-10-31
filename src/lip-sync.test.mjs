import test from 'node:test';
import assert from 'node:assert/strict';
import { audioTrack, speechGain, alignPlanToAudio, captionWindow, splitSpeech } from './lip-sync.mjs';

test('voiced audio alignment respects real leading/trailing silence and mid-sentence pause', () => {
  const samples = new Float32Array(2000);
  samples.fill(.3, 200, 650); samples.fill(.3, 1100, 1650);
  const track = audioTrack({ duration: 2, sampleRate: 1000, length: 2000, numberOfChannels: 1, getChannelData: () => samples });
  assert.equal(speechGain(track, .05), 0); assert.equal(speechGain(track, .8), 0);
  assert.equal(speechGain(track, 1.9), 0); assert.ok(speechGain(track, .4) > .9);
  const plan = { events: [{ t: .05, d: .2, v: 'aa' }, { t: .25, d: .3, v: 'sil', kind: 'pause' }, { t: .55, d: .25, v: 'O' }], chars: [{ t: .05, d: .2 }, { t: .25, d: .3 }, { t: .55, d: .25 }], beats: [.05, .55], sentences: [{ t0: .05, t1: .8 }], dur: .8 };
  assert.equal(alignPlanToAudio(plan, track), true);
  assert.ok(plan.events[0].t >= .17);
  assert.ok(plan.events[2].t >= 1.05);
  assert.ok(plan.events[2].t + plan.events[2].d <= 1.7);
  assert.equal(plan.dur, 2);
});

test('silent or unusable audio has a safe timing fallback', () => {
  const track = audioTrack({ duration: 1, sampleRate: 100, length: 100, numberOfChannels: 1, getChannelData: () => new Float32Array(100) });
  assert.equal(speechGain(track, .5), 0);
  assert.equal(alignPlanToAudio({ events: [], chars: [] }, track), false);
});

test('long subtitles remain bounded and preserve the exact original characters', () => {
  const clean = '你好'.repeat(100);
  const plan = { clean, chars: Array.from(clean, (_, i) => ({ t: i * .2, d: .2 })), sentences: [{ i0: 0, i1: clean.length }] };
  assert.equal(captionWindow(plan, -1), null);
  for (let i = 0; i < clean.length; i++) {
    const result = captionWindow(plan, i * .2);
    assert.ok((result.done + result.todo).length <= 28);
    assert.equal(result.done + result.todo, clean.slice(Math.floor(i / 28) * 28, Math.floor(i / 28) * 28 + 28));
  }
});

test('cloud speech chunks preserve every tag and character while bounding segment length', () => {
  const text = '[wave]你好。' + '这是口型测试。'.repeat(35) + '[smile]再见。';
  const chunks = splitSpeech(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.replace(/\[[a-z]+\]/g, '').length <= 90);
});
