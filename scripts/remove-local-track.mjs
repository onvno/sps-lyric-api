import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLyricsDatabase } from '../db.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const id = Number.parseInt(process.argv[2] || '', 10);

if (!Number.isFinite(id)) {
  console.error('用法：npm run lyrics:remove -- <local-track-id>');
  process.exitCode = 1;
} else {
  const database = openLyricsDatabase({
    dbPath: process.env.LYRICS_DB_PATH || join(ROOT, 'data', 'lyrics.db'),
    seedPath: join(ROOT, 'data', 'store.json')
  });
  try {
    const track = database.getSourceTrack(id);
    const result = database.deleteSourceTrack(id);
    console.log(JSON.stringify({ track, ...result, stats: database.stats() }, null, 2));
    if (!result.deleted) process.exitCode = 1;
  } finally {
    database.close();
  }
}
