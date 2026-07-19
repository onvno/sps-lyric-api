import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openLyricsDatabase } from './db.mjs';
import { analyzeLyrics } from './lyric-analysis.mjs';
import {
  getPublicDomainSong,
  listPublicDomainSongs,
  publicDomainSearchTrack
} from './public-domain-source.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(ROOT, 'data', 'lyrics.db');
const DEFAULT_SEED_PATH = join(ROOT, 'data', 'store.json');
const DEFAULT_PUBLIC_DIR = join(ROOT, 'public');
const MAX_BODY_BYTES = 256 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

const RIGHTS_BASES = new Set(['public_domain', 'licensed', 'permission', 'quotation_review']);
const LANGUAGES = new Set(['zh-CN', 'en']);

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function apiError(res, status, code, message, details) {
  sendJson(res, status, { error: { code, message, ...(details ? { details } : {}) } });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('请求内容过大');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('请求体不是有效的 JSON');
    error.status = 400;
    throw error;
  }
}

function cleanText(value, maxLength = 240) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function cleanExcerpt(value, maxLength = 280) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/gu, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, maxLength)
    .trim();
}

function excerptKey(value) {
  return cleanExcerpt(value, 1000).toLocaleLowerCase().replace(/\s+/gu, ' ');
}

function cleanUrl(value) {
  const text = cleanText(value, 800);
  if (!text) return '';
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function normalizeCreators(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .map((creator) => ({
      name: cleanText(creator?.name, 100),
      role: cleanText(creator?.role, 40) || '创作者'
    }))
    .filter((creator) => creator.name);
}

function normalizeThemes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, 24)).filter(Boolean))].slice(0, 6);
}

function safeEquals(left, right) {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function reviewerAuthorized(req, reviewerToken) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return Boolean(reviewerToken) && safeEquals(token, reviewerToken);
}

function filterEntries(entries, searchParams) {
  const query = cleanText(searchParams.get('q') || '', 100).toLocaleLowerCase();
  const language = searchParams.get('language') || '';
  const theme = cleanText(searchParams.get('theme') || '', 24).toLocaleLowerCase();

  return entries.filter((entry) => {
    if (language && entry.language !== language) return false;
    if (theme && !entry.themes.some((item) => item.toLocaleLowerCase() === theme)) return false;
    if (!query) return true;
    const haystack = [
      entry.excerpt,
      entry.song.title,
      entry.song.originalTitle,
      ...entry.creators.map((creator) => creator.name),
      ...entry.themes
    ].join(' ').toLocaleLowerCase();
    return haystack.includes(query);
  });
}

function paginate(items, searchParams) {
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(searchParams.get('limit') || '18', 10) || 18));
  const start = (page - 1) * limit;
  return {
    data: items.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total: items.length,
      pages: Math.ceil(items.length / limit)
    }
  };
}

function aggregateSongs(entries) {
  const songs = new Map();
  for (const entry of entries) {
    const current = songs.get(entry.song.id) || {
      ...entry.song,
      creators: entry.creators,
      languages: [],
      themes: [],
      entryCount: 0,
      entries: []
    };
    current.entryCount += 1;
    current.languages = [...new Set([...current.languages, entry.language])];
    current.themes = [...new Set([...current.themes, ...entry.themes])];
    current.entries.push({ id: entry.id, excerpt: entry.excerpt, language: entry.language });
    songs.set(entry.song.id, current);
  }
  return [...songs.values()];
}

function uniqueLyricLines(lyrics) {
  if (typeof lyrics !== 'string') return [];
  const seen = new Set();
  const lines = [];
  for (const rawLine of lyrics.split(/\r?\n/)) {
    const line = cleanText(rawLine.replace(/^\[\d{2}:\d{2}(?:\.\d{1,3})?\]\s*/, ''), 280);
    const key = line.toLocaleLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length >= 80) break;
  }
  return lines;
}

function submissionValidation(body) {
  const normalized = {
    excerpt: cleanExcerpt(body.excerpt, 280),
    language: cleanText(body.language, 10),
    songTitle: cleanText(body.songTitle, 140),
    songOriginalTitle: cleanText(body.songOriginalTitle, 140),
    creators: normalizeCreators(body.creators),
    sourceUrl: cleanUrl(body.sourceUrl),
    sourceLabel: cleanText(body.sourceLabel, 120),
    rightsBasis: cleanText(body.rightsBasis, 40),
    rightsNote: cleanText(body.rightsNote, 600),
    rightsConfirmed: body.rightsConfirmed === true,
    curatorNote: cleanText(body.curatorNote, 360),
    themes: normalizeThemes(body.themes),
    submitterName: cleanText(body.submitterName, 100),
    submitterContact: cleanText(body.submitterContact, 160)
  };

  const errors = [];
  if (normalized.excerpt.length < 2) errors.push({ field: 'excerpt', message: '摘录至少需要 2 个字符' });
  if (!LANGUAGES.has(normalized.language)) errors.push({ field: 'language', message: '仅支持 zh-CN 或 en' });
  if (!normalized.songTitle) errors.push({ field: 'songTitle', message: '请填写歌曲名称' });
  if (!normalized.creators.length) errors.push({ field: 'creators', message: '请至少填写一位创作者；传统作品可填“传统民歌”' });
  if (!normalized.sourceUrl) errors.push({ field: 'sourceUrl', message: '请提供有效的 http(s) 来源链接' });
  if (!RIGHTS_BASES.has(normalized.rightsBasis)) errors.push({ field: 'rightsBasis', message: '请选择有效的版权依据' });
  if (!normalized.rightsNote) errors.push({ field: 'rightsNote', message: '请说明公版、授权或引用判断依据' });
  if (!normalized.rightsConfirmed) errors.push({ field: 'rightsConfirmed', message: '投稿人必须确认有权提交该内容' });
  if (!normalized.submitterName) errors.push({ field: 'submitterName', message: '请填写投稿人名称' });
  return { normalized, errors };
}

