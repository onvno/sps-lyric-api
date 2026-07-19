#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const DEFAULTS = Object.freeze({
  backupDir: 'backup',
  db: 'data/lyrics.db',
  outputDir: 'backup/converted',
  apply: false
});

const FORMAL_COLUMNS = ['id', 'song', 'content', 'lang', 'singer', 'type', 'writer', 'contributor', 'createtime'];
const APPLY_COLUMNS = ['id', 'song', 'content', 'lang', 'singer', 'writer', 'contributor', 'createtime'];

function portablePath(value) {
  if (!value) return '';
  const absolute = resolve(value);
  const local = relative(process.cwd(), absolute);
  return local && !local.startsWith('..') ? local : basename(absolute);
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };
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
    if (key === 'backup-dir') options.backupDir = value;
    else if (key === 'db') options.db = value;
    else if (key === 'output-dir') options.outputDir = value;
    else throw new Error(`Unknown option: --${key}`);
  }
  return options;
}

const HELP = `Import legacy MySQL lyric excerpts into the local SQLite review queue.

Usage:
  node scripts/import-legacy-backup.mjs [options]

Options:
  --backup-dir PATH   Backup folder (default backup)
  --db PATH           SQLite database (default data/lyrics.db)
  --output-dir PATH   CSV/JSON report folder (default backup/converted)
  --apply             Create a consistent SQLite backup and write novel rows
  --help              Show this help

Without --apply the command is read-only. Imported rows remain candidates and are not published.`;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseMySqlValues(sql, tableName) {
  const marker = `INSERT INTO \`${tableName}\` VALUES `;
  const markerAt = sql.indexOf(marker);
  if (markerAt === -1) return [];
  let cursor = markerAt + marker.length;
  const rows = [];

  function skipWhitespace() {
    while (/\s/u.test(sql[cursor] || '')) cursor += 1;
  }

  function parseString() {
    cursor += 1;
    let value = '';
    const escapes = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };
    while (cursor < sql.length) {
      const character = sql[cursor++];
      if (character === "'") {
        if (sql[cursor] === "'") {
          cursor += 1;
          value += "'";
          continue;
        }
        return value;
      }
      if (character === '\\') {
        const escaped = sql[cursor++];
        value += escapes[escaped] ?? escaped;
      } else {
        value += character;
      }
    }
    throw new Error(`Unterminated SQL string in ${tableName}`);
  }

  function parseValue() {
    skipWhitespace();
    if (sql[cursor] === "'") return parseString();
    if (sql.startsWith('NULL', cursor)) {
      cursor += 4;
      return null;
    }
    const start = cursor;
    while (cursor < sql.length && ![',', ')'].includes(sql[cursor])) cursor += 1;
    const token = sql.slice(start, cursor).trim();
    if (!token) throw new Error(`Empty SQL value in ${tableName}`);
    const number = Number(token);
    return Number.isFinite(number) ? number : token;
  }

  while (cursor < sql.length) {
    skipWhitespace();
    if (sql[cursor] === ';') break;
    if (sql[cursor] === ',') {
      cursor += 1;
      continue;
    }
    if (sql[cursor] !== '(') throw new Error(`Expected tuple at offset ${cursor} in ${tableName}`);
    cursor += 1;
    const row = [];
    while (cursor < sql.length) {
      row.push(parseValue());
      skipWhitespace();
      if (sql[cursor] === ',') {
        cursor += 1;
        continue;
      }
      if (sql[cursor] === ')') {
        cursor += 1;
        break;
      }
      throw new Error(`Expected comma or tuple end at offset ${cursor} in ${tableName}`);
    }
    rows.push(row);
  }
  return rows;
}

