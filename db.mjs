import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';

const SCHEMA_VERSION = 2;

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function openLyricsDatabase({ dbPath, seedPath }) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      song_id TEXT NOT NULL,
      song_title TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      language TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entries_search
      ON entries(status, language, song_title);

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      reviewed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_submissions_status
      ON submissions(status, submitted_at DESC);

    CREATE TABLE IF NOT EXISTS source_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      provider_track_id TEXT NOT NULL,
      track_name TEXT NOT NULL,
      artist_name TEXT NOT NULL DEFAULT '',
      lyricist_name TEXT NOT NULL DEFAULT '',
      composer_name TEXT NOT NULL DEFAULT '',
      album_name TEXT NOT NULL DEFAULT '',
      duration REAL NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT '',
      lyrics_text TEXT NOT NULL,
      synced_lyrics_text TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL,
      license_url TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL,
      UNIQUE(provider, provider_track_id)
    );

    CREATE TABLE IF NOT EXISTS lyric_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_track_id INTEGER NOT NULL REFERENCES source_tracks(id) ON DELETE CASCADE,
      segment_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      tokens_json TEXT NOT NULL,
      language TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      char_count INTEGER NOT NULL,
      score REAL NOT NULL,
      duplicate_count INTEGER NOT NULL DEFAULT 1,
      start_ms INTEGER,
      end_ms INTEGER,
      status TEXT NOT NULL CHECK(status IN ('candidate', 'filtered', 'approved', 'rejected')),
      rejection_reason TEXT NOT NULL DEFAULT '',
      entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      UNIQUE(source_track_id, normalized_text)
    );

    CREATE INDEX IF NOT EXISTS idx_segments_review
      ON lyric_segments(source_track_id, status, score DESC);

    CREATE TABLE IF NOT EXISTS review_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  const sourceTrackColumns = new Set(db.prepare('PRAGMA table_info(source_tracks)').all().map((column) => column.name));
  if (!sourceTrackColumns.has('lyricist_name')) {
    db.exec("ALTER TABLE source_tracks ADD COLUMN lyricist_name TEXT NOT NULL DEFAULT ''");
  }
  if (!sourceTrackColumns.has('composer_name')) {
    db.exec("ALTER TABLE source_tracks ADD COLUMN composer_name TEXT NOT NULL DEFAULT ''");
  }

  const getMetaStatement = db.prepare('SELECT value FROM metadata WHERE key = ?');
  const setMetaStatement = db.prepare(`
    INSERT INTO metadata(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const upsertEntryStatement = db.prepare(`
    INSERT INTO entries(id, song_id, song_title, excerpt, language, status, payload_json, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      song_id = excluded.song_id,
      song_title = excluded.song_title,
      excerpt = excluded.excerpt,
      language = excluded.language,
      status = excluded.status,
      payload_json = excluded.payload_json,
      created_at = excluded.created_at
  `);
  const upsertSubmissionStatement = db.prepare(`
    INSERT INTO submissions(id, status, payload_json, submitted_at, reviewed_at)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      payload_json = excluded.payload_json,
      submitted_at = excluded.submitted_at,
      reviewed_at = excluded.reviewed_at
  `);

  function setMeta(key, value) {
    setMetaStatement.run(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  function getMeta(key, fallback = '') {
    return getMetaStatement.get(key)?.value ?? fallback;
  }

  function saveEntry(entry) {
    upsertEntryStatement.run(
      entry.id,
      entry.song.id,
      entry.song.title,
      entry.excerpt,
      entry.language,
      entry.status,
      JSON.stringify(entry),
      entry.createdAt
    );
  }

  function saveSubmission(submission) {
    upsertSubmissionStatement.run(
      submission.id,
      submission.status,
      JSON.stringify(submission),
      submission.submittedAt,
      submission.reviewedAt || null
    );
  }

  function readStore() {
    const entries = db.prepare('SELECT payload_json FROM entries ORDER BY rowid').all()
      .map((row) => parseJson(row.payload_json, null))
      .filter(Boolean);
    const submissions = db.prepare('SELECT payload_json FROM submissions ORDER BY submitted_at DESC').all()
      .map((row) => parseJson(row.payload_json, null))
      .filter(Boolean);
    return {
      meta: {
        schemaVersion: Number(getMeta('schema_version', SCHEMA_VERSION)),
        updatedAt: getMeta('updated_at', new Date().toISOString()),
        editorialPolicy: getMeta('editorial_policy', '')
      },
      entries,
      submissions
    };
  }

  function syncStore(store) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const entryIds = new Set(store.entries.map((entry) => entry.id));
      const submissionIds = new Set(store.submissions.map((submission) => submission.id));
      for (const row of db.prepare('SELECT id FROM entries').all()) {
        if (!entryIds.has(row.id)) db.prepare('DELETE FROM entries WHERE id = ?').run(row.id);
      }
      for (const row of db.prepare('SELECT id FROM submissions').all()) {
        if (!submissionIds.has(row.id)) db.prepare('DELETE FROM submissions WHERE id = ?').run(row.id);
      }
      store.entries.forEach(saveEntry);
      store.submissions.forEach(saveSubmission);
      setMeta('schema_version', String(SCHEMA_VERSION));
      setMeta('updated_at', store.meta.updatedAt);
      setMeta('editorial_policy', store.meta.editorialPolicy || '');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function updateStore(mutator) {
    const store = readStore();
    const result = mutator(store);
    store.meta.updatedAt = new Date().toISOString();
    syncStore(store);
    return result;
  }

  function importSeedIfEmpty() {
    const count = db.prepare('SELECT COUNT(*) AS count FROM entries').get().count;
    if (count > 0 || !seedPath || !existsSync(seedPath)) return false;
    const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
    syncStore(seed);
    return true;
  }

  function saveSourceTrack(track) {
    const fetchedAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO source_tracks(
        provider, provider_track_id, track_name, artist_name, lyricist_name, composer_name, album_name,
        duration, language, lyrics_text, synced_lyrics_text, source_url,
        license_url, fetched_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_track_id) DO UPDATE SET
        track_name = excluded.track_name,
        artist_name = excluded.artist_name,
        lyricist_name = excluded.lyricist_name,
        composer_name = excluded.composer_name,
        album_name = excluded.album_name,
        duration = excluded.duration,
        language = excluded.language,
        lyrics_text = excluded.lyrics_text,
        synced_lyrics_text = excluded.synced_lyrics_text,
        source_url = excluded.source_url,
        license_url = excluded.license_url,
        fetched_at = excluded.fetched_at
    `).run(
      track.provider,
      track.providerId,
      track.trackName,
      track.artistName || '',
      track.lyricistName || '',
      track.composerName || '',
      track.albumName || '',
      track.duration,
      track.language,
      track.plainLyrics,
      track.syncedLyrics,
      track.sourceUrl,
      track.licenseUrl,
      fetchedAt
    );
    return db.prepare('SELECT * FROM source_tracks WHERE provider = ? AND provider_track_id = ?')
      .get(track.provider, track.providerId);
  }

  function saveSegments(sourceTrackId, segments) {
    const statement = db.prepare(`
      INSERT INTO lyric_segments(
        source_track_id, segment_index, text, normalized_text, tokens_json,
        language, word_count, char_count, score, duplicate_count,
        start_ms, end_ms, status, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_track_id, normalized_text) DO UPDATE SET
        segment_index = excluded.segment_index,
        text = excluded.text,
        tokens_json = excluded.tokens_json,
        language = excluded.language,
        word_count = excluded.word_count,
        char_count = excluded.char_count,
        score = excluded.score,
        duplicate_count = excluded.duplicate_count,
        start_ms = excluded.start_ms,
        end_ms = excluded.end_ms,
        status = CASE
          WHEN lyric_segments.status IN ('approved', 'rejected') THEN lyric_segments.status
          ELSE excluded.status
        END
    `);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const segment of segments) {
        statement.run(
          sourceTrackId,
          segment.index,
          segment.text,
          segment.normalizedText,
          JSON.stringify(segment.tokens),
          segment.language,
          segment.wordCount,
          segment.charCount,
          segment.score,
          segment.duplicateCount,
          segment.startMs,
          segment.endMs,
          segment.status,
          new Date().toISOString()
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function listSourceTracks({ candidatesOnly = false } = {}) {
    const having = candidatesOnly
      ? "HAVING SUM(CASE WHEN s.status = 'candidate' THEN 1 ELSE 0 END) > 0"
      : '';
    return db.prepare(`
      SELECT
        t.id, t.provider, t.provider_track_id, t.track_name, t.artist_name,
        t.lyricist_name, t.composer_name, t.album_name, t.duration, t.language, t.source_url, t.license_url,
        t.fetched_at,
        COUNT(s.id) AS segment_count,
        SUM(CASE WHEN s.status = 'candidate' THEN 1 ELSE 0 END) AS candidate_count,
        SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
        SUM(CASE WHEN s.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
      FROM source_tracks t
      LEFT JOIN lyric_segments s ON s.source_track_id = t.id
      GROUP BY t.id
      ${having}
      ORDER BY t.fetched_at DESC
    `).all();
  }

  function getSourceTrack(id, { includeLyrics = false } = {}) {
    const fields = includeLyrics ? '*' : `
      id, provider, provider_track_id, track_name, artist_name, lyricist_name, composer_name, album_name,
      duration, language, source_url, license_url, fetched_at
    `;
    return db.prepare(`SELECT ${fields} FROM source_tracks WHERE id = ?`).get(id);
  }

  function deleteSourceTrack(id) {
    const approved = db.prepare(`
      SELECT COUNT(*) AS count FROM lyric_segments
      WHERE source_track_id = ? AND status = 'approved'
    `).get(id).count;
    if (approved > 0) return { deleted: false, reason: 'approved_segments_exist' };
    const result = db.prepare('DELETE FROM source_tracks WHERE id = ?').run(id);
    return { deleted: result.changes > 0, reason: result.changes ? '' : 'not_found' };
  }

  function listSegments(sourceTrackId, status = 'candidate') {
    const allowed = new Set(['candidate', 'filtered', 'approved', 'rejected', 'all']);
    const selected = allowed.has(status) ? status : 'candidate';
    const sql = selected === 'all'
      ? 'SELECT * FROM lyric_segments WHERE source_track_id = ? ORDER BY score DESC, segment_index ASC'
      : 'SELECT * FROM lyric_segments WHERE source_track_id = ? AND status = ? ORDER BY score DESC, segment_index ASC';
    const rows = selected === 'all'
      ? db.prepare(sql).all(sourceTrackId)
      : db.prepare(sql).all(sourceTrackId, selected);
    return rows.map((row) => ({ ...row, tokens: parseJson(row.tokens_json, []) }));
  }

  function getSegment(id) {
    const row = db.prepare('SELECT * FROM lyric_segments WHERE id = ?').get(id);
    return row ? { ...row, tokens: parseJson(row.tokens_json, []) } : null;
  }

  function rejectSegment(id, reason) {
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE lyric_segments
      SET status = 'rejected', rejection_reason = ?, reviewed_at = ?
      WHERE id = ? AND status IN ('candidate', 'filtered')
    `).run(reason, now, id);
    if (result.changes) {
      db.prepare(`
        INSERT INTO review_actions(entity_type, entity_id, action, note, created_at)
        VALUES('lyric_segment', ?, 'reject', ?, ?)
      `).run(String(id), reason, now);
    }
    return result.changes > 0;
  }

  function publishSegment(id, entry, note = '') {
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const segment = db.prepare('SELECT status FROM lyric_segments WHERE id = ?').get(id);
      if (!segment || !['candidate', 'filtered'].includes(segment.status)) {
        db.exec('ROLLBACK');
        return false;
      }
      saveEntry(entry);
      db.prepare(`
        UPDATE lyric_segments
        SET status = 'approved', entry_id = ?, reviewed_at = ?, rejection_reason = ''
        WHERE id = ?
      `).run(entry.id, now, id);
      db.prepare(`
        INSERT INTO review_actions(entity_type, entity_id, action, note, created_at)
        VALUES('lyric_segment', ?, 'approve', ?, ?)
      `).run(String(id), note, now);
      setMeta('updated_at', now);
      db.exec('COMMIT');
      return true;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function stats() {
    return {
      entries: db.prepare('SELECT COUNT(*) AS count FROM entries').get().count,
      submissions: db.prepare('SELECT COUNT(*) AS count FROM submissions').get().count,
      sourceTracks: db.prepare('SELECT COUNT(*) AS count FROM source_tracks').get().count,
      segments: db.prepare('SELECT COUNT(*) AS count FROM lyric_segments').get().count,
      candidates: db.prepare("SELECT COUNT(*) AS count FROM lyric_segments WHERE status = 'candidate'").get().count,
      approvedSegments: db.prepare("SELECT COUNT(*) AS count FROM lyric_segments WHERE status = 'approved'").get().count
    };
  }

  setMeta('schema_version', String(SCHEMA_VERSION));
  if (!getMeta('updated_at')) setMeta('updated_at', new Date().toISOString());
  importSeedIfEmpty();

  return {
    path: dbPath,
    readStore,
    updateStore,
    saveSourceTrack,
    saveSegments,
    listSourceTracks,
    getSourceTrack,
    deleteSourceTrack,
    listSegments,
    getSegment,
    rejectSegment,
    publishSegment,
    stats,
    close: () => db.close()
  };
}