function entryFromSubmission(submission, edits = {}) {
  const songId = cleanText(edits.songId, 100) || `song_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const excerpt = cleanExcerpt(edits.excerpt, 280) || submission.excerpt;
  const title = cleanText(edits.songTitle, 140) || submission.songTitle;
  const originalTitle = cleanText(edits.songOriginalTitle, 140) || submission.songOriginalTitle;
  const creators = normalizeCreators(edits.creators).length ? normalizeCreators(edits.creators) : submission.creators;
  const themes = normalizeThemes(edits.themes).length ? normalizeThemes(edits.themes) : submission.themes;
  const curatorNote = cleanText(edits.curatorNote, 360) || submission.curatorNote || '经人工审核收录。';
  const now = new Date().toISOString();
  return {
    id: `line_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    excerpt,
    language: submission.language,
    song: { id: songId, title, ...(originalTitle ? { originalTitle } : {}) },
    creators,
    themes,
    curatorNote,
    source: {
      url: submission.sourceUrl,
      label: submission.sourceLabel || new URL(submission.sourceUrl).hostname,
      accessedAt: now.slice(0, 10)
    },
    rights: {
      basis: submission.rightsBasis,
      jurisdiction: cleanText(edits.jurisdiction, 60) || '投稿人声明，待运营方复核',
      note: submission.rightsNote
    },
    status: 'published',
    createdAt: now
  };
}

function buildOpenApi(origin) {
  return {
    openapi: '3.1.0',
    info: {
      title: '摘句 Lyric Lines API',
      version: '1.1.0',
      description: '人工策展的中英文经典歌词短摘录 API，支持 SQLite 本地曲库、整首下载、本地分词和人工审核。'
    },
    servers: [{ url: `${origin}/api/v1` }],
    paths: {
      '/entries': {
        get: {
          summary: '搜索公开歌词摘句',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'language', in: 'query', schema: { type: 'string', enum: ['zh-CN', 'en'] } },
            { name: 'theme', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 18 } }
          ],
          responses: { 200: { description: '分页摘句列表' } }
        }
      },
      '/entries/{id}': {
        get: {
          summary: '获取单条摘句',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: '摘句详情' }, 404: { description: '不存在' } }
        }
      },
      '/songs': { get: { summary: '按歌曲聚合摘句', responses: { 200: { description: '歌曲列表' } } } },
      '/random': { get: { summary: '随机获取一条摘句', responses: { 200: { description: '随机摘句' } } } },
      '/submissions': {
        post: {
          summary: '提交候选摘句',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SubmissionInput' } } } },
          responses: { 201: { description: '已进入待审队列' }, 422: { description: '字段校验失败' } }
        }
      },
      '/review/sources/search': {
        get: {
          summary: '搜索外部真实歌词源',
          security: [{ reviewerBearer: [] }],
          parameters: [
            { name: 'provider', in: 'query', schema: { type: 'string', enum: ['lrclib', 'publicdomain', 'jamendo'], default: 'lrclib' } },
            { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } }
          ],
          responses: { 200: { description: '带可选歌词行的曲库版本' }, 401: { description: '审核口令无效' } }
        }
      },
      '/review/sources/import': {
        post: {
          summary: '把外部曲库的一句歌词加入待审队列',
          security: [{ reviewerBearer: [] }],
          responses: { 201: { description: '候选已进入待审队列' }, 422: { description: '原文、作者或版权依据校验失败' } }
        }
      },
      '/review/local/fetch': {
        post: {
          summary: '下载整首歌词到本地 SQLite 并进行分词、去重与候选评分',
          security: [{ reviewerBearer: [] }],
          responses: { 201: { description: '歌词和分析片段已保存到本地' } }
        }
      },
      '/review/local/upload': {
        post: {
          summary: '人工上传整首歌词到本地 SQLite 并进行分析',
          security: [{ reviewerBearer: [] }],
          responses: { 201: { description: '人工歌词和分析片段已保存到本地' } }
        }
      },
      '/review/local/tracks': {
        get: {
          summary: '列出本地 SQLite 曲库',
          security: [{ reviewerBearer: [] }],
          parameters: [{
            name: 'candidates_only',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: '只返回仍有待选片段的歌曲'
          }],
          responses: { 200: { description: '本地歌曲及候选统计' } }
        }
      },
      '/review/local/tracks/{id}': {
        get: {
          summary: '查看本地歌曲的分词候选',
          security: [{ reviewerBearer: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: '本地歌曲和分词片段' } }
        }
      },
      '/review/local/segments/{id}': {
        patch: {
          summary: '批准或驳回一个本地分词片段',
          security: [{ reviewerBearer: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: '审核结果；批准时生成公开摘句' } }
        }
      }
    },
    components: {
      securitySchemes: {
        reviewerBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'reviewer-token' }
      },
      schemas: {
        Creator: {
          type: 'object',
          required: ['name', 'role'],
          properties: { name: { type: 'string' }, role: { type: 'string' } }
        },
        SubmissionInput: {
          type: 'object',
          required: ['excerpt', 'language', 'songTitle', 'creators', 'sourceUrl', 'rightsBasis', 'rightsNote', 'rightsConfirmed', 'submitterName'],
          properties: {
            excerpt: { type: 'string', maxLength: 280 },
            language: { type: 'string', enum: ['zh-CN', 'en'] },
            songTitle: { type: 'string' },
            creators: { type: 'array', items: { $ref: '#/components/schemas/Creator' } },
            sourceUrl: { type: 'string', format: 'uri' },
            rightsBasis: { type: 'string', enum: [...RIGHTS_BASES] },
            rightsNote: { type: 'string' },
            rightsConfirmed: { type: 'boolean', const: true },
            submitterName: { type: 'string' }
          }
        }
      }
    }
  };
}

