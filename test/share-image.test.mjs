import test from 'node:test';
import assert from 'node:assert/strict';
import { formatShareLyrics, wrapText, renderShareImage, shareFilename, SHARE_TEMPLATES } from '../public/share-image.js';

const context = { measureText: (text) => ({ width: [...text].length * 20 }) };

test('share text wrapping preserves hard breaks, words and full long tokens', () => {
  assert.deepEqual(wrapText(context, '第一行\r\n\r\n第二行', 200), ['第一行', '', '第二行']);
  assert.deepEqual(wrapText(context, 'A song for tomorrow', 220), ['A song for', 'tomorrow']);
  for (const text of ['远方的人也在仰望明天的月光', 'Supercalifragilisticexpialidocious']) {
    const lines = wrapText(context, text, 140);
    assert.equal(lines.join(''), text);
    assert.ok(lines.every((line) => context.measureText(line).width <= 140));
  }
  assert.deepEqual(wrapText(context, '👨‍👩‍👧‍👦👨‍👩‍👧‍👦', 140), ['👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦']);
});

test('all templates extend the canvas to retain long lyrics and creator attribution', () => {
  const entry = {
    id: 'sample', song: { title: 'A song with a long title'.repeat(4) },
    excerpt: Array.from({ length: 35 }, (_, index) => `第${index}行完整歌词保留在图片中`).join('\n'),
    creators: [{ name: '创作者'.repeat(30), role: '作词' }]
  };
  for (const theme of SHARE_TEMPLATES) {
    const textDraws = [];
    const fakeContext = new Proxy({
      measureText: context.measureText,
      fillText(text, x, y) { textDraws.push({ text, x, y }); }
    }, { get(target, key) { return key in target ? target[key] : () => {}; } });
    const canvas = { getContext: () => fakeContext };
    renderShareImage(entry, theme.id, canvas);
    assert.equal(canvas.width, 1080);
    assert.ok(canvas.height > 1440);
    assert.ok(textDraws.every(({ y }) => y > 0 && y < canvas.height));
    assert.equal(textDraws.filter(({ text }) => /^第\d+行/u.test(text)).length, 35);
    assert.ok(textDraws.some(({ text }) => text.includes('创作者')));
  }
});

test('share PNG filenames are portable and identify the entry and template', () => {
  const name = shareFilename({ id: 'en/one', song: { title: 'A/B: "Song"?' } }, 'forest');
  assert.match(name, /-enone-forest\.png$/u);
  assert.doesNotMatch(name, /[\\/:*?"<>|]/u);
});


test('Chinese share images turn space separators into lines while preserving original text and English words', () => {
  const entry = { language: 'zh-CN', excerpt: ' 第一行  第二行\t第三行\u3000第四行\u00a0第五行 \r\n 第六行\n\n第七行 ' };
  const original = entry.excerpt;
  assert.equal(formatShareLyrics(entry), '第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n\n第七行');
  assert.equal(entry.excerpt, original);
  assert.equal(formatShareLyrics({ language: 'en', excerpt: 'Amazing grace! How sweet the sound.\r\nA second line.' }), 'Amazing grace! How sweet the sound.\nA second line.');
});

test('every share template renders space-separated Chinese lyrics on distinct lines', () => {
  const entry = { id: 'spaced', language: 'zh-CN', song: { title: '中文 Song Title' }, excerpt: '你问我 为什么顽固而专一\n天下太大 总有人比你更合适', creators: [{ name: 'John Newton', role: 'Lyrics' }] };
  for (const theme of SHARE_TEMPLATES) {
    const draws = [];
    const fakeContext = new Proxy({ measureText: context.measureText, fillText: (text, x, y) => draws.push({ text, y }) }, { get: (target, key) => key in target ? target[key] : () => {} });
    renderShareImage(entry, theme.id, { getContext: () => fakeContext });
    const lyricDraws = draws.filter(({ text }) => ['你问我', '为什么顽固而专一', '天下太大', '总有人比你更合适'].includes(text));
    assert.equal(lyricDraws.length, 4);
    assert.equal(new Set(lyricDraws.map(({ y }) => y)).size, 4);
    assert.ok(draws.some(({ text }) => text === '《中文 Song Title》'));
    assert.ok(draws.some(({ text }) => text === 'John Newton · Lyrics'));
  }
});
