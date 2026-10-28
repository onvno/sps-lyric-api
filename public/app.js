import { createSharePanel } from './share-image.js?v=20261029-share-1';

const state = {
  entries: [],
  collection: 'entries',
  page: 1,
  pages: 0,
  collectionRequest: 0,
  language: '',
  query: '',
  currentView: 'discover',
  adminMode: false,
  githubIssuesUrl: '',
  reviewToken: '',
  sourceTracks: [],
  localTracks: [],
  localPage: 1,
  localRequest: 0,
  currentCandidate: null,
  providerConfig: {},
  toastTimer: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  quoteGrid: $('#quote-grid'),
  emptyState: $('#empty-state'),
  entryCount: $('#entry-count'),
  songCount: $('#song-count'),
  searchForm: $('#search-form'),
  searchInput: $('#search-input'),
  activeSearch: $('#active-search'),
  activeQuery: $('#active-query'),
  clearSearch: $('#clear-search'),
  dialog: $('#quote-dialog'),
  dialogContent: $('#dialog-content'),
  toast: $('#toast'),
  submissionForm: $('#submission-form'),
  submissionStatus: $('#submission-status'),
  reviewToken: $('#review-token'),
  reviewList: $('#review-list'),
  pendingCount: $('#pending-count'),
  demoTokenNote: $('#demo-token-note'),
  githubIssuesLink: $('#github-issues-link'),
  sourceResults: $('#source-results'),
  sourceProvider: $('#source-provider'),
  sourceQuery: $('#source-query'),
  sourceProviderNote: $('#source-provider-note'),
  localTrackList: $('#local-track-list'),
  localTrackCount: $('#local-track-count'),
  localCandidateCount: $('#local-candidate-count'),
  manualUploadForm: $('#manual-upload-form'),
  manualUploadStatus: $('#manual-upload-status'),
  candidateDialog: $('#candidate-dialog'),
  candidateForm: $('#candidate-form'),
  candidateStatus: $('#candidate-status')
};

const endpointSamples = {
  entries: {
    label: '搜索中文摘句',
    code: (base) => `fetch('${base}/entries?q=送别&language=zh-CN')
  .then(response => response.json())
  .then(({ data, pagination }) => {
    console.log(data);
    // 每条记录都包含 excerpt、song、creators、
    // themes、source 和 rights
  });`
  },
  random: {
    label: '随机获取一句',
    code: (base) => `const response = await fetch(
  '${base}/random?language=en'
);

const { data } = await response.json();
console.log(data.excerpt);
console.log(data.song.title);`
  },
  songs: {
    label: '按歌曲聚合',
    code: (base) => `const response = await fetch('${base}/songs');
const { data } = await response.json();

data.forEach(song => {
  console.log(song.title, song.entryCount);
  // song.entries 是这首歌的全部公开摘句
});`
  },
  'admin-entry': {
    label: '管理员直接发布',
    code: (base) => `await fetch('${base}/admin/entries', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer YOUR_REVIEWER_TOKEN'
  },
  body: JSON.stringify({
    excerpt: '第一行歌词\\n第二行歌词',
    songTitle: '歌曲名',
    performerName: '演唱者',
    lyricistName: '作词人（可选）'
  })
});`
  }
};

function apiBase() {
  return `${window.location.origin}/api/v1`;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || `请求失败 (${response.status})`);
    error.details = payload.error?.details;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 2200);
}

function creatorLine(entry) {
  return entry.creators.map((creator) => `${creator.name} · ${creator.role}`).join(' / ');
}

function rightsLabel(basis) {
  return {
    public_domain: '公版',
    licensed: '已授权',
    permission: '已许可',
    quotation_review: '个案审核',
    personal_use: '个人使用'
  }[basis] || '已核对';
}

function quoteCard(entry) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `quote-card${entry.language === 'en' ? ' is-english' : ''}`;
  card.dataset.id = entry.id;
  card.setAttribute('aria-label', `查看《${entry.song.title}》摘句详情`);

  const top = document.createElement('div');
  top.className = 'card-top';

  const language = document.createElement('span');
  language.className = 'language-label';
  language.textContent = entry.language === 'zh-CN' ? '中文 · ZH' : 'ENGLISH · EN';

  const rights = document.createElement('span');
  rights.className = 'rights-label';
  rights.textContent = rightsLabel(entry.rights.basis);
  top.append(language, rights);

  const mark = document.createElement('div');
  mark.className = 'quote-mark';
  mark.textContent = '“';

  const quote = document.createElement('blockquote');
  quote.lang = entry.language;
  quote.textContent = entry.excerpt;

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const songMeta = document.createElement('div');
  songMeta.className = 'song-meta';
  const song = document.createElement('strong');
  song.textContent = `《${entry.song.title}》`;
  const creator = document.createElement('small');
  creator.textContent = creatorLine(entry);
  songMeta.append(song, creator);
  const arrow = document.createElement('span');
  arrow.className = 'card-arrow';
  arrow.textContent = '↗';
  meta.append(songMeta, arrow);

  card.append(top, mark, quote, meta);
  card.addEventListener('click', () => openEntry(entry));
  return card;
}