async function serveStatic(res, publicDir, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (requested.includes('..')) {
    apiError(res, 400, 'invalid_path', '无效路径');
    return;
  }
  const filePath = join(publicDir, requested);
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': requested === 'index.html' ? 'no-cache' : 'public, max-age=300'
    });
    res.end(body);
  } catch (error) {
    if (error.code === 'ENOENT') {
      apiError(res, 404, 'not_found', '页面不存在');
      return;
    }
    throw error;
  }
}

export async function createLyricServer(options = {}) {
  const dbPath = options.dbPath || process.env.LYRICS_DB_PATH || DEFAULT_DB_PATH;
  const seedPath = options.seedPath === undefined ? DEFAULT_SEED_PATH : options.seedPath;
  const publicDir = options.publicDir || DEFAULT_PUBLIC_DIR;
  const reviewerToken = options.reviewerToken ?? process.env.REVIEWER_TOKEN ?? 'demo-review-token';
  const publicBaseUrl = cleanUrl(options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL);
  const externalFetch = options.externalFetch || globalThis.fetch;
  const jamendoClientId = options.jamendoClientId ?? process.env.JAMENDO_CLIENT_ID ?? '';
  const demoMode = reviewerToken === 'demo-review-token';
  let writeQueue = Promise.resolve();
  let databaseClosed = false;

  await mkdir(dirname(dbPath), { recursive: true });
  const database = openLyricsDatabase({ dbPath, seedPath });

  async function fetchExternalJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await externalFetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'lyric-lines-api/0.2 (review-source-lookup)' }
      });
      if (!response.ok) {
        const error = new Error(`外部曲库返回 ${response.status}`);
        error.status = 502;
        throw error;
      }
      return await response.json();
    } catch (error) {
      if (error.status) throw error;
      const wrapped = new Error(error.name === 'AbortError' ? '外部曲库响应超时' : '暂时无法连接外部曲库');
      wrapped.status = 502;
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchExternalText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await externalFetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'lyric-lines-api/0.3 (personal-local-library)' }
      });
      if (!response.ok) {
        const error = new Error(`外部曲库返回 ${response.status}`);
        error.status = 502;
        throw error;
      }
      return await response.text();
    } catch (error) {
      if (error.status) throw error;
      const wrapped = new Error(error.name === 'AbortError' ? '外部曲库响应超时' : '暂时无法连接外部曲库');
      wrapped.status = 502;
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeLrclibTrack(track) {
    const id = Number.parseInt(track?.id, 10);
    if (!Number.isFinite(id)) return null;
    const lines = uniqueLyricLines(track.plainLyrics || track.syncedLyrics);
    return {
      provider: 'lrclib',
      providerId: String(id),
      trackName: cleanText(track.trackName || track.name, 140),
      artistName: cleanText(track.artistName, 140),
      albumName: cleanText(track.albumName, 140),
      duration: Number(track.duration) || 0,
      instrumental: track.instrumental === true,
      hasSyncedLyrics: Boolean(track.syncedLyrics),
      language: '',
      licenseUrl: '',
      sourceUrl: `https://lrclib.net/api/get/${id}`,
      plainLyrics: String(track.plainLyrics || ''),
      syncedLyrics: String(track.syncedLyrics || ''),
      lines
    };
  }

  function normalizeJamendoTrack(track) {
    const id = cleanText(String(track?.id || ''), 40);
    if (!id) return null;
    return {
      provider: 'jamendo',
      providerId: id,
      trackName: cleanText(track.name, 140),
      artistName: cleanText(track.artist_name, 140),
      albumName: cleanText(track.album_name, 140),
      duration: Number(track.duration) || 0,
      instrumental: track.musicinfo?.vocalinstrumental === 'instrumental',
      hasSyncedLyrics: false,
      language: cleanText(track.musicinfo?.lang, 10),
      licenseUrl: cleanUrl(track.license_ccurl),
      sourceUrl: cleanUrl(track.shareurl) || `https://www.jamendo.com/track/${id}`,
      plainLyrics: String(track.lyrics || ''),
      syncedLyrics: '',
      lines: uniqueLyricLines(track.lyrics)
    };
  }

  function sourceTrackResponse(track) {
    const { plainLyrics, syncedLyrics, ...response } = track;
    return response;
  }

  async function searchExternalProvider(provider, query) {
    if (provider === 'lrclib') {
      const url = new URL('https://lrclib.net/api/search');
      url.searchParams.set('q', query);
      const payload = await fetchExternalJson(url);
      return (Array.isArray(payload) ? payload : [])
        .map(normalizeLrclibTrack)
        .filter((track) => track && track.lines.length)
        .slice(0, 12);
    }
    if (provider === 'jamendo') {
      if (!jamendoClientId) {
        const error = new Error('Jamendo 尚未配置；请设置 JAMENDO_CLIENT_ID');
        error.status = 503;
        throw error;
      }
      const url = new URL('https://api.jamendo.com/v3.0/tracks/');
      url.searchParams.set('client_id', jamendoClientId);
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '12');
      url.searchParams.set('namesearch', query);
      url.searchParams.set('include', 'lyrics licenses musicinfo');
      url.searchParams.set('vocalinstrumental', 'vocal');
      const payload = await fetchExternalJson(url);
      if (payload?.headers?.status && payload.headers.status !== 'success') {
        const error = new Error(payload.headers.error_message || 'Jamendo 查询失败');
        error.status = 502;
        throw error;
      }
      return (Array.isArray(payload?.results) ? payload.results : [])
        .map(normalizeJamendoTrack)
        .filter((track) => track && track.lines.length)
        .slice(0, 12);
    }
    if (provider === 'publicdomain') {
      const results = await listPublicDomainSongs({ query, fetchText: fetchExternalText });
      return results.slice(0, 12).map(publicDomainSearchTrack);
    }
    const error = new Error('provider 必须是 lrclib、publicdomain 或 jamendo');
    error.status = 422;
    throw error;
  }

  async function getExternalTrack(provider, providerId) {
    if (provider === 'lrclib') {
      if (!/^\d+$/.test(providerId)) return null;
      const payload = await fetchExternalJson(`https://lrclib.net/api/get/${providerId}`);
      return normalizeLrclibTrack(payload);
    }
    if (provider === 'jamendo') {
      if (!jamendoClientId) {
        const error = new Error('Jamendo 尚未配置；请设置 JAMENDO_CLIENT_ID');
        error.status = 503;
        throw error;
      }
      const url = new URL('https://api.jamendo.com/v3.0/tracks/');
      url.searchParams.set('client_id', jamendoClientId);
      url.searchParams.set('format', 'json');
      url.searchParams.set('id', providerId);
      url.searchParams.set('include', 'lyrics licenses musicinfo');
      const payload = await fetchExternalJson(url);
      return normalizeJamendoTrack(payload?.results?.[0]);
    }
    if (provider === 'publicdomain') {
      return getPublicDomainSong(providerId, { fetchText: fetchExternalText });
    }
    return null;
  }

  async function readStore() {
    return database.readStore();
  }

  function updateStore(mutator) {
    writeQueue = writeQueue.catch(() => {}).then(() => database.updateStore(mutator));
    return writeQueue;
  }

  const server = createServer(async (req, res) => {
    const origin = `http://${req.headers.host || 'localhost'}`;
    const canonicalOrigin = (publicBaseUrl || origin).replace(/\/$/, '');
    const url = new URL(req.url || '/', origin);
    const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';

    res.setHeader('access-control-allow-origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          service: 'lyric-lines-api',
          storage: 'sqlite',
          database: database.stats(),
          time: new Date().toISOString()
        });
        return;
      }

      if (pathname === '/api/v1/config' && req.method === 'GET') {
        sendJson(res, 200, {
          demoMode,
          ...(demoMode ? { demoReviewToken: reviewerToken } : {}),
          storage: { engine: 'sqlite', local: true },
          providers: {
            lrclib: { enabled: true, access: 'review_only', rights: 'item_review_required' },
            publicdomain: { enabled: true, access: 'review_only', rights: 'public_domain_source_review' },
            jamendo: { enabled: Boolean(jamendoClientId), access: 'review_only', rights: 'creative_commons_per_track' },
            manual: { enabled: true, access: 'review_only', rights: 'uploader_review_required' }
          }
        });
        return;
      }

      if (pathname === '/api/v1/openapi.json' && req.method === 'GET') {
        sendJson(res, 200, buildOpenApi(origin));
        return;
      }

      if (pathname === '/api/v1/entries' && req.method === 'GET') {
        const store = await readStore();
        const filtered = filterEntries(store.entries.filter((entry) => entry.status === 'published'), url.searchParams);
        sendJson(res, 200, paginate(filtered, url.searchParams));
        return;
      }

      const entryMatch = pathname.match(/^\/api\/v1\/entries\/([^/]+)$/);
      if (entryMatch && req.method === 'GET') {
        const store = await readStore();
        const entry = store.entries.find((item) => item.id === entryMatch[1] && item.status === 'published');
        if (!entry) {
          apiError(res, 404, 'entry_not_found', '未找到这条摘句');
          return;
        }
        sendJson(res, 200, { data: entry });
        return;
      }

      if (pathname === '/api/v1/songs' && req.method === 'GET') {
        const store = await readStore();
        const filtered = filterEntries(store.entries.filter((entry) => entry.status === 'published'), url.searchParams);
        sendJson(res, 200, paginate(aggregateSongs(filtered), url.searchParams));
        return;
      }

      if (pathname === '/api/v1/random' && req.method === 'GET') {
        const store = await readStore();
        const filtered = filterEntries(store.entries.filter((entry) => entry.status === 'published'), url.searchParams);
        if (!filtered.length) {
          apiError(res, 404, 'no_match', '没有符合条件的摘句');
          return;
        }
        const entry = filtered[Math.floor(Math.random() * filtered.length)];
        sendJson(res, 200, { data: entry });
        return;
      }

      if (pathname === '/api/v1/submissions' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const { normalized, errors } = submissionValidation(body);
        if (errors.length) {
          apiError(res, 422, 'validation_failed', '投稿信息不完整', errors);
          return;
        }
        const submission = {
          id: `sub_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
          ...normalized,
          status: 'pending',
          submittedAt: new Date().toISOString()
        };
        await updateStore((store) => {
          store.submissions.unshift(submission);
        });
        sendJson(res, 201, {
          data: { id: submission.id, status: submission.status, submittedAt: submission.submittedAt },
          message: '投稿已进入人工审核队列，不会立即公开。'
        });
        return;
      }

      if (pathname === '/api/v1/review/submissions' && req.method === 'GET') {
        if (!reviewerAuthorized(req, reviewerToken)) {
          apiError(res, 401, 'reviewer_unauthorized', '审核口令无效');
          return;
        }
        const store = await readStore();
        const status = url.searchParams.get('status') || 'pending';
        const submissions = store.submissions.filter((submission) => status === 'all' || submission.status === status);
        sendJson(res, 200, paginate(submissions, url.searchParams));
        return;
      }

      if (pathname === '/api/v1/review/sources/search' && req.method === 'GET') {
        if (!reviewerAuthorized(req, reviewerToken)) {
          apiError(res, 401, 'reviewer_unauthorized', '审核口令无效');
          return;
        }
        const provider = cleanText(url.searchParams.get('provider') || 'lrclib', 20);
        const query = cleanText(url.searchParams.get('q') || '', 100);
        if (query.length < 2) {
          apiError(res, 422, 'query_too_short', '曲库搜索词至少需要 2 个字符');
          return;
        }
        const results = await searchExternalProvider(provider, query);
        sendJson(res, 200, {
          data: results.map(sourceTrackResponse),
          provider,
          rightsNotice: provider === 'lrclib'
            ? 'LRCLIB 免费提供歌词检索，但每首歌词的再分发权利需单独核对。'
            : provider === 'publicdomain'
              ? 'Public Domain Lyrics 收录来自 Wikisource / Project Gutenberg 的公版文本；下载后仍应核对原始来源。'
              : 'Jamendo 曲目按逐曲 Creative Commons 许可使用，发布时必须保留许可与署名。'
        });
        return;
      }

      if (pathname === '/api/v1/review/local/fetch' && req.method === 'POST') {
        if (!reviewerAuthorized(req, reviewerToken)) {
          apiError(res, 401, 'reviewer_unauthorized', '审核口令无效');
          return;
        }
        const body = await readJsonBody(req);
        const provider = cleanText(body.provider, 20);
        const providerId = cleanText(String(body.providerId || ''), 40);
        const track = await getExternalTrack(provider, providerId);
        if (!track || (!track.plainLyrics && !track.syncedLyrics)) {
          apiError(res, 404, 'source_track_not_found', '外部曲库中未找到可下载的歌词版本');
          return;
        }
        const preferredLanguage = LANGUAGES.has(body.language) ? body.language : '';
        const analysis = analyzeLyrics({
          plainLyrics: track.plainLyrics,
          syncedLyrics: track.syncedLyrics,
          language: preferredLanguage
        });
        const localTrack = database.saveSourceTrack({
          ...track,
          language: analysis.summary.language
        });
        database.saveSegments(localTrack.id, analysis.segments);
        sendJson(res, 201, {
          data: {
            track: database.getSourceTrack(localTrack.id),
            analysis: analysis.summary
          },
          message: '整首歌词已保存到本地 SQLite，并完成分词、去重和候选评分。'
        });
        return;
      }

      if (pathname === '/api/v1/review/local/upload' && req.method === 'POST') {
        if (!reviewerAuthorized(req, reviewerToken)) {
          apiError(res, 401, 'reviewer_unauthorized', '审核口令无效');
          return;
        }
        const body = await readJsonBody(req);
        const trackName = cleanText(body.trackName, 140);
        const artistName = cleanText(body.artistName, 140);
        const albumName = cleanText(body.albumName, 140);
        const plainLyrics = typeof body.plainLyrics === 'string' ? body.plainLyrics.trim().slice(0, 200_000) : '';
        const syncedLyrics = typeof body.syncedLyrics === 'string' ? body.syncedLyrics.trim().slice(0, 200_000) : '';
        const sourceUrl = cleanUrl(body.sourceUrl);
        const errors = [];
        if (!trackName) errors.push({ field: 'trackName', message: '请填写歌曲名称' });
        if (!plainLyrics && !syncedLyrics) errors.push({ field: 'plainLyrics', message: '请粘贴纯文本歌词或 LRC 同步歌词' });
        if (!sourceUrl) errors.push({ field: 'sourceUrl', message: '请提供可核对的 http(s) 来源链接' });
        if (errors.length) {
          apiError(res, 422, 'validation_failed', '人工上传资料不完整', errors);
          return;
        }
        const preferredLanguage = LANGUAGES.has(body.language) ? body.language : '';
        const analysis = analyzeLyrics({ plainLyrics, syncedLyrics, language: preferredLanguage });
        const providerId = `manual_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
        const localTrack = database.saveSourceTrack({
          provider: 'manual',
          providerId,
          trackName,
          artistName,
          albumName,
          duration: 0,
          language: analysis.summary.language,
          plainLyrics,
          syncedLyrics,
          sourceUrl,
          licenseUrl: cleanUrl(body.licenseUrl)
        });
        database.saveSegments(localTrack.id, analysis.segments);
        sendJson(res, 201, {
          data: {
            track: database.getSourceTrack(localTrack.id),
            analysis: analysis.summary
          },
          message: '人工上传的整首歌词已保存到本地 SQLite，并进入候选审核流程。'
        });
        return;
      }

      if (pathname === '/api/v1/review/local/tracks' && req.method === 'GET') {
        if (!reviewerAuthorized(req, reviewerToken)) {
          apiError(res, 401, 'reviewer_unauthorized', '审核口令无效');
          return;
        }
        const candidatesOnly = ['1', 'true'].includes(
          String(url.searchParams.get('candidates_only') || '').toLocaleLowerCase()
        );
        const tracks = database.listSourceTracks({ candidatesOnly });
        sendJson(res, 200, {
          data: tracks,
          stats: { ...database.stats(), visibleSourceTracks: tracks.length }
        });
        return;
      }

      const localTrackMatch = pathname.match(/^\/api\/v1\/review\/local\/tracks\/(\d+)$/);
      if (localTrackMatch && req.method === 'GET') {
        if (!reviewerAuthorized(req, reviewerToken)) {
          apiError(res, 401, 'reviewer_unauthorized', '审核口令无效');
          return;
        }
        const localTrackId = Number.parseInt(localTrackMatch[1], 10);
        const track = database.getSourceTrack(localTrackId, {
          includeLyrics: url.searchParams.get('include') === 'lyrics'
        });
        if (!track) {
          apiError(res, 404, 'local_track_not_found', '本地曲库中未找到这首歌');
          return;
        }
        sendJson(res, 200, {
          data: {
            track,
            segments: database.listSegments(localTrackId, url.searchParams.get('status') || 'candidate')
          }
        });
        return;
      }

      const localSegmentMatch = pathname.match(/^\/api\/v1\/review\/local\/segments\/(\d+)$/);
      if (localSegmentMatch && req.method === 'PATCH') {
        if (!reviewerAuthorized(req, reviewerToken)) {
          apiError(res, 401, 'reviewer_unauthorized', '审核口令无效');
          return;
        }
        const segmentId = Number.parseInt(localSegmentMatch[1], 10);
        const segment = database.getSegment(segmentId);
        if (!segment) {
          apiError(res, 404, 'local_segment_not_found', '本地曲库中未找到这个片段');
          return;
        }
        if (!['candidate', 'filtered'].includes(segment.status)) {
          apiError(res, 409, 'already_reviewed', `该片段已经是 ${segment.status} 状态`);
          return;
        }
        const body = await readJsonBody(req);
        const action = cleanText(body.action, 20);
        if (!['approve', 'reject'].includes(action)) {
          apiError(res, 422, 'invalid_action', 'action 必须是 approve 或 reject');
          return;
        }
        const reviewNote = cleanText(body.reviewNote, 500);
        if (action === 'reject') {
          if (!reviewNote) {
            apiError(res, 422, 'review_note_required', '驳回时必须填写原因');
            return;
          }
          database.rejectSegment(segmentId, reviewNote);
          sendJson(res, 200, { data: { id: segmentId, status: 'rejected', reviewNote } });
          return;
        }

        const track = database.getSourceTrack(segment.source_track_id);
        const creatorName = cleanText(body.creatorName, 100);
        const creatorRole = cleanText(body.creatorRole, 40) || '作词 / 创作者';
        const creators = creatorName ? [{ name: creatorName, role: creatorRole }] : [];
        if (track.artist_name && track.artist_name.toLocaleLowerCase() !== creatorName.toLocaleLowerCase()) {
          creators.push({ name: track.artist_name, role: '表演者 / 曲库版本' });
        }
        const automaticRightsNote = track.provider === 'jamendo' && track.license_url
          ? `Jamendo 曲目许可：${track.license_url}`
          : track.provider === 'publicdomain'
            ? `Public Domain Lyrics 标记为公版；原始文本来源：${track.source_url}`
            : '';
        const legacyProvider = ['legacy_backup_sps', 'legacy_backup_apply'].includes(track.provider);
        const candidate = {
          excerpt: segment.text,
          language: LANGUAGES.has(body.language) ? body.language : segment.language,
          songTitle: track.track_name,
          creators,
          sourceUrl: cleanUrl(body.sourceUrl)
            || track.source_url
            || (legacyProvider ? `${canonicalOrigin}/legacy-sql-source.html` : ''),
          sourceLabel: cleanText(body.sourceLabel, 120) || (track.provider === 'lrclib'
            ? `LRCLIB #${track.provider_track_id}`
            : track.provider === 'jamendo'
              ? `Jamendo · ${track.track_name}`
              : track.provider === 'publicdomain'
                ? `Public Domain Lyrics · ${track.track_name}`
                : track.provider === 'chinese_lyrics'
                  ? `ChineseLyrics 离线库 · ${track.track_name}`
                  : track.provider === 'legacy_backup_sps'
                    ? `旧 SQL 备份 · sps_sps #${track.provider_track_id}`
                    : track.provider === 'legacy_backup_apply'
                      ? `旧 SQL 备份 · sps_apply #${track.provider_track_id}`
                      : `人工上传 · ${track.track_name}`),
          rightsBasis: cleanText(body.rightsBasis, 40)
            || (track.provider === 'publicdomain'
              ? 'public_domain'
              : track.provider === 'jamendo' && track.license_url ? 'licensed' : 'quotation_review'),
          rightsNote: cleanText(body.rightsNote, 600) || automaticRightsNote,
          rightsConfirmed: body.rightsConfirmed === true,
          curatorNote: cleanText(body.curatorNote, 360),
          themes: normalizeThemes(body.themes),
          submitterName: `本地曲库审核 · ${track.provider}`,
          submitterContact: ''
        };
        const { normalized, errors } = submissionValidation(candidate);
        if (errors.length) {
          apiError(res, 422, 'validation_failed', '候选资料不完整', errors);
          return;
        }
        const store = await readStore();
        const existingSong = store.entries.find((item) =>
          item.song.title.toLocaleLowerCase() === normalized.songTitle.toLocaleLowerCase()
        );
        const entry = entryFromSubmission(normalized, {
          songId: existingSong?.song.id,
          curatorNote: normalized.curatorNote
        });
        const duplicate = store.entries.some((item) =>
          excerptKey(item.excerpt) === excerptKey(entry.excerpt)
          && item.song.title.toLocaleLowerCase() === entry.song.title.toLocaleLowerCase()
        );
        if (duplicate) {
          apiError(res, 409, 'duplicate_entry', '同一歌曲下已有相同摘句');
          return;
        }
        database.publishSegment(segmentId, entry, reviewNote);
        sendJson(res, 200, { data: { segmentId, status: 'approved', entry } });
        return;
      }

      if (pathname === '/api/v1/review/sources/import' && req.method === 'POST') {
        if (!reviewerAuthorized(req, reviewerToken)) {
          apiError(res, 401, 'reviewer_unauthorized', '审核口令无效');
          return;
        }
        const body = await readJsonBody(req);
        const provider = cleanText(body.provider, 20);
        const providerId = cleanText(String(body.providerId || ''), 40);
        const track = await getExternalTrack(provider, providerId);
        if (!track) {
          apiError(res, 404, 'source_track_not_found', '外部曲库中未找到该版本');
          return;
        }
        const excerpt = cleanText(body.excerpt, 280);
        if (!track.lines.includes(excerpt)) {
          apiError(res, 422, 'excerpt_not_in_source', '所选摘句与曲库原文不一致，请重新搜索后选择');
          return;
        }
        const creatorName = cleanText(body.creatorName, 100);
        const creatorRole = cleanText(body.creatorRole, 40) || '作词 / 创作者';
        if (!creatorName) {
          apiError(res, 422, 'creator_required', '曲库只提供表演者时，必须补充并核对词作者或创作者');
          return;
        }
        const rightsBasis = cleanText(body.rightsBasis, 40)
          || (provider === 'publicdomain'
            ? 'public_domain'
            : provider === 'jamendo' && track.licenseUrl ? 'licensed' : 'quotation_review');
        const automaticRightsNote = provider === 'jamendo' && track.licenseUrl
          ? `Jamendo 曲目许可：${track.licenseUrl}`
          : provider === 'publicdomain'
            ? `Public Domain Lyrics 标记为公版；原始文本来源：${track.sourceUrl}`
            : '';
        const rightsNote = cleanText(body.rightsNote, 600) || automaticRightsNote;
        const creators = [{ name: creatorName, role: creatorRole }];
        if (track.artistName && track.artistName.toLocaleLowerCase() !== creatorName.toLocaleLowerCase()) {
          creators.push({ name: track.artistName, role: '表演者 / 曲库版本' });
        }
        const candidate = {
          excerpt,
          language: cleanText(body.language, 10),
          songTitle: track.trackName,
          creators,
          sourceUrl: track.sourceUrl,
          sourceLabel: provider === 'lrclib'
            ? `LRCLIB #${providerId}`
            : provider === 'publicdomain'
              ? `Public Domain Lyrics · ${track.trackName}`
              : `Jamendo · ${track.trackName}`,
          rightsBasis,
          rightsNote,
          rightsConfirmed: body.rightsConfirmed === true,
          curatorNote: cleanText(body.curatorNote, 360),
          themes: normalizeThemes(body.themes),
          submitterName: `审核员曲库导入 · ${provider}`,
          submitterContact: ''
        };
        const { normalized, errors } = submissionValidation(candidate);
        if (errors.length) {
          apiError(res, 422, 'validation_failed', '候选资料不完整', errors);
          return;
        }
        const submission = {
          id: `sub_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
          ...normalized,
          externalSource: {
            provider,
            providerId,
            artistName: track.artistName,
            albumName: track.albumName,
            licenseUrl: track.licenseUrl,
            hasSyncedLyrics: track.hasSyncedLyrics
          },
          status: 'pending',
          submittedAt: new Date().toISOString()
        };
        await updateStore((store) => {
          store.submissions.unshift(submission);
        });
        sendJson(res, 201, {
          data: { id: submission.id, status: submission.status, source: submission.externalSource },
          message: '真实曲库摘句已加入待审队列，尚未公开。'
        });
        return;
      }

      const reviewMatch = pathname.match(/^\/api\/v1\/review\/submissions\/([^/]+)$/);
      if (reviewMatch && req.method === 'PATCH') {
        if (!reviewerAuthorized(req, reviewerToken)) {
          apiError(res, 401, 'reviewer_unauthorized', '审核口令无效');
          return;
        }
        const body = await readJsonBody(req);
        const action = cleanText(body.action, 20);
        if (!['approve', 'reject'].includes(action)) {
          apiError(res, 422, 'invalid_action', 'action 必须是 approve 或 reject');
          return;
        }
        const reviewNote = cleanText(body.reviewNote, 500);
        if (action === 'reject' && !reviewNote) {
          apiError(res, 422, 'review_note_required', '驳回时必须填写原因');
          return;
        }

        const result = await updateStore((store) => {
          const submission = store.submissions.find((item) => item.id === reviewMatch[1]);
          if (!submission) return { notFound: true };
          if (submission.status !== 'pending') return { conflict: true, status: submission.status };

          if (action === 'approve') {
            const existingSong = store.entries.find((item) =>
              item.song.title.toLocaleLowerCase() === submission.songTitle.toLocaleLowerCase()
            );
            const edits = {
              ...(body.edits || {}),
              songId: cleanText(body.edits?.songId, 100) || existingSong?.song.id
            };
            const entry = entryFromSubmission(submission, edits);
            const duplicate = store.entries.some((item) =>
              excerptKey(item.excerpt) === excerptKey(entry.excerpt)
              && item.song.title.toLocaleLowerCase() === entry.song.title.toLocaleLowerCase()
            );
            if (duplicate) return { duplicate: true };
            submission.status = 'approved';
            submission.reviewedAt = new Date().toISOString();
            submission.reviewNote = reviewNote;
            store.entries.unshift(entry);
            submission.publishedEntryId = entry.id;
            return { submission, entry };
          }
          submission.status = 'rejected';
          submission.reviewedAt = new Date().toISOString();
          submission.reviewNote = reviewNote;
          return { submission };
        });

        if (result.notFound) {
          apiError(res, 404, 'submission_not_found', '未找到该投稿');
          return;
        }
        if (result.conflict) {
          apiError(res, 409, 'already_reviewed', `该投稿已经是 ${result.status} 状态`);
          return;
        }
        if (result.duplicate) {
          apiError(res, 409, 'duplicate_entry', '同一歌曲下已有相同摘句');
          return;
        }
        sendJson(res, 200, { data: result });
        return;
      }

      if (pathname.startsWith('/api/')) {
        apiError(res, 404, 'route_not_found', 'API 路径不存在');
        return;
      }

      await serveStatic(res, publicDir, pathname);
    } catch (error) {
      console.error(error);
      apiError(res, error.status || 500, 'internal_error', error.status ? error.message : '服务暂时不可用');
    }
  });

  server.on('close', () => {
    if (!databaseClosed) {
      databaseClosed = true;
      database.close();
    }
  });
  return server;
}

async function main() {
  const port = Number.parseInt(process.env.PORT || '8787', 10);
  const host = process.env.HOST || '127.0.0.1';
  const server = await createLyricServer();
  server.listen(port, host, () => {
    console.log(`Lyric Lines API running at http://${host}:${port}`);
    if (!process.env.REVIEWER_TOKEN) {
      console.warn('Using demo reviewer token. Set REVIEWER_TOKEN before deployment.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
