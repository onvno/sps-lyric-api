#!/usr/bin/env node

import { existsSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const DEFAULTS = Object.freeze({
  provider: '',
  language: '',
  status: 'candidate',
  limit: 80,
  perTrack: 3,
  perArtist: 6,
  minSourceScore: 0,
  minPreScore: 0,
  auditLimit: 8,
  output: '',
  format: ''
});

const ALLOWED_STATUSES = new Set(['candidate', 'filtered']);
const ALLOWED_FORMATS = new Set(['json', 'markdown']);

const HELP = `Prepare a read-only lyric curation review batch from SQLite.

Usage:
  node prepare-review-batch.mjs [options]

Options:
  --db PATH                 SQLite database path; otherwise auto-discover
  --provider NAME           Restrict source provider, e.g. chinese_lyrics
  --language CODE           Restrict language, e.g. zh-CN or en
  --status STATUS           candidate (default) or filtered
  --limit N                 Number of ranked candidates to return (default 80)
  --per-track N             Maximum candidates per track, capped at 3 (default 3)
  --per-artist N            Maximum candidates per artist per batch (default 6)
  --min-source-score N      Minimum database score (default 0)
  --min-pre-score N         Minimum deterministic pre-score (default 0)
  --audit-limit N           Lower-ranked audit samples (default 8)
  --output PATH             Write output to a file; stdout when omitted
  --format json|markdown    Output format; inferred from .md when possible
  --help                    Show this help

The script never writes to SQLite and never approves or rejects a segment.`;

function positiveInteger(value, name, { allowZero = false } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed < 1)) {
    throw new Error(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
  return parsed;
}

function finiteNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, db: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') return { ...options, help: true };
    if (!argument.startsWith('--')) throw new Error(`Unknown argument: ${argument}`);

    const equalsAt = argument.indexOf('=');
    const key = equalsAt === -1 ? argument.slice(2) : argument.slice(2, equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : argument.slice(equalsAt + 1);
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);

    switch (key) {
      case 'db': options.db = value; break;
      case 'provider': options.provider = value; break;
      case 'language': options.language = value; break;
      case 'status': options.status = value; break;
      case 'limit': options.limit = positiveInteger(value, '--limit'); break;
      case 'per-track': options.perTrack = positiveInteger(value, '--per-track'); break;
      case 'per-artist': options.perArtist = positiveInteger(value, '--per-artist'); break;
      case 'min-source-score': options.minSourceScore = finiteNumber(value, '--min-source-score'); break;
      case 'min-pre-score': options.minPreScore = finiteNumber(value, '--min-pre-score'); break;
      case 'audit-limit': options.auditLimit = positiveInteger(value, '--audit-limit', { allowZero: true }); break;
      case 'output': options.output = value; break;
      case 'format': options.format = value; break;
      default: throw new Error(`Unknown option: --${key}`);
    }
  }
  if (!ALLOWED_STATUSES.has(options.status)) {
    throw new Error('--status must be candidate or filtered');
  }
  if (options.format && !ALLOWED_FORMATS.has(options.format)) {
    throw new Error('--format must be json or markdown');
  }
  if (options.perTrack > 3) throw new Error('--per-track cannot exceed 3');
  return options;
}

function discoverDatabase(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.LYRICS_DB_PATH,
    resolve(process.cwd(), 'data/lyrics.db'),
    resolve(process.cwd(), 'lyric-lines-api/data/lyrics.db')
  ].filter(Boolean).map((item) => resolve(item));
  const found = candidates.find((item) => existsSync(item));
  if (!found) {
    throw new Error('Could not find lyrics.db. Pass --db /absolute/path/to/lyrics.db.');
  }
  return found;
}

