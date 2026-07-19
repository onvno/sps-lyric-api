#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const RULE_VERSION = 'multiline-reflective-v2';
const LEGACY_PROVIDERS = new Set(['legacy_backup_sps', 'legacy_backup_apply']);
const DEFAULTS = Object.freeze({
  db: '',
  providers: ['chinese_lyrics', 'lrclib'],
  perTrack: 3,
  minScore: 76,
  minLines: 2,
  maxLines: 4,
  output: '',
  apply: false
});

const STRUCTURE_LINE = /^\s*[\[(（【]?(?:verse|chorus|bridge|intro|outro|hook|refrain|instrumental|主歌|副歌|间奏|前奏|尾奏|过渡|互动)(?:\s*\d+)?[^\])）】]*[\])）】]?\s*$/iu;
const CREDIT_LINE = /^(?:作词|填词|词曲|作曲|谱曲|编曲|演唱|歌手|原唱|翻唱|和声|混音|录音|后期|制作人|监制|出品|发行|吉他|贝斯|键盘|鼓手|母带|歌词编辑|lrc|editor|lyrics?\s+by)(?:\s*[:：]|\s+).{1,160}$/iu;
const PLATFORM_LINE = /(?:qq音乐|酷狗音乐|酷我音乐|网易云音乐|千千静听|未经许可|版权所有|本歌词|上传者|歌词制作|https?:\/\/|www\.)/iu;
const INLINE_METADATA = /(?:作词|作曲|编曲|监制|制作人|混音|录音|母带|发行|出品|版权所有|未经许可|QQ音乐|网易云|酷狗)/iu;
const ROLE_LINE = /^[（(【\[]?(?:男|女|合|旁白|独白|和声|rap|verse|chorus|hook)[）)】\]\s:：-]/iu;
const EXPLICIT_LINE = /(?:傻[逼比]|撒逼|煞笔|他妈|妈的|卧槽|操你|日你|fuck|shit|bitch|nigg|\*\*)/iu;
const GENERIC_PHRASE = /(?:我爱你|我想你|对不起|谢谢你|别离开|离不开你|永远爱你|i love you|i miss you|sorry)/iu;
const CONTEXT_OPENING = /^[而但却也又仍还就才因所若如当把被让与及或的了着过我你他她它这那]/u;

const SIGNAL_GROUPS = [
  ['time_memory', /时间|岁月|年华|青春|曾经|后来|记忆|回忆|明天|昨天|今夜|永远|一生|一世|moment|memory|tomorrow|yesterday|tonight|forever/iu],
  ['life_choice', /人生|生活|世界|命运|选择|拥有|失去|得到|放下|意义|答案|真相|现实|未来|life|world|fate|choice|meaning|truth|future/iu],
  ['inner_growth', /孤独|自由|勇气|梦想|希望|遗憾|温柔|灵魂|成长|改变|相信|原谅|宽恕|lonely|freedom|courage|dream|hope|soul|grow|forgive/iu],
  ['journey_home', /路|远方|归来|离开|告别|出发|回家|故乡|漂泊|journey|road|leave|return|home|goodbye/iu],
  ['relationship', /相遇|拥抱|等待|陪伴|错过|思念|爱|别离|理解|meet|embrace|wait|miss|love|understand/iu],
  ['nature_image', /风|雨|雪|云|月|星|海|河|山|花|树|天空|黄昏|黎明|夕阳|夜|春|秋|wind|rain|snow|moon|star|sea|river|sky|dawn|night/iu]
];

const CONTRAST = /但|但是|却|仍|只是|原来|反而|即使|哪怕|宁愿|不是.+而是|but|yet|instead|even if|rather/iu;
const CAUSAL = /因为|所以|于是|如果|只要|才会|才能|为了|为何|为什么|because|therefore|if|so that|why/iu;
const QUESTION = /[?？]|谁(?:会|能|在|又|让|说|知)|为何|为什么|何时|何处|是否|难道|who|why|how|when|where|whether/iu;
const METAPHOR = /像|如同|仿佛|化作|成为|犹如|好比|like|as if|become/iu;

