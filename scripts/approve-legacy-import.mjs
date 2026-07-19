import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const LEGACY_PROVIDERS = new Set(['legacy_backup_sps', 'legacy_backup_apply']);
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const baseUrl = (process.env.LYRICS_API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const reviewerToken = process.env.REVIEWER_TOKEN || '';

if (!reviewerToken) {
  throw new Error('请通过 REVIEWER_TOKEN 提供审核口令。');
}

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${reviewerToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

const library = await api('/api/v1/review/local/tracks');
const tracks = library.data.filter((track) => LEGACY_PROVIDERS.has(track.provider));
const expectedCandidates = tracks.reduce((sum, track) => sum + track.candidate_count, 0);

if (!apply) {
  console.log(JSON.stringify({
    mode: 'dry-run',
    providers: [...LEGACY_PROVIDERS],
    tracks: tracks.length,
    candidates: expectedCandidates,
    missingLyricistTracks: tracks
      .filter((track) => !track.lyricist_name?.trim())
      .map((track) => ({ id: track.id, title: track.track_name }))
  }, null, 2));
  process.exit(0);
}

const report = {
  startedAt: new Date().toISOString(),
  scope: {
    providers: [...LEGACY_PROVIDERS],
    tracks: tracks.length,
    candidates: expectedCandidates
  },
  policy: {
    creatorSource: 'source_tracks.lyricist_name',
    creatorRole: '作词',
    rightsBasis: 'quotation_review',
    intendedUse: '用户个人本地歌词摘句库',
    instruction: '用户明确要求将旧 SQL 备份恢复候选批量审核通过'
  },
  approved: [],
  skipped: [],
  failed: []
};

for (const track of tracks) {
  const creatorName = track.lyricist_name?.trim();
  if (!creatorName) {
    report.skipped.push({
      trackId: track.id,
      title: track.track_name,
      reason: 'missing_lyricist',
      candidates: track.candidate_count
    });
    continue;
  }

  const detail = await api(`/api/v1/review/local/tracks/${track.id}?status=candidate`);
  for (const segment of detail.data.segments) {
    try {
      const result = await api(`/api/v1/review/local/segments/${segment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'approve',
          creatorName,
          creatorRole: '作词',
          language: segment.language,
          rightsBasis: 'quotation_review',
          rightsNote: '从用户旧 SQL 备份恢复；用户确认用于个人本地歌词摘句库，并按短摘录个案审核通过。',
          rightsConfirmed: true,
          themes: [],
          curatorNote: '由用户旧 SQL 精选歌词数据恢复。',
          reviewNote: '批量审核通过：来源为用户旧 SQL 备份，用户明确要求恢复为已批准条目。'
        })
      });
      report.approved.push({
        provider: track.provider,
        trackId: track.id,
        trackTitle: track.track_name,
        artist: track.artist_name,
        lyricist: creatorName,
        segmentId: segment.id,
        entryId: result.data.entry.id
      });
    } catch (error) {
      report.failed.push({
        provider: track.provider,
        trackId: track.id,
        trackTitle: track.track_name,
        segmentId: segment.id,
        status: error.status || null,
        error: error.message,
        details: error.payload || null
      });
    }
  }

  const processed = report.approved.length + report.failed.length;
  if (processed && processed % 50 === 0) {
    console.log(`已处理 ${processed}/${expectedCandidates}`);
  }
}

report.finishedAt = new Date().toISOString();
report.summary = {
  approved: report.approved.length,
  skippedTracks: report.skipped.length,
  failed: report.failed.length
};

const timestamp = report.startedAt.replaceAll(':', '-').replaceAll('.', '-');
const reportPath = process.env.APPROVAL_REPORT_PATH
  || path.resolve('data/import-manifests', `legacy-approval-${timestamp}.json`);
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  mode: 'apply',
  reportPath,
  ...report.summary
}, null, 2));

if (report.failed.length || report.skipped.length) process.exitCode = 2;
