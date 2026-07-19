import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLyricsDatabase } from '../db.mjs';
import { analyzeLyrics } from '../lyric-analysis.mjs';
import { exportProviderManifest } from '../import-manifest.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_DIR = join(ROOT, 'chinese-lyrics');
const SOURCE_URL = 'https://github.com/dengxiuqi/ChineseLyrics';
const dbPath = process.env.LYRICS_DB_PATH || join(ROOT, 'data', 'lyrics.db');

function numberArgument(name, fallback, maximum) {
  const value = process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split('=')[1];
  return Math.min(maximum, Math.max(1, Number.parseInt(value || String(fallback), 10) || fallback));
}

const options = {
  limit: numberArgument('limit', 800, 5000),
  maxPerSinger: numberArgument('max-per-singer', 3, 20),
  minCandidates: numberArgument('min-candidates', 10, 100),
  minScore: numberArgument('min-score', 68, 100),
  dryRun: process.argv.includes('--dry-run'),
  refreshExisting: process.argv.includes('--refresh-existing')
};

const BAD_TITLE = /(伴奏|纯音乐|纯人声|铃声|试听|片段|串烧|广告|旁白|demo|live|remix|mix版|dj版|翻唱|消音版|合唱版)/i;
const BAD_SINGER = /^(none|null|unknown|未知歌手)$/i;
const PRIORITY_SINGERS = new Set([
  '周杰伦', '林俊杰', '王菲', '张国荣', '陈奕迅', '邓丽君', '李宗盛', '罗大佑',
  '张学友', '刘德华', '五月天', '朴树', '许巍', '孙燕姿', '梁静茹', '蔡琴',
  '齐秦', 'beyond', '崔健', '汪峰', '周华健', '苏芮', '叶倩文', '梅艳芳',
  '赵传', '伍佰', '张信哲', '莫文蔚', '那英', '韩红', '陶喆', '王力宏',
  '蔡依林', '李健', '许嵩', '田馥甄', '凤凰传奇', '薛之谦', '毛不易'
]);
const STRUCTURE_LINE = /^\s*[\[(（【]?(verse|chorus|bridge|intro|outro|hook|refrain|instrumental|主歌|副歌|间奏|前奏|尾奏|过渡|结尾)[^\])）】]*[\])）】]?\s*$/i;
const CREDIT_LINE = /^(作词|填词|词曲|作曲|谱曲|编曲|演唱|歌手|原唱|翻唱|和声|混音|录音|后期|制作人|监制|出品|发行|吉他|贝斯|键盘|鼓手|母带|歌词编辑|lrc|editor)(?:\s*[:：]|\s+).{1,100}$/i;
const NOISE_LINE = /(qq音乐|酷狗音乐|酷我音乐|网易云音乐|千千静听|未经许可|版权所有|本歌词|上传者|歌词制作|https?:\/\/|www\.)/i;
const CJK = /[\u3400-\u9fff]/g;

