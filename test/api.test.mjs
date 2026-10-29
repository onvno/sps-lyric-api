import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLyricServer } from '../server.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function withServer(run, serverOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sps-lyric-api-'));
  const dbPath = join(directory, 'lyrics.db');
  const server = await createLyricServer({
    dbPath,
    seedPath: join(ROOT, 'data', 'store.json'),
    publicDir: join(ROOT, 'public'),
    adminMode: true,
    reviewerToken: 'test-review-token',
    ...serverOptions
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await run({ base, dbPath });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

test('serves the site and paginated public entries', async () => {
  await withServer(async ({ base }) => {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /SPS Lyric API/);

    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'sps-lyric-api');

    const response = await fetch(`${base}/api/v1/entries?language=zh-CN&limit=2`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.length, 2);
    assert.equal(payload.pagination.total, 12);
    assert.ok(payload.data.every((entry) => entry.language === 'zh-CN'));
  });
});

test('search, random and song aggregation return curated records', async () => {
  await withServer(async ({ base }) => {
    const search = await fetch(`${base}/api/v1/entries?q=${encodeURIComponent('李叔同')}`);
    const searchPayload = await search.json();
    assert.equal(searchPayload.pagination.total, 2);

    const random = await fetch(`${base}/api/v1/random?language=en`);
    const randomPayload = await random.json();
    assert.equal(random.status, 200);
    assert.equal(randomPayload.data.language, 'en');

    const songs = await fetch(`${base}/api/v1/songs?q=${encodeURIComponent('送别')}`);
    const songsPayload = await songs.json();
    assert.equal(songsPayload.pagination.total, 1);
    assert.equal(songsPayload.data[0].entryCount, 2);
  });
});

test('default mode only exposes the read API and hides maintenance routes', async () => {
  await withServer(async ({ base }) => {
    const page = await fetch(base);
    const pageHtml = await page.text();
    assert.match(pageHtml, /data-admin-only hidden/);

    const config = await fetch(`${base}/api/v1/config`);
    const configPayload = await config.json();
    assert.equal(configPayload.adminMode, false);
    assert.equal('demoReviewToken' in configPayload, false);
    assert.equal(configPayload.githubIssuesUrl, 'https://github.com/example/sps-lyric-api/issues/new/choose');

    const retiredSubmission = await fetch(`${base}/api/v1/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(retiredSubmission.status, 410);
    assert.equal((await retiredSubmission.json()).error.details.githubIssuesUrl, 'https://github.com/example/sps-lyric-api/issues/new/choose');

    const review = await fetch(`${base}/api/v1/review/submissions`);
    const admin = await fetch(`${base}/api/v1/admin/entries`, { method: 'POST' });
    assert.equal(review.status, 404);
    assert.equal(admin.status, 404);

    const openApi = await fetch(`${base}/api/v1/openapi.json`);
    const openApiPayload = await openApi.json();
    assert.equal('/admin/entries' in openApiPayload.paths, false);
    assert.equal('/review/local/tracks' in openApiPayload.paths, false);
  }, {
    adminMode: false,
    reviewerToken: '',
    githubIssuesUrl: 'https://github.com/example/sps-lyric-api/issues/new/choose'
  });
});

test('administrators can publish a multiline excerpt directly with minimal fields', async () => {
  await withServer(async ({ base }) => {
    const unauthorized = await fetch(`${base}/api/v1/admin/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(`${base}/api/v1/admin/entries`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-review-token', 'content-type': 'application/json' },
      body: JSON.stringify({ excerpt: '只有一行', songTitle: '测试之歌', performerName: '测试演唱者' })
    });
    assert.equal(invalid.status, 422);

    const published = await fetch(`${base}/api/v1/admin/entries`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-review-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        excerpt: '第一行测试歌词。\r\n第二行测试歌词。',
        songTitle: '管理员直发测试',
        performerName: '测试演唱者',
        lyricistName: '测试作词人'
      })
    });
    assert.equal(published.status, 201);
    const publishedPayload = await published.json();
    assert.equal(publishedPayload.data.excerpt, '第一行测试歌词。\n第二行测试歌词。');
    assert.equal(publishedPayload.data.language, 'zh-CN');
    assert.equal(publishedPayload.data.rights.basis, 'personal_use');
    assert.deepEqual(publishedPayload.data.creators, [
      { name: '测试作词人', role: '作词' },
      { name: '测试演唱者', role: '演唱' }
    ]);

    const publicEntries = await fetch(`${base}/api/v1/entries?q=${encodeURIComponent('第一行测试歌词')}`);
    assert.equal((await publicEntries.json()).pagination.total, 1);

    const duplicate = await fetch(`${base}/api/v1/admin/entries`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-review-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        excerpt: '第一行测试歌词。\n第二行测试歌词。',
        songTitle: '管理员直发测试',
        performerName: '另一位演唱者'
      })
    });
    assert.equal(duplicate.status, 409);
  });
});

