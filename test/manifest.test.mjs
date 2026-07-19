import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLyricsDatabase } from '../db.mjs';
import { analyzeLyrics } from '../lyric-analysis.mjs';
import { exportProviderManifest } from '../import-manifest.mjs';

test('exports JSON, CSV and Markdown manifests with normalized duplicate markers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lyrics-manifest-'));
  const dbPath = join(directory, 'lyrics.db');
  const outputDir = join(directory, 'manifests');
  const database = openLyricsDatabase({ dbPath, seedPath: '' });
  try {
    for (const [providerId, title] of [['one', '妈妈, 我'], ['two', '妈妈,我']]) {
      const lyrics = '晚风吹过安静的街道\n远方的人也在轻轻歌唱';
      const track = database.saveSourceTrack({
        provider: 'chinese_lyrics',
        providerId,
        trackName: title,
        artistName: '测试歌手',
        lyricistName: '测试作词',
        composerName: '',
        albumName: 'ChineseLyrics 离线库 · lyrics1.json',
        duration: 0,
        language: 'zh-CN',
        plainLyrics: lyrics,
        syncedLyrics: '',
        sourceUrl: 'https://example.com/source',
        licenseUrl: ''
      });
      database.saveSegments(track.id, analyzeLyrics({ plainLyrics: lyrics, language: 'zh-CN' }).segments);
    }
  } finally {
    database.close();
  }

  try {
    const result = await exportProviderManifest({ dbPath, provider: 'chinese_lyrics', outputDir });
    const manifest = JSON.parse(await readFile(result.jsonPath, 'utf8'));
    const csv = await readFile(result.csvPath, 'utf8');
    const markdown = await readFile(result.markdownPath, 'utf8');
    assert.equal(manifest.summary.songCount, 2);
    assert.equal(manifest.summary.duplicateDedupeKeyGroups, 1);
    assert.ok(manifest.songs.every((song) => song.dedupeCollisionCount === 2));
    assert.match(csv, /lyricsSha256/);
    assert.match(markdown, /规范化重名提醒/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