function cleanLine(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^\[\d{2}:\d{2}(?:\.\d{1,3})?\]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineKey(value) {
  return cleanLine(value).toLocaleLowerCase().replace(/[\s，。！？；,.!?;:'"“”‘’()（）\-—…]/g, '');
}

function plausibleLyricLine(line) {
  if (!line || STRUCTURE_LINE.test(line) || CREDIT_LINE.test(line) || NOISE_LINE.test(line)) return false;
  const cjkCount = (line.match(CJK) || []).length;
  return cjkCount >= 5 && cjkCount <= 42 && [...line].length <= 80;
}

function creditValue(lines, labels) {
  const pattern = new RegExp(`^(?:${labels})\\s*[:：]?\\s*(.+)$`, 'i');
  for (const line of lines) {
    const match = cleanLine(line).match(pattern);
    if (!match) continue;
    const value = match[1]
      .split(/(?:作词|填词|词曲|作曲|谱曲|编曲|演唱|歌手|原唱|制作人)\s*[:：]?/)[0]
      .replace(/^(author|lyrics?|composer)\s*[/：:]\s*/i, '')
      .replace(/[（(].*?[）)]/g, '')
      .trim();
    const meaningfulCharacters = (value.match(/[\p{Letter}\p{Number}]/gu) || []).length;
    if (meaningfulCharacters >= 2 && value.length <= 100) return value;
  }
  return '';
}

function roughSong(song, fileName, index) {
  const trackName = cleanLine(song?.name);
  const singer = cleanLine(song?.singer);
  const meaningfulTitleCharacters = (trackName.match(/[\p{Letter}\p{Number}]/gu) || []);
  const titleIsOnlyNumbers = meaningfulTitleCharacters.length > 0
    && meaningfulTitleCharacters.every((character) => /\p{Number}/u.test(character));
  if (!trackName || !singer || BAD_SINGER.test(singer) || titleIsOnlyNumbers || BAD_TITLE.test(trackName) || !Array.isArray(song?.lyric)) return null;
  const lines = song.lyric.map(cleanLine).filter(Boolean);
  if (lines.length < options.minCandidates) return null;

  const seen = new Set();
  const plausible = [];
  let plausibleOccurrences = 0;
  for (const line of lines) {
    if (plausibleLyricLine(line)) plausibleOccurrences += 1;
    const key = lineKey(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (plausibleLyricLine(line)) plausible.push(line);
  }
  if (plausible.length < options.minCandidates) return null;

  const averageLength = plausible.reduce((sum, line) => sum + [...line].length, 0) / plausible.length;
  const punctuationRatio = plausible.filter((line) => /[，。！？；,.!?;:]/.test(line)).length / plausible.length;
  const repetitionRatio = plausibleOccurrences
    ? Math.max(0, plausibleOccurrences - plausible.length) / plausibleOccurrences
    : 0;
  const lyricistName = creditValue(lines, '作词|填词');
  const composerName = creditValue(lines, '作曲|谱曲');
  const unusualTitleMarks = (trackName.match(/[|│★◆■【】]/g) || []).length;
  const quality = 75
    - Math.abs(plausible.length - 30) * 1.15
    - Math.abs(averageLength - 15) * 0.8
    - Math.max(0, plausible.length - 55) * 1.8
    + Math.min(10, repetitionRatio * 32)
    + punctuationRatio * 5
    + (lyricistName ? 5 : 0)
    + (composerName ? 2 : 0)
    + (PRIORITY_SINGERS.has(singer.toLocaleLowerCase()) ? 12 : 0)
    - unusualTitleMarks * 4;

  return {
    trackName,
    singer,
    lyricistName,
    composerName,
    plainLyrics: lines.join('\n'),
    fileName,
    index,
    roughCandidates: plausible.length,
    quality
  };
}

function addSingerCandidate(map, candidate) {
  const bucket = map.get(candidate.singer) || [];
  bucket.push(candidate);
  bucket.sort((left, right) => right.quality - left.quality);
  const singerLimit = PRIORITY_SINGERS.has(candidate.singer.toLocaleLowerCase())
    ? Math.max(options.maxPerSinger, 8)
    : options.maxPerSinger;
  if (bucket.length > singerLimit) bucket.length = singerLimit;
  map.set(candidate.singer, bucket);
}

function providerId(candidate) {
  return createHash('sha256')
    .update(`${candidate.singer}\0${candidate.trackName}`)
    .digest('hex')
    .slice(0, 20);
}

const files = (await readdir(SOURCE_DIR))
  .filter((name) => /^lyrics\d+\.json$/i.test(name))
  .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));

const perSinger = new Map();
const songKeys = new Set();
let scannedSongs = 0;
let roughEligibleSongs = 0;

for (const fileName of files) {
  const songs = JSON.parse(await readFile(join(SOURCE_DIR, fileName), 'utf8'));
  for (let index = 0; index < songs.length; index += 1) {
    scannedSongs += 1;
    const candidate = roughSong(songs[index], fileName, index);
    if (!candidate) continue;
    const key = `${candidate.singer}\0${candidate.trackName}`.toLocaleLowerCase();
    if (songKeys.has(key)) continue;
    songKeys.add(key);
    roughEligibleSongs += 1;
    addSingerCandidate(perSinger, candidate);
  }
  console.log(JSON.stringify({ stage: 'scan', fileName, songs: songs.length, scannedSongs, roughEligibleSongs }));
}

const ranked = [...perSinger.values()].flat().sort((left, right) => right.quality - left.quality);
if (options.dryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    options,
    scannedSongs,
    roughEligibleSongs,
    singers: perSinger.size,
    rankedSongs: ranked.length,
    sample: ranked.slice(0, 12).map(({ trackName, singer, lyricistName, composerName, roughCandidates, quality }) => ({
      trackName, singer, lyricistName, composerName, roughCandidates, quality: Number(quality.toFixed(2))
    }))
  }, null, 2));
  process.exit(0);
}