function songCard(song) {
  const card = document.createElement('details');
  card.className = 'song-card';
  const summary = document.createElement('summary');
  const title = document.createElement('strong');
  title.textContent = `《${song.title}》`;
  const metadata = document.createElement('span');
  metadata.textContent = `${song.creators.map((creator) => creator.name).join(' / ')} · ${song.entryCount} 条摘句`;
  summary.append(title, metadata);
  const excerpts = document.createElement('div');
  excerpts.className = 'song-excerpts';
  for (const entry of song.entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.excerpt;
    button.addEventListener('click', async () => {
      try {
        const payload = await apiFetch(`/api/v1/entries/${encodeURIComponent(entry.id)}`);
        openEntry(payload.data);
      } catch (error) { showToast(error.message); }
    });
    excerpts.append(button);
  }
  card.append(summary, excerpts);
  return card;
}

async function loadEntries() {
  const request = ++state.collectionRequest;
  const params = new URLSearchParams({ limit: '24', page: String(state.page) });
  if (state.language) params.set('language', state.language);
  if (state.query) params.set('q', state.query);
  elements.quoteGrid.setAttribute('aria-busy', 'true');
  $('#collection-prev').disabled = true;
  $('#collection-next').disabled = true;
  $('#collection-summary').textContent = '正在载入…';
  try {
    const payload = await apiFetch(`/api/v1/${state.collection}?${params}`);
    if (request !== state.collectionRequest) return;
    state.entries = payload.data;
    state.pages = payload.pagination.pages;
    elements.quoteGrid.replaceChildren(...payload.data.map(state.collection === 'songs' ? songCard : quoteCard));
    elements.quoteGrid.hidden = payload.data.length === 0;
    elements.emptyState.hidden = payload.data.length !== 0;
    const unit = state.collection === 'songs' ? '首歌曲' : '条摘句';
    $('#collection-summary').textContent = `共 ${payload.pagination.total} ${unit}，当前显示 ${payload.data.length} ${unit}`;
    $('#collection-page').textContent = state.pages ? `第 ${state.page} / ${state.pages} 页` : '暂无结果';
    $('#collection-prev').disabled = state.page <= 1;
    $('#collection-next').disabled = state.page >= state.pages;
    elements.activeSearch.hidden = !state.query;
    elements.activeQuery.textContent = state.query;
  } catch (error) {
    if (request !== state.collectionRequest) return;
    elements.quoteGrid.replaceChildren();
    elements.emptyState.hidden = true;
    $('#collection-summary').textContent = `载入失败：${error.message}，请重新搜索或切换浏览方式重试。`;
    $('#collection-page').textContent = '';
    showToast(error.message);
  } finally {
    if (request === state.collectionRequest) elements.quoteGrid.removeAttribute('aria-busy');
  }
}

async function loadStats() {
  try {
    const [entries, songs] = await Promise.all([
      apiFetch('/api/v1/entries?limit=1'),
      apiFetch('/api/v1/songs?limit=1')
    ]);
    elements.entryCount.textContent = entries.pagination.total;
    elements.songCount.textContent = songs.pagination.total;
  } catch {
    elements.entryCount.textContent = '—';
    elements.songCount.textContent = '—';
  }
}

let currentSharePanel = null;

function openEntry(entry) {
  currentSharePanel?.dispose();
  currentSharePanel = createSharePanel(entry, showToast);
  const body = document.createElement('div');
  body.className = 'dialog-body';

  const language = document.createElement('span');
  language.className = 'language-label';
  language.textContent = entry.language === 'zh-CN' ? '中文摘句 · ZH' : 'ENGLISH LINE · EN';

  const quote = document.createElement('blockquote');
  quote.lang = entry.language;
  quote.textContent = `“${entry.excerpt}”`;

  const songBlock = document.createElement('div');
  songBlock.className = 'dialog-song';
  const song = document.createElement('strong');
  song.textContent = `《${entry.song.title}》${entry.song.year ? ` · ${entry.song.year}` : ''}`;
  const creators = document.createElement('p');
  creators.textContent = creatorLine(entry);
  songBlock.append(song, creators);

  const note = document.createElement('p');
  note.className = 'curator-note';
  note.textContent = entry.curatorNote;

  const tags = document.createElement('div');
  tags.className = 'dialog-tags';
  entry.themes.forEach((theme) => {
    const tag = document.createElement('span');
    tag.textContent = `# ${theme}`;
    tags.append(tag);
  });

  const rights = document.createElement('div');
  rights.className = 'dialog-rights';
  const rightsTitle = document.createElement('strong');
  rightsTitle.textContent = `${rightsLabel(entry.rights.basis)} · ${entry.rights.jurisdiction}`;
  const rightsText = document.createElement('p');
  rightsText.textContent = entry.rights.note;
  const source = document.createElement('a');
  source.href = entry.source.url;
  source.target = '_blank';
  source.rel = 'noreferrer';
  source.textContent = `${entry.source.label} ↗`;
  rights.append(rightsTitle, rightsText, source);

  body.append(language, quote, songBlock, currentSharePanel.element, note, tags, rights);
  elements.dialogContent.replaceChildren(body);
  if (typeof elements.dialog.showModal === 'function') elements.dialog.showModal();
  else elements.dialog.setAttribute('open', '');
}

