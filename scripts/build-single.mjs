// 把源码打成一个自包含的 HTML，用来发布到 claude.ai 的 Artifact 页面。
// Artifact 只允许从 CDN 白名单加载脚本、页面会被套上 <html><body> 骨架，所以这里：
//   - 不写 doctype / html / body，样式和两个模块脚本全部内联
//   - three 走 jsDelivr 的 importmap，pinyin-pro 走 UMD 全局 window.pinyinPro
//   - 当前男女两种卡通 GLB 以 base64 嵌入，页面里的 getBuffer() 会优先读取它
// 输出：dist-single/index.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { AVATAR_PRESETS } from '../src/avatars.mjs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replaceAll('\r\n', '\n');
const must = (ok, msg) => { if (!ok) throw new Error(`build-single: ${msg}`); };

const pkg = JSON.parse(read('package.json'));
const three = pkg.dependencies.three;
const py = pkg.dependencies['pinyin-pro'];
const singleAvatars = AVATAR_PRESETS.filter(av => ['nianian', 'muyan'].includes(av.id));
// The primary demo serves models on demand. Artifact embeds are limited to
// 16 MiB, so keep the first avatar if two high-resolution models do not fit.
const embeddedSize = () => singleAvatars.reduce((n, av) => n + Math.ceil(readFileSync(new URL(`public/${av.model}`, root)).length / 3) * 4, 0);
if (embeddedSize() > 14 * 1024 * 1024) singleAvatars.splice(1);
const singleIds = JSON.stringify(singleAvatars.map(av => av.id));

const html = read('index.html');
const title = html.match(/<title>[\s\S]*?<\/title>/)?.[0];
const desc = html.match(/<meta name="description"[^>]*>/)?.[0];
const links = (html.match(/<link [^>]*>/g) || []).join('\n');
const bodyStart = html.indexOf('<body>') + '<body>'.length;
const bodyEnd = html.indexOf('<script type="module" src="/src/main.js">');
must(title && desc && bodyEnd > bodyStart, 'index.html 结构变了，找不到 title / description / 入口脚本');
const body = html.slice(bodyStart, bodyEnd).trim();

const css = read('src/style.css');
let dh = read('src/digital-human.js');
dh = dh.replace("import { createSSEParser } from './stream.mjs';", read('src/stream.mjs').replace(/export /g, ''));
dh = dh.replace("import { audioTrack, speechGain, alignPlanToAudio, captionWindow, splitSpeech } from './lip-sync.mjs';", read('src/lip-sync.mjs').replace(/export /g, '').replaceAll('const clamp', 'const lipClamp').replaceAll('clamp(', 'lipClamp('));
dh = dh.replace("import { AVATAR_PRESETS } from './avatars.mjs';", read('src/avatars.mjs').replace(/export /g, '') + `\nAVATAR_PRESETS.splice(0, AVATAR_PRESETS.length, ...AVATAR_PRESETS.filter(av => ${singleIds}.includes(av.id)));\n`);
dh = dh.replace("import { voiceGender, voicesFor, pickVoice } from './voices.mjs';", read('src/voices.mjs').replace(/export /g, ''));
dh = dh.replace("import { resolveMorphName, cartoonVowelWeights } from './model-bindings.mjs';", read('src/model-bindings.mjs').replace(/export /g, ''));
dh = dh.replace("import { anatomicalBodyFrame } from './body-frame.mjs';", read('src/body-frame.mjs').replace(/export /g, ''));
const PY_IMPORT = "import * as pinyinPro from 'pinyin-pro';\n";
must(dh.includes(PY_IMPORT) && dh.includes('window.pinyinPro || pinyinPro'), 'digital-human.js 里的 pinyin-pro 引入方式变了');
dh = dh.replace(PY_IMPORT, '').replace('window.pinyinPro || pinyinPro', 'window.pinyinPro');
const face = read('src/face-screen.js');
for (const [name, code] of [['digital-human.js', dh], ['face-screen.js', face]]) must(!code.includes('</script'), `${name} 里出现了 </script，内联会截断`);

const embeddedModels = singleAvatars.map(av => {
  const glb = readFileSync(new URL(`public/${av.model}`, root)).toString('base64');
  return `<script type="application/octet-stream" id="embedded:${av.model}">${glb}</script>`;
}).join('\n');

const out = `${title}
${desc}
${links}
<style>
${css}</style>

${body}

<script src="https://cdn.jsdelivr.net/npm/pinyin-pro@${py}/dist/index.js"></script>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@${three}/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@${three}/examples/jsm/"
  }
}
</script>
<script type="module">
${dh}</script>
<script type="module">
${face}</script>
${embeddedModels}
`;

mkdirSync(new URL('dist-single/', root), { recursive: true });
writeFileSync(new URL('dist-single/index.html', root), out);
const mb = (Buffer.byteLength(out) / 1024 / 1024).toFixed(1);
console.log(`dist-single/index.html  ${mb} MB（${singleAvatars.length} 种形象；Artifact 上限 16 MB）`);
must(Buffer.byteLength(out) < 16 * 1024 * 1024, '模型超过 Artifact 的 16 MB 上限，请改用公开 Worker 版');
