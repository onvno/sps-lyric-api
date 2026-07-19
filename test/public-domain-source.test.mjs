import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicDomainCatalog, parsePublicDomainDetail } from '../public-domain-source.mjs';

test('parses public-domain catalog links without duplicate detail links', () => {
  const html = `
    <a href="?type=pd&song=40&page=3">The Fixture Song</a>
    <a href="?type=pd&amp;song=40&amp;page=3">Show full lyrics &rarr;</a>
    <a href="?type=pd&song=41&page=3">Another &amp; Better Song</a>
  `;
  assert.deepEqual(parsePublicDomainCatalog(html), [
    { providerId: '40', page: 3, trackName: 'The Fixture Song' },
    { providerId: '41', page: 3, trackName: 'Another & Better Song' }
  ]);
});

test('parses complete public-domain lyrics and original source metadata', () => {
  const html = `
    <div class="song-title">The Fixture Song</div>
    <span class="song-category">Folk songs</span>
    <div class="song-lyrics full">First public line<br />Second &amp; final line</div>
    <div>Year: 1888</div>
    <div>Source: <a href="https://en.wikisource.org/wiki/Fixture">source</a></div>
  `;
  const result = parsePublicDomainDetail(html, '40');
  assert.equal(result.trackName, 'The Fixture Song');
  assert.equal(result.albumName, 'Folk songs · 1888');
  assert.equal(result.plainLyrics, 'First public line\nSecond & final line');
  assert.equal(result.sourceUrl, 'https://en.wikisource.org/wiki/Fixture');
  assert.equal(result.lines.length, 2);
});