function showView(view, updateHash = true) {
  const allowed = new Set(['discover', 'api', ...(state.adminMode ? ['submit', 'review'] : [])]);
  const next = allowed.has(view) ? view : 'discover';
  state.currentView = next;
  $$('.view').forEach((section) => {
    const active = section.dataset.view === next;
    section.hidden = !active;
    section.classList.toggle('is-active', active);
  });
  $$('.nav-link').forEach((link) => link.classList.toggle('is-active', link.dataset.nav === next));
  if (updateHash) history.replaceState(null, '', `#${next}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (next === 'api') updateCodeSample('entries');
  if (next === 'review' && (state.reviewToken || elements.reviewToken.value.trim())) loadLocalLibrary();
}

function updateCodeSample(key) {
  const sample = endpointSamples[key] || endpointSamples.entries;
  $('#code-label').textContent = sample.label;
  $('#code-sample').textContent = sample.code(apiBase());
  $$('.endpoint').forEach((button) => button.classList.toggle('is-active', button.dataset.endpoint === key));
}

async function submitQuote(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = $('button[type="submit"]', form);
  const data = new FormData(form);
  const token = String(data.get('adminToken') || '').trim();
  const payload = {
    excerpt: data.get('excerpt'),
    songTitle: data.get('songTitle'),
    performerName: data.get('performerName'),
    lyricistName: data.get('lyricistName')
  };

  elements.submissionStatus.textContent = '';
  submitButton.disabled = true;
  submitButton.firstChild.textContent = '发布中… ';
  try {
    if (!token) throw new Error('请输入管理员口令');
    state.reviewToken = token;
    elements.reviewToken.value = token;
    const result = await apiFetch('/api/v1/admin/entries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    form.reset();
    $('#excerpt-count').textContent = '0';
    elements.submissionStatus.textContent = `已发布：${result.data.id}`;
    showToast('摘句已直接发布');
    await Promise.all([loadEntries(), loadStats()]);
  } catch (error) {
    const detail = error.details?.[0]?.message;
    elements.submissionStatus.textContent = detail || error.message;
    showToast(detail || error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.firstChild.textContent = '直接发布 ';
  }
}

function reviewPlaceholder(title, detail) {
  const wrapper = document.createElement('div');
  wrapper.className = 'review-placeholder';
  const symbol = document.createElement('span');
  symbol.textContent = '⌁';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const text = document.createElement('p');
  text.textContent = detail;
  wrapper.append(symbol, heading, text);
  return wrapper;
}

function reviewCard(submission) {
  const card = document.createElement('article');
  card.className = 'review-card';
  card.dataset.id = submission.id;

  const content = document.createElement('div');
  const meta = document.createElement('span');
  meta.className = 'language-label';
  meta.textContent = `${submission.language} · ${submission.id}`;
  const quote = document.createElement('blockquote');
  quote.textContent = `“${submission.excerpt}”`;
  const source = document.createElement('div');
  source.className = 'review-source';
  const song = document.createElement('strong');
  song.textContent = `《${submission.songTitle}》 · ${creatorLine(submission)}`;
  const details = document.createElement('p');
  details.textContent = `投稿人：${submission.submitterName} · 版权依据：${rightsLabel(submission.rightsBasis)} · ${submission.rightsNote}`;
  const link = document.createElement('a');
  link.href = submission.sourceUrl;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = '核对来源 ↗';
  source.append(song, details, link);
  const tags = document.createElement('div');
  tags.className = 'review-tags';
  submission.themes.forEach((theme) => {
    const item = document.createElement('span');
    item.textContent = theme;
    tags.append(item);
  });
  content.append(meta, quote, source, tags);

  const controls = document.createElement('div');
  controls.className = 'review-controls';
  const label = document.createElement('label');
  label.htmlFor = `note-${submission.id}`;
  label.textContent = '审核意见';
  const note = document.createElement('textarea');
  note.className = 'review-note';
  note.id = `note-${submission.id}`;
  note.placeholder = '通过可选填；驳回必须说明原因';
  const buttons = document.createElement('div');
  buttons.className = 'review-buttons';
  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'reject';
  reject.textContent = '驳回';
  reject.addEventListener('click', () => reviewSubmission(submission.id, 'reject', note.value, card));
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'approve';
  approve.textContent = '通过并发布';
  approve.addEventListener('click', () => reviewSubmission(submission.id, 'approve', note.value, card));
  buttons.append(reject, approve);
  controls.append(label, note, buttons);

  card.append(content, controls);
  return card;
}

async function loadReviewQueue() {
  const token = elements.reviewToken.value.trim();
  if (!token) {
    showToast('请先输入审核口令');
    return;
  }
  state.reviewToken = token;
  loadLocalLibrary();
  elements.reviewList.replaceChildren(reviewPlaceholder('正在载入', '正在读取待审队列…'));
  try {
    const payload = await apiFetch('/api/v1/review/submissions?status=pending&limit=50', {
      headers: { Authorization: `Bearer ${token}` }
    });
    elements.pendingCount.textContent = payload.pagination.total;
    if (!payload.data.length) {
      elements.reviewList.replaceChildren(reviewPlaceholder('队列已经清空', '目前没有等待审核的投稿。'));
      return;
    }
    elements.reviewList.replaceChildren(...payload.data.map(reviewCard));
  } catch (error) {
    elements.pendingCount.textContent = '—';
    elements.reviewList.replaceChildren(reviewPlaceholder('无法载入待审队列', error.message));
    showToast(error.message);
  }
}

async function reviewSubmission(id, action, reviewNote, card) {
  if (action === 'reject' && !reviewNote.trim()) {
    showToast('驳回时请填写原因');
    return;
  }
  $$('button', card).forEach((button) => { button.disabled = true; });
  try {
    await apiFetch(`/api/v1/review/submissions/${id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${state.reviewToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, reviewNote })
    });
    showToast(action === 'approve' ? '已通过并发布' : '已驳回');
    await Promise.all([loadReviewQueue(), loadStats(), loadEntries()]);
  } catch (error) {
    showToast(error.message);
    $$('button', card).forEach((button) => { button.disabled = false; });
  }
}

