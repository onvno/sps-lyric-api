import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapText, renderShareImage, shareFilename, SHARE_TEMPLATES } from '../public/share-image.js';

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
