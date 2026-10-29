#!/usr/bin/env node
// Public releases start from the tracked demo seed, never from the user's runtime DB.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openLyricsDatabase } from '../db.mjs';
import { buildDatabaseRelease } from './build-database-release.mjs';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export function buildDemoRelease(options) {
  const directory = mkdtempSync(join(tmpdir(), 'lyric-demo-release-'));
  try {
    const dbPath = join(directory, 'demo.db');
    const database = openLyricsDatabase({ dbPath, seedPath: join(ROOT, 'data/store.json') });
    database.close();
    return buildDatabaseRelease({ ...options, db: dbPath, releaseType: 'demo_sqlite_database', outputDir: options.outputDir || join(ROOT, 'dist/releases', options.version) });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
export function main(argv = process.argv.slice(2)) {
  const options = { version: '', outputDir: '', force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === '--help') { console.log('Build a demo-only public database: npm run db:release -- --version VERSION [--output-dir PATH] [--force]\nNo runtime database or raw lyrics are included.'); return; }
    if (argument === '--force') { options.force = true; continue; }
    if (!['--version', '--output-dir'].includes(argument)) throw new Error(`Unknown option: ${argument}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    options[argument === '--version' ? 'version' : 'outputDir'] = value;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(options.version)) throw new Error('--version is required (letters, numbers, dots, underscores, hyphens; up to 64 characters)');
  console.log(JSON.stringify(buildDemoRelease(options), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