async function loadConfig() {
  try {
    const config = await apiFetch('/api/v1/config');
    state.adminMode = config.adminMode === true;
    state.githubIssuesUrl = config.githubIssuesUrl || '';
    state.providerConfig = config.providers || {};
    $$('[data-admin-only]').forEach((element) => { element.hidden = !state.adminMode; });
    elements.demoTokenNote.textContent = state.adminMode ? '审核口令仅保存在当前浏览器页面。' : '';
    if (state.githubIssuesUrl) {
      elements.githubIssuesLink.href = state.githubIssuesUrl;
      elements.githubIssuesLink.hidden = false;
    }
    const jamendoOption = $('option[value="jamendo"]', elements.sourceProvider);
    const jamendoEnabled = config.providers?.jamendo?.enabled === true;
    jamendoOption.disabled = !jamendoEnabled;
    jamendoOption.textContent = jamendoEnabled
      ? 'Jamendo · CC 授权'
      : 'Jamendo · 需配置 client_id';
    if (state.currentView === 'review' && state.reviewToken) loadLocalLibrary();
  } catch {
    state.adminMode = false;
    $$('[data-admin-only]').forEach((element) => { element.hidden = true; });
    elements.demoTokenNote.textContent = '';
  }
}

function sourceStatus(message) {
  const status = document.createElement('div');
  status.className = 'source-results-status';
  status.textContent = message;
  elements.sourceResults.replaceChildren(status);
}

function sourceTrackCard(track) {
  const details = document.createElement('details');
  details.className = 'source-track';

  const summary = document.createElement('summary');
  const summaryCopy = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'source-track-title';
  const trackName = document.createElement('strong');
  trackName.textContent = track.trackName;
  const artist = document.createElement('span');
  artist.textContent = track.artistName || '未知表演者';
  title.append(trackName, artist);
  const meta = document.createElement('div');
  meta.className = 'source-track-meta';
  const flags = [
    track.albumName,
    track.duration ? `${Math.floor(track.duration / 60)}:${String(Math.round(track.duration % 60)).padStart(2, '0')}` : '',
    track.lines.length ? `${track.lines.length} 条可选歌词` : '下载后分析完整歌词',
    track.hasSyncedLyrics ? '含同步歌词' : '',
    track.licenseUrl ? '含 CC 许可' : ''
  ].filter(Boolean);
  meta.textContent = flags.join(' · ');
  summaryCopy.append(title, meta);
  summary.append(summaryCopy);

  const lines = document.createElement('div');
  lines.className = 'source-lines';

  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'source-download';
  download.textContent = '下载整首到本地分析';
  download.addEventListener('click', () => fetchTrackLocally(track, download));
  lines.append(download);
  track.lines.forEach((line) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-line';
    button.textContent = line;
    button.addEventListener('click', () => openCandidate(track, line));
    lines.append(button);
  });
  details.append(summary, lines);
  return details;
}