function rowsToObjects(rows, columns, tableName) {
  return rows.map((values, index) => {
    if (values.length !== columns.length) {
      throw new Error(`${tableName} row ${index + 1} has ${values.length} values; expected ${columns.length}`);
    }
    return Object.fromEntries(columns.map((column, columnIndex) => [column, values[columnIndex]]));
  });
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanContent(value) {
  return decodeHtml(value)
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function cleanField(value) {
  return decodeHtml(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizedKey(value) {
  return cleanField(value).toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

function normalizedSegment(value) {
  return cleanContent(value).toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function languageCode(value) {
  return cleanField(value).toLocaleLowerCase() === 'en' ? 'en' : 'zh-CN';
}

function legacyTimestamp(value) {
  const cleaned = cleanField(value);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(cleaned)) return new Date().toISOString();
  const parsed = new Date(`${cleaned.replace(' ', 'T')}+08:00`);
  return Number.isNaN(parsed.valueOf()) ? new Date().toISOString() : parsed.toISOString();
}

function looksLikeSpam(row) {
  const identityFields = [row.song, row.singer, row.writer, row.contributor].map(cleanField);
  const emailCount = identityFields.filter((field) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(field)).length;
  const content = cleanContent(row.content);
  const hasCjk = /[\p{Script=Han}]/u.test(content);
  return emailCount >= 2 || (emailCount >= 1 && !hasCjk && content.length < 40);
}

function tokensFor(text, language) {
  const segmenter = new Intl.Segmenter(language === 'en' ? 'en' : 'zh-CN', { granularity: 'word' });
  return [...segmenter.segment(text)].filter((item) => item.isWordLike).map((item) => item.segment);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvFor(rows, fields) {
  return `\uFEFF${[
    fields.join(','),
    ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(','))
  ].join('\n')}\n`;
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) counts[row[field]] = (counts[row[field]] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function databaseStats(database) {
  return {
    entries: database.prepare('SELECT COUNT(*) AS n FROM entries').get().n,
    source_tracks: database.prepare('SELECT COUNT(*) AS n FROM source_tracks').get().n,
    lyric_segments: database.prepare('SELECT COUNT(*) AS n FROM lyric_segments').get().n,
    candidates: database.prepare("SELECT COUNT(*) AS n FROM lyric_segments WHERE status = 'candidate'").get().n,
    legacy_tracks: database.prepare("SELECT COUNT(*) AS n FROM source_tracks WHERE provider IN ('legacy_backup_sps', 'legacy_backup_apply')").get().n,
    legacy_segments: database.prepare("SELECT COUNT(*) AS n FROM lyric_segments ls JOIN source_tracks st ON st.id = ls.source_track_id WHERE st.provider IN ('legacy_backup_sps', 'legacy_backup_apply')").get().n
  };
}

function loadExistingIndex(database) {
  const exact = new Map();
  const byText = new Map();
  const register = (sourceType, id, song, singer, content) => {
    const songKey = normalizedKey(song);
    const contentKey = normalizedKey(content);
    if (!songKey || !contentKey) return;
    const value = { source_type: sourceType, source_id: String(id), song: cleanField(song), singer: cleanField(singer) };
    const exactKey = `${songKey}|${contentKey}`;
    if (!exact.has(exactKey)) exact.set(exactKey, value);
    if (!byText.has(contentKey)) byText.set(contentKey, []);
    byText.get(contentKey).push(value);
  };

  for (const row of database.prepare('SELECT id, song_title, excerpt FROM entries').all()) {
    register('entry', row.id, row.song_title, '', row.excerpt);
  }
  for (const row of database.prepare(`
    SELECT ls.id, st.track_name, st.artist_name, ls.text
    FROM lyric_segments ls
    JOIN source_tracks st ON st.id = ls.source_track_id
  `).all()) {
    register('segment', row.id, row.track_name, row.artist_name, row.text);
  }
  return { exact, byText };
}

function prepareLegacyRows(formalRows, applyRows, database) {
  const existing = loadExistingIndex(database);
  const seenBackupExact = new Map();
  const seenBackupText = new Map();
  const prepared = [];

  const sourceSets = [
    { table: 'sps_sps', sourceKind: 'formal', provider: 'legacy_backup_sps', rows: formalRows },
    { table: 'sps_apply', sourceKind: 'pending', provider: 'legacy_backup_apply', rows: applyRows }
  ];

  for (const sourceSet of sourceSets) {
    for (const raw of sourceSet.rows) {
      const row = {
        source_table: sourceSet.table,
        source_kind: sourceSet.sourceKind,
        provider: sourceSet.provider,
        legacy_id: Number(raw.id),
        song: cleanField(raw.song),
        content: cleanContent(raw.content),
        content_preview: cleanContent(raw.content).replaceAll('\n', ' ⏎ '),
        legacy_language: cleanField(raw.lang),
        language: languageCode(raw.lang),
        singer: cleanField(raw.singer),
        type: cleanField(raw.type || (sourceSet.sourceKind === 'formal' ? 'song' : 'submission')),
        writer: cleanField(raw.writer),
        contributor: cleanField(raw.contributor),
        legacy_created_at: cleanField(raw.createtime),
        created_at: legacyTimestamp(raw.createtime),
        decision: '',
        reason: '',
        matched_source_type: '',
        matched_source_id: '',
        matched_song: '',
        provider_track_id: '',
        local_track_id: '',
        local_segment_id: ''
      };
      const songKey = normalizedKey(row.song);
      const contentKey = normalizedKey(row.content);
      const exactKey = `${songKey}|${contentKey}`;
      const trackKey = `${normalizedKey(row.singer)}|${songKey}|${row.language}`;
      row.provider_track_id = sha256(`${row.source_table}|${trackKey}`).slice(0, 24);

      if (!row.song || !row.singer || !row.writer || !row.content) {
        row.decision = 'skip_invalid';
        row.reason = '缺少歌曲、表演者、创作者或歌词正文';
      } else if (looksLikeSpam(raw)) {
        row.decision = 'skip_spam';
        row.reason = '投稿字段呈批量邮箱/随机文本特征';
      } else if (!songKey || contentKey.length < 4) {
        row.decision = 'skip_invalid';
        row.reason = '规范化后内容过短';
      } else if (seenBackupExact.has(exactKey)) {
        const match = seenBackupExact.get(exactKey);
        row.decision = 'skip_backup_duplicate';
        row.reason = `与备份 ${match.source_table} #${match.legacy_id} 完全重复`;
        row.matched_source_type = match.source_table;
        row.matched_source_id = String(match.legacy_id);
        row.matched_song = match.song;
      } else if (existing.exact.has(exactKey)) {
        const match = existing.exact.get(exactKey);
        row.decision = 'skip_existing_exact';
        row.reason = `当前 SQLite 已有同歌同片段 ${match.source_type} #${match.source_id}`;
        row.matched_source_type = match.source_type;
        row.matched_source_id = match.source_id;
        row.matched_song = match.song;
      } else {
        const textMatches = [
          ...(existing.byText.get(contentKey) || []),
          ...(seenBackupText.get(contentKey) || [])
        ].filter((match) => normalizedKey(match.song) !== songKey);
        if (textMatches.length) {
          const match = textMatches[0];
          row.decision = 'skip_content_conflict';
          row.reason = `相同正文出现在另一首歌《${match.song}》，需人工核对`;
          row.matched_source_type = match.source_type || match.source_table;
          row.matched_source_id = String(match.source_id || match.legacy_id);
          row.matched_song = match.song;
        } else {
          row.decision = 'import_candidate';
          row.reason = sourceSet.sourceKind === 'formal'
            ? '旧正式摘句；作为待复核候选导入，不自动公开'
            : '旧待审投稿；作为待复核候选导入，不自动公开';
        }
      }

      if (!seenBackupExact.has(exactKey)) seenBackupExact.set(exactKey, row);
      if (!seenBackupText.has(contentKey)) seenBackupText.set(contentKey, []);
      seenBackupText.get(contentKey).push(row);
      prepared.push(row);
    }
  }
  return prepared;
}

function groupImportRows(rows) {
  const groups = new Map();
  for (const row of rows.filter((item) => item.decision === 'import_candidate')) {
    const key = `${row.provider}|${row.provider_track_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()];
}

function sqliteString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function applyImport(database, rows, backupDir) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `lyrics-before-legacy-import-${timestamp}.db`);
  database.exec(`VACUUM INTO ${sqliteString(backupPath)}`);

  const insertTrack = database.prepare(`
    INSERT INTO source_tracks(
      provider, provider_track_id, track_name, artist_name, lyricist_name, composer_name, album_name,
      duration, language, lyrics_text, synced_lyrics_text, source_url, license_url, fetched_at
    ) VALUES(?, ?, ?, ?, ?, '', ?, 0, ?, ?, '', '', '', ?)
    ON CONFLICT(provider, provider_track_id) DO NOTHING
  `);
  const getTrack = database.prepare('SELECT id FROM source_tracks WHERE provider = ? AND provider_track_id = ?');
  const insertSegment = database.prepare(`
    INSERT INTO lyric_segments(
      source_track_id, segment_index, text, normalized_text, tokens_json,
      language, word_count, char_count, score, duplicate_count,
      start_ms, end_ms, status, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, 'candidate', ?)
  `);
  const insertAction = database.prepare(`
    INSERT INTO review_actions(entity_type, entity_id, action, note, created_at)
    VALUES('lyric_segment', ?, 'legacy_import', ?, ?)
  `);
  const setMeta = database.prepare(`
    INSERT INTO metadata(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  database.exec('BEGIN IMMEDIATE');
  try {
    for (const group of groupImportRows(rows)) {
      group.sort((left, right) => left.legacy_id - right.legacy_id);
      const first = group[0];
      const writers = [...new Set(group.map((row) => row.writer).filter(Boolean))];
      const fullText = group.map((row) => row.content).join('\n\n');
      const fetchedAt = group.map((row) => row.created_at).sort().at(-1);
      insertTrack.run(
        first.provider,
        first.provider_track_id,
        first.song,
        first.singer,
        writers.join(' / '),
        `MySQL backup 2026-07-16 · ${first.source_table}`,
        first.language,
        fullText,
        fetchedAt
      );
      const track = getTrack.get(first.provider, first.provider_track_id);
      if (!track) throw new Error(`Failed to create legacy track ${first.provider_track_id}`);

      for (let index = 0; index < group.length; index += 1) {
        const row = group[index];
        const tokens = tokensFor(row.content, row.language);
        const result = insertSegment.run(
          track.id,
          index,
          row.content,
          normalizedSegment(row.content),
          JSON.stringify(tokens),
          row.language,
          tokens.length,
          Array.from(row.content).length,
          row.source_kind === 'formal' ? 90 : 75,
          row.created_at
        );
        row.local_track_id = String(track.id);
        row.local_segment_id = String(result.lastInsertRowid);
        row.decision = 'imported_candidate';
        insertAction.run(
          row.local_segment_id,
          `${row.source_table} #${row.legacy_id}；旧数据恢复为待审核候选，未自动公开`,
          new Date().toISOString()
        );
      }
    }
    const now = new Date().toISOString();
    setMeta.run('legacy_backup_imported_at', now);
    setMeta.run('legacy_backup_import_summary', JSON.stringify(countBy(rows, 'decision')));
    setMeta.run('updated_at', now);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return backupPath;
}

function reportRow(row) {
  return {
    source_table: row.source_table,
    source_kind: row.source_kind,
    legacy_id: row.legacy_id,
    song: row.song,
    content: row.content,
    content_preview: row.content_preview,
    legacy_language: row.legacy_language,
    language: row.language,
    singer: row.singer,
    type: row.type,
    writer: row.writer,
    contributor: row.contributor,
    legacy_created_at: row.legacy_created_at,
    decision: row.decision,
    reason: row.reason,
    matched_source_type: row.matched_source_type,
    matched_source_id: row.matched_source_id,
    matched_song: row.matched_song,
    provider: row.provider,
    provider_track_id: row.provider_track_id,
    local_track_id: row.local_track_id,
    local_segment_id: row.local_segment_id
  };
}

export async function importLegacyBackup(options) {
  const backupDir = resolve(options.backupDir);
  const dbPath = resolve(options.db);
  const outputDir = resolve(options.outputDir);
  const formalPath = join(backupDir, 'sps_sps_2026071601.sql');
  const applyPath = join(backupDir, 'sps_apply_2026071601.sql');
  const combinedPath = join(backupDir, 'backup.sql');
  const [formalSql, applySql, combinedSql] = await Promise.all([
    readFile(formalPath, 'utf8'),
    readFile(applyPath, 'utf8'),
    readFile(combinedPath, 'utf8')
  ]);

  const formalValues = parseMySqlValues(formalSql, 'sps_sps');
  const applyValues = parseMySqlValues(applySql, 'sps_apply');
  const combinedFormal = parseMySqlValues(combinedSql, 'sps_sps');
  const combinedApply = parseMySqlValues(combinedSql, 'sps_apply');
  if (!formalValues.length) throw new Error('No sps_sps rows found in the dated backup');
  if (!applyValues.length) throw new Error('No sps_apply rows found in the dated backup');

  const formalRows = rowsToObjects(formalValues, FORMAL_COLUMNS, 'sps_sps');
  const applyRows = rowsToObjects(applyValues, APPLY_COLUMNS, 'sps_apply');
  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  let backupPath = '';
  let prepared;
  const before = databaseStats(database);
  try {
    prepared = prepareLegacyRows(formalRows, applyRows, database);
    const plannedImportTracks = groupImportRows(prepared).length;
    if (options.apply) {
      const databaseBackupDir = resolve(join(dbPath, '..', 'backups'));
      await mkdir(databaseBackupDir, { recursive: true });
      backupPath = applyImport(database, prepared, databaseBackupDir);
    }
    const after = databaseStats(database);
    const rows = prepared.map(reportRow);
    const formalReportRows = rows.filter((row) => row.source_table === 'sps_sps');
    const applyReportRows = rows.filter((row) => row.source_table === 'sps_apply');
    const report = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      mode: options.apply ? 'applied' : 'dry_run',
      database: portablePath(dbPath),
      database_backup: portablePath(backupPath),
      source_files: {
        formal: { path: portablePath(formalPath), file_sha256: sha256(formalSql), rows: formalRows.length },
        pending: { path: portablePath(applyPath), file_sha256: sha256(applySql), rows: applyRows.length },
        combined: {
          path: portablePath(combinedPath),
          file_sha256: sha256(combinedSql),
          formal_rows: combinedFormal.length,
          pending_rows: combinedApply.length,
          formal_matches_dated_export: sha256(JSON.stringify(combinedFormal)) === sha256(JSON.stringify(formalValues)),
          pending_matches_dated_export: sha256(JSON.stringify(combinedApply)) === sha256(JSON.stringify(applyValues))
        }
      },
      excluded_tables: ['sps_pv（访问量）', 'sps_user（账号及密码哈希）', 'Django 系统表'],
      import_policy: {
        destination: 'source_tracks + lyric_segments',
        imported_status: 'candidate',
        publication: 'never automatic',
        exact_conflict: 'same normalized song title and excerpt in entries or lyric_segments',
        cross_song_conflict: 'same normalized excerpt under another song is skipped for manual review'
      },
      database_before: before,
      database_after: after,
      summary: {
        formal_rows: formalReportRows.length,
        pending_rows: applyReportRows.length,
        total_rows: rows.length,
        decisions: countBy(rows, 'decision'),
        unique_songs: new Set(rows.map((row) => `${normalizedKey(row.singer)}|${normalizedKey(row.song)}`)).size,
        planned_import_tracks: plannedImportTracks,
        imported_tracks: after.legacy_tracks - before.legacy_tracks,
        imported_segments: after.legacy_segments - before.legacy_segments
      },
      rows
    };

    await mkdir(outputDir, { recursive: true });
    const fields = Object.keys(reportRow(prepared[0]));
    const paths = {
      formalCsv: join(outputDir, 'legacy_sps_sps.csv'),
      pendingCsv: join(outputDir, 'legacy_sps_apply.csv'),
      decisionsCsv: join(outputDir, 'legacy_import_decisions.csv'),
      reportJson: join(outputDir, 'legacy_import_report.json')
    };
    await Promise.all([
      writeFile(paths.formalCsv, csvFor(formalReportRows, fields), 'utf8'),
      writeFile(paths.pendingCsv, csvFor(applyReportRows, fields), 'utf8'),
      writeFile(paths.decisionsCsv, csvFor(rows, fields), 'utf8'),
      writeFile(paths.reportJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    ]);
    return { report, paths };
  } finally {
    database.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const result = await importLegacyBackup(options);
  process.stdout.write(`${JSON.stringify({
    mode: result.report.mode,
    summary: result.report.summary,
    database_before: result.report.database_before,
    database_after: result.report.database_after,
    database_backup: result.report.database_backup,
    outputs: Object.fromEntries(Object.entries(result.paths).map(([key, value]) => [key, portablePath(value)]))
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
