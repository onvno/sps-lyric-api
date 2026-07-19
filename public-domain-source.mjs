const BASE_URL = 'https://pubdomainonly.com/';
const PUBLIC_DOMAIN_MARK = 'https://creativecommons.org/publicdomain/mark/1.0/';

function decodeHtml(value) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—',
    hellip: '…', copy: '©'
  };
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLocaleLowerCase()] ?? match);
}

function htmlToText(value, { preserveLines = false } = {}) {
  let text = String(value || '');
  if (preserveLines) text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeHtml(text).replace(/\r/g, '');
  return preserveLines
    ? text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).join('\n').trim()
    : text.replace(/\s+/g, ' ').trim();
}

export function parsePublicDomainCatalog(html) {
  const tracks = [];
  const seen = new Set();
  const pattern = /<a\s+href="\?type=pd(?:&|&amp;)song=(\d+)(?:&|&amp;)page=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    const providerId = match[1];
    const title = htmlToText(match[3]);
    if (!title || /^show full lyrics/i.test(title) || seen.has(providerId)) continue;
    seen.add(providerId);
    tracks.push({ providerId, page: Number(match[2]), trackName: title });
  }
  return tracks;
}

export function parsePublicDomainDetail(html, providerId) {
  const source = String(html || '');
  const title = htmlToText(source.match(/<div class="song-title">([\s\S]*?)<\/div>/i)?.[1]);
  const category = htmlToText(source.match(/<span class="song-category">([\s\S]*?)<\/span>/i)?.[1]);
  const lyrics = htmlToText(source.match(/<div class="song-lyrics full">([\s\S]*?)<\/div>/i)?.[1], { preserveLines: true });
  const year = htmlToText(source.match(/<div>Year:\s*([\s\S]*?)<\/div>/i)?.[1]);
  const sourceUrl = decodeHtml(source.match(/<div>Source:\s*<a href="([^"]+)"/i)?.[1] || '');
  if (!title || !lyrics) return null;
  return {
    provider: 'publicdomain',
    providerId: String(providerId),
    trackName: title,
    artistName: '',
    albumName: [category, year].filter(Boolean).join(' · '),
    duration: 0,
    instrumental: false,
    hasSyncedLyrics: false,
    language: 'en',
    licenseUrl: PUBLIC_DOMAIN_MARK,
    sourceUrl: sourceUrl || `${BASE_URL}?type=pd&song=${providerId}`,
    plainLyrics: lyrics,
    syncedLyrics: '',
    lines: [...new Set(lyrics.split('\n').map((line) => line.trim()).filter(Boolean))].slice(0, 80),
    publicDomain: { category, year, catalogUrl: `${BASE_URL}?type=pd&song=${providerId}` }
  };
}

export async function listPublicDomainSongs({ page = 1, query = '', fetchText }) {
  const url = new URL(BASE_URL);
  url.searchParams.set('type', 'pd');
  url.searchParams.set('page', String(page));
  if (query) url.searchParams.set('q', query);
  return parsePublicDomainCatalog(await fetchText(url));
}

export async function getPublicDomainSong(providerId, { fetchText }) {
  if (!/^\d+$/.test(String(providerId))) return null;
  const page = Math.floor(Number(providerId) / 20) + 1;
  const url = new URL(BASE_URL);
  url.searchParams.set('type', 'pd');
  url.searchParams.set('song', String(providerId));
  url.searchParams.set('page', String(page));
  return parsePublicDomainDetail(await fetchText(url), providerId);
}

export function publicDomainSearchTrack(item) {
  return {
    provider: 'publicdomain',
    providerId: item.providerId,
    trackName: item.trackName,
    artistName: '公版作品，作者待核对',
    albumName: 'Public Domain Lyrics',
    duration: 0,
    instrumental: false,
    hasSyncedLyrics: false,
    language: 'en',
    licenseUrl: PUBLIC_DOMAIN_MARK,
    sourceUrl: `${BASE_URL}?type=pd&song=${item.providerId}&page=${item.page}`,
    plainLyrics: '',
    syncedLyrics: '',
    lines: []
  };
}
