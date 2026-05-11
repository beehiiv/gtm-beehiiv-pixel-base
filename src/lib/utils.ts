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

export function getInt(s: number | string | undefined): number | undefined {
  if (typeof s === 'number') return s;
  if (typeof s === 'string') return Number.parseInt(s, 10);
  return undefined;
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
