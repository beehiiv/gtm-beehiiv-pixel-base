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

// content_ids must ship as an array of strings. Shopify (and some GTM datalayer
// configs) hand us a single scalar variant id — wrapping it here keeps the
// backend's array validator happy without forcing every caller to remember.
// Anything that stringifies to "[object Object]" is dropped — that's not a
// real id, it's a misconfigured datalayer.
export function toStringArray(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  const out = arr
    .filter((x) => x !== undefined && x !== null && x !== '')
    .map((x) => String(x))
    .filter((s) => s !== '[object Object]' && s.trim() !== '');
  return out.length ? out : undefined;
}

// Cast to string. Backend expects order_id as a string but Shopify hands us
// numeric ids (e.g. 4138434) — those rejected with "is not compatible with the
// expected field type" until we coerce.
export function toIdString(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v);
  return s === '[object Object]' ? undefined : s;
}

// Coerce primitives to a trimmed non-empty string. Used for optional payload
// fields where Apiary expects a string — content_category, content_name,
// content_type, currency, search_string, status. Objects/arrays come back
// as undefined since they have no sensible string projection here.
export function toStringField(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'object') return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

// Warn (without throwing) when our coercion actually changed the caller's
// input. Lets advertisers spot misconfigured datalayers in devtools instead
// of silently shipping massaged data forever.
export function warnIfChanged(field: string, before: unknown, after: unknown): void {
  if (before === after) return;
  if (before === undefined || before === '') return;
  // Deep-equal arrays of primitives — cheap and good enough for our shapes.
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length === after.length && before.every((v, i) => v === after[i])) return;
  }
  console.warn(`[bhpx] ${field}: coerced ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
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