function normalizeForComparison(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function contentUnits(text, language) {
  if (language.toLocaleLowerCase().startsWith('zh')) {
    return Array.from(text.match(/[\p{Script=Han}\p{L}\p{N}]/gu) || []);
  }
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
}

function hasBalancedPairs(text) {
  const pairs = [['(', ')'], ['（', '）'], ['[', ']'], ['【', '】']];
  return pairs.every(([left, right]) => text.split(left).length === text.split(right).length);
}

function hardRejectReasons(row) {
  const text = row.text.trim();
  const lineCount = text.split(/\r?\n/u).filter((line) => line.trim()).length;
  const units = contentUnits(text, row.language);
  const reasons = [];
  const isChinese = row.language.toLocaleLowerCase().startsWith('zh');

  if (!row.track_name.trim() || !row.artist_name.trim()) reasons.push('missing_track_identity');
  if (/https?:\/\/|www\./iu.test(text)) reasons.push('url_noise');
  if (/(?:作词|作曲|编曲|监制|制作人|混音|录音|母带|发行|出品|版权所有|未经许可|QQ音乐|网易云|酷狗)/iu.test(text)) {
    reasons.push('metadata_noise');
  }
  if (/^[（(【\[]?(?:男|女|合|旁白|独白|和声|rap|verse|chorus|hook)[）)】\]\s:：-]/iu.test(text)) {
    reasons.push('role_or_section_label');
  }
  if (/(?:傻[逼比]|撒逼|煞笔|他妈|妈的|卧槽|操你|日你|fuck|shit|bitch|nigg)/iu.test(text)) {
    reasons.push('abusive_or_explicit_language');
  }
  if (lineCount < 2) reasons.push('single_line_requires_manual_exception');
  if (lineCount > 4) reasons.push('too_many_lines');
  if ((isChinese && (units.length < 10 || units.length > 80)) || (!isChinese && (units.length < 6 || units.length > 42))) {
    reasons.push('length_out_of_range');
  }
  const unique = new Set(units).size;
  if (!units.length
      || unique / units.length < 0.24
      || /^(.)\1{4,}$/u.test(normalizeForComparison(text))
      || /([\p{L}])\1{3,}/u.test(text)) {
    reasons.push('low_information_repetition');
  }
  const parentheticalLength = Array.from(text.matchAll(/[（(【\[].*?[）)】\]]/gu))
    .reduce((total, match) => total + Array.from(match[0]).length, 0);
  if (parentheticalLength > 0) reasons.push('parenthetical_or_backing_vocal');
  if (!hasBalancedPairs(text)) reasons.push('damaged_brackets');

  return [...new Set(reasons)];
}

function keywordGroups(text) {
  const groups = [
    ['time_memory', /时间|岁月|年华|青春|曾经|后来|记忆|回忆|明天|昨天|今夜|永远|moment|memory|tomorrow|yesterday|tonight/iu],
    ['nature_scene', /风|雨|雪|云|月|星|海|河|山|花|树|天空|黄昏|黎明|夜|wind|rain|snow|moon|star|sea|river|sky|dawn|night/iu],
    ['journey_change', /路|远方|归来|离开|告别|成长|改变|出发|回家|journey|road|leave|return|change|grow/iu],
    ['inner_life', /孤独|自由|勇气|梦想|希望|遗憾|温柔|心|灵魂|命运|lonely|freedom|courage|dream|hope|soul|fate/iu],
    ['relationship', /相遇|拥抱|等待|陪伴|错过|思念|爱|别离|meet|embrace|wait|miss|love|goodbye/iu]
  ];
  return groups.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function candidateFlags(row, crossTrackDuplicateCount) {
  const text = row.text.trim();
  const lineCount = text.split(/\r?\n/u).filter((line) => line.trim()).length;
  const flags = [];
  if (!row.lyricist_name.trim()) flags.push('creator_missing');
  if (!row.license_url.trim() && row.provider !== 'publicdomain') flags.push('rights_needs_review');
  if (!hasBalancedPairs(row.track_name) || /(?:\bprod\.?|伴奏|纯音乐|demo\b)/iu.test(row.track_name)) {
    flags.push('track_metadata_suspicious');
  }
  if (/\d/u.test(text)) flags.push('numeric_content');
  if (/^[而但却也又仍还就才因所若如当把被让与及或的了着过我你他她它这那]/u.test(text)) flags.push('possible_context_dependency');
  if (/(?:我爱你|我想你|对不起|谢谢你|别离开|离不开你|永远爱你|i love you|i miss you|sorry)/iu.test(text)
      && contentUnits(text, row.language).length <= (row.language.startsWith('zh') ? 10 : 7)) {
    flags.push('generic_phrase');
  }
  if (crossTrackDuplicateCount > 1) flags.push('cross_track_duplicate');
  if (row.duplicate_count > 6) flags.push('heavy_repetition');
  if (/[，,。.!！?？;；:：]{2,}/u.test(text)) flags.push('punctuation_noise');
  if (lineCount < 2) flags.push('single_line_exception');
  return flags;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function scoreCandidate(row, flags) {
  const text = row.text.trim();
  const units = contentUnits(text, row.language);
  const isChinese = row.language.toLocaleLowerCase().startsWith('zh');
  const unitCount = units.length;
  const lineCount = text.split(/\r?\n/u).filter((line) => line.trim()).length;
  const diversity = units.length ? new Set(units).size / units.length : 0;
  const groups = keywordGroups(text);

  const source = clamp(((Number(row.score) - 60) / 30) * 15, 0, 15);
  const idealLength = isChinese
    ? (unitCount >= 18 && unitCount <= 50 ? 12 : unitCount >= 12 && unitCount <= 68 ? 8 : 4)
    : (unitCount >= 10 && unitCount <= 28 ? 12 : unitCount >= 6 && unitCount <= 38 ? 8 : 4);
  const lineStructure = lineCount === 3 ? 8 : lineCount === 2 || lineCount === 4 ? 7 : 0;
  const lexical = diversity >= 0.72 ? 15 : diversity >= 0.58 ? 11 : diversity >= 0.45 ? 7 : 3;
  const repetition = row.duplicate_count >= 2 && row.duplicate_count <= 4
    ? 10
    : row.duplicate_count === 1 ? 7 : row.duplicate_count <= 6 ? 6 : 3;
  const contrast = /但|却|仍|即使|哪怕|如果|直到|宁愿|而是|but|yet|even if|rather/iu.test(text) ? 4 : 0;
  const metaphor = /像|如同|仿佛|化作|成为|犹如|like|as if|become/iu.test(text) ? 4 : 0;
  const themeStatement = /人生|世界|命运|青春|成长|自由|孤独|梦想|记忆|时间|life|world|fate|youth|freedom|dream|memory|time/iu.test(text) ? 2 : 0;
  const parallelism = /(.{2,6})[，,\s]+(.{2,6})[，,\s]+/u.test(text) ? 3 : 0;
  const expression = clamp(groups.length * 2 + contrast + metaphor + themeStatement + parallelism, 0, 25);
  let form = 12;
  if (/[。！？.!?]$/u.test(text)) form += 3;
  if (flags.includes('punctuation_noise')) form -= 5;
  if (flags.includes('possible_context_dependency')) form -= 3;

  let total = source + idealLength + lineStructure + lexical + repetition + expression + clamp(form, 0, 15);
  if (flags.includes('numeric_content')) total -= 5;
  if (flags.includes('generic_phrase')) total -= 8;
  if (flags.includes('cross_track_duplicate')) total -= 10;
  if (flags.includes('heavy_repetition')) total -= 4;

  return {
    preScore: Math.round(clamp(total, 0, 100)),
    signals: {
      source_structure: Math.round(source),
      length_fit: idealLength,
      line_count: lineCount,
      line_structure: lineStructure,
      lexical_diversity: Math.round(diversity * 100) / 100,
      repetition_signal: repetition,
      expression_signal: expression,
      form_signal: clamp(form, 0, 15),
      keyword_groups: groups
    }
  };
}

function countValues(rows, field) {
  const counts = {};
  for (const row of rows) {
    for (const value of row[field] || []) counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function serializeCandidate(row, crossTrackDuplicateCount) {
  const flags = candidateFlags(row, crossTrackDuplicateCount);
  const { preScore, signals } = scoreCandidate(row, flags);
  return {
    segment_id: row.segment_id,
    source_track_id: row.source_track_id,
    segment_index: row.segment_index,
    text: row.text.trim(),
    line_count: row.text.trim().split(/\r?\n/u).filter((line) => line.trim()).length,
    adjacent_lines_verified: true,
    track: row.track_name,
    artist: row.artist_name,
    lyricist: row.lyricist_name,
    composer: row.composer_name,
    language: row.language,
    provider: row.provider,
    provider_track_id: row.provider_track_id,
    source_url: row.source_url,
    license_url: row.license_url,
    source_score: row.score,
    duplicate_count: row.duplicate_count,
    cross_track_duplicate_count: crossTrackDuplicateCount,
    pre_score: preScore,
    signals,
    flags,
    required_manual_checks: ['semantic_rubric', 'line_cohesion', 'reflective_aftertaste', 'creator_credit', 'source_and_rights', 'same_track_diversity'],
    rubric_template: {
      self_contained: null,
      line_cohesion: null,
      expression_density: null,
      reflective_aftertaste: null,
      imagery: null,
      emotional_resonance: null,
      rhythm_quotability: null
    }
  };
}

function applyDiversityQuotas(rows, options) {
  const selected = [];
  const trackCounts = new Map();
  const artistCounts = new Map();
  for (const row of rows) {
    const trackKey = String(row.source_track_id);
    const artistKey = row.artist.trim().toLocaleLowerCase() || `unknown:${trackKey}`;
    if ((trackCounts.get(trackKey) || 0) >= options.perTrack) continue;
    if ((artistCounts.get(artistKey) || 0) >= options.perArtist) continue;
    selected.push(row);
    trackCounts.set(trackKey, (trackCounts.get(trackKey) || 0) + 1);
    artistCounts.set(artistKey, (artistCounts.get(artistKey) || 0) + 1);
    if (selected.length >= options.limit) break;
  }
  return selected;
}

function evenAuditSample(rows, limit) {
  if (!limit || !rows.length) return [];
  if (rows.length <= limit) return rows;
  if (limit === 1) return [rows[Math.floor(rows.length / 2)]];
  const result = [];
  for (let index = 0; index < limit; index += 1) {
    result.push(rows[Math.floor(index * (rows.length - 1) / (limit - 1))]);
  }
  return result;
}

function markdownEscape(value) {
  return String(value ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
}

function toMarkdown(batch) {
  const lines = [
    '# 歌词摘句预筛批次',
    '',
    `- 数据库：\`${batch.database}\``,
    `- 扫描：${batch.summary.scanned}`,
    `- 硬性排除：${batch.summary.hard_rejected}`,
    `- 可复核：${batch.summary.eligible}`,
    `- 本批候选：${batch.summary.selected}`,
    `- 审计样本：${batch.summary.audit_sample}`,
    '',
    '## 候选',
    '',
    '| segment_id | 预分 | 表演者 | 歌曲 | 原文 | 提醒 |',
    '|---:|---:|---|---|---|---|'
  ];
  for (const item of batch.candidates) {
    lines.push(`| ${item.segment_id} | ${item.pre_score} | ${markdownEscape(item.artist)} | ${markdownEscape(item.track)} | ${markdownEscape(item.text)} | ${markdownEscape(item.flags.join(', '))} |`);
  }
  lines.push('', '## 低预分审计样本', '', '| segment_id | 预分 | 表演者 | 歌曲 | 原文 |', '|---:|---:|---|---|---|');
  for (const item of batch.audit_sample) {
    lines.push(`| ${item.segment_id} | ${item.pre_score} | ${markdownEscape(item.artist)} | ${markdownEscape(item.track)} | ${markdownEscape(item.text)} |`);
  }
  lines.push('', '> `pre_score` 仅用于复核排序，不代表经典程度，也不能自动批准。', '');
  return lines.join('\n');
}

export function prepareReviewBatch(options) {
  const databasePath = discoverDatabase(options.db);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const where = ['ls.status = ?', 'ls.score >= ?'];
    const parameters = [options.status, options.minSourceScore];
    if (options.provider) {
      where.push('st.provider = ?');
      parameters.push(options.provider);
    }
    if (options.language) {
      where.push('ls.language = ?');
      parameters.push(options.language);
    }
    const query = `
      SELECT
        ls.id AS segment_id,
        ls.source_track_id,
        ls.segment_index,
        ls.text,
        ls.normalized_text,
        ls.language,
        ls.score,
        ls.duplicate_count,
        st.provider,
        st.provider_track_id,
        st.track_name,
        st.artist_name,
        st.lyricist_name,
        st.composer_name,
        st.source_url,
        st.license_url
      FROM lyric_segments ls
      JOIN source_tracks st ON st.id = ls.source_track_id
      WHERE ${where.join(' AND ')}
      ORDER BY ls.score DESC, ls.id ASC
    `;
    const rows = database.prepare(query).all(...parameters);

    const tracksByNormalizedText = new Map();
    for (const row of rows) {
      const key = normalizeForComparison(row.normalized_text || row.text);
      if (!tracksByNormalizedText.has(key)) tracksByNormalizedText.set(key, new Set());
      tracksByNormalizedText.get(key).add(row.source_track_id);
    }

    const hardRejected = [];
    const eligible = [];
    for (const row of rows) {
      const reasons = hardRejectReasons(row);
      if (reasons.length) {
        hardRejected.push({ hard_reject_reasons: reasons });
        continue;
      }
      const key = normalizeForComparison(row.normalized_text || row.text);
      const serialized = serializeCandidate(row, tracksByNormalizedText.get(key)?.size || 1);
      if (serialized.pre_score >= options.minPreScore) eligible.push(serialized);
    }

    eligible.sort((left, right) =>
      right.pre_score - left.pre_score
      || right.source_score - left.source_score
      || left.segment_id - right.segment_id
    );
    const selected = applyDiversityQuotas(eligible, options);
    const selectedIds = new Set(selected.map((item) => item.segment_id));
    const auditPool = eligible
      .filter((item) => !selectedIds.has(item.segment_id))
      .sort((left, right) => left.pre_score - right.pre_score || left.segment_id - right.segment_id);
    const auditSample = evenAuditSample(auditPool, options.auditLimit);

    return {
      generated_at: new Date().toISOString(),
      database: databasePath,
      filters: {
        provider: options.provider || 'all',
        language: options.language || 'all',
        status: options.status,
        min_source_score: options.minSourceScore,
        min_pre_score: options.minPreScore,
        per_track: options.perTrack,
        per_artist: options.perArtist
      },
      summary: {
        scanned: rows.length,
        hard_rejected: hardRejected.length,
        below_pre_score: rows.length - hardRejected.length - eligible.length,
        eligible: eligible.length,
        selected: selected.length,
        audit_sample: auditSample.length,
        selected_tracks: new Set(selected.map((item) => item.source_track_id)).size,
        selected_artists: new Set(selected.map((item) => item.artist)).size,
        selected_missing_lyricist: selected.filter((item) => !item.lyricist).length
      },
      hard_reject_counts: countValues(hardRejected, 'hard_reject_reasons'),
      flag_counts: countValues(eligible, 'flags'),
      candidates: selected,
      audit_sample: auditSample,
      notice: 'pre_score is deterministic triage only; preserve line breaks and apply the multi-line semantic rubric before any approval'
    };
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
  const batch = prepareReviewBatch(options);
  const inferredFormat = options.output && extname(options.output).toLocaleLowerCase() === '.md' ? 'markdown' : 'json';
  const format = options.format || inferredFormat;
  const output = format === 'markdown' ? toMarkdown(batch) : `${JSON.stringify(batch, null, 2)}\n`;
  if (options.output) {
    const outputPath = resolve(options.output);
    writeFileSync(outputPath, output, 'utf8');
    process.stdout.write(`${JSON.stringify({ output: outputPath, summary: batch.summary })}\n`);
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
