// SpeechSynthesisVoice does not expose gender. Only known voice names and
// explicit gender labels are eligible; an unknown voice is never guessed.
const femaleNames = ['xiaoxiao', 'xiaoyi', 'xiaohan', 'xiaomo', 'xiaoxuan', 'xiaorui', 'xiaoshuang', 'xiaoqiu', 'xiaozhen', 'xiaoyan', 'huihui', 'yaoyao', 'tingting', 'meijia', 'sinji', 'lili', 'hanhan', 'shanshan', 'jenny', 'aria', 'ava', 'emma', 'michelle', 'samantha', 'zira', 'victoria', 'karen', 'moira', 'tessa', 'susan', 'hazel', 'libby', 'sonia', 'serena'];
const maleNames = ['yunxi', 'yunyang', 'yunjian', 'yunfeng', 'yunhao', 'yunye', 'yunze', 'yunxia', 'kangkang', 'zhiwei', 'li-mu', 'limu', 'guy', 'andrew', 'brian', 'davis', 'christopher', 'eric', 'roger', 'steffan', 'david', 'mark', 'alex', 'daniel', 'fred', 'tom', 'ryan', 'george'];
const matches = (name, names) => names.some(n => new RegExp(`(^|[^a-z])${n}(neural|natural|online)?([^a-z]|$)`, 'i').test(name));
export function voiceGender(v) {
  const name = v.name || '';
  if (/\bfemale\b|女声|晓晓|晓伊|慧慧|瑶瑶/i.test(name) || matches(name, femaleNames)) return 'female';
  if (/\bmale\b|男声|康康|云希|云扬/i.test(name) || matches(name, maleNames)) return 'male';
  return null;
}
export function voicesFor(all, lang, gender) {
  return all.filter(v => v.lang.replaceAll('_', '-').toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()) && (!gender || voiceGender(v) === gender));
}
export function pickVoice(all, langCfg, gender, forcedName) {
  const list = voicesFor(all, langCfg.lang, gender);
  const forced = list.find(v => v.name === forcedName);
  if (forced) return { v: forced, matched: true };
  const score = v => (v.lang.replaceAll('_', '-').toLowerCase() === langCfg.lang.toLowerCase() ? 2 : 0) + (v.localService ? .5 : 0) + (/natural|neural|online/i.test(v.name) ? 1 : 0);
  const best = list.reduce((a, v) => !a || score(v) > score(a) ? v : a, null);
  return best ? { v: best, matched: true } : null;
}
