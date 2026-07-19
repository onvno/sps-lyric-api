#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const HELP = `Build a consistent SQLite snapshot for a GitHub Release.

Usage:
  node scripts/build-database-release.mjs --version VERSION [options]

Options:
  --db PATH          Source SQLite database (default data/lyrics.db)
  --version VERSION  Release version used in asset names, e.g. 2026.07.19
  --output-dir PATH  Asset directory (default dist/releases/VERSION)
  --force            Replace assets for the same version
  --help             Show this help
`;

function parseArgs(argv) {
  const options = { db: 'data/lyrics.db', version: '', outputDir: '', force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--force') {
      options.force = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') return { ...options, help: true };
    if (!argument.startsWith('--')) throw new Error(`Unknown argument: ${argument}`);
    const equalsAt = argument.indexOf('=');
    const key = equalsAt === -1 ? argument.slice(2) : argument.slice(2, equalsAt);
    const value = equalsAt === -1 ? argv[++index] : argument.slice(equalsAt + 1);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    if (key === 'db') options.db = value;
    else if (key === 'version') options.version = value;
    else if (key === 'output-dir') options.outputDir = value;
    else throw new Error(`Unknown option: --${key}`);
  }
  if (!options.version) throw new Error('--version is required');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(options.version)) {
    throw new Error('--version may only contain letters, numbers, dots, underscores, and hyphens');
  }
  return options;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readDatabaseSummary(database) {
  const requiredTables = ['entries', 'lyric_segments', 'metadata', 'source_tracks'];
  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  const missing = requiredTables.filter((name) => !tables.has(name));
  if (missing.length) throw new Error(`Database is missing required tables: ${missing.join(', ')}`);
  const integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
  if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`);
  const metadata = Object.fromEntries(database.prepare('SELECT key, value FROM metadata').all().map((row) => [row.key, row.value]));
  return {
    integrity,
    schema_version: metadata.schema_version || '',
    curation_version: metadata.candidate_curation_version || '',
    source_tracks: database.prepare('SELECT COUNT(*) AS count FROM source_tracks').get().count,
    segments: database.prepare('SELECT COUNT(*) AS count FROM lyric_segments').get().count,
    candidates: database.prepare("SELECT COUNT(*) AS count FROM lyric_segments WHERE status='candidate'").get().count,
    approved_segments: database.prepare("SELECT COUNT(*) AS count FROM lyric_segments WHERE status='approved'").get().count,
    entries: database.prepare('SELECT COUNT(*) AS count FROM entries').get().count
  };
}

export function buildDatabaseRelease(options) {
  const sourcePath = resolve(options.db);
  if (!existsSync(sourcePath)) throw new Error(`Source database not found: ${sourcePath}`);
  const outputDirectory = resolve(options.outputDir || `dist/releases/${options.version}`);
  mkdirSync(outputDirectory, { recursive: true });
  const assetPath = resolve(outputDirectory, `sps-lyric-api-${options.version}.db`);
  const checksumPath = `${assetPath}.sha256`;
  const manifestPath = resolve(outputDirectory, `sps-lyric-api-${options.version}.manifest.json`);
  const outputs = [assetPath, checksumPath, manifestPath];
  if (outputs.some((path) => existsSync(path)) && !options.force) {
    throw new Error(`Release assets already exist in ${outputDirectory}; use --force to replace them`);
  }
  if (options.force) outputs.forEach((path) => rmSync(path, { force: true }));

  const source = new DatabaseSync(sourcePath);
  let sourceSummary;
  try {
    source.exec('PRAGMA wal_checkpoint(FULL)');
    sourceSummary = readDatabaseSummary(source);
    source.exec(`VACUUM INTO ${sqlString(assetPath)}`);
  } finally {
    source.close();
  }

  const snapshot = new DatabaseSync(assetPath, { readOnly: true });
  let snapshotSummary;
  try {
    snapshotSummary = readDatabaseSummary(snapshot);
  } finally {
    snapshot.close();
  }
  if (JSON.stringify(snapshotSummary) !== JSON.stringify(sourceSummary)) {
    throw new Error('Release snapshot counts do not match the source database');
  }

  const checksum = sha256(assetPath);
  const manifest = {
    release_type: 'prebuilt_sqlite_database',
    version: options.version,
    generated_at: new Date().toISOString(),
    source_file: basename(sourcePath),
    asset: basename(assetPath),
    bytes: statSync(assetPath).size,
    sha256: checksum,
    database: snapshotSummary,
    install: 'Stop the service, verify the checksum, then run npm run db:install -- --asset PATH --checksum CHECKSUM_FILE --apply'
  };
  writeFileSync(checksumPath, `${checksum}  ${basename(assetPath)}\n`, 'utf8');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { assetPath, checksumPath, manifestPath, manifest };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const result = buildDatabaseRelease(options);
  process.stdout.write(`${JSON.stringify({
    ...result,
    assetPath: relative(process.cwd(), result.assetPath),
    checksumPath: relative(process.cwd(), result.checksumPath),
    manifestPath: relative(process.cwd(), result.manifestPath)
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
