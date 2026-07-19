const STRUCTURE_LINE = /^\s*[\[(（【]?(verse|chorus|bridge|intro|outro|hook|refrain|instrumental|主歌|副歌|间奏|前奏|尾奏)[^\])）】]*[\])）】]?\s*$/i;
const URL_LIKE = /https?:\/\/|www\./i;
const CREDIT_LINE = /^(作词|填词|词曲|作曲|谱曲|编曲|演唱|歌手|原唱|翻唱|和声|混音|录音|后期|制作人|监制|出品|发行|吉他|贝斯|键盘|鼓手|母带|歌词编辑|lrc|editor|lyrics?\s+by)(?:\s*[:：]|\s+).{1,100}$/i;
const PLATFORM_LINE = /(qq音乐|酷狗音乐|酷我音乐|网易云音乐|千千静听|未经许可|版权所有|本歌词|上传者|歌词制作)/i;
const CJK = /[\u3400-\u9fff]/g;

function normalizeText(value) {
  return value
    .normalize('NFKC')
    .replace(/^\[\d{2}:\d{2}(?:\.\d{1,3})?\]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function languageOf(text, preferred = '') {
  if (preferred === 'zh-CN' || preferred === 'en') return preferred;
  const cjkCount = (text.match(CJK) || []).length;
  return cjkCount >= Math.max(2, text.length * 0.25) ? 'zh-CN' : 'en';
}

function tokenize(text, language) {
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en';
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  return [...segmenter.segment(text)]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);
}

function parseSyncedStarts(syncedLyrics) {
  const starts = new Map();
  if (!syncedLyrics) return starts;
  for (const rawLine of syncedLyrics.split(/\r?\n/)) {
    const match = rawLine.match(/^\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/);
    if (!match) continue;
    const text = normalizeText(match[4]);
    if (!text || starts.has(text.toLocaleLowerCase())) continue;
    const fraction = Number(`0.${match[3] || '0'}`) * 1000;
    const startMs = Number(match[1]) * 60_000 + Number(match[2]) * 1000 + Math.round(fraction);
    starts.set(text.toLocaleLowerCase(), startMs);
  }
  return starts;
}

function candidateScore({ text, language, tokens, duplicateCount }) {
  const charCount = [...text].length;
  const wordCount = tokens.length;
  let score = 50;
  let filtered = false;

  if (!text || STRUCTURE_LINE.test(text) || CREDIT_LINE.test(text) || PLATFORM_LINE.test(text) || URL_LIKE.test(text)) filtered = true;
  if (language === 'zh-CN') {
    const cjkCount = (text.match(CJK) || []).length;
    if (cjkCount < 5 || cjkCount > 42) filtered = true;
    score += 22 - Math.min(22, Math.abs(cjkCount - 16) * 1.6);
  } else {
    if (wordCount < 3 || wordCount > 20) filtered = true;
    score += 20 - Math.min(20, Math.abs(wordCount - 9) * 2);
  }

  if (/[，。！？；,.!?;:]/.test(text)) score += 5;
  if (duplicateCount > 1) score += Math.min(8, duplicateCount * 2);
  const diversity = tokens.length ? new Set(tokens.map((token) => token.toLocaleLowerCase())).size / tokens.length : 0;
  score += Math.round(diversity * 8);
  if (/^(la|na|oh|ah|yeah|ooh|啦|啊|呀|哦)[\s,.!，。！]*$/i.test(text)) filtered = true;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    status: filtered ? 'filtered' : 'candidate',
    charCount,
    wordCount
  };
}

export function analyzeLyrics({ plainLyrics, syncedLyrics = '', language = '' }) {
  const syncedStarts = parseSyncedStarts(syncedLyrics);
  const rawLines = String(plainLyrics || syncedLyrics || '').split(/\r?\n/);
  const grouped = new Map();

  rawLines.forEach((rawLine, index) => {
    const text = normalizeText(rawLine);
    if (!text) return;
    const key = text
      .toLocaleLowerCase()
      .replace(/[\s，。！？；,.!?;:'"“”‘’()（）\-—…]/g, '');
    if (!key) return;
    const current = grouped.get(key);
    if (current) {
      current.duplicateCount += 1;
      return;
    }
    grouped.set(key, { text, index, duplicateCount: 1 });
  });

  const segments = [];
  for (const item of grouped.values()) {
    const detectedLanguage = languageOf(item.text, language);
    const tokens = tokenize(item.text, detectedLanguage);
    const metrics = candidateScore({
      text: item.text,
      language: detectedLanguage,
      tokens,
      duplicateCount: item.duplicateCount
    });
    segments.push({
      index: item.index,
      text: item.text,
      normalizedText: item.text.toLocaleLowerCase(),
      tokens,
      language: detectedLanguage,
      wordCount: metrics.wordCount,
      charCount: metrics.charCount,
      score: metrics.score,
      duplicateCount: item.duplicateCount,
      startMs: syncedStarts.get(item.text.toLocaleLowerCase()) ?? null,
      endMs: null,
      status: metrics.status
    });
  }

  const timed = segments.filter((segment) => segment.startMs !== null).sort((a, b) => a.startMs - b.startMs);
  timed.forEach((segment, index) => {
    segment.endMs = timed[index + 1]?.startMs ?? null;
  });

  return {
    segments,
    summary: {
      total: segments.length,
      candidates: segments.filter((segment) => segment.status === 'candidate').length,
      filtered: segments.filter((segment) => segment.status === 'filtered').length,
      repeatedLinesCollapsed: rawLines.filter((line) => normalizeText(line)).length - segments.length,
      language: segments.find((segment) => segment.language === 'zh-CN') ? 'zh-CN' : 'en'
    }
  };
}
