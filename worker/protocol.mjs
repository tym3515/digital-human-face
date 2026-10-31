export class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export async function readBytes(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) throw new RequestError('内容太长，请缩短后重试。', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('请求内容为空。');
  const parts = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RequestError('内容太长，请缩短后重试。', 413); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
export async function readJson(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new RequestError('请发送 JSON 内容。', 415);
  try { return JSON.parse(new TextDecoder().decode(await readBytes(request, 32768))); }
  catch (e) { if (e instanceof RequestError) throw e; throw new RequestError('JSON 格式有误。'); }
}
export function messagesOf(body) {
  if (!Array.isArray(body?.messages) || !body.messages.length || body.messages.length > 16) throw new RequestError('对话消息格式有误。');
  const messages = body.messages.map(m => {
    if (!['user', 'assistant'].includes(m?.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 4000) throw new RequestError('消息为空或太长，请缩短后重试。');
    return { role: m.role, content: m.content.trim() };
  });
  if (messages.at(-1).role !== 'user') throw new RequestError('请先输入你的问题。');
  return messages;
}
export function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