async function fetchTrackLocally(track, button) {
  const token = elements.reviewToken.value.trim();
  if (!token) {
    showToast('请先输入审核口令');
    return;
  }
  state.reviewToken = token;
  button.disabled = true;
  button.textContent = '正在下载和分词…';
  try {
    const payload = await apiFetch('/api/v1/review/local/fetch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: track.provider,
        providerId: track.providerId,
        language: track.language || (/\p{Script=Han}/u.test(track.lines[0] || '') ? 'zh-CN' : 'en')
      })
    });
    const summary = payload.data.analysis;
    showToast(`已保存：${summary.candidates} 条候选，过滤 ${summary.filtered} 条`);
    await loadLocalLibrary();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = '下载整首到本地分析';
  }
}

function localSegmentCard(track, segment) {
  const item = document.createElement('article');
  item.className = 'local-segment';

  const content = document.createElement('div');
  const text = document.createElement('blockquote');
  text.textContent = segment.text;
  const metadata = document.createElement('p');
  const statusLabel = { candidate: '待审', filtered: '自动过滤', approved: '已发布', rejected: '已驳回' }[segment.status];
  metadata.textContent = `${statusLabel} · 评分 ${segment.score} · ${segment.word_count} 词 · ${segment.char_count} 字符${segment.duplicate_count > 1 ? ` · 原歌词重复 ${segment.duplicate_count} 次` : ''}`;
  const tokens = document.createElement('div');
  tokens.className = 'local-tokens';
  segment.tokens.slice(0, 18).forEach((token) => {
    const chip = document.createElement('span');
    chip.textContent = token;
    tokens.append(chip);
  });
  content.append(text, metadata, tokens);

  const actions = document.createElement('div');
  actions.className = 'local-segment-actions';
  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'reject';
  reject.textContent = '不收录';
  reject.addEventListener('click', () => rejectLocalSegment(track, segment, item));
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'approve';
  approve.textContent = '核对并发布';
  approve.addEventListener('click', () => openLocalCandidate(track, segment));
  if (['candidate', 'filtered'].includes(segment.status)) actions.append(reject, approve);

  item.append(content, actions);
  return item;
}

async function loadLocalSegments(details, track) {
  const body = $('.local-track-body', details);
  body.replaceChildren(reviewPlaceholder('正在读取分词结果', '从本地 SQLite 载入候选…'));
  try {
    const payload = await apiFetch(`/api/v1/review/local/tracks/${track.id}?status=${$('#local-segment-status').value}`, {
      headers: { Authorization: `Bearer ${state.reviewToken || elements.reviewToken.value.trim()}` }
    });
    const segments = payload.data.segments;
    body.replaceChildren(...(segments.length
      ? segments.map((segment) => localSegmentCard(track, segment))
      : [reviewPlaceholder('这首歌没有待选片段', '候选可能已全部审核，或在自动分析时被过滤。')]));
  } catch (error) {
    body.replaceChildren(reviewPlaceholder('无法载入本地候选', error.message));
  }
}

function localTrackCard(track) {
  const details = document.createElement('details');
  details.className = 'local-track';
  const summary = document.createElement('summary');
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = `《${track.track_name}》`;
  const artist = document.createElement('span');
  artist.textContent = track.artist_name || '未知表演者';
  const metadata = document.createElement('small');
  const credits = [
    track.lyricist_name ? `作词 ${track.lyricist_name}` : '',
    track.composer_name ? `作曲 ${track.composer_name}` : ''
  ].filter(Boolean).join(' · ');
  metadata.textContent = `${track.provider.toUpperCase()} #${track.provider_track_id}${credits ? ` · ${credits}` : ''} · ${track.segment_count || 0} 个分词片段 · ${track.candidate_count || 0} 条待选 · ${track.approved_count || 0} 条已发布`;
  copy.append(title, artist, metadata);
  summary.append(copy);
  const body = document.createElement('div');
  body.className = 'local-track-body';
  details.append(summary, body);
  details.addEventListener('toggle', () => {
    if (details.open) loadLocalSegments(details, track);
  });
  return details;
}

