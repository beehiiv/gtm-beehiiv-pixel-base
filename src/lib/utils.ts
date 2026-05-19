export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function isCrawler(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const crawlerRegex =
    /(bot|crawl|spider|slurp|archiver|indexer|facebookexternalhit|twitterbot|bingpreview|applebot|siteaudit|semrush|ahrefs|mj12bot|seznambot|screaming frog|dotbot)/i;
  return crawlerRegex.test(ua);
}

// Coerces to an integer. Numbers are rounded — `32.63 * 100 = 3263.0000000000005`
// would otherwise sail through and trip the backend's decimal validator.
export function getInt(s: number | string | undefined): number | undefined {
  if (typeof s === 'number') return Number.isFinite(s) ? Math.round(s) : undefined;
  if (typeof s === 'string') {
    const n = Number.parseInt(s, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(s: string | undefined): boolean {
  return !!s && UUID_RE.test(s);
}

export function validatePixelId(pixelId: string): boolean {
  if (!pixelId || typeof pixelId !== 'string') {
    throw new Error('Invalid pixel ID');
  }
  const pixelIdRegex = /^[a-zA-Z0-9-_]{8,}$/;
  if (!pixelIdRegex.test(pixelId)) {
    throw new Error('Invalid pixel ID format');
  }
  return true;
}

// Validates a beehiiv click id (bhcl_id) format. Used both for query-param
// parsing on landing and for sanity-checking cookie reads.
export function isValidClickId(bhclId: string): boolean {
  return /^[a-zA-Z0-9-_]{8,}$/.test(bhclId);
}