test('reviewers can search a real provider and import one verified line as pending', async () => {
  const track = {
    id: 4242,
    trackName: 'Provider Fixture Song',
    artistName: 'Fixture Performer',
    albumName: 'Fixture Album',
    duration: 188,
    instrumental: false,
    plainLyrics: 'First provider line\nA verified provider line\nFirst provider line',
    syncedLyrics: '[00:01.00] First provider line'
  };
  const externalFetch = async (url) => {
    const payload = String(url).includes('/api/search') ? [track] : track;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  await withServer(async ({ base }) => {
    const search = await fetch(`${base}/api/v1/review/sources/search?provider=lrclib&q=fixture`, {
      headers: { authorization: 'Bearer test-review-token' }
    });
    assert.equal(search.status, 200);
    const searchPayload = await search.json();
    assert.equal(searchPayload.data.length, 1);
    assert.deepEqual(searchPayload.data[0].lines, ['First provider line', 'A verified provider line']);

    const imported = await fetch(`${base}/api/v1/review/sources/import`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-review-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'lrclib',
        providerId: '4242',
        excerpt: 'A verified provider line',
        creatorName: 'Fixture Writer',
        creatorRole: 'Lyrics',
        language: 'en',
        rightsBasis: 'permission',
        rightsNote: 'Fixture writer granted permission.',
        rightsConfirmed: true,
        themes: ['fixture']
      })
    });
    assert.equal(imported.status, 201);
    const importedPayload = await imported.json();
    assert.equal(importedPayload.data.status, 'pending');
    assert.equal(importedPayload.data.source.provider, 'lrclib');

    const queue = await fetch(`${base}/api/v1/review/submissions`, {
      headers: { authorization: 'Bearer test-review-token' }
    });
    const queuePayload = await queue.json();
    assert.equal(queuePayload.pagination.total, 1);
    assert.equal(queuePayload.data[0].externalSource.providerId, '4242');

    const publicEntries = await fetch(`${base}/api/v1/entries?q=${encodeURIComponent('verified provider')}`);
    assert.equal((await publicEntries.json()).pagination.total, 0);
  }, { externalFetch });
});