async function loadLocalLibrary() {
  const token = elements.reviewToken.value.trim() || state.reviewToken;
  if (!token) { showToast('请先输入审核口令'); return; }
  state.reviewToken = token;
  const request = ++state.localRequest;
  const params = new URLSearchParams({ page: String(state.localPage), limit: '24', q: $('#local-library-query').value.trim(), candidates_only: String($('#local-library-scope').value === 'candidate') });
  $('#local-prev').disabled = true;
  $('#local-next').disabled = true;
  elements.localTrackList.replaceChildren(reviewPlaceholder('正在读取本地曲库', '载入 SQLite 统计…'));
  try {
    const payload = await apiFetch(`/api/v1/review/local/tracks?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (request !== state.localRequest) return;
    if (state.localPage > 1 && state.localPage > payload.pagination.pages) {
      state.localPage = Math.max(1, payload.pagination.pages);
      return loadLocalLibrary();
    }
    $('#local-page').textContent = payload.pagination.pages ? `第 ${state.localPage} / ${payload.pagination.pages} 页` : '暂无结果';
    $('#local-prev').disabled = state.localPage <= 1;
    $('#local-next').disabled = state.localPage >= payload.pagination.pages;
    state.localTracks = payload.data;
    elements.localTrackCount.textContent = payload.stats.visibleSourceTracks ?? payload.data.length;
    elements.localCandidateCount.textContent = payload.stats.candidates;
    elements.localTrackList.replaceChildren(...(payload.data.length
      ? payload.data.map(localTrackCard)
      : [reviewPlaceholder('没有匹配歌曲', '试试其他关键词，或将歌曲范围切换为“全部来源歌曲”。')]));
  } catch (error) {
    if (request !== state.localRequest) return;
    $('#local-page').textContent = '';
    elements.localTrackCount.textContent = '—';
    elements.localCandidateCount.textContent = '—';
    elements.localTrackList.replaceChildren(reviewPlaceholder('无法读取本地曲库', error.message));
  }
}

async function uploadManualTrack(event) {
  event.preventDefault();
  const token = state.reviewToken || elements.reviewToken.value.trim();
  if (!token) {
    showToast('请先输入审核口令');
    return;
  }
  state.reviewToken = token;
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = $('button[type="submit"]', form);
  const payload = {
    trackName: data.get('trackName'),
    artistName: data.get('artistName'),
    language: data.get('language'),
    sourceUrl: data.get('sourceUrl'),
    plainLyrics: data.get('plainLyrics')
  };
  button.disabled = true;
  elements.manualUploadStatus.textContent = '正在分词、去重和评分…';
  try {
    const result = await apiFetch('/api/v1/review/local/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    form.reset();
    const summary = result.data.analysis;
    elements.manualUploadStatus.textContent = `已保存：${summary.candidates} 条候选，过滤 ${summary.filtered} 条。`;
    showToast('人工歌词已保存到本地候选库');
    await loadLocalLibrary();
  } catch (error) {
    elements.manualUploadStatus.textContent = error.details?.[0]?.message || error.message;
  } finally {
    button.disabled = false;
  }
}

async function rejectLocalSegment(track, segment, card) {
  $$('button', card).forEach((button) => { button.disabled = true; });
  try {
    await apiFetch(`/api/v1/review/local/segments/${segment.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${state.reviewToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'reject', reviewNote: '人工审核：不收录此片段' })
    });
    showToast('已标记为不收录');
    card.remove();
    await loadLocalLibrary();
  } catch (error) {
    showToast(error.message);
    $$('button', card).forEach((button) => { button.disabled = false; });
  }
}

function renderSourceResults(payload) {
  const notice = document.createElement('p');
  notice.className = 'source-rights-notice';
  notice.textContent = payload.rightsNotice;
  const tracks = payload.data || [];
  if (!tracks.length) {
    const empty = document.createElement('div');
    empty.className = 'source-results-status';
    empty.textContent = '没有找到带歌词的版本，请换歌曲名或歌手再试。';
    elements.sourceResults.replaceChildren(notice, empty);
    return;
  }
  state.sourceTracks = tracks;
  elements.sourceResults.replaceChildren(notice, ...tracks.map(sourceTrackCard));
}

