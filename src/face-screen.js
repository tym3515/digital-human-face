/* ================================================================
   机器人表情屏：读取数字人的实时信号，转成 /face/cmd 消息，
   屏端按「情绪 / 口型 / 视线 / 待机」四层渲染。
   ================================================================ */
function startFace(dh) {
  const q = s => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  const now = () => performance.now() / 1000;
  const DEG = Math.PI / 180;
  const T0 = now();

  /* ---------- 屏端数据：情绪、姿态、口型 ---------- */
  const EMO = {
    neutral:   { zh: '平静', prio: 0, hold: 0,   auto: 0,    kind: 'state' },
    listening: { zh: '倾听', prio: 1, hold: 600, auto: 0,    kind: 'state' },
    thinking:  { zh: '思考', prio: 1, hold: 600, auto: 0,    kind: 'state' },
    sleep:     { zh: '睡眠', prio: 1, hold: 800, auto: 0,    kind: 'state' },
    happy:     { zh: '开心', prio: 2, hold: 800, auto: 2600, kind: 'react' },
    sad:       { zh: '难过', prio: 2, hold: 800, auto: 3000, kind: 'react' },
    surprised: { zh: '惊讶', prio: 2, hold: 600, auto: 1800, kind: 'react' },
    error:     { zh: '故障', prio: 3, hold: 0,   auto: 0,    kind: 'sticky' },
  };
  const POSE = {
    neutral:   { browY: 0,   browRot: 0,     lid: 0.1,  lidTilt: 0,     low: 0,    eyeSY: 1,    eye: 'open',  mouth: 9, blush: 0, fx: 0, tint: 0, faceRot: 0 },
    listening: { browY: -7,  browRot: 0.05,  lid: 0.02, lidTilt: 0,     low: 0,    eyeSY: 1.06, eye: 'open',  mouth: 0, blush: 0, fx: 0, tint: 0, faceRot: 0.07 },
    thinking:  { browY: -4,  browRot: 0,     lid: 0.22, lidTilt: 0.05,  low: 0.1,  eyeSY: 0.96, eye: 'open',  mouth: 7, blush: 0, fx: 1, tint: 0, faceRot: -0.03, browAsym: 1 },
    sleep:     { browY: 8,   browRot: -0.05, lid: 1,    lidTilt: 0,     low: 0,    eyeSY: 1,    eye: 'open',  mouth: 0, blush: 0, fx: 2, tint: 0, faceRot: 0 },
    happy:     { browY: -10, browRot: 0.08,  lid: 0,    lidTilt: 0,     low: 0,    eyeSY: 1,    eye: 'arc',   mouth: 5, blush: 1, fx: 0, tint: 0, faceRot: 0 },
    sad:       { browY: 4,   browRot: 0.34,  lid: 0.34, lidTilt: -0.55, low: 0,    eyeSY: 0.94, eye: 'open',  mouth: 6, blush: 0, fx: 0, tint: 0, faceRot: 0 },
    surprised: { browY: -24, browRot: 0.02,  lid: 0,    lidTilt: 0,     low: 0,    eyeSY: 1.14, eye: 'open',  mouth: 4, blush: 0, fx: 0, tint: 0, faceRot: 0 },
    error:     { browY: -2,  browRot: -0.2,  lid: 0,    lidTilt: 0,     low: 0,    eyeSY: 1,    eye: 'cross', mouth: 8, blush: 0, fx: 3, tint: 1, faceRot: 0 },
  };
  const MOUTHS = [
    [0, 'closed', '闭合', 'PP、sil、倾听'], [1, 'small', '微张', 'FF TH DD kk CH nn'], [2, 'e', '扁宽', 'E I SS'], [3, 'a', '大开', 'aa'],
    [4, 'o', '圆', 'O U RR、惊讶'], [5, 'smile', '开口笑', 'happy'], [6, 'frown', '下垂', 'sad'], [7, 'side', '撇嘴', 'thinking'],
    [8, 'wave', '波浪', 'error'], [9, 'soft', '浅笑', 'neutral'],
  ];
  // 15 个 Oculus viseme（和数字人、Azure 等 TTS 输出一致）→ mouth 插槽 display
  const VIS_MOUTH = { sil: 0, PP: 0, FF: 1, TH: 1, DD: 1, kk: 1, CH: 1, SS: 2, nn: 1, RR: 4, aa: 3, E: 2, I: 2, O: 4, U: 4 };
  const VIS_ROWS = [['aa', '3 大开'], ['E · I · SS', '2 扁宽'], ['O · U · RR', '4 圆'], ['PP · sil', '0 闭合'], ['FF · TH · DD · kk · CH · nn', '1 微张']];

  // 数字人信号 → 表情屏情绪
  const EXPR_FACE = { smile: 'happy', surprise: 'surprised', frown: 'sad', doubt: 'thinking' };
  const STATE_FACE = { idle: 'neutral', listening: 'listening', thinking: 'thinking' };
  const EXPR_ZH = { smile: '微笑', surprise: '惊讶', frown: '不满', doubt: '疑惑', neutral: '平静' };
  const GEST_ZH = { wave: '挥手', explain: '讲解', shrug: '耸肩', point: '指向', bow: '鞠躬', nod: '点头', shake: '摇头' };

  /* ---------- 接口约定（表格和复制内容共用） ---------- */
  const MAP_ROWS = [
    ['状态 idle / listening / thinking', '{"type":"face","name":"neutral"}（或 listening / thinking）', '状态切换时'],
    ['表情标签 [smile] [surprise] [frown] [doubt]', 'face：happy / surprised / sad / thinking', '按标签时间提前 lead_ms 发送'],
    ['开始说话 / 说完', '{"type":"speech","state":"start"}（或 stop）', '每段话'],
    ['当前口型：15 个 viseme 取权重最大者', '{"type":"speech","viseme":"aa"}', '变化时发送，不超过 30 Hz'],
    ['眼球朝向：yaw ±30°、pitch ±20° 归一化', '{"type":"gaze","x":-0.4,"y":0.1,"present":true}', '30 Hz；数字人没在看人时 present=false'],
    ['眨眼、呼吸', '不发送', '屏端待机层本地生成'],
  ];
  const HW_RULES = [
    '传输：ROS 2 话题 /face/cmd（std_msgs/String，内容为 JSON），或同样的 JSON 走 WebSocket',
    '屏端从收到消息到画面变化，目标在 100 ms 以内；表情事件按 lead_ms 提前发出',
    '口型统一用 15 个 Oculus viseme 名，和 Azure 等 TTS 的 viseme 输出一致，屏端再映射到 mouth 插槽',
    '屏端每秒回报一次 state，主控超过 3 秒收不到就当屏幕离线',
  ];
  const MSGS = [
    ['face', '主控 → 屏', '事件', '{"type":"face","name":"happy"}', '可带 hold_ms 覆盖默认保持；clear 解除故障'],
    ['speech start / stop', '数字人 → 屏', '每段话', '{"type":"speech","state":"start"}', 'stop 之后嘴型交还情绪层'],
    ['speech viseme', '数字人 → 屏', '≤ 30 Hz', '{"type":"speech","viseme":"aa"}', '口型变化时发送'],
    ['speech visemes', 'TTS → 屏', '每句一次', '{"type":"speech","visemes":[{"t":0,"v":"nn"},{"t":90,"v":"I"}]}', '可选：TTS 返回时间表时一次下发，屏端按本地时钟播放，播完自动 stop'],
    ['gaze', '视觉 → 屏', '30 Hz', '{"type":"gaze","x":0.31,"y":-0.12,"present":true}', '按摄像头原始画面归一化到 −1…1，x 向右、y 向下为正；屏端把 x 取反'],
    ['state', '屏 → 主控', '1 Hz', '{"type":"state","emotion":"happy","speaking":false,"fps":30}', '心跳'],
  ];
  const PRIOS = [
    ['error 故障', '3', '—', '一直保持，只接受 clear'],
    ['happy 开心 · sad 难过 · surprised 惊讶', '2', '600–800 ms', '1.8–3 s 后自动回落到基础状态'],
    ['listening 倾听 · thinking 思考 · sleep 睡眠', '1', '600–800 ms', '持续到下一个事件，同时成为回落目标'],
    ['neutral 平静', '0', '—', '默认基础状态'],
  ];
  const ART_RULES = [
    '画布 480 × 480（圆屏），安全区直径 440；横屏版本 800 × 480，脸居中不拉伸',
    '30 fps 制作；导出 DragonBones JSON，版本不高于 5.6.3（Cocos Creator 3.8 能读的上限）',
    '命名全小写加下划线。左右以机器人自身为准：eye_L 在观众看来位于屏幕右侧',
    '情绪动画不要 key pupil_* 和 blink_*，视线和眨眼由程序负责',
    '每个情绪动画第一帧从 neutral 姿态出发，末帧就是保持姿态',
  ];
  const BONES = [
    ['root', '骨骼', '待机层', 'idle 动画只 key 它，做呼吸起伏'],
    ['face', '骨骼', '情绪层', '挂在 root 下，情绪动画可 key 旋转（倾听歪头）'],
    ['eye_L / eye_R', '骨骼 + 插槽', '情绪层', '插槽 display：0 睁眼、1 笑眼、2 故障叉'],
    ['pupil_L / pupil_R', '骨骼', '视线层', '程序每帧写 offset，动画不要 key'],
    ['lid_* / lowlid_*', '骨骼', '情绪层', '上下眼睑，key 位置和旋转'],
    ['blink_L / blink_R', '骨骼', '待机层', '眨眼专用遮挡，和 lid 分开所以不冲突'],
    ['brow_L / brow_R', '骨骼', '情绪层', '眉毛位置和旋转'],
    ['mouth', '插槽', '情绪层 · 口型层', 'display 顺序见下表；说话时口型层接管'],
    ['blush / fx', '插槽', '情绪层', '腮红透明度；fx：0 空、1 思考点、2 睡眠 Z、3 故障感叹号'],
  ];
  const ANIMS = [
    ['idle', '0 · base', '循环', 'root', '4.2 s 一个呼吸周期'],
    ['blink', '1 · blink', '单次', 'blink_L, blink_R', '0.18 s；每 2–6 s 随机触发，约 18% 连眨'],
    ['emo_<名称>', '2 · emotion', '单次，停在末帧', 'face, eye_*, lid_*, brow_*, mouth, blush, fx', '淡入 0.25 s'],
  ];

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  function fillTable(id, head, rows, codeCols = []) {
    q(id).innerHTML = '<thead><tr>' + head.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + r.map((c, i) => codeCols.includes(i) ? `<td><code>${esc(c)}</code></td>` : `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</tbody>';
  }
  function fillList(id, items) {
    q(id).innerHTML = items.map(([title, code, note]) => `<div class="spec-item"><b>${esc(title)}</b>${code ? `<code>${esc(code)}</code>` : ''}${note ? `<span>${esc(note)}</span>` : ''}</div>`).join('');
  }
  fillList('#tMap', MAP_ROWS);
  q('#hwRules').innerHTML = HW_RULES.map(r => `<li>${esc(r)}</li>`).join('');
  fillList('#tMsgs', MSGS.map(r => [`${r[0]} · ${r[1]} · ${r[2]}`, r[3], r[4]]));
  fillTable('#tPrios', ['情绪', '优先级', '最短保持', '结束方式'], PRIOS);
  fillTable('#tVis', ['viseme', 'mouth display'], VIS_ROWS, [0]);
  q('#artRules').innerHTML = ART_RULES.map(r => `<li>${esc(r)}</li>`).join('');
  fillTable('#tBones', ['骨骼 / 插槽', '类型', '图层', '说明'], BONES, [0]);
  fillList('#tAnims', ANIMS.map(r => [`${r[0]} · layer ${r[1]} · ${r[2]}`, `允许 key：${r[3]}`, r[4]]));
  fillTable('#tMouths', ['index', 'display 名', '形状', '用于'], MOUTHS, [1]);

  function specMarkdown() {
    const tbl = (head, rows) => ['| ' + head.join(' | ') + ' |', '|' + head.map(() => ' --- ').join('|') + '|',
      ...rows.map(r => '| ' + r.map(c => String(c).replace(/\|/g, '\\|')).join(' | ') + ' |')].join('\n');
    return ['# 数字人 → 机器人表情屏 接口约定', '',
      '表情屏四层：情绪层（机器人事件）、口型层（viseme）、视线层（人脸 / 注视）、待机层（本地定时器），上层按骨骼遮罩覆盖下层。', '',
      '## 数字人信号 → 表情屏消息', tbl(['数字人信号', '发给表情屏', '时机'], MAP_ROWS), '',
      '## 消息', ...HW_RULES.map(r => '- ' + r), '', tbl(['消息', '方向', '频率', '示例', '说明'], MSGS.map(r => [r[0], r[1], r[2], '`' + r[3] + '`', r[4]])), '',
      '## 情绪优先级', tbl(['情绪', '优先级', '最短保持', '结束方式'], PRIOS), '',
      '## viseme 到 mouth 插槽', tbl(['viseme', 'mouth display'], VIS_ROWS), '',
      '## 给美术：DragonBones 资源规范', ...ART_RULES.map(r => '- ' + r), '',
      tbl(['骨骼 / 插槽', '类型', '图层', '说明'], BONES), '', tbl(['动画', 'layer · 组', '播放', '允许 key 的骨骼', '说明'], ANIMS), '',
      tbl(['index', 'display 名', '形状', '用于'], MOUTHS), ''].join('\n');
  }
  q('#copySpec').addEventListener('click', () => {
    const b = q('#copySpec');
    const done = ok => { b.textContent = ok ? '已复制' : '复制失败，请手动选中表格'; setTimeout(() => (b.textContent = '复制接口约定（Markdown）'), 1800); };
    try { navigator.clipboard.writeText(specMarkdown()).then(() => done(true), () => done(false)); } catch (e) { done(false); }
  });

  /* ---------- 屏端状态 ---------- */
  const S = {
    emo: 'neutral', prev: 'neutral', emoT: now() - 1, fade: 0.25, base: 'neutral', autoAt: null,
    speaking: false, mouthIdx: 0, vis: 'sil', visemes: null, visT0: 0,
    gaze: { x: 0, y: 0, present: true }, pupil: { x: 0, y: 0 }, sacc: { x: 0, y: 0, next: 0 },
    blinks: [], nextBlink: now() + 1.5, shape: 'round', ovBones: false, lead: 0.08,
  };

  /* ---------- 日志 ---------- */
  const logEl = q('#flog');
  const lastLog = {};
  function log(msg, res, src) {
    const quiet = msg.type === 'gaze' || msg.viseme !== undefined;
    const key = msg.type + (msg.viseme !== undefined ? 'V' : '');
    const t = now();
    if (quiet && res.ok && lastLog[key] && t - lastLog[key] < 0.3) return;
    lastLog[key] = t;
    const d = document.createElement('div');
    const tag = src === 'screen' ? ['屏端', 'sys'] : res.ok ? ['执行', ''] : ['忽略', 'ig'];
    d.innerHTML = `<time>${(t - T0).toFixed(1)}s</time><span class="tag ${tag[1]}">${tag[0]}</span><code></code>${res.note ? '<em></em>' : ''}`;
    d.querySelector('code').textContent = JSON.stringify(msg);
    if (res.note) d.querySelector('em').textContent = res.note;
    logEl.prepend(d);
    while (logEl.children.length > 60) logEl.lastChild.remove();
  }

  /* ---------- 屏端消息处理 ---------- */
  function setEmo(name) {
    S.prev = S.emo; S.emo = name; S.emoT = now();
    const e = EMO[name];
    if (e.kind === 'state') S.base = name;
    S.autoAt = e.auto ? now() + e.auto / 1000 : null;
    document.querySelectorAll('[data-fev]').forEach(b => b.setAttribute('aria-current', b.dataset.fev === S.emo));
  }
  function handle(msg) {
    const t = now();
    if (msg.type === 'face') {
      const name = msg.name;
      if (name === 'clear') {
        if (S.emo !== 'error') return { ok: false, note: '当前没有故障' };
        setEmo(S.base); return { ok: true, note: `故障解除，回到「${EMO[S.base].zh}」` };
      }
      const nx = EMO[name];
      if (!nx) return { ok: false, note: '未知的情绪名' };
      // 状态类消息（平静 / 倾听 / 思考 / 睡眠）即使暂时盖不过当前表情，也要记成回落目标，否则会丢状态
      if (S.emo === 'error') {
        if (nx.kind === 'state') { S.base = name; return { ok: false, note: `故障未清除，只接受 clear；清除后回到「${nx.zh}」` }; }
        return { ok: false, note: '故障未清除，只接受 clear' };
      }
      const cur = EMO[S.emo], held = (t - S.emoT) * 1000;
      if (nx.prio < cur.prio && held < cur.hold) {
        if (nx.kind === 'state') { S.base = name; return { ok: true, note: `「${cur.zh}」还在最短保持内，记为回落目标，之后回到「${nx.zh}」` }; }
        return { ok: false, note: `优先级低于「${cur.zh}」，且当前表情还没到 ${cur.hold} ms 最短保持` };
      }
      if (name === S.emo) { if (nx.auto) S.autoAt = t + (msg.hold_ms || nx.auto) / 1000; return { ok: true, note: '同一表情，刷新保持时间' }; }
      setEmo(name);
      if (msg.hold_ms && nx.auto) S.autoAt = t + msg.hold_ms / 1000;
      return { ok: true, note: nx.kind === 'react' ? `${(msg.hold_ms || nx.auto) / 1000} s 后回落到「${EMO[S.base].zh}」` : '' };
    }
    if (msg.type === 'speech') {
      if (msg.state === 'start') { S.speaking = true; S.visemes = null; S.vis = 'sil'; S.mouthIdx = 0; return { ok: true }; }
      if (msg.state === 'stop') { S.speaking = false; S.visemes = null; return { ok: true, note: '嘴型交还情绪层' }; }
      if (msg.viseme !== undefined) {
        if (!S.speaking) return { ok: false, note: '还没收到 start' };
        S.vis = msg.viseme; S.mouthIdx = VIS_MOUTH[msg.viseme] ?? 1; return { ok: true };
      }
      if (Array.isArray(msg.visemes)) { S.speaking = true; S.visemes = msg.visemes; S.visT0 = t; return { ok: true, note: `${msg.visemes.length} 个 viseme，播完自动 stop` }; }
    }
    if (msg.type === 'gaze') {
      S.gaze.x = clamp(+msg.x, -1, 1); S.gaze.y = clamp(+msg.y, -1, 1); S.gaze.present = !!msg.present;
      return { ok: true };
    }
    return { ok: false, note: '未知消息' };
  }
  function send(msg) { const r = handle(msg); log(msg, r); return r; }

  /* ---------- 桥：数字人信号 → 消息 ---------- */
  const B = { lastState: 'idle', lastExpr: 'neutral', preSent: null, speaking: false, vis: 'sil', visT: 0, gx: 9, gy: 9, gp: null, gT: 0, tagsRef: null, fired: new Set(), dur: 0 };
  const seqEl = q('#seq'), seqEmpty = q('#seqEmpty'), seqPh = q('#seqPh');
  function buildSeq(sig) {
    seqEl.querySelectorAll('.mk').forEach(m => m.remove());
    B.dur = sig.dur;
    const tags = sig.tags || [];
    seqEmpty.hidden = tags.length > 0;
    if (!tags.length) { seqEmpty.textContent = '这段话没有标签。试试「播放联动示例」，或在「说话」里加 [smile] [wave] 这类标签'; return; }
    tags.forEach((tg, i) => {
      const m = document.createElement('span');
      const isFace = tg.name in EXPR_ZH;
      m.className = 'mk' + (isFace ? '' : ' g');
      m.id = 'fmk' + i;
      m.style.left = (clamp(tg.t / Math.max(0.1, sig.dur), 0, 0.92) * 100).toFixed(2) + '%';
      m.textContent = isFace ? `${EXPR_ZH[tg.name]}${EXPR_FACE[tg.name] ? ' → ' + EMO[EXPR_FACE[tg.name]].zh : ''}` : GEST_ZH[tg.name] || tg.name;
      m.title = `${tg.t.toFixed(2)} s · [${tg.name}]`;
      seqEl.appendChild(m);
    });
  }
  function bridge(t) {
    const sig = dh._signals();

    // 1. 标签：按这段话的时钟，提前 lead 发表情事件
    if (sig.tags !== B.tagsRef) { B.tagsRef = sig.tags; B.fired = new Set(); if (sig.tags && sig.tags.length || sig.speaking) buildSeq(sig); }
    if (sig.tt >= 0 && sig.tags) {
      sig.tags.forEach((tg, i) => {
        if (B.fired.has(i) || sig.tt < tg.t - S.lead) return;
        B.fired.add(i);
        const mk = q('#fmk' + i); if (mk) mk.classList.add('fired');
        const f = EXPR_FACE[tg.name] || (tg.name === 'neutral' ? STATE_FACE[sig.userState] : null);
        if (f) { send({ type: 'face', name: f }); if (tg.name !== B.lastExpr) B.preSent = tg.name; }
      });
    }
    if (sig.speaking && B.dur > 0 && sig.tt >= 0) seqPh.style.left = clamp(sig.tt / B.dur, 0, 1) * 100 + '%';

    // 2. 状态和表情分两路发：状态是回落目标，表情是一次性反应
    const stateFace = STATE_FACE[sig.userState] || 'neutral';
    if (sig.userState !== B.lastState) { B.lastState = sig.userState; send({ type: 'face', name: stateFace }); }
    if (sig.expr !== B.lastExpr) {
      B.lastExpr = sig.expr;
      if (B.preSent !== sig.expr) send({ type: 'face', name: EXPR_FACE[sig.expr] || stateFace });   // 标签已经提前发过的不重复
      B.preSent = null;
    }

    // 3. 说话开始 / 结束、口型
    if (sig.speaking && !B.speaking) { send({ type: 'speech', state: 'start' }); B.vis = 'sil'; }
    if (!sig.speaking && B.speaking) send({ type: 'speech', state: 'stop' });
    B.speaking = sig.speaking;
    if (sig.speaking && t - B.visT >= 1 / 30) {
      let top = 0; for (let i = 1; i < 15; i++) if (sig.visW[i] > sig.visW[top]) top = i;
      const v = sig.visW[top] > 0.2 ? sig.visNames[top] : 'sil';
      if (v !== B.vis) { B.vis = v; B.visT = t; send({ type: 'speech', viseme: v }); }
    }

    // 4. 视线：数字人眼球朝向 → 摄像头画面坐标（x 与观众方向相反，屏端再取反）
    if (t - B.gT >= 1 / 30) {
      const x = +clamp(-sig.gazeYaw / (30 * DEG), -1, 1).toFixed(2), y = +clamp(-sig.gazePitch / (20 * DEG), -1, 1).toFixed(2);
      if (Math.abs(x - B.gx) > 0.015 || Math.abs(y - B.gy) > 0.015 || sig.present !== B.gp) {
        B.gx = x; B.gy = y; B.gp = sig.present; B.gT = t;
        send({ type: 'gaze', x, y, present: sig.present });
      }
    }
    return sig;
  }

  /* ---------- 控件 ---------- */
  document.querySelectorAll('[data-fev]').forEach(b => b.addEventListener('click', () => send({ type: 'face', name: b.dataset.fev })));
  const pip = q('#facePip');
  function setShape(s) {
    S.shape = s; pip.classList.toggle('wide', s === 'wide');
    document.querySelectorAll('[data-shape]').forEach(x => x.setAttribute('aria-pressed', x.dataset.shape === s));
  }
  document.querySelectorAll('[data-shape]').forEach(b => b.addEventListener('click', () => setShape(b.dataset.shape)));
  q('#tPip').addEventListener('change', e => { pip.hidden = !e.target.checked; });
  q('#tBones').addEventListener('change', e => { S.ovBones = e.target.checked; });
  q('#lead').addEventListener('input', e => { S.lead = e.target.value / 1000; q('#leadOut').textContent = e.target.value + ' ms'; });
  const DEMO = '[wave]你好，我是小夏。[smile]我说话时，口型、表情和视线会同时发给机器人的表情屏。[surprise]你看，屏幕上的脸也跟着变了。[explain]同一套信号，驱动两种形态。';
  q('#bLinkDemo').addEventListener('click', () => {
    const ta = document.getElementById('sayText');
    ta.value = DEMO; ta.dataset.touched = '1';
    dh.stop();
    document.getElementById('bSay').click();
  });

  /* ---------- 每帧：四层合成 ---------- */
  const NUM_KEYS = ['browY', 'browRot', 'lid', 'lidTilt', 'low', 'eyeSY', 'blush', 'tint', 'faceRot', 'browAsym'];
  const poseOf = n => ({ browAsym: 0, ...POSE[n] });
  const status = { emotion: '', mouth: '', gaze: '', idle: '', on: { emotion: 1, mouth: 0, gaze: 0, idle: 1 } };
  function computePose(t, dt) {
    const P = poseOf('neutral');
    P.faceY = 0; P.px = 0; P.py = 0; P.blink = 0;
    // 情绪层
    const w = smooth(clamp((t - S.emoT) / S.fade, 0, 1));
    const a = poseOf(S.prev), b = poseOf(S.emo);
    for (const k of NUM_KEYS) P[k] = lerp(a[k], b[k], w);
    P.eye = w < 0.5 ? a.eye : b.eye; P.mouth = w < 0.5 ? a.mouth : b.mouth; P.fx = w < 0.5 ? a.fx : b.fx;
    const left = S.autoAt ? Math.max(0, S.autoAt - t) : null;
    status.emotion = `${EMO[S.emo].zh} ${S.emo} · P${EMO[S.emo].prio}` + (left !== null ? ` · ${left.toFixed(1)} s 后回落「${EMO[S.base].zh}」` : S.emo === 'error' ? ' · 等待 clear' : '');
    // 待机层（屏端本地）
    const slow = S.emo === 'sleep' ? 1.7 : 1, ph = (t / (4.2 * slow)) % 1;
    P.faceY = Math.sin(ph * Math.PI * 2) * 3.2;
    P.eyeSY *= 1 + Math.sin(ph * Math.PI * 2) * 0.012;
    if (t >= S.nextBlink && S.emo !== 'sleep') { S.blinks.push(t); if (Math.random() < 0.18) S.blinks.push(t + 0.27); S.nextBlink = t + 2.2 + Math.random() * 3.6; }
    S.blinks = S.blinks.filter(x => t - x < 0.2);
    for (const x of S.blinks) { const d = (t - x) / 0.18; if (d >= 0 && d <= 1) P.blink = Math.max(P.blink, Math.sin(d * Math.PI)); }
    status.idle = `呼吸 ${(ph * 4.2 * slow).toFixed(1)} / ${(4.2 * slow).toFixed(1)} s · ` + (S.emo === 'sleep' ? '睡眠中不眨眼' : `下次眨眼 ${Math.max(0, S.nextBlink - t).toFixed(1)} s`);
    // 口型层
    if (S.speaking && S.visemes) {
      const ms = (t - S.visT0) * 1000; let cur = S.visemes[0];
      for (const v of S.visemes) if (v.t <= ms) cur = v;
      if (ms > S.visemes[S.visemes.length - 1].t + 150) { S.speaking = false; S.visemes = null; log({ type: 'speech', state: 'stop' }, { ok: true, note: '时间表播完，屏端自动 stop' }, 'screen'); }
      else { S.vis = cur.v; S.mouthIdx = VIS_MOUTH[cur.v] ?? 1; }
    }
    if (S.speaking) { P.mouth = S.mouthIdx; status.mouth = `viseme ${S.vis} → display ${S.mouthIdx} ${MOUTHS[S.mouthIdx][2]}`; status.on.mouth = 1; }
    else { status.mouth = `未说话 · 嘴型由情绪层给出（${MOUTHS[P.mouth][2]}）`; status.on.mouth = 0; }
    // 视线层
    let tx, ty, k;
    if (S.gaze.present) {
      const dz = v => (Math.abs(v) < 0.04 ? 0 : v);
      tx = -dz(S.gaze.x) * 24; ty = dz(S.gaze.y) * 18; k = 12;
    } else {
      if (t >= S.sacc.next) { S.sacc.x = (Math.random() * 2 - 1) * 16; S.sacc.y = (Math.random() * 2 - 1) * 10; S.sacc.next = t + 1.2 + Math.random() * 2.6; }
      tx = S.sacc.x; ty = S.sacc.y; k = 26;
    }
    const al = 1 - Math.exp(-dt * k);
    S.pupil.x += (tx - S.pupil.x) * al; S.pupil.y += (ty - S.pupil.y) * al;
    P.px = S.pupil.x; P.py = S.pupil.y;
    status.gaze = `瞳孔 (${P.px.toFixed(1)}, ${P.py.toFixed(1)}) px · ` + (S.gaze.present ? '跟随数字人视线' : '无注视对象，随机扫视');
    status.on.gaze = S.gaze.present ? 1 : 0;
    return P;
  }

  /* ---------- 绘制 ---------- */
  const cv = q('#face'), ctx = cv.getContext('2d');
  const COL = { bg: '#04070A', iris: [143, 221, 255], amber: [255, 181, 71], pupil: '#062130', blush: 'rgba(255,128,170,' };
  const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
  const EYE = { x: 96, y: -30, w: 116, h: 132, r: 48 };
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function drawEye(side, P, color) {
    const cx = side * EYE.x + P.px * 0.28, cy = EYE.y + P.faceY + P.py * 0.2;
    const h = EYE.h * P.eyeSY, w = EYE.w;
    ctx.save(); ctx.translate(cx, cy);
    if (P.eye === 'arc') {
      ctx.strokeStyle = color; ctx.lineWidth = 18; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-w / 2 + 14, 16); ctx.quadraticCurveTo(0, -46, w / 2 - 14, 16); ctx.stroke();
      ctx.restore(); return;
    }
    if (P.eye === 'cross') {
      ctx.strokeStyle = color; ctx.lineWidth = 18; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-36, -36); ctx.lineTo(36, 36); ctx.moveTo(36, -36); ctx.lineTo(-36, 36); ctx.stroke();
      ctx.restore(); return;
    }
    rr(-w / 2, -h / 2, w, h, EYE.r); ctx.save(); ctx.clip();
    ctx.fillStyle = color; ctx.fillRect(-w / 2, -h / 2, w, h);
    const px = P.px, py = P.py;
    ctx.fillStyle = COL.pupil; ctx.beginPath(); ctx.arc(px, py, 31, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(px - 11, py - 13, 10, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 12, py + 11, 4, 0, Math.PI * 2); ctx.fill();
    const close = Math.max(P.lid, P.blink);
    const lineY = -h / 2 + close * (h + 4);
    const tilt = P.lidTilt * 34 * (close < 0.98 ? 1 : 0);
    const innerX = -side * w / 2, outerX = side * w / 2;
    ctx.fillStyle = COL.bg; ctx.beginPath();
    ctx.moveTo(innerX, -h / 2 - 60); ctx.lineTo(outerX, -h / 2 - 60);
    ctx.lineTo(outerX, lineY - tilt); ctx.lineTo(innerX, lineY + tilt); ctx.closePath(); ctx.fill();
    if (P.low > 0.001) {
      const ly = h / 2 - P.low * h * 0.55;
      ctx.beginPath(); ctx.moveTo(-w / 2 - 2, h / 2 + 40); ctx.lineTo(-w / 2 - 2, ly + 14); ctx.quadraticCurveTo(0, ly - 14, w / 2 + 2, ly + 14); ctx.lineTo(w / 2 + 2, h / 2 + 40); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    const shut = clamp((close - 0.85) / 0.15, 0, 1);
    if (shut > 0) {
      ctx.globalAlpha = shut; ctx.strokeStyle = color; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-w / 2 + 12, h * 0.3); ctx.quadraticCurveTo(0, h * 0.3 + 16, w / 2 - 12, h * 0.3); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  function drawBrow(side, P, color) {
    const cx = side * EYE.x, cy = EYE.y - EYE.h / 2 - 34 + P.faceY + P.browY + (P.browAsym ? (side > 0 ? -12 : 5) * P.browAsym : 0);
    const rot = P.browRot + (P.browAsym ? (side > 0 ? 0.12 : -0.06) * P.browAsym : 0);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(side * rot);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.8; ctx.lineWidth = 12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(40, 0); ctx.stroke();
    ctx.restore();
  }
  function drawMouth(P, color) {
    ctx.save(); ctx.translate(0, 118 + P.faceY * 0.6);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    switch (P.mouth) {
      case 0: ctx.moveTo(-32, 0); ctx.lineTo(32, 0); ctx.stroke(); break;
      case 1: ctx.ellipse(0, 0, 20, 11, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 2: ctx.roundRect(-44, -13, 88, 26, 13); ctx.fill(); break;
      case 3: ctx.ellipse(0, 4, 40, 32, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = COL.bg; ctx.beginPath(); ctx.ellipse(0, 22, 18, 8, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 4: ctx.ellipse(0, 2, 22, 28, 0, 0, Math.PI * 2); ctx.lineWidth = 11; ctx.stroke(); break;
      case 5: ctx.moveTo(-62, -14); ctx.quadraticCurveTo(0, 74, 62, -14); ctx.closePath(); ctx.fill(); break;
      case 6: ctx.moveTo(-42, 16); ctx.quadraticCurveTo(0, -18, 42, 16); ctx.stroke(); break;
      case 7: ctx.moveTo(-10, 2); ctx.quadraticCurveTo(14, -2, 38, -12); ctx.stroke(); break;
      case 8: ctx.moveTo(-48, 0); for (let i = 0; i < 6; i++) ctx.lineTo(-48 + (i + 1) * 16, i % 2 ? 0 : -12); ctx.lineWidth = 8; ctx.stroke(); break;
      default: ctx.moveTo(-40, -3); ctx.quadraticCurveTo(0, 14, 40, -3); ctx.stroke();
    }
    ctx.restore();
  }
  function drawFx(P, color, t) {
    ctx.save(); ctx.fillStyle = color;
    if (P.fx === 1) {
      for (let i = 0; i < 3; i++) { ctx.globalAlpha = 0.35 + 0.65 * ((Math.sin(t * 5 - i * 0.9) + 1) / 2); ctx.beginPath(); ctx.arc(110 + i * 22, -150 - i * 6, 7 + i * 1.5, 0, Math.PI * 2); ctx.fill(); }
    } else if (P.fx === 2) {
      for (let i = 0; i < 3; i++) { const p = ((t * 0.45) + i / 3) % 1; ctx.globalAlpha = Math.sin(p * Math.PI); ctx.font = `600 ${20 + i * 6}px "IBM Plex Sans", sans-serif`; ctx.fillText('Z', 96 + p * 34 + i * 6, -110 - p * 60); }
    } else if (P.fx === 3) {
      ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(t * 4));
      ctx.beginPath(); ctx.moveTo(0, -212); ctx.lineTo(26, -170); ctx.lineTo(-26, -170); ctx.closePath(); ctx.fill();
      ctx.fillStyle = COL.bg; ctx.fillRect(-3, -200, 6, 18); ctx.fillRect(-3, -178, 6, 5);
    }
    ctx.restore();
  }
  function drawBones(P, sc) {
    if (!S.ovBones) return;
    const px = 1 / sc;
    const pts = [
      ['root', 0, 200 + P.faceY], ['face', 0, 40 + P.faceY],
      ['eye_L', EYE.x, EYE.y + P.faceY], ['eye_R', -EYE.x, EYE.y + P.faceY],
      ['pupil_L', EYE.x + P.px * 1.28, EYE.y + P.py * 1.2 + P.faceY], ['pupil_R', -EYE.x + P.px * 1.28, EYE.y + P.py * 1.2 + P.faceY],
      ['brow_L', EYE.x, EYE.y - EYE.h / 2 - 34 + P.browY + P.faceY], ['brow_R', -EYE.x, EYE.y - EYE.h / 2 - 34 + P.browY + P.faceY],
      ['mouth', 0, 118 + P.faceY], ['blush', 150, 54 + P.faceY], ['fx', 150, -176],
    ];
    ctx.save();
    ctx.font = `${13 * px}px "IBM Plex Mono", monospace`;
    for (const [n, x, y] of pts) {
      ctx.fillStyle = 'rgba(255,200,90,.95)'; ctx.beginPath(); ctx.arc(x, y, 4 * px, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(4,7,10,.85)'; ctx.lineWidth = 3 * px; ctx.strokeText(n, x + 7 * px, y - 6 * px); ctx.fillText(n, x + 7 * px, y - 6 * px);
    }
    ctx.restore();
  }
  function draw(P, t) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = cv.clientWidth, ch = cv.clientHeight;
    if (!cw || pip.hidden) return;
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const design = S.shape === 'round' ? 480 : 800;
    const sc = cw / design;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(sc * dpr, 0, 0, sc * dpr, W / 2, H / 2);
    const color = mix(COL.iris, COL.amber, P.tint);
    ctx.save(); ctx.rotate(P.faceRot);
    if (P.blush > 0.01) {
      ctx.fillStyle = COL.blush + (P.blush * 0.42).toFixed(3) + ')';
      for (const s of [1, -1]) { ctx.beginPath(); ctx.ellipse(s * 150, 54 + P.faceY, 34, 15, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    drawEye(1, P, color); drawEye(-1, P, color);
    drawBrow(1, P, color); drawBrow(-1, P, color);
    drawMouth(P, color);
    ctx.restore();
    drawFx(P, color, t);
    drawBones(P, sc);
  }

  /* ---------- 主循环 ---------- */
  const L = ['emotion', 'mouth', 'gaze', 'idle'].map(k => ({ k, v: q('#fl-' + k), i: q('#fi-' + k) }));
  let last = now(), lastUi = 0, lastState = 0;
  function tick() {
    const t = now(), dt = Math.min(0.1, t - last); last = t;
    let sig = null;
    try { sig = bridge(t); } catch (e) { console.error(e); }
    if (S.autoAt && t >= S.autoAt && S.emo !== 'error') {
      log({ type: 'face', name: S.base }, { ok: true, note: `「${EMO[S.emo].zh}」保持时间到，自动回落` }, 'screen');
      setEmo(S.base);
    }
    const P = computePose(t, dt);
    draw(P, t);
    if (t - lastUi > 0.1) {
      lastUi = t;
      for (const l of L) { l.v.textContent = status[l.k]; l.i.classList.toggle('on', !!status.on[l.k]); }
      q('#faceSum').textContent = `${EMO[S.emo].zh}${S.speaking ? ' · 说话中' : ''}`;
    }
    if (t - lastState > 5) { lastState = t; log({ type: 'state', emotion: S.emo, speaking: S.speaking, fps: 30 }, { ok: true, note: '心跳（真实为 1 Hz，这里每 5 s 记一条）' }, 'screen'); }
    requestAnimationFrame(tick);
  }
  window.faceScreen = { send, state: () => ({ emo: S.emo, base: S.base, speaking: S.speaking, vis: S.vis, mouth: S.mouthIdx, gaze: { ...S.gaze }, pupil: { ...S.pupil } }) };
  requestAnimationFrame(tick);
}

(function wait(n) {
  if (window.digitalHuman && window.digitalHuman._signals) return startFace(window.digitalHuman);
  if (n > 200) { console.warn('数字人模块没有就绪，表情屏未启动'); return; }
  setTimeout(() => wait(n + 1), 50);
})(0);
