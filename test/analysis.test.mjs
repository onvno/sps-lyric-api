import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLyrics } from '../lyric-analysis.mjs';

test('local analysis tokenizes Chinese and collapses repeated lines', () => {
  const result = analyzeLyrics({
    language: 'zh-CN',
    plainLyrics: '长亭外，古道边，芳草碧连天。\n长亭外，古道边，芳草碧连天。\n晚风拂柳笛声残。'
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.repeatedLinesCollapsed, 1);
  assert.equal(result.summary.language, 'zh-CN');
  assert.equal(result.segments[0].duplicateCount, 2);
  assert.ok(result.segments[0].tokens.length >= 4);
  assert.ok(result.segments.every((segment) => segment.status === 'candidate'));
});

test('local analysis filters structure markers and preserves synced timestamps', () => {
  const result = analyzeLyrics({
    language: 'en',
    plainLyrics: '[Verse]\nA line worth keeping today',
    syncedLyrics: '[00:04.50] A line worth keeping today'
  });

  assert.equal(result.summary.candidates, 1);
  assert.equal(result.summary.filtered, 1);
  const candidate = result.segments.find((segment) => segment.status === 'candidate');
  assert.equal(candidate.startMs, 4500);
  assert.deepEqual(candidate.tokens, ['A', 'line', 'worth', 'keeping', 'today']);
});

test('local analysis keeps production credits out of lyric candidates', () => {
  const result = analyzeLyrics({
    language: 'zh-CN',
    plainLyrics: '作词 周某\n作曲 李某\n演唱 王某\n晚风吹过安静的街道'
  });

  assert.equal(result.summary.total, 4);
  assert.equal(result.summary.candidates, 1);
  assert.equal(result.summary.filtered, 3);
  assert.equal(result.segments.find((segment) => segment.status === 'candidate').text, '晚风吹过安静的街道');
});