const HELP = `Rebuild final-review lyric candidates as adjacent multi-line passages.

Usage:
  node rebuild-final-candidates.mjs [options]

Options:
  --db PATH             SQLite database path; otherwise auto-discover
  --provider NAMES      Comma-separated providers (default chinese_lyrics,lrclib)
  --per-track N         Final-review passages per track, 1-3 (default 3)
  --min-score N         Deterministic triage threshold (default 76)
  --output PATH         JSON report path
  --apply               Backup SQLite, filter old candidates, and write rebuilt candidates
  --help                Show this help

Dry-run is the default. Automatic passages always contain 2-4 adjacent original lines.
Approval and publication remain separate human-review actions.`;

function parseArgs(argv) {
  const options = { ...DEFAULTS, providers: [...DEFAULTS.providers] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--apply') {
      options.apply = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') return { ...options, help: true };
    if (!argument.startsWith('--')) throw new Error(`Unknown argument: ${argument}`);
    const equalsAt = argument.indexOf('=');
    const key = equalsAt === -1 ? argument.slice(2) : argument.slice(2, equalsAt);
    const value = equalsAt === -1 ? argv[++index] : argument.slice(equalsAt + 1);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    if (key === 'db') options.db = value;
    else if (key === 'provider') options.providers = value.split(',').map((item) => item.trim()).filter(Boolean);
    else if (key === 'per-track') options.perTrack = Number.parseInt(value, 10);
    else if (key === 'min-score') options.minScore = Number(value);
    else if (key === 'output') options.output = value;
    else throw new Error(`Unknown option: --${key}`);
  }
  if (!options.providers.length) throw new Error('--provider must include at least one provider');
  if (options.providers.some((provider) => LEGACY_PROVIDERS.has(provider))) {
    throw new Error('Legacy SQL providers contain approved hand-curated excerpts and cannot be rebuilt');
  }
  if (!Number.isInteger(options.perTrack) || options.perTrack < 1 || options.perTrack > 3) {
    throw new Error('--per-track must be an integer from 1 to 3');
  }
  if (!Number.isFinite(options.minScore) || options.minScore < 0 || options.minScore > 100) {
    throw new Error('--min-score must be between 0 and 100');
  }
  return options;
}

function discoverDatabase(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.LYRICS_DB_PATH,
    resolve(process.cwd(), 'data/lyrics.db'),
    resolve(process.cwd(), 'sps-lyric-api/data/lyrics.db')
  ].filter(Boolean).map((item) => resolve(item));
  const found = candidates.find((item) => existsSync(item));
  if (!found) throw new Error('Could not find lyrics.db. Pass --db /absolute/path/to/lyrics.db.');
  return found;
}

function portablePath(value) {
  if (!value) return null;
  const absolute = resolve(value);
  const local = relative(process.cwd(), absolute);
  return local && !local.startsWith('..') ? local : basename(absolute);
}

function cleanLine(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^\[\d{2}:\d{2}(?:\.\d{1,3})?\]\s*/u, '')
    .replace(/[ \t]+/gu, ' ')
    .trim();
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function contentUnits(text, language) {
  if (String(language).toLocaleLowerCase().startsWith('zh')) {
    return Array.from(text.match(/[\p{Script=Han}\p{L}\p{N}]/gu) || []);
  }
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
}

function hasBalancedPairs(text) {
  const pairs = [['(', ')'], ['（', '）'], ['[', ']'], ['【', '】']];
  return pairs.every(([left, right]) => text.split(left).length === text.split(right).length);
}

function tokenize(text, language) {
  const locale = String(language).toLocaleLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  return [...segmenter.segment(text)]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);
}

function isBoundaryOrNoise(line, track) {
  if (!line) return true;
  if (STRUCTURE_LINE.test(line) || CREDIT_LINE.test(line) || PLATFORM_LINE.test(line) || ROLE_LINE.test(line)) return true;
  if (normalizeKey(line) === normalizeKey(track.track_name)) return true;
  if (/^[\-_=*·•~～—\s]{2,}$/u.test(line)) return true;
  return false;
}

function lyricBlocks(track) {
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length) blocks.push(current);
    current = [];
  };
  String(track.lyrics_text || '').split(/\r?\n/u).forEach((raw, index) => {
    const text = cleanLine(raw);
    if (isBoundaryOrNoise(text, track)) {
      flush();
      return;
    }
    current.push({ text, index });
  });
  flush();
  return blocks;
}