test('downloads a whole source track, analyzes it locally, and publishes an approved segment', async () => {
  const track = {
    id: 5151,
    trackName: 'Local SQLite Song',
    artistName: 'Fixture Performer',
    albumName: 'Local Fixtures',
    duration: 180,
    instrumental: false,
    plainLyrics: [
      'A memorable local lyric line',
      'A memorable local lyric line',
      'Another candidate worth keeping',
      '[Chorus]'
    ].join('\n'),
    syncedLyrics: '[00:01.00] A memorable local lyric line\n[00:06.00] Another candidate worth keeping'
  };
  const externalFetch = async () => new Response(JSON.stringify(track), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  await withServer(async ({ base }) => {
    const unauthorized = await fetch(`${base}/api/v1/review/local/tracks`);
    assert.equal(unauthorized.status, 401);

    const downloaded = await fetch(`${base}/api/v1/review/local/fetch`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-review-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ provider: 'lrclib', providerId: '5151', language: 'en' })
    });
    assert.equal(downloaded.status, 201);
    const downloadedPayload = await downloaded.json();
    assert.equal(downloadedPayload.data.analysis.total, 3);
    assert.equal(downloadedPayload.data.analysis.repeatedLinesCollapsed, 1);
    assert.equal(downloadedPayload.data.analysis.candidates, 2);
    const localTrackId = downloadedPayload.data.track.id;

    const library = await fetch(`${base}/api/v1/review/local/tracks?candidates_only=1`, {
      headers: { authorization: 'Bearer test-review-token' }
    });
    const libraryPayload = await library.json();
    assert.equal(libraryPayload.data.length, 1);
    assert.equal(libraryPayload.stats.sourceTracks, 1);
    assert.equal(libraryPayload.stats.visibleSourceTracks, 1);

    const localTrack = await fetch(`${base}/api/v1/review/local/tracks/${localTrackId}?status=candidate`, {
      headers: { authorization: 'Bearer test-review-token' }
    });
    const localPayload = await localTrack.json();
    assert.equal(localPayload.data.segments.length, 2);
    assert.ok(localPayload.data.segments[0].tokens.length >= 4);

    const segment = localPayload.data.segments.find((item) => item.text === 'A memorable local lyric line');
    const remainingSegment = localPayload.data.segments.find((item) => item.id !== segment.id);
    const approved = await fetch(`${base}/api/v1/review/local/segments/${segment.id}`, {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer test-review-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        action: 'approve',
        creatorName: 'Fixture Writer',
        creatorRole: 'Lyrics',
        language: 'en',
        rightsBasis: 'permission',
        rightsNote: 'Fixture writer granted permission.',
        rightsConfirmed: true,
        themes: ['local'],
        curatorNote: 'A locally reviewed fixture.'
      })
    });
    assert.equal(approved.status, 200);
    const approvedPayload = await approved.json();
    assert.equal(approvedPayload.data.status, 'approved');

    const rejected = await fetch(`${base}/api/v1/review/local/segments/${remainingSegment.id}`, {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer test-review-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ action: 'reject', reviewNote: 'Fixture candidate intentionally excluded.' })
    });
    assert.equal(rejected.status, 200);

    const pendingLibrary = await fetch(`${base}/api/v1/review/local/tracks?candidates_only=true`, {
      headers: { authorization: 'Bearer test-review-token' }
    });
    const pendingLibraryPayload = await pendingLibrary.json();
    assert.equal(pendingLibraryPayload.data.length, 0);
    assert.equal(pendingLibraryPayload.stats.visibleSourceTracks, 0);

    const completeLibrary = await fetch(`${base}/api/v1/review/local/tracks`, {
      headers: { authorization: 'Bearer test-review-token' }
    });
    const completeLibraryPayload = await completeLibrary.json();
    assert.equal(completeLibraryPayload.data.length, 1);
    assert.equal(completeLibraryPayload.data[0].candidate_count, 0);

    const publicEntries = await fetch(`${base}/api/v1/entries?q=${encodeURIComponent('memorable local')}`);
    const publicPayload = await publicEntries.json();
    assert.equal(publicPayload.pagination.total, 1);
    assert.equal(publicPayload.data[0].song.title, 'Local SQLite Song');
  }, { externalFetch });
});