async function searchSources(event) {
  event.preventDefault();
  const token = elements.reviewToken.value.trim();
  const query = elements.sourceQuery.value.trim();
  const provider = elements.sourceProvider.value;
  if (!token) {
    showToast('请先输入审核口令');
    return;
  }
  if (query.length < 2) {
    showToast('曲库搜索词至少需要 2 个字符');
    return;
  }
  state.reviewToken = token;
  sourceStatus('正在连接真实曲库…');
  try {
    const params = new URLSearchParams({ provider, q: query });
    const payload = await apiFetch(`/api/v1/review/sources/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    renderSourceResults(payload);
  } catch (error) {
    sourceStatus(error.message);
    showToast(error.message);
  }
}

function openCandidate(track, line) {
  state.currentCandidate = { mode: 'external', track, line };
  const form = elements.candidateForm;
  form.reset();
  $('[name="excerpt"]', form).value = line;
  $('[name="language"]', form).value = /[\u3400-\u9fff]/.test(line) ? 'zh-CN' : 'en';
  $('[name="creatorName"]', form).value = track.provider === 'jamendo' ? track.artistName : '';
  $('[name="creatorRole"]', form).value = track.provider === 'jamendo' ? '词曲 / 艺术家' : '作词 / 创作者';
  $('[name="rightsBasis"]', form).value = track.provider === 'jamendo' && track.licenseUrl
    ? 'licensed'
    : 'quotation_review';
  $('[name="rightsNote"]', form).value = track.licenseUrl ? `Jamendo 曲目许可：${track.licenseUrl}` : '';
  $('#candidate-track-meta').textContent = `《${track.trackName}》 · ${track.artistName || '未知表演者'} · ${track.provider.toUpperCase()} #${track.providerId}`;
  $('#candidate-dialog-title').textContent = '加入待审队列';
  $('#candidate-submit').firstChild.textContent = '加入待审 ';
  $('#candidate-confirm-copy').textContent = '我已核对创作者和使用依据，同意先进入待审队列。';
  elements.candidateStatus.textContent = track.provider === 'lrclib'
    ? '提示：LRCLIB 的 artist 通常是表演者，请另行核对词作者。'
    : 'Jamendo 许可会随候选记录一并保存。';
  if (typeof elements.candidateDialog.showModal === 'function') elements.candidateDialog.showModal();
  else elements.candidateDialog.setAttribute('open', '');
}

function openLocalCandidate(track, segment) {
  state.currentCandidate = { mode: 'local', track, segment, line: segment.text };
  const form = elements.candidateForm;
  form.reset();
  $('[name="excerpt"]', form).value = segment.text;
  $('[name="language"]', form).value = segment.language;
  $('[name="creatorName"]', form).value = track.lyricist_name || (track.provider === 'jamendo' ? track.artist_name : '');
  $('[name="creatorRole"]', form).value = track.lyricist_name
    ? '作词'
    : track.provider === 'jamendo' ? '词曲 / 艺术家' : '作词 / 创作者';
  $('[name="rightsBasis"]', form).value = track.provider === 'jamendo' && track.license_url
    ? 'licensed'
    : track.provider === 'publicdomain' ? 'public_domain' : 'quotation_review';
  $('[name="rightsNote"]', form).value = track.provider === 'publicdomain'
    ? `Public Domain Lyrics 标记为公版；原始文本来源：${track.source_url}`
    : track.license_url ? `Jamendo 曲目许可：${track.license_url}` : '';
  $('#candidate-track-meta').textContent = `《${track.track_name}》 · ${track.artist_name || '未知表演者'} · 本地评分 ${segment.score}`;
  $('#candidate-dialog-title').textContent = '批准并发布摘句';
  $('#candidate-submit').firstChild.textContent = '批准发布 ';
  $('#candidate-confirm-copy').textContent = '我已核对创作者、文本和使用依据，同意将这条摘句发布到公开 API。';
  elements.candidateStatus.textContent = track.provider === 'lrclib'
    ? '整首歌词已在本地完成分词；发布前仍需核对词作者和使用依据。'
    : track.provider === 'publicdomain'
      ? '该文本标记为公版；发布前请核对原始 Wikisource / Project Gutenberg 页面和作者。'
      : track.provider === 'chinese_lyrics'
        ? '来自离线中文学习数据集；已提取制作信息，但发布前仍需核对词作者和使用依据。'
      : 'Jamendo 许可会随公开摘句一并保存。';
  if (typeof elements.candidateDialog.showModal === 'function') elements.candidateDialog.showModal();
  else elements.candidateDialog.setAttribute('open', '');
}

async function importCandidate(event) {
  event.preventDefault();
  const candidate = state.currentCandidate;
  if (!candidate) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const submitButton = $('button[type="submit"]', form);
  const reviewFields = {
    creatorName: data.get('creatorName'),
    creatorRole: data.get('creatorRole'),
    language: data.get('language'),
    rightsBasis: data.get('rightsBasis'),
    rightsNote: data.get('rightsNote'),
    themes: String(data.get('themes') || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    curatorNote: data.get('curatorNote'),
    rightsConfirmed: data.get('rightsConfirmed') === 'on'
  };
  const payload = {
    provider: candidate.track.provider,
    providerId: candidate.track.providerId,
    excerpt: candidate.line,
    ...reviewFields
  };
  submitButton.disabled = true;
  elements.candidateStatus.textContent = candidate.mode === 'local'
    ? '正在写入公开摘句…'
    : '正在重新核对曲库原文…';
  try {
    const endpoint = candidate.mode === 'local'
      ? `/api/v1/review/local/segments/${candidate.segment.id}`
      : '/api/v1/review/sources/import';
    const requestPayload = candidate.mode === 'local'
      ? { action: 'approve', reviewNote: '本地候选经人工核对通过', ...reviewFields }
      : payload;
    const result = await apiFetch(endpoint, {
      method: candidate.mode === 'local' ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${state.reviewToken || elements.reviewToken.value.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestPayload)
    });
    elements.candidateDialog.close();
    if (candidate.mode === 'local') {
      showToast('本地候选已批准并发布');
      await Promise.all([loadLocalLibrary(), loadStats(), loadEntries()]);
    } else {
      showToast(`已加入待审：${result.data.id}`);
      await loadReviewQueue();
    }
  } catch (error) {
    const detail = error.details?.[0]?.message;
    elements.candidateStatus.textContent = detail || error.message;
  } finally {
    submitButton.disabled = false;
  }
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      showView(nav.dataset.nav);
    }
  });

  elements.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.page = 1;
    state.query = elements.searchInput.value.trim();
    loadEntries();
  });

  elements.clearSearch.addEventListener('click', () => {
    state.page = 1;
    state.query = '';
    elements.searchInput.value = '';
    loadEntries();
  });

  $$('.filter-chip').forEach((button) => {
    button.addEventListener('click', () => {
      state.page = 1;
      state.language = button.dataset.language;
      $$('.filter-chip').forEach((item) => item.classList.toggle('is-active', item === button));
      loadEntries();
    });
  });

  $$('[data-collection]').forEach((button) => {
    button.addEventListener('click', () => {
      state.collection = button.dataset.collection;
      state.page = 1;
      $$('[data-collection]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      loadEntries();
    });
  });
  for (const [id, delta] of [['collection-prev', -1], ['collection-next', 1]]) {
    $(`#${id}`).addEventListener('click', async () => {
      state.page += delta;
      await loadEntries();
      $('.collection-heading').scrollIntoView({ block: 'start' });
    });
  }

  $('#random-button').addEventListener('click', async () => {
    const params = new URLSearchParams();
    if (state.language) params.set('language', state.language);
    try {
      const payload = await apiFetch(`/api/v1/random?${params}`);
      openEntry(payload.data);
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.dialog.addEventListener('close', () => { currentSharePanel?.dispose(); currentSharePanel = null; });
  $('#dialog-close').addEventListener('click', () => elements.dialog.close());
  elements.dialog.addEventListener('click', (event) => {
    if (event.target === elements.dialog) elements.dialog.close();
  });

  $$('.endpoint').forEach((button) => button.addEventListener('click', () => updateCodeSample(button.dataset.endpoint)));

  $$('.copy-button').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.copyTarget);
      try {
        await navigator.clipboard.writeText(target.textContent);
        showToast('已复制');
      } catch {
        showToast('复制失败，请手动选择文本');
      }
    });
  });

  elements.submissionForm.addEventListener('submit', submitQuote);
  $('[name="excerpt"]', elements.submissionForm).addEventListener('input', (event) => {
    $('#excerpt-count').textContent = event.target.value.length;
  });

  $('#load-review').addEventListener('click', loadReviewQueue);
  elements.reviewToken.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadReviewQueue();
  });

  $('#source-search-form').addEventListener('submit', searchSources);
  $('#refresh-local-library').addEventListener('click', loadLocalLibrary);
  $('#local-library-filter').addEventListener('submit', (event) => {
    event.preventDefault(); state.localPage = 1; loadLocalLibrary();
  });
  for (const id of ['local-library-scope', 'local-segment-status']) {
    $(`#${id}`).addEventListener('change', () => { state.localPage = 1; loadLocalLibrary(); });
  }
  for (const [id, delta] of [['local-prev', -1], ['local-next', 1]]) {
    $(`#${id}`).addEventListener('click', async () => {
      state.localPage += delta;
      await loadLocalLibrary();
      $('#local-library-filter').scrollIntoView({ block: 'start' });
    });
  }
  elements.manualUploadForm.addEventListener('submit', uploadManualTrack);
  elements.sourceProvider.addEventListener('change', () => {
    elements.sourceProviderNote.textContent = elements.sourceProvider.value === 'jamendo'
      ? 'Jamendo 返回逐曲 Creative Commons 许可，发布时必须保留署名与许可条件。'
      : elements.sourceProvider.value === 'publicdomain'
        ? '公版集合无需注册，收录 1,347 首来自 Wikisource / Project Gutenberg 的可追溯文本。'
        : 'LRCLIB 无需密钥，但歌词权利需要逐首核对。';
  });
  elements.candidateForm.addEventListener('submit', importCandidate);
  $('#candidate-dialog-close').addEventListener('click', () => elements.candidateDialog.close());
  elements.candidateDialog.addEventListener('click', (event) => {
    if (event.target === elements.candidateDialog) elements.candidateDialog.close();
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      showView('discover');
      requestAnimationFrame(() => elements.searchInput.focus());
    }
  });

  window.addEventListener('hashchange', () => showView(location.hash.slice(1), false));
}

async function init() {
  $('#base-url').textContent = apiBase();
  bindEvents();
  await loadConfig();
  showView(location.hash.slice(1) || 'discover', false);
  updateCodeSample('entries');
  await Promise.all([loadEntries(), loadStats()]);
}

init();
