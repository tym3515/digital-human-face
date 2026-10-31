// SSE boundaries can split anywhere, including inside UTF-8 and CRLF delimiters.
export function createSSEParser(onDelta) {
  let buffer = '', ended = false;
  function event(block) {
    if (ended) return;
    const payload = block.split(/\r?\n/).filter(x => x.startsWith('data:')).map(x => x.slice(5).trimStart()).join('\n');
    if (!payload) return;
    if (payload === '[DONE]') { ended = true; return; }
    const data = JSON.parse(payload);
    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : 'AI 回复中断，请重试。');
    const delta = data.delta ?? data.response ?? data.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) onDelta(delta);
  }
  return {
    push(chunk) {
      buffer += chunk;
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        event(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length);
      }
      if (buffer.length > 65536) throw new Error('AI 响应格式异常。');
    },
    finish() { if (buffer.trim()) event(buffer); if (!ended) throw new Error('AI 回复中断，请重新发送。'); },
  };
}
export function visibleReply(text) {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').replace(/^\s*<\/think>\s*/, '').trimStart();
}