test('reviewers can manually upload a whole lyric and review its local segments', async () => {
  await withServer(async ({ base }) => {
    const uploaded = await fetch(`${base}/api/v1/review/local/upload`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-review-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        trackName: '人工上传之歌',
        artistName: '测试演唱者',
        language: 'zh-CN',
        sourceUrl: 'https://example.com/manual-song',
        plainLyrics: '月光落在回家的路上\n月光落在回家的路上\n远方的人也在仰望'
      })
    });
    assert.equal(uploaded.status, 201);
    const uploadedPayload = await uploaded.json();
    assert.equal(uploadedPayload.data.track.provider, 'manual');
    assert.equal(uploadedPayload.data.analysis.total, 2);
    assert.equal(uploadedPayload.data.analysis.repeatedLinesCollapsed, 1);

    const trackId = uploadedPayload.data.track.id;
    const detail = await fetch(`${base}/api/v1/review/local/tracks/${trackId}?status=candidate`, {
      headers: { authorization: 'Bearer test-review-token' }
    });
    const segment = (await detail.json()).data.segments[0];
    const approved = await fetch(`${base}/api/v1/review/local/segments/${segment.id}`, {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer test-review-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        action: 'approve',
        creatorName: '测试作者',
        creatorRole: '作词',
        language: 'zh-CN',
        rightsBasis: 'permission',
        rightsNote: '测试作者允许收录。',
        rightsConfirmed: true
      })
    });
    assert.equal(approved.status, 200);
    const approvedPayload = await approved.json();
    assert.equal(approvedPayload.data.entry.source.label, '人工上传 · 人工上传之歌');
  });
});

test('searches and downloads a public-domain catalog song with its original source', async () => {
  const catalogHtml = `
    <a href="?type=pd&song=40&page=3">Public Fixture Song</a>
    <a href="?type=pd&song=40&page=3">Show full lyrics &rarr;</a>
  `;
  const detailHtml = `
    <div class="song-title">Public Fixture Song</div>
    <span class="song-category">Folk songs</span>
    <div class="song-lyrics full">A public lyric line survives<br />Another public line remains</div>
    <div>Year: 1888</div>
    <div>Source: <a href="https://en.wikisource.org/wiki/Public_Fixture">source</a></div>
  `;
  const externalFetch = async (url) => new Response(String(url).includes('song=40') ? detailHtml : catalogHtml, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });

  await withServer(async ({ base }) => {
    const searched = await fetch(`${base}/api/v1/review/sources/search?provider=publicdomain&q=fixture`, {
      headers: { authorization: 'Bearer test-review-token' }
    });
    assert.equal(searched.status, 200);
    const searchedPayload = await searched.json();
    assert.equal(searchedPayload.data[0].trackName, 'Public Fixture Song');
    assert.equal(searchedPayload.data[0].lines.length, 0);

    const downloaded = await fetch(`${base}/api/v1/review/local/fetch`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-review-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ provider: 'publicdomain', providerId: '40', language: 'en' })
    });
    assert.equal(downloaded.status, 201);
    const downloadedPayload = await downloaded.json();
    assert.equal(downloadedPayload.data.track.provider, 'publicdomain');
    assert.equal(downloadedPayload.data.track.source_url, 'https://en.wikisource.org/wiki/Public_Fixture');
    assert.equal(downloadedPayload.data.analysis.candidates, 2);
  }, { externalFetch });
});

test('all public entries and songs remain reachable through filtered pagination', async () => {
  await withServer(async ({ base }) => {
    for (const resource of ['entries', 'songs']) {
      const ids = new Set();
      let total = 0;
      for (let page = 1; ; page += 1) {
        const response = await fetch(`${base}/api/v1/${resource}?language=zh-CN&limit=2&page=${page}`);
        assert.equal(response.status, 200);
        const payload = await response.json();
        total = payload.pagination.total;
        assert.equal(payload.pagination.page, page);
        for (const item of payload.data) {
          assert.ok(!ids.has(item.id), 'pages must not repeat records');
          ids.add(item.id);
          if (resource === 'entries') assert.equal(item.language, 'zh-CN');
          else assert.ok(item.entries.every((entry) => entry.language === 'zh-CN'));
        }
        if (page >= payload.pagination.pages) break;
      }
      assert.ok(total > 2);
      assert.equal(ids.size, total);
      const result = await fetch(`${base}/api/v1/${resource}?q=${encodeURIComponent('送别')}&limit=1&page=1`).then((response) => response.json());
      assert.equal(result.data.length, 1);
      assert.ok(result.pagination.total > 0);
    }
  }, { adminMode: false });
});