function keywordGroups(text) {
  return SIGNAL_GROUPS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function windowHardRejectReasons(window, language) {
  const reasons = [];
  const text = window.text;
  const units = contentUnits(text, language);
  const isChinese = String(language).toLocaleLowerCase().startsWith('zh');
  if (window.lines.length < 2) reasons.push('single_line_requires_manual_exception');
  if (window.lines.length > 4) reasons.push('too_many_lines');
  if (PLATFORM_LINE.test(text) || CREDIT_LINE.test(text) || INLINE_METADATA.test(text)) reasons.push('metadata_noise');
  if (/^(?:嗯|啊|哦|呃|唉|oh|yeah|uh)(?:[\s,，.!！]+|$)/iu.test(window.lines[0]?.text || '')) reasons.push('leading_filler');
  if (EXPLICIT_LINE.test(text)) reasons.push('abusive_or_masked_explicit_language');
  if (/[（(【\[].*?[）)】\]]/u.test(text)) reasons.push('parenthetical_or_backing_vocal');
  if ((isChinese && (units.length < 10 || units.length > 80)) || (!isChinese && (units.length < 6 || units.length > 42))) {
    reasons.push('passage_length_out_of_range');
  }
  const diversity = units.length ? new Set(units).size / units.length : 0;
  if (!units.length
      || diversity < 0.24
      || /^(.)\1{4,}$/u.test(normalizeKey(text))
      || /([\p{L}])\1{3,}/u.test(text)) {
    reasons.push('low_information_repetition');
  }
  if (!hasBalancedPairs(text)) reasons.push('damaged_brackets');
  return [...new Set(reasons)];
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function scoreWindow(window, track) {
  const text = window.text;
  const lines = window.lines.map((line) => line.text);
  const language = track.language || (/\p{Script=Han}/u.test(text) ? 'zh-CN' : 'en');
  const units = contentUnits(text, language);
  const isChinese = language.toLocaleLowerCase().startsWith('zh');
  const groups = keywordGroups(text);
  const diversity = units.length ? new Set(units.map((unit) => unit.toLocaleLowerCase())).size / units.length : 0;
  const hasContrast = CONTRAST.test(text);
  const hasCausal = CAUSAL.test(text);
  const hasQuestion = QUESTION.test(text);
  const hasMetaphor = METAPHOR.test(text);
  const endsWithLanding = /[。！？.!?]$/u.test(lines.at(-1))
    || keywordGroups(lines.at(-1)).some((group) => group !== 'nature_image');
  const repeatedOpening = lines.length >= 2
    && lines.map((line) => normalizeKey(line).slice(0, 2)).filter(Boolean).some((prefix, index, all) => all.indexOf(prefix) !== index);

  let score = 38;
  const reasons = [];
  const signals = {
    line_count: lines.length,
    unit_count: units.length,
    keyword_groups: groups,
    contrast: hasContrast,
    causal: hasCausal,
    question: hasQuestion,
    metaphor: hasMetaphor,
    ending_lands: endsWithLanding,
    lexical_diversity: Math.round(diversity * 100) / 100
  };

  const lengthFit = isChinese
    ? (units.length >= 18 && units.length <= 50 ? 12 : units.length >= 12 && units.length <= 68 ? 8 : 3)
    : (units.length >= 10 && units.length <= 28 ? 12 : units.length >= 6 && units.length <= 38 ? 8 : 3);
  score += lengthFit;
  score += lines.length === 2 ? 9 : lines.length === 3 ? 12 : 10;

  const reflectiveGroups = groups.filter((group) => group !== 'nature_image').length;
  score += Math.min(14, reflectiveGroups * 4 + (groups.includes('nature_image') ? 2 : 0));
  if (reflectiveGroups >= 2) reasons.push('多个语义层次共同形成可回味的主题');
  else if (reflectiveGroups === 1) reasons.push('段落具有明确的思考或情感落点');

  if (hasContrast) {
    score += 8;
    reasons.push('相邻句之间存在转折或价值张力');
  }
  if (hasCausal) {
    score += 6;
    reasons.push('相邻句形成原因、条件或结果关系');
  }
  if (hasQuestion) {
    score += 5;
    reasons.push('提问使段落具有继续思考的空间');
  }
  if (hasMetaphor) {
    score += 4;
    reasons.push('意象或比喻承载了抽象感受');
  }
  if (repeatedOpening) score += 3;
  if (endsWithLanding) score += 4;
  score += diversity >= 0.62 ? 5 : diversity >= 0.48 ? 3 : 0;

  if (CONTEXT_OPENING.test(lines[0]) && !hasContrast && !hasCausal) score -= 4;
  if (GENERIC_PHRASE.test(text) && units.length <= (isChinese ? 18 : 12)) score -= 8;
  if (window.duplicateCount > 4) score -= 3;
  if (!reflectiveGroups && !hasContrast && !hasCausal && !hasQuestion && !hasMetaphor) score -= 7;

  if (!reasons.length) reasons.push('多行共同构成一个可独立复核的表达单元');
  return {
    score: Math.round(clamp(score, 0, 100)),
    language,
    reasons: reasons.slice(0, 3),
    signals
  };
}

function bigrams(text) {
  const normalized = normalizeKey(text);
  if (normalized.length < 2) return new Set([normalized]);
  const result = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function similarity(left, right) {
  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  let intersection = 0;
  for (const value of leftSet) if (rightSet.has(value)) intersection += 1;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 1;
}

function overlapsHeavily(left, right) {
  const overlap = Math.max(0, Math.min(left.endIndex, right.endIndex) - Math.max(left.startIndex, right.startIndex) + 1);
  const shorter = Math.min(left.lines.length, right.lines.length);
  return shorter > 0 && overlap / shorter >= 0.34;
}

function sharesTooManyLines(left, right) {
  const leftLines = new Set(left.lines.map((line) => normalizeKey(line.text)).filter(Boolean));
  const rightLines = new Set(right.lines.map((line) => normalizeKey(line.text)).filter(Boolean));
  let shared = 0;
  for (const line of leftLines) if (rightLines.has(line)) shared += 1;
  return shared > 0;
}

export function buildTrackCandidates(track, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const windowsByKey = new Map();
  for (const block of lyricBlocks(track)) {
    for (let start = 0; start < block.length; start += 1) {
      for (let lineCount = settings.minLines; lineCount <= settings.maxLines; lineCount += 1) {
        const lines = block.slice(start, start + lineCount);
        if (lines.length !== lineCount) continue;
        const text = lines.map((line) => line.text).join('\n');
        const key = normalizeKey(text);
        if (!key) continue;
        const current = windowsByKey.get(key);
        if (current) {
          current.duplicateCount += 1;
          continue;
        }
        windowsByKey.set(key, {
          text,
          lines,
          lineCount,
          startIndex: lines[0].index,
          endIndex: lines.at(-1).index,
          duplicateCount: 1
        });
      }
    }
  }

  const rejectedCounts = {};
  const eligible = [];
  for (const window of windowsByKey.values()) {
    const language = track.language || (/\p{Script=Han}/u.test(window.text) ? 'zh-CN' : 'en');
    const hardRejectReasons = windowHardRejectReasons(window, language);
    if (hardRejectReasons.length) {
      for (const reason of hardRejectReasons) rejectedCounts[reason] = (rejectedCounts[reason] || 0) + 1;
      continue;
    }
    const scored = scoreWindow(window, track);
    if (scored.score < settings.minScore) continue;
    eligible.push({
      ...window,
      ...scored,
      normalizedText: window.text.toLocaleLowerCase().replace(/\s+/gu, ' ').trim(),
      tokens: tokenize(window.text, scored.language),
      charCount: Array.from(window.text.replace(/\s/gu, '')).length,
      wordCount: tokenize(window.text, scored.language).length,
      flags: [
        ...(!String(track.lyricist_name || '').trim() ? ['creator_missing'] : []),
        ...(!String(track.license_url || '').trim() && track.provider !== 'publicdomain' ? ['rights_needs_review'] : [])
      ]
    });
  }

  eligible.sort((left, right) =>
    right.score - left.score
    || right.signals.keyword_groups.length - left.signals.keyword_groups.length
    || left.startIndex - right.startIndex
    || left.lineCount - right.lineCount
  );

  const selected = [];
  for (const candidate of eligible) {
    const tooSimilar = selected.some((current) =>
      similarity(candidate.text, current.text) >= 0.45
      || overlapsHeavily(candidate, current)
      || sharesTooManyLines(candidate, current)
    );
    if (tooSimilar) continue;
    selected.push(candidate);
    if (selected.length >= settings.perTrack) break;
  }

  return {
    generatedWindows: windowsByKey.size,
    eligibleWindows: eligible.length,
    hardRejectCounts: rejectedCounts,
    selected
  };
}

function countValues(items) {
  const counts = {};
  for (const item of items) counts[item] = (counts[item] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function backupDatabase(database, databasePath) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const backupDir = resolve(dirname(databasePath), 'backups');
  mkdirSync(backupDir, { recursive: true });
  const backupPath = resolve(backupDir, `lyrics-before-${RULE_VERSION}-${stamp}.db`);
  database.exec(`VACUUM INTO ${sqlString(backupPath)}`);
  return backupPath;
}

export function rebuildFinalCandidates(options) {
  const databasePath = discoverDatabase(options.db);
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  try {
    const placeholders = options.providers.map(() => '?').join(', ');
    const tracks = database.prepare(`
      SELECT st.*,
        SUM(CASE WHEN ls.status = 'candidate' THEN 1 ELSE 0 END) AS old_candidate_count
      FROM source_tracks st
      LEFT JOIN lyric_segments ls ON ls.source_track_id = st.id
      WHERE st.provider IN (${placeholders})
      GROUP BY st.id
      ORDER BY st.id
    `).all(...options.providers);

    const trackReports = tracks.map((track) => {
      const built = buildTrackCandidates(track, options);
      return {
        source_track_id: track.id,
        provider: track.provider,
        provider_track_id: track.provider_track_id,
        track: track.track_name,
        artist: track.artist_name,
        lyricist: track.lyricist_name,
        old_candidate_count: track.old_candidate_count,
        generated_windows: built.generatedWindows,
        eligible_windows: built.eligibleWindows,
        hard_reject_counts: built.hardRejectCounts,
        candidates: built.selected.map((candidate) => ({
          text: candidate.text,
          line_count: candidate.lineCount,
          start_line: candidate.startIndex,
          end_line: candidate.endIndex,
          score: candidate.score,
          reasons: candidate.reasons,
          signals: candidate.signals,
          flags: candidate.flags,
          duplicate_count: candidate.duplicateCount
        })),
        _selected: built.selected
      };
    });

    const flatCandidates = trackReports.flatMap((track) => track.candidates.map((candidate) => ({
      source_track_id: track.source_track_id,
      provider: track.provider,
      track: track.track,
      artist: track.artist,
      lyricist: track.lyricist,
      ...candidate
    })));
    const hardRejectCounts = {};
    for (const track of trackReports) {
      for (const [reason, count] of Object.entries(track.hard_reject_counts)) {
        hardRejectCounts[reason] = (hardRejectCounts[reason] || 0) + count;
      }
    }

    const generatedAt = new Date().toISOString();
    const summary = {
      rule_version: RULE_VERSION,
      tracks_scanned: tracks.length,
      old_candidates: tracks.reduce((sum, track) => sum + Number(track.old_candidate_count || 0), 0),
      windows_generated: trackReports.reduce((sum, track) => sum + track.generated_windows, 0),
      eligible_windows: trackReports.reduce((sum, track) => sum + track.eligible_windows, 0),
      selected_candidates: flatCandidates.length,
      tracks_by_selected_count: countValues(trackReports.map((track) => track.candidates.length)),
      tracks_missing_lyricist: trackReports.filter((track) => !track.lyricist.trim()).length,
      max_candidates_per_track: Math.max(0, ...trackReports.map((track) => track.candidates.length))
    };
    const report = {
      generated_at: generatedAt,
      database: databasePath,
      mode: options.apply ? 'apply' : 'dry-run',
      filters: {
        providers: options.providers,
        min_score: options.minScore,
        min_lines: options.minLines,
        max_lines: options.maxLines,
        per_track: options.perTrack
      },
      calibration: {
        source: '701 user-curated legacy SQL excerpts',
        multiline: 693,
        lines_2_to_4: 630,
        average_characters: 25.6
      },
      summary,
      hard_reject_counts: hardRejectCounts,
      tracks: trackReports.map(({ _selected, ...track }) => track)
    };

    if (options.apply) {
      const backupPath = backupDatabase(database, databasePath);
      const filterOld = database.prepare(`
        UPDATE lyric_segments
        SET status = 'filtered', rejection_reason = ?, reviewed_at = NULL
        WHERE source_track_id = ? AND status = 'candidate'
      `);
      const upsert = database.prepare(`
        INSERT INTO lyric_segments(
          source_track_id, segment_index, text, normalized_text, tokens_json,
          language, word_count, char_count, score, duplicate_count,
          start_ms, end_ms, status, rejection_reason, created_at, reviewed_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'candidate', '', ?, NULL)
        ON CONFLICT(source_track_id, normalized_text) DO UPDATE SET
          segment_index = excluded.segment_index,
          text = excluded.text,
          tokens_json = excluded.tokens_json,
          language = excluded.language,
          word_count = excluded.word_count,
          char_count = excluded.char_count,
          score = excluded.score,
          duplicate_count = excluded.duplicate_count,
          status = CASE
            WHEN lyric_segments.status IN ('approved', 'rejected') THEN lyric_segments.status
            ELSE 'candidate'
          END,
          rejection_reason = CASE
            WHEN lyric_segments.status IN ('approved', 'rejected') THEN lyric_segments.rejection_reason
            ELSE ''
          END,
          reviewed_at = CASE
            WHEN lyric_segments.status IN ('approved', 'rejected') THEN lyric_segments.reviewed_at
            ELSE NULL
          END
      `);
      const logAction = database.prepare(`
        INSERT INTO review_actions(entity_type, entity_id, action, note, created_at)
        VALUES('source_track', ?, 'candidate_rebuild', ?, ?)
      `);
      const setMeta = database.prepare(`
        INSERT INTO metadata(key, value) VALUES(?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);
      const now = new Date().toISOString();
      database.exec('BEGIN IMMEDIATE');
      try {
        for (const track of trackReports) {
          filterOld.run(`由 ${RULE_VERSION} 多行候选替代`, track.source_track_id);
          for (const candidate of track._selected) {
            upsert.run(
              track.source_track_id,
              candidate.startIndex,
              candidate.text,
              candidate.normalizedText,
              JSON.stringify(candidate.tokens),
              candidate.language,
              candidate.wordCount,
              candidate.charCount,
              candidate.score,
              candidate.duplicateCount,
              now
            );
          }
          logAction.run(
            String(track.source_track_id),
            `${RULE_VERSION}: ${track.old_candidate_count} -> ${track.candidates.length} candidates; adjacent 2-4 lines; max ${options.perTrack}`,
            now
          );
        }
        setMeta.run('candidate_curation_version', RULE_VERSION);
        setMeta.run('candidate_rebuilt_at', now);
        setMeta.run('candidate_rebuild_summary', JSON.stringify(summary));
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      report.backup = backupPath;
      report.database_changes = {
        filtered_old_candidates: summary.old_candidates,
        inserted_or_reactivated_candidates: summary.selected_candidates,
        review_actions: trackReports.length
      };
    }

    return report;
  } finally {
    database.close();
  }
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const report = rebuildFinalCandidates(options);
  const stamp = report.generated_at.replaceAll(':', '-').replaceAll('.', '-');
  const defaultOutput = options.apply
    ? resolve(dirname(report.database), 'import-manifests', `final-candidate-rebuild-${stamp}.json`)
    : '';
  const outputPath = options.output ? resolve(options.output) : defaultOutput;
  const portableReport = {
    ...report,
    database: portablePath(report.database),
    ...(report.backup ? { backup: portablePath(report.backup) } : {})
  };
  if (outputPath) {
    if (extname(outputPath).toLocaleLowerCase() !== '.json') throw new Error('--output must use a .json extension');
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(portableReport, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify({
    mode: report.mode,
    output: portablePath(outputPath),
    backup: portablePath(report.backup),
    summary: report.summary,
    database_changes: report.database_changes || null
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
