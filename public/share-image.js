// Local canvas rendering: no remote fonts, screenshots or image service needed.
export const SHARE_TEMPLATES = [
  { id: 'paper', name: '暖纸', caption: '纸上的一句', background: '#f5eddb', ink: '#302d26', muted: '#736959', accent: '#b45d3c' },
  { id: 'forest', name: '松林', caption: '让一句话生长', background: '#203f35', ink: '#f8f1de', muted: '#c0ccba', accent: '#e5b97f' },
  { id: 'night', name: '深夜', caption: '留给夜晚的歌', background: '#202637', ink: '#f2eee9', muted: '#b5bbca', accent: '#d8ac9d' }
];

const SERIF = '"Songti SC", "Noto Serif CJK SC", "SimSun", Georgia, serif';
const SANS = '"PingFang SC", "Microsoft YaHei", Arial, sans-serif';

// Preserve hard line breaks; wrap English at word boundaries and long tokens by grapheme.
export function wrapText(context, text, width) {
  const words = new Intl.Segmenter(undefined, { granularity: 'word' });
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const lines = [];
  for (const paragraph of String(text).replace(/\r\n?/gu, '\n').split('\n')) {
    let line = '';
    for (const { segment } of words.segment(paragraph)) {
      const parts = context.measureText(segment).width > width
        ? [...graphemes.segment(segment)].map((part) => part.segment) : [segment];
      for (const part of parts) {
        if (line && context.measureText(line + part).width > width) {
          lines.push(line.trimEnd());
          line = part.trimStart();
        } else line += part;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function shareFilename(entry, templateId) {
  const title = String(entry.song.title).replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_').trim().slice(0, 80) || '歌词';
  const id = String(entry.id || '').replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 32);
  return `摘句-${title}${id ? `-${id}` : ''}-${templateId}.png`;
}

export function renderShareImage(entry, templateId, canvas = document.createElement('canvas')) {
  const theme = SHARE_TEMPLATES.find((item) => item.id === templateId) || SHARE_TEMPLATES[0];
  canvas.width = 1080;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持图片生成');
  let fontSize = 58;
  context.font = `${fontSize}px ${SERIF}`;
  let lyrics = wrapText(context, entry.excerpt, 848);
  if (lyrics.length > 10) {
    fontSize = 46;
    context.font = `${fontSize}px ${SERIF}`;
    lyrics = wrapText(context, entry.excerpt, 848);
  }
  const lineHeight = fontSize * 1.65;
  context.font = `34px ${SERIF}`;
  const title = wrapText(context, `《${entry.song.title}》`, 848);
  context.font = `25px ${SANS}`;
  const credits = wrapText(context, entry.creators.map((creator) => `${creator.name}${creator.role ? ` · ${creator.role}` : ''}`).join(' / '), 848);
  const attributionTop = Math.max(960, 365 + lyrics.length * lineHeight + 100);
  const creditsTop = attributionTop + title.length * 49 + 18;
  const footerTop = creditsTop + credits.length * 40 + 100;
  canvas.height = Math.ceil(Math.max(1440, footerTop + 145));
  const height = canvas.height;
  context.fillStyle = theme.background;
  context.fillRect(0, 0, 1080, height);
  context.strokeStyle = theme.muted;
  context.globalAlpha = 0.25;
  context.lineWidth = 1;
  context.strokeRect(40, 40, 1000, height - 80);
  context.globalAlpha = 1;

  // Template-specific illustration, drawn as vectors so exports stay sharp.
  if (theme.id === 'paper') {
    context.strokeStyle = '#b5a686';
    context.globalAlpha = 0.16;
    for (let y = 400; y < height - 140; y += 48) {
      context.beginPath(); context.moveTo(80, y); context.lineTo(1000, y); context.stroke();
    }
    context.globalAlpha = 1;
    context.fillStyle = theme.accent;
    context.fillRect(870, 110, 92, 92);
    context.fillStyle = theme.background;
    context.font = `50px ${SERIF}`;
    context.fillText('句', 891, 174);
  } else if (theme.id === 'forest') {
    context.strokeStyle = theme.accent;
    context.lineWidth = 3;
    context.beginPath(); context.moveTo(880, 235); context.quadraticCurveTo(935, 175, 945, 100); context.stroke();
    for (let i = 0; i < 4; i += 1) {
      const y = 130 + i * 25;
      context.beginPath(); context.ellipse(927 - i * 9, y, 24, 9, -0.65, 0, Math.PI * 2); context.stroke();
    }
  } else {
    context.fillStyle = theme.accent;
    context.beginPath(); context.arc(925, 160, 48, 0, Math.PI * 2); context.fill();
    context.fillStyle = theme.background;
    context.beginPath(); context.arc(946, 143, 43, 0, Math.PI * 2); context.fill();
    context.fillStyle = theme.muted;
    for (const [x, y] of [[850, 105], [980, 235], [858, 210]]) context.fillRect(x, y, 4, 4);
  }

  context.textBaseline = 'alphabetic';
  context.fillStyle = theme.accent;
  context.font = `23px ${SANS}`;
  context.fillText('LYRIC LINES  /  摘句', 116, 153);
  context.fillStyle = theme.muted;
  context.font = `25px ${SERIF}`;
  context.fillText(theme.caption, 116, 204);
  context.fillStyle = theme.accent;
  context.font = `140px ${SERIF}`;
  context.fillText('“', 104, 340);
  context.fillStyle = theme.ink;
  context.font = `${fontSize}px ${SERIF}`;
  lyrics.forEach((line, index) => context.fillText(line, 116, 390 + index * lineHeight));
  context.fillStyle = theme.accent;
  context.fillRect(116, attributionTop - 50, 62, 3);
  context.fillStyle = theme.ink;
  context.font = `34px ${SERIF}`;
  title.forEach((line, index) => context.fillText(line, 116, attributionTop + index * 49));
  context.fillStyle = theme.muted;
  context.font = `25px ${SANS}`;
  credits.forEach((line, index) => context.fillText(line, 116, creditsTop + index * 40));
  context.strokeStyle = theme.muted;
  context.globalAlpha = 0.35;
  context.beginPath(); context.moveTo(116, height - 156); context.lineTo(964, height - 156); context.stroke();
  context.globalAlpha = 1;
  context.fillStyle = theme.muted;
  context.font = `21px ${SANS}`;
  context.fillText('把歌留在一句话里。', 116, height - 101);
  context.textAlign = 'right';
  context.fillText('摘句 · SPS LYRIC API', 964, height - 101);
  context.textAlign = 'left';
  return canvas;
}

export function createSharePanel(entry, onError) {
  const panel = document.createElement('details');
  panel.className = 'share-panel';
  const summary = document.createElement('summary');
  summary.textContent = '分享图片 · 选择模板并下载';
  const controls = document.createElement('div');
  controls.className = 'share-templates';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '分享图片模板');
  const preview = document.createElement('img');
  preview.className = 'share-preview';
  preview.alt = `《${entry.song.title}》歌词分享图片预览`;
  preview.hidden = true;
  const status = document.createElement('p');
  status.className = 'share-status';
  status.setAttribute('role', 'status');
  const download = document.createElement('a');
  download.className = 'share-download';
  download.textContent = '下载 PNG 图片';
  download.hidden = true;
  let selected = SHARE_TEMPLATES[0].id;
  let objectUrl = '';
  let request = 0;
  let disposed = false;
  async function render() {
    const current = ++request;
    download.hidden = true;
    preview.hidden = true;
    status.textContent = '正在生成预览…';
    controls.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.template === selected)));
    try {
      await document.fonts.ready;
      if (disposed || current !== request) return;
      const canvas = renderShareImage(entry, selected);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (disposed || current !== request) return;
      if (!blob) throw new Error('图片生成失败，请重试');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      preview.src = objectUrl;
      preview.hidden = false;
      download.href = objectUrl;
      download.download = shareFilename(entry, selected);
      download.hidden = false;
      status.textContent = `${canvas.width} × ${canvas.height} · PNG · 长歌词自动延展`;
    } catch (error) {
      if (disposed || current !== request) return;
      status.textContent = '生成失败，请重新选择模板重试。';
      onError(error.message);
    }
  }
  for (const theme of SHARE_TEMPLATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.template = theme.id;
    button.textContent = theme.name;
    button.style.setProperty('--share-swatch', theme.background);
    button.setAttribute('aria-pressed', String(theme.id === selected));
    button.addEventListener('click', () => { selected = theme.id; render(); });
    controls.append(button);
  }
  panel.addEventListener('toggle', () => { if (panel.open && !objectUrl) render(); });
  panel.append(summary, controls, preview, status, download);
  return {
    element: panel,
    dispose() { disposed = true; request += 1; if (objectUrl) URL.revokeObjectURL(objectUrl); }
  };
}