const database = openLyricsDatabase({ dbPath, seedPath: join(ROOT, 'data', 'store.json') });
const existingProviderIds = new Set(database.listSourceTracks()
  .filter((track) => track.provider === 'chinese_lyrics')
  .map((track) => track.provider_track_id));
let importedTracks = 0;
let importedCandidates = 0;
let importedFiltered = 0;
let collapsedRepeats = 0;
let creditedTracks = 0;
let skippedExisting = 0;

try {
  for (const candidate of ranked) {
    if (importedTracks >= options.limit) break;
    const stableProviderId = providerId(candidate);
    if (!options.refreshExisting && existingProviderIds.has(stableProviderId)) {
      skippedExisting += 1;
      continue;
    }
    const analysis = analyzeLyrics({ plainLyrics: candidate.plainLyrics, language: 'zh-CN' });
    const segments = analysis.segments.map((segment) => ({
      ...segment,
      status: segment.status === 'candidate'
        && segment.language === 'zh-CN'
        && segment.score >= options.minScore
        ? 'candidate'
        : 'filtered'
    }));
    const candidateCount = segments.filter((segment) => segment.status === 'candidate').length;
    if (candidateCount < options.minCandidates) continue;

    const track = database.saveSourceTrack({
      provider: 'chinese_lyrics',
      providerId: stableProviderId,
      trackName: candidate.trackName,
      artistName: candidate.singer,
      lyricistName: candidate.lyricistName,
      composerName: candidate.composerName,
      albumName: `ChineseLyrics 离线库 · ${candidate.fileName}`,
      duration: 0,
      language: 'zh-CN',
      plainLyrics: candidate.plainLyrics,
      syncedLyrics: '',
      sourceUrl: SOURCE_URL,
      licenseUrl: ''
    });
    database.saveSegments(track.id, segments);
    importedTracks += 1;
    importedCandidates += candidateCount;
    importedFiltered += segments.length - candidateCount;
    collapsedRepeats += analysis.summary.repeatedLinesCollapsed;
    if (candidate.lyricistName || candidate.composerName) creditedTracks += 1;
    if (importedTracks % 100 === 0) {
      console.log(JSON.stringify({ stage: 'import', importedTracks, importedCandidates, importedFiltered }));
    }
  }
} finally {
  console.log(JSON.stringify({
    options,
    scannedSongs,
    roughEligibleSongs,
    singers: perSinger.size,
    rankedSongs: ranked.length,
    importedTracks,
    importedCandidates,
    importedFiltered,
    collapsedRepeats,
    creditedTracks,
    skippedExisting,
    database: dbPath,
    databaseStats: database.stats()
  }, null, 2));
  database.close();
}

const manifest = await exportProviderManifest({
  dbPath,
  provider: 'chinese_lyrics',
  outputDir: join(ROOT, 'data', 'import-manifests')
});
console.log(JSON.stringify({ stage: 'manifest', ...manifest }));
