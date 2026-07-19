#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const HELP = `Verify and optionally install a released SQLite database.

Usage:
  node scripts/install-database-release.mjs --asset PATH [options]

Options:
  --asset PATH     Downloaded release .db file
  --checksum PATH  Optional .sha256 file from the same release
  --db PATH        Runtime database to replace (default data/lyrics.db)
  --apply          Back up the current database and atomically replace it
  --help           Show this help

Dry-run is the default. Stop the API service before using --apply.
`;

function parseArgs(argv) {
  const options = { asset: '', checksum: '', db: 'data/lyrics.db', apply: false };
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
    if (key === 'asset') options.asset = value;
    else if (key === 'checksum') options.checksum = value;
    else if (key === 'db') options.db = value;
    else throw new Error(`Unknown option: --${key}`);
  }
  if (!options.asset) throw new Error('--asset is required');
  return options;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function inspectDatabase(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    const required = ['entries', 'lyric_segments', 'metadata', 'source_tracks'];
    const missing = required.filter((name) => !tables.has(name));
    if (missing.length) throw new Error(`Database is missing required tables: ${missing.join(', ')}`);
    const integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`);
    return {
      integrity,
      source_tracks: database.prepare('SELECT COUNT(*) AS count FROM source_tracks').get().count,
      candidates: database.prepare("SELECT COUNT(*) AS count FROM lyric_segments WHERE status='candidate'").get().count,
      approved_segments: database.prepare("SELECT COUNT(*) AS count FROM lyric_segments WHERE status='approved'").get().count,
      entries: database.prepare('SELECT COUNT(*) AS count FROM entries').get().count
    };
  } finally {
    database.close();
  }
}

function verifyChecksum(assetPath, checksumPath) {
  const actual = sha256(assetPath);
  if (!checksumPath) return actual;
  const expected = readFileSync(checksumPath, 'utf8').trim().split(/\s+/u)[0]?.toLocaleLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(expected || '')) throw new Error('Checksum file does not start with a valid SHA-256 value');
  if (actual !== expected) throw new Error(`SHA-256 mismatch: expected ${expected}, received ${actual}`);
  return actual;
}

export function installDatabaseRelease(options) {
  const assetPath = resolve(options.asset);
  const databasePath = resolve(options.db);
  const checksumPath = options.checksum ? resolve(options.checksum) : '';
  if (!existsSync(assetPath)) throw new Error(`Release asset not found: ${assetPath}`);
  if (checksumPath && !existsSync(checksumPath)) throw new Error(`Checksum file not found: ${checksumPath}`);
  if (assetPath === databasePath) throw new Error('Release asset and runtime database must be different files');

  const checksum = verifyChecksum(assetPath, checksumPath);
  const incoming = inspectDatabase(assetPath);
  if (!options.apply) {
    return { mode: 'dry-run', asset: assetPath, sha256: checksum, database: incoming };
  }

  let backupPath = '';
  if (existsSync(databasePath)) {
    const backupDirectory = resolve(dirname(databasePath), 'backups');
    mkdirSync(backupDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    backupPath = resolve(backupDirectory, `lyrics-before-release-install-${timestamp}.db`);
    const current = new DatabaseSync(databasePath);
    try {
      current.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      current.exec(`VACUUM INTO ${sqlString(backupPath)}`);
    } finally {
      current.close();
    }
  } else {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const stagingPath = `${databasePath}.incoming-${process.pid}`;
  rmSync(stagingPath, { force: true });
  copyFileSync(assetPath, stagingPath);
  inspectDatabase(stagingPath);
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  renameSync(stagingPath, databasePath);
  const installed = inspectDatabase(databasePath);
  return {
    mode: 'apply',
    asset: basename(assetPath),
    database: databasePath,
    backup: backupPath,
    sha256: checksum,
    installed
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  process.stdout.write(`${JSON.stringify(installDatabaseRelease(options), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
