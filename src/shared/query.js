// One synonym dictionary for online search, local folders and saved library views.
(function(root) {
const synonyms = [
  ['雨', '雨音', '雨の音', 'rain', 'rainfall'], ['風', '風音', 'wind'], ['海', '波', '波音', 'wave', 'ocean'], ['鳥', '鳥の声', 'bird'], ['雷', '雷鳴', 'thunder'], ['足音', 'footstep', 'footsteps'], ['水', 'water'], ['拍手', 'applause', 'clapping'], ['ドア', '扉', 'door'],
  ['ドラム', 'drum', 'drums'], ['キック', 'kick'], ['スネア', 'snare'], ['ハイハット', 'hihat', 'hi-hat'], ['シンバル', 'cymbal'], ['ベース', 'bass'], ['ピアノ', 'piano'], ['ギター', 'guitar'], ['シンセ', 'シンセサイザー', 'synth', 'synthesizer'], ['バイオリン', 'ヴァイオリン', 'violin'], ['弦楽器', 'strings'], ['トランペット', 'trumpet'], ['フルート', 'flute'], ['ベル', '鐘', 'bell'], ['パーカッション', '打楽器', 'percussion'],
  ['ループ', 'loop'], ['ワンショット', 'oneshot', 'one-shot'], ['bgm', '音楽', 'music'], ['アンビエンス', '環境音', 'ambience', 'ambient'], ['ジングル', 'jingle'], ['声', 'ボイス', 'voice'], ['笑い声', '笑い', 'laughter', 'laugh'], ['群衆', '人混み', 'crowd'], ['叫び声', '悲鳴', 'scream'], ['息', '呼吸', 'breathing'],
  ['車', '自動車', 'car'], ['電車', '列車', 'train'], ['飛行機', 'airplane'], ['ヘリコプター', 'ヘリ', 'helicopter'], ['エンジン', 'engine'], ['犬', '犬の声', 'dog'], ['猫', '猫の声', 'cat'], ['虫', '虫の声', 'insect'], ['蛙', 'カエル', 'frog'], ['森', 'forest'], ['川', 'river'], ['滝', 'waterfall'], ['火', '炎', '焚き火', 'fire'],
  ['爆発', '爆発音', 'explosion'], ['銃声', 'gunshot'], ['衝撃', '衝撃音', 'impact'], ['警報', 'アラーム', 'alarm'], ['サイレン', 'siren'], ['時計', 'clock'], ['心臓', '心音', 'heartbeat'], ['クリック', 'click'], ['電子音', 'beep'], ['宇宙', 'space'], ['ロボット', 'robot'], ['ホラー', 'horror'], ['ノイズ', 'noise'], ['レコード', 'vinyl'], ['スクラッチ', 'scratch'], ['リバース', 'reverse'],
];
function expandQuery(query) {
  const normalized = String(query ?? '').normalize('NFKC').toLowerCase().trim();
  return [...new Set([normalized, ...synonyms.filter(group => group.includes(normalized)).flat()])].filter(Boolean);
}
function createMatcher(query) {
  const terms = expandQuery(query).map(term => /^[a-z]+$/.test(term) ? new RegExp(`(?:^|[^a-z])${term}(?:[^a-z]|$)`) : term);
  return value => {
    const text = String(value ?? '').normalize('NFKC').toLowerCase();
    return !terms.length || terms.some(term => typeof term === 'string' ? text.includes(term) : term.test(text));
  };
}
function matchesText(text, query) { return createMatcher(query)(text); }
const api = { expandQuery, createMatcher, matchesText };
if (typeof module !== 'undefined') module.exports = api; else root.AllsampleQuery = api;
})(globalThis);
