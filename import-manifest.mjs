import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function stableText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
    .trim();
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function exportProviderManifest({ dbPath, provider, outputDir }) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let rows;
  try {
    rows = db.prepare(`
      SELECT
        t.id AS local_track_id,
        t.provider_track_id,
        t.track_name,
        t.artist_name,
        t.lyricist_name,
        t.composer_name,
        t.album_name,
        t.source_url,
        t.fetched_at,
        t.lyrics_text,
        COUNT(s.id) AS segment_count,
        SUM(CASE WHEN s.status = 'candidate' THEN 1 ELSE 0 END) AS candidate_count,
        SUM(CASE WHEN s.status = 'filtered' THEN 1 ELSE 0 END) AS filtered_count,
        SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
        SUM(CASE WHEN s.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
        ROUND(AVG(CASE WHEN s.status = 'candidate' THEN s.score END), 2) AS candidate_average_score,
        MAX(CASE WHEN s.status = 'candidate' THEN s.score END) AS candidate_max_score
      FROM source_tracks t
      LEFT JOIN lyric_segments s ON s.source_track_id = t.id
      WHERE t.provider = ?
      GROUP BY t.id
      ORDER BY t.artist_name COLLATE NOCASE, t.track_name COLLATE NOCASE, t.id
    `).all(provider);
  } finally {
    db.close();
  }

  const baseSongs = rows.map((row) => {
    const titleKey = stableText(row.track_name);
    const singerKey = stableText(row.artist_name);
    return {
      localTrackId: row.local_track_id,
      provider,
      providerTrackId: row.provider_track_id,
      dedupeKey: `${singerKey}:${titleKey}`,
      title: row.track_name,
      singer: row.artist_name,
      lyricist: row.lyricist_name,
      composer: row.composer_name,
      sourceFile: row.album_name.split(' · ').at(-1) || '',
      sourceUrl: row.source_url,
      lyricsSha256: createHash('sha256').update(row.lyrics_text).digest('hex'),
      segmentCount: row.segment_count,
      candidateCount: row.candidate_count,
      filteredCount: row.filtered_count,
      approvedCount: row.approved_count,
      rejectedCount: row.rejected_count,
      candidateAverageScore: row.candidate_average_score,
      candidateMaxScore: row.candidate_max_score,
      fetchedAt: row.fetched_at
    };
  });
  const dedupeCounts = new Map();
  baseSongs.forEach((song) => dedupeCounts.set(song.dedupeKey, (dedupeCounts.get(song.dedupeKey) || 0) + 1));
  const songs = baseSongs.map((song) => ({
    ...song,
    dedupeCollisionCount: dedupeCounts.get(song.dedupeKey) || 1
  }));
  const duplicateDedupeKeyGroups = [...dedupeCounts.values()].filter((count) => count > 1);

  const summary = {
    songCount: songs.length,
    singerCount: new Set(songs.map((song) => song.singer)).size,
    segmentCount: songs.reduce((sum, song) => sum + song.segmentCount, 0),
    candidateCount: songs.reduce((sum, song) => sum + song.candidateCount, 0),
    filteredCount: songs.reduce((sum, song) => sum + song.filteredCount, 0),
    approvedCount: songs.reduce((sum, song) => sum + song.approvedCount, 0),
    rejectedCount: songs.reduce((sum, song) => sum + song.rejectedCount, 0),
    duplicateDedupeKeyGroups: duplicateDedupeKeyGroups.length,
    songsInDuplicateGroups: duplicateDedupeKeyGroups.reduce((sum, count) => sum + count, 0)
  };
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provider,
    databaseFile: basename(dbPath),
    matching: {
      primary: 'providerTrackId：导入器根据“歌手 + 歌名”生成的稳定 SHA-256 前 20 位',
      fallback: 'dedupeKey：歌手和歌名经 NFKC、转小写、移除标点后拼接',
      content: 'lyricsSha256：完整歌词文本哈希，可识别同名但内容变化的版本'
    },
    summary,
    songs
  };

  await mkdir(outputDir, { recursive: true });
  const jsonPath = join(outputDir, `${provider}.json`);
  const csvPath = join(outputDir, `${provider}.csv`);
  const markdownPath = join(outputDir, `${provider}.md`);
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const fields = [
    'localTrackId', 'providerTrackId', 'dedupeKey', 'dedupeCollisionCount', 'title', 'singer', 'lyricist', 'composer',
    'sourceFile', 'segmentCount', 'candidateCount', 'filteredCount', 'approvedCount',
    'rejectedCount', 'candidateAverageScore', 'candidateMaxScore', 'lyricsSha256', 'sourceUrl', 'fetchedAt'
  ];
  const csv = [
    fields.join(','),
    ...songs.map((song) => fields.map((field) => csvCell(song[field])).join(','))
  ].join('\n');
  await writeFile(csvPath, `${csv}\n`, 'utf8');

  const singerGroups = new Map();
  songs.forEach((song) => {
    const group = singerGroups.get(song.singer) || [];
    group.push(song);
    singerGroups.set(song.singer, group);
  });
  const markdown = [
    '# ChineseLyrics 入库歌曲清单',
    '',
    `生成时间：${manifest.generatedAt}`,
    '',
    `- 歌曲：${summary.songCount}`,
    `- 歌手：${summary.singerCount}`,
    `- 分片：${summary.segmentCount}`,
    `- 待审核候选：${summary.candidateCount}`,
    `- 已过滤：${summary.filteredCount}`,
    `- 规范化重名组：${summary.duplicateDedupeKeyGroups}（共 ${summary.songsInDuplicateGroups} 首，清单中已标记）`,
    '',
    '匹配优先使用 `providerTrackId`；跨数据源对比可使用 `dedupeKey`，同名歌词内容变化可比较 `lyricsSha256`。',
    '',
    '## 规范化重名提醒',
    ''
  ];
  const collisions = songs.filter((song) => song.dedupeCollisionCount > 1);
  markdown.push(...(collisions.length
    ? collisions.map((song) => `- ${song.singer}《${song.title}》— \`${song.dedupeKey}\` / \`${song.providerTrackId}\``)
    : ['- 无']));
  markdown.push('', '## 按歌手列出的已入库歌曲', '');
  for (const [singer, singerSongs] of singerGroups) {
    markdown.push(`### ${singer}`, '');
    for (const song of singerSongs) {
      markdown.push(`- 《${song.title}》— 候选 ${song.candidateCount} / 过滤 ${song.filteredCount} / 本地 ID ${song.localTrackId} / \`${song.providerTrackId}\``);
    }
    markdown.push('');
  }
  await writeFile(markdownPath, `${markdown.join('\n')}\n`, 'utf8');
  return { jsonPath, csvPath, markdownPath, summary };
}
