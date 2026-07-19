import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLyricsDatabase } from '../db.mjs';
import { analyzeLyrics } from '../lyric-analysis.mjs';
import { getPublicDomainSong, listPublicDomainSongs } from '../public-domain-source.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dbPath = process.env.LYRICS_DB_PATH || join(ROOT, 'data', 'lyrics.db');
const limitArgument = process.argv.find((value) => value.startsWith('--limit='));
const pageArgument = process.argv.find((value) => value.startsWith('--start-page='));
const limit = Math.min(200, Math.max(1, Number.parseInt(limitArgument?.split('=')[1] || '40', 10) || 40));
const startPage = Math.max(1, Number.parseInt(pageArgument?.split('=')[1] || '1', 10) || 1);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'lyric-lines-api/0.3 (personal-public-domain-import)' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
}

await mkdir(dirname(dbPath), { recursive: true });
const database = openLyricsDatabase({ dbPath, seedPath: join(ROOT, 'data', 'store.json') });

let imported = 0;
let failed = 0;
let page = startPage;

try {
  while (imported < limit) {
    const catalog = await listPublicDomainSongs({ page, fetchText });
    if (!catalog.length) break;
    for (const item of catalog) {
      if (imported >= limit) break;
      try {
        const song = await getPublicDomainSong(item.providerId, { fetchText });
        if (!song) throw new Error('页面缺少标题或完整歌词');
        const analysis = analyzeLyrics({ plainLyrics: song.plainLyrics, language: song.language });
        const track = database.saveSourceTrack({ ...song, language: analysis.summary.language });
        database.saveSegments(track.id, analysis.segments);
        imported += 1;
        console.log(JSON.stringify({
          imported,
          providerId: song.providerId,
          localTrackId: track.id,
          trackName: song.trackName,
          ...analysis.summary
        }));
      } catch (error) {
        failed += 1;
        console.warn(JSON.stringify({ providerId: item.providerId, trackName: item.trackName, error: error.message }));
      }
    }
    page += 1;
  }
} finally {
  console.log(JSON.stringify({ imported, failed, database: dbPath, ...database.stats() }, null, 2));
  database.close();
}
