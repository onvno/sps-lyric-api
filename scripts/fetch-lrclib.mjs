import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLyricsDatabase } from '../db.mjs';
import { analyzeLyrics } from '../lyric-analysis.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dbPath = process.env.LYRICS_DB_PATH || join(ROOT, 'data', 'lyrics.db');
const queries = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);

function comparableTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

if (!queries.length) {
  console.error('用法：npm run lyrics:fetch -- "Amazing Grace" "Auld Lang Syne"');
  process.exitCode = 1;
} else {
  await mkdir(dirname(dbPath), { recursive: true });
  const database = openLyricsDatabase({
    dbPath,
    seedPath: join(ROOT, 'data', 'store.json')
  });

  try {
    for (const query of queries) {
      const searchUrl = new URL('https://lrclib.net/api/search');
      searchUrl.searchParams.set('q', query);
      const searchResponse = await fetch(searchUrl, {
        headers: { 'user-agent': 'lyric-lines-api/0.2 (personal-local-library)' }
      });
      if (!searchResponse.ok) throw new Error(`搜索“${query}”失败：HTTP ${searchResponse.status}`);
      const matches = await searchResponse.json();
      const usable = matches.filter((item) => !item.instrumental && (item.plainLyrics || item.syncedLyrics));
      const queryTitle = comparableTitle(query);
      const match = usable.find((item) => comparableTitle(item.trackName || item.name) === queryTitle)
        || usable.find((item) => comparableTitle(item.trackName || item.name).includes(queryTitle))
        || usable[0];
      if (!match) {
        console.warn(`未找到带歌词的版本：${query}`);
        continue;
      }

      const plainLyrics = String(match.plainLyrics || '');
      const syncedLyrics = String(match.syncedLyrics || '');
      const analysis = analyzeLyrics({ plainLyrics, syncedLyrics });
      const track = database.saveSourceTrack({
        provider: 'lrclib',
        providerId: String(match.id),
        trackName: String(match.trackName || match.name || query).trim(),
        artistName: String(match.artistName || '').trim(),
        albumName: String(match.albumName || '').trim(),
        duration: Number(match.duration) || 0,
        language: analysis.summary.language,
        plainLyrics,
        syncedLyrics,
        sourceUrl: `https://lrclib.net/api/get/${match.id}`,
        licenseUrl: ''
      });
      database.saveSegments(track.id, analysis.segments);
      console.log(JSON.stringify({
        query,
        localTrackId: track.id,
        providerId: String(match.id),
        trackName: track.track_name,
        artistName: track.artist_name,
        ...analysis.summary
      }));
    }
  } finally {
    console.log(JSON.stringify({ database: dbPath, ...database.stats() }, null, 2));
    database.close();
  }
}
