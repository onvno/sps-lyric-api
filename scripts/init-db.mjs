import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLyricsDatabase } from '../db.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dbPath = process.env.LYRICS_DB_PATH || join(ROOT, 'data', 'lyrics.db');
await mkdir(dirname(dbPath), { recursive: true });

const database = openLyricsDatabase({
  dbPath,
  seedPath: join(ROOT, 'data', 'store.json')
});

console.log(JSON.stringify({ database: dbPath, ...database.stats() }, null, 2));
database.close();
