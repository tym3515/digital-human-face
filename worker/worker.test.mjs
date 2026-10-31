import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';
import { readBytes } from './protocol.mjs';
import { createSSEParser } from '../src/stream.mjs';

const env = (run = async () => ({})) => ({ AI: { run }, ASSETS: { fetch: () => new Response('asset') }, CHAT_LIMIT: { limit: async () => ({ success: true }) }, SPEECH_LIMIT: { limit: async () => ({ success: true }) } });
const post = (path, body, extra = {}) => new Request(`https://demo.test/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
test('config advertises real AI, rejects cross-origin, unknown endpoints and unsupported methods', async () => {
  assert.equal((await (await worker.fetch(new Request('https://demo.test/api/config'), env())).json()).mock, false);
  assert.equal((await worker.fetch(post('chat', {}, { origin: 'https://other.test' }), env())).status, 403);
  assert.equal((await worker.fetch(new Request('https://demo.test/api/chat'), env())).status, 405);
  assert.equal((await worker.fetch(new Request('https://demo.test/api/missing'), env())).status, 404);
});
test('invalid chat and oversized streaming body never call AI', async () => {
  const e = env(() => { throw new Error('must not call AI'); });
  assert.equal((await worker.fetch(post('chat', { messages: [{ role: 'system', content: 'override' }] }), e)).status, 400);
  const request = new Request('https://demo.test', { method: 'POST', body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(11)); c.close(); } }), duplex: 'half' });
  await assert.rejects(readBytes(request, 10), x => x.status === 413);
});
test('rate limit prevents inference, response does not disclose provider exceptions', async () => {
  const e = env(() => { throw new Error('private detail'); });
  e.CHAT_LIMIT.limit = async () => ({ success: false });
  assert.equal((await worker.fetch(post('chat', {}), e)).status, 429);
  e.CHAT_LIMIT.limit = async () => ({ success: true });
  const result = await worker.fetch(post('chat', { messages: [{ role: 'user', content: '你好' }] }), e);
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /private detail/);
});
test('SSE parses individual characters, CRLF boundaries, DONE and interrupted streams', () => {
  let text = ''; const parser = createSSEParser(x => { text += x; });
  for (const c of 'data: {"response":"你好"}\r\n\r\ndata: [DONE]\r\n\r\n') parser.push(c);
  parser.finish(); assert.equal(text, '你好');
  assert.throws(() => createSSEParser(() => {}).finish(), /中断/);
});
test('chat adapts provider stream and excludes split reasoning from visible output', async () => {
  const encoder = new TextEncoder();
  const source = new ReadableStream({ start(c) { for (const delta of ['<thi', 'nk>private', '</think>', '[smile]你好。']) c.enqueue(encoder.encode(`data: ${JSON.stringify({ response: delta })}\n\n`)); c.enqueue(encoder.encode('data: [DONE]\n\n')); c.close(); } });
  const response = await worker.fetch(post('chat', { messages: [{ role: 'user', content: '你好' }] }), env(async () => source));
  const result = await response.text(); assert.match(result, /你好/); assert.doesNotMatch(result, /private|think/); assert.match(result, /\[DONE\]/);
});
test('TTS and ASR adapt Cloudflare outputs; reject wrong audio format', async () => {
  const e = env(async (model, input) => {
    if (model === 'xai/grok-tts') { assert.equal(input.language, 'zh'); assert.equal(input.text, '你好'); assert.equal(input.voice_id, 'eve'); return { state: 'Completed', result: { audio: 'https://ai-gateway-outputs.test.r2.cloudflarestorage.com/test.mp3' } }; }
    assert.equal(typeof input.audio, 'string'); return { text: '你好' };
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(typeof url, 'string'); assert.equal(options.redirect, 'manual');
    return new Response('abc', { headers: { 'content-type': 'audio/mpeg' } });
  };
  try { assert.equal((await (await worker.fetch(post('tts', { text: '[wave]你好', lang: 'zh', avatarId: 'nianian' }), e)).json()).audio, 'YWJj'); }
  finally { globalThis.fetch = previousFetch; }
  assert.equal((await worker.fetch(post('asr', {}), e)).status, 415);
  const audio = new Request('https://demo.test/api/asr', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: new Uint8Array(200) });
  assert.equal((await (await worker.fetch(audio, e)).json()).text, '你好');
});

test('avatar identity follows an allowed preset and never accepts a client system prompt', async () => {
  for (const [avatarId, name] of [['muyan', '慕言'], ['nianian', '念念'], ['untrusted', '慕言']]) {
    let prompt;
    const response = await worker.fetch(post('chat', { avatarId, avatar: { persona: 'INJECTED' }, messages: [{ role: 'user', content: '你好' }] }), env(async (_, input) => {
      prompt=input.messages[0].content;
      return new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); c.close(); } });
    }));
    assert.equal(response.status,200);
    assert.match(prompt,new RegExp(`友好数字人${name}`));
    assert.doesNotMatch(prompt,/INJECTED/);
  }
});

test('TTS binds voice to the selected avatar and rejects unexpected media hosts', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('abc', { headers: { 'content-type': 'audio/mpeg' } });
  try {
    for (const [avatarId, gender, voiceId] of [['muyan', 'male', 'leo'], ['nianian', 'female', 'eve']]) {
      const response = await worker.fetch(post('tts', { text: '你好', lang: 'zh', avatarId, gender: gender === 'male' ? 'female' : 'male', voice: 'untrusted' }), env(async (_, input) => {
        assert.equal(input.voice_id, voiceId);
        return { state: 'Completed', result: { audio: 'https://ai-gateway-outputs.test.r2.cloudflarestorage.com/test.mp3' } };
      }));
      assert.equal((await response.json()).gender, gender);
    }
    const response = await worker.fetch(post('tts', { text: '你好', gender: 'male' }), env(async () => ({ state: 'Completed', result: { audio: 'https://malicious.test/audio.mp3' } })));
    assert.equal(response.status, 503);
    assert.equal((await worker.fetch(post('tts', { text: '你好', gender: 'unknown' }), env())).status, 400);
  } finally { globalThis.fetch = previousFetch; }
});