test('admin library searches all sources and paginates without publishing candidates', async () => {
  await withServer(async ({ base }) => {
    const headers = { authorization: 'Bearer test-review-token', 'content-type': 'application/json' };
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      const response = await fetch(`${base}/api/v1/review/local/upload`, {
        method: 'POST', headers,
        body: JSON.stringify({ trackName: `${name} Song`, artistName: `${name} Artist`, language: 'en', sourceUrl: `https://example.com/${name}`, plainLyrics: 'The road remembers where we started\nTomorrow asks us where to go' })
      });
      assert.equal(response.status, 201);
    }
    const library = (query) => fetch(`${base}/api/v1/review/local/tracks${query}`, { headers }).then((response) => response.json());
    const first = await library('?page=1&limit=2&candidates_only=1');
    const second = await library('?page=2&limit=2&candidates_only=1');
    assert.equal(first.pagination.total, 3);
    assert.equal(first.data.length, 2);
    assert.equal(second.data.length, 1);
    assert.ok(!first.data.some((track) => track.id === second.data[0].id));
    const found = await library('?q=beta%20artist&page=1&limit=24');
    assert.equal(found.pagination.total, 1);
    assert.equal(found.data[0].track_name, 'Beta Song');
    assert.equal(found.stats.visibleSourceTracks, 1);
    assert.equal(found.stats.sourceTracks, 3);
    const detail = await fetch(`${base}/api/v1/review/local/tracks/${found.data[0].id}`, { headers }).then((response) => response.json());
    for (const segment of detail.data.segments) {
      const rejected = await fetch(`${base}/api/v1/review/local/segments/${segment.id}`, {
        method: 'PATCH', headers, body: JSON.stringify({ action: 'reject', reviewNote: 'Excluded test fixture.' })
      });
      assert.equal(rejected.status, 200);
    }
    assert.equal((await library('?q=beta&candidates_only=1&limit=24')).pagination.total, 0);
    assert.equal((await library('?q=beta&candidates_only=0&limit=24')).pagination.total, 1);
    assert.equal((await library('')).data.length, 3, 'unpaginated API remains compatible');
    const publicResult = await fetch(`${base}/api/v1/entries?q=Beta`).then((response) => response.json());
    assert.equal(publicResult.pagination.total, 0);
  });
});

test('invalid URL encodings return 400 and leave the server healthy', async () => {
  await withServer(async ({ base }) => {
    for (const path of ['/%ZZ', '/%E0%A4%A']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'invalid_url');
    }
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    const schema = await fetch(`${base}/api/v1/openapi.json`).then(r => r.json());
    assert.equal(schema.servers[0].url, 'https://example.com/api/v1');
  }, { publicBaseUrl: 'https://example.com' });
});


test('legacy provenance uses the deployment origin without rewriting stored data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lyric-legacy-origin-'));
  try {
    const seed = JSON.parse(await readFile(join(ROOT, 'data/store.json'), 'utf8'));
    const sourceUrl = 'http://localhost:8787/legacy-sql-source.html';
    seed.entries[0].source.url = sourceUrl;
    const seedPath = join(directory, 'seed.json');
    await writeFile(seedPath, JSON.stringify(seed));
    await withServer(async ({ base, dbPath }) => {
      for (const path of ['/api/v1/entries?limit=1', `/api/v1/entries/${seed.entries[0].id}`]) {
        const body = await fetch(base + path).then(r => r.json());
        const entry = Array.isArray(body.data) ? body.data[0] : body.data;
        assert.equal(entry.source.url, 'https://example.com/legacy-sql-source.html');
      }
      const { DatabaseSync } = await import('node:sqlite');
      const database = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const entry = JSON.parse(database.prepare('SELECT payload_json FROM entries WHERE id = ?').get(seed.entries[0].id).payload_json);
        assert.equal(entry.source.url, sourceUrl);
      } finally { database.close(); }
    }, { seedPath, publicBaseUrl: 'https://example.com' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
