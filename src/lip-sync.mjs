const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

// MeloTTS supplies audio, not phoneme timestamps. These timings are estimates
// constrained by the actual voiced portions of that audio, never ASR text.
export function audioTrack(buffer) {
  const step = .01, count = Math.ceil(buffer.duration / step);
  const levels = new Float32Array(count);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let k = 0; k < count; k++) {
    const a = Math.floor(k * step * buffer.sampleRate);
    const b = Math.min(buffer.length, Math.floor((k + 1) * step * buffer.sampleRate));
    let sum = 0;
    for (const data of channels) for (let i = a; i < b; i++) sum += data[i] ** 2;
    levels[k] = Math.sqrt(sum / Math.max(1, (b - a) * channels.length));
  }
  const peak = levels.reduce((a, b) => Math.max(a, b), 0);
  const threshold = Math.max(.002, peak * .025);
  const spans = [];
  for (let k = 0; k < count; k++) {
    if (levels[k] < threshold) continue;
    const start = Math.max(0, k * step - .02), end = Math.min(buffer.duration, (k + 1) * step + .02);
    const previous = spans.at(-1);
    if (previous && start - previous.end <= .04) previous.end = end;
    else spans.push({ start, end });
  }
  return { step, levels, peak, spans, duration: buffer.duration };
}

export function speechGain(track, time) {
  if (time < 0 || time >= track.duration || !track.peak) return 0;
  const i = Math.floor(time / track.step);
  // A short lookahead permits articulatory anticipation, without keeping the
  // mouth open through real pauses or trailing silence.
  const level = Math.max(track.levels[i] || 0, track.levels[i + 1] || 0);
  return clamp((level / track.peak - .015) / .15);
}

export function alignPlanToAudio(plan, track) {
  const voiced = plan.events.filter(e => e.v !== 'sil' && e.kind !== 'pause');
  const weight = voiced.reduce((n, e) => n + e.d, 0);
  const duration = track.spans.reduce((n, s) => n + s.end - s.start, 0);
  if (!weight || !duration) return false;
  const original = voiced.map(e => ({ ...e }));
  const progressAt = time => {
    let progress = 0;
    for (const e of original) progress += clamp(time - e.t, 0, e.d);
    return clamp(progress / weight);
  };
  // Match written clause breaks with nearby real gaps. Audio energy is not a
  // phoneme recognizer; ambiguous gaps retain proportional voiced-time mapping.
  const gaps = [];
  let accumulated = 0;
  for (let i = 0; i < track.spans.length - 1; i++) {
    accumulated += track.spans[i].end - track.spans[i].start;
    if (track.spans[i + 1].start - track.spans[i].end >= .1) gaps.push(accumulated / duration);
  }
  const anchors = [[0, 0]];
  for (const event of plan.events) {
    if (event.kind !== 'pause' || event.d < .15) continue;
    const progress = progressAt(event.t);
    const previous = anchors.at(-1);
    const candidates = gaps.filter(g => g > previous[1] && Math.abs(g - progress) < .15);
    if (progress > previous[0] && progress < 1 && candidates.length) anchors.push([progress, candidates.reduce((a, b) => Math.abs(a - progress) < Math.abs(b - progress) ? a : b)]);
  }
  anchors.push([1, 1]);
  const map = (time, after = false) => {
    const p = progressAt(time);
    const index = anchors.findIndex((a, i) => i > 0 && p <= a[0]);
    const [a, b] = [anchors[Math.max(0, index - 1)], anchors[Math.max(1, index)]];
    let remaining = (a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0])) * duration;
    for (let i = 0; i < track.spans.length; i++) {
      const span = track.spans[i];
      const length = span.end - span.start;
      if (remaining < length - 1e-6 || (!after && remaining <= length + 1e-6) || i === track.spans.length - 1) return Math.min(span.end, span.start + remaining);
      remaining -= length;
    }
    return track.spans.at(-1).end;
  };
  const pauses = plan.events.filter(e => e.kind === 'pause').map(e => ({ ...e }));
  for (const e of plan.events) { const pause = e.kind === 'pause'; const end = map(e.t + e.d, pause); e.t = map(e.t, !pause); e.d = Math.max(0, end - e.t); }
  for (const c of plan.chars) if (c) { const pause = pauses.some(e => c.t >= e.t && c.t < e.t + e.d); const end = map(c.t + c.d, pause); c.t = map(c.t, !pause); c.d = Math.max(0, end - c.t); }
  for (const s of plan.sentences) { s.t0 = map(s.t0); s.t1 = map(s.t1); }
  plan.beats = plan.beats.map(time => map(time, true));
  plan.dur = track.duration;
  return true;
}

export function captionWindow(plan, time, size = 28) {
  let i = plan.chars.findLastIndex(c => c && c.t <= time);
  if (i < 0) return null;
  const sentence = plan.sentences.find(s => i >= s.i0 && i < s.i1);
  if (!sentence) return null;
  const start = sentence.i0 + Math.floor((i - sentence.i0) / size) * size;
  const end = Math.min(sentence.i1, start + size);
  return { done: plan.clean.slice(start, i + 1), todo: plan.clean.slice(i + 1, end) };
}

export function splitSpeech(text, limit = 90) {
  const tokens = text.match(/\[[a-zA-Z]+\]|[^]/g) || [];
  const out = [];
  let chunk = '', visible = 0;
  for (const token of tokens) {
    if (visible >= limit && !/^\[/.test(token)) { out.push(chunk); chunk = ''; visible = 0; }
    chunk += token;
    if (!/^\[/.test(token)) visible++;
    // Prefer a clause boundary, while keeping short clauses together to avoid
    // an extra cloud request for every comma.
    if (visible >= limit * .55 && /[。！？!?；;，,\n]/.test(token)) { out.push(chunk); chunk = ''; visible = 0; }
  }
  if (chunk) out.push(chunk);
  return out;
}
