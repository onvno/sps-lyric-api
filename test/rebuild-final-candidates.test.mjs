import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openLyricsDatabase } from '../db.mjs';
import { analyzeLyrics } from '../lyric-analysis.mjs';
import {
  buildTrackCandidates,
  rebuildFinalCandidates
} from '../skills/curate-lyric-lines/scripts/rebuild-final-candidates.mjs';

const LYRICS = `测试之歌
作词 测试作者 作曲 测试作曲
时间把昨日留在身后
但我们仍要选择往前走
所以每一步都有了重量
副歌1
晚风吹过安静的河流
倒影提醒我看见自己
原来失去也能教人成长
本歌曲由测试厂牌发行
啦啦啦啦
如果命运（只给一扇窄门
主歌2
谁能替明天写好答案
如果命运只给一扇窄门
我愿保留推门时的勇气`;

function fixtureTrack() {
  return {
    id: 1,
    provider: 'chinese_lyrics',
    provider_track_id: 'fixture-track',
    track_name: '测试之歌',
    artist_name: '测试歌手',
    lyricist_name: '测试作者',
    composer_name: '测试作曲',
    language: 'zh-CN',
    lyrics_text: LYRICS,
    source_url: 'https://example.com/fixture',
    license_url: ''
  };
}

test('builds at most three distinct adjacent multi-line candidates', () => {
  const result = buildTrackCandidates(fixtureTrack(), {
    perTrack: 3,
    minScore: 0,
    minLines: 2,
    maxLines: 4
  });
  assert.ok(result.selected.length > 0);
  assert.ok(result.selected.length <= 3);
  assert.ok(result.selected.every((candidate) => candidate.lineCount >= 2 && candidate.lineCount <= 4));
  assert.ok(result.selected.every((candidate) => candidate.text.includes('\n')));
  assert.ok(result.selected.every((candidate) => !candidate.text.includes('作词')));
  assert.ok(result.selected.every((candidate) => !candidate.text.includes('发行')));
  assert.ok(result.selected.every((candidate) => !candidate.text.includes('啦啦啦啦')));
  assert.ok(result.selected.every((candidate) => !candidate.text.includes('命运（')));

  for (let leftIndex = 0; leftIndex < result.selected.length; leftIndex += 1) {
    const leftLines = new Set(result.selected[leftIndex].lines.map((line) => line.text));
    for (let rightIndex = leftIndex + 1; rightIndex < result.selected.length; rightIndex += 1) {
      const rightLines = result.selected[rightIndex].lines.map((line) => line.text);
      assert.ok(rightLines.every((line) => !leftLines.has(line)));
    }
  }
});

test('apply mode backs up SQLite, filters old candidates, and writes multi-line candidates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lyric-candidate-rebuild-'));
  const dbPath = join(directory, 'lyrics.db');
  try {
    const store = openLyricsDatabase({ dbPath, seedPath: null });
    const sourceTrack = store.saveSourceTrack({
      provider: 'chinese_lyrics',
      providerId: 'fixture-track',
      trackName: '测试之歌',
      artistName: '测试歌手',
      lyricistName: '测试作者',
      composerName: '测试作曲',
      albumName: '',
      duration: 0,
      language: 'zh-CN',
      plainLyrics: LYRICS,
      syncedLyrics: '',
      sourceUrl: 'https://example.com/fixture',
      licenseUrl: ''
    });
    const original = analyzeLyrics({ plainLyrics: LYRICS, language: 'zh-CN' });
    store.saveSegments(sourceTrack.id, original.segments);
    const oldCandidateCount = store.listSegments(sourceTrack.id, 'candidate').length;
    assert.ok(oldCandidateCount > 3);
    store.close();

    const report = rebuildFinalCandidates({
      db: dbPath,
      providers: ['chinese_lyrics'],
      perTrack: 3,
      minScore: 0,
      minLines: 2,
      maxLines: 4,
      apply: true
    });
    assert.ok(existsSync(report.backup));
    assert.equal(report.summary.max_candidates_per_track <= 3, true);

    const database = new DatabaseSync(dbPath, { readOnly: true });
    const candidates = database.prepare("SELECT text FROM lyric_segments WHERE status='candidate'").all();
    const filtered = database.prepare("SELECT COUNT(*) count FROM lyric_segments WHERE status='filtered'").get().count;
    const rebuildActions = database.prepare("SELECT COUNT(*) count FROM review_actions WHERE action='candidate_rebuild'").get().count;
    const ruleVersion = database.prepare("SELECT value FROM metadata WHERE key='candidate_curation_version'").get().value;
    database.close();

    assert.ok(candidates.length > 0 && candidates.length <= 3);
    assert.ok(candidates.every((candidate) => candidate.text.includes('\n')));
    assert.ok(filtered >= oldCandidateCount);
    assert.equal(rebuildActions, 1);
    assert.equal(ruleVersion, 'multiline-reflective-v2');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
