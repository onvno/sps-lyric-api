import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLyricsDatabase } from '../db.mjs';
import { analyzeLyrics } from '../lyric-analysis.mjs';
import { buildDatabaseRelease } from '../scripts/build-database-release.mjs';
import { installDatabaseRelease } from '../scripts/install-database-release.mjs';

test('builds, verifies, and installs a standalone database release', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lyric-database-release-'));
  const sourcePath = join(directory, 'source.db');
  const targetPath = join(directory, 'target.db');
  const outputDirectory = join(directory, 'release');
  try {
    const source = openLyricsDatabase({ dbPath: sourcePath, seedPath: null });
    const track = source.saveSourceTrack({
      provider: 'manual',
      providerId: 'release-fixture',
      trackName: 'Release Fixture',
      artistName: 'Fixture Artist',
      lyricistName: 'Fixture Writer',
      composerName: '',
      albumName: '',
      duration: 0,
      language: 'en',
      plainLyrics: 'The road remembers where we started\nTomorrow asks us where to go',
      syncedLyrics: '',
      sourceUrl: 'https://example.com/release-fixture',
      licenseUrl: ''
    });
    source.saveSegments(track.id, analyzeLyrics({
      plainLyrics: 'The road remembers where we started\nTomorrow asks us where to go',
      language: 'en'
    }).segments);
    source.close();

    const target = openLyricsDatabase({ dbPath: targetPath, seedPath: null });
    target.close();

    const release = buildDatabaseRelease({
      db: sourcePath,
      version: 'test.1',
      outputDir: outputDirectory,
      force: false
    });
    assert.ok(existsSync(release.assetPath));
    assert.ok(existsSync(release.checksumPath));
    assert.ok(existsSync(release.manifestPath));
    assert.equal(release.manifest.database.source_tracks, 1);
    assert.match(readFileSync(release.checksumPath, 'utf8'), /^[a-f0-9]{64}\s{2}lyric-lines-test\.1\.db\n$/u);

    const preview = installDatabaseRelease({
      asset: release.assetPath,
      checksum: release.checksumPath,
      db: targetPath,
      apply: false
    });
    assert.equal(preview.mode, 'dry-run');
    assert.equal(preview.database.source_tracks, 1);

    const installed = installDatabaseRelease({
      asset: release.assetPath,
      checksum: release.checksumPath,
      db: targetPath,
      apply: true
    });
    assert.equal(installed.mode, 'apply');
    assert.ok(existsSync(installed.backup));
    assert.equal(installed.installed.source_tracks, 1);
    assert.equal(installed.installed.integrity, 'ok');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
