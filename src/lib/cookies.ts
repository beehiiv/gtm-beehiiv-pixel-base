import type { HostDomain } from './types';
import { isValidClickId } from './utils';

// Domains where multiple beehiiv publications share a hostname suffix
// (e.g. pub1.beehiiv.com / pub2.beehiiv.com). On these we host-scope the
// cookie name to prevent cross-publication collision. External advertiser
// sites (Shopify stores, GTM installs, etc.) don't have this problem.
export const EXCLUDED_DOMAINS = ['beehiiv.com', 'staginghiiv.com', 'localhiiv.com'];

const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export interface CookieJar {
  get(name: CookieName): Promise<string>;
  set(name: CookieName, value: string): Promise<void>;
}

export type CookieName = '_bhc' | '_bhp';

export function getHostDomain(hostname: string): HostDomain {
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return { host: '', domain: 'localhost' };
  }
  let host = 'www';
  let domain = '';
  const parts = hostname.split('.');
  if (parts.length < 3) {
    domain = `${parts[0]}.${parts[1]}`;
  } else {
    host = parts[0];
    domain = `${parts[1]}.${parts[2]}`;
  }
  return { host, domain };
}

// Returns the bhcl_id from a URL's query string, or null if absent/malformed.
export function parseClickId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const bhclId = parsed.searchParams.get('bhcl_id');
    if (!bhclId) return null;
    if (!isValidClickId(bhclId)) {
      console.error('Invalid bhcl_id format');
      return null;
    }
    return bhclId;
  } catch {
    return null;
  }
}

// Sync cookie jar backed by document.cookie. Wraps reads/writes in Promises so
// callers can treat it identically to async jars (e.g. Shopify's browser.cookie).
//
// Naming rules (preserved from the original implementation):
//  - On EXCLUDED_DOMAINS, _bhc writes use `_bhc_<host>` to avoid collision
//    between sibling beehiiv publications. _bhp writes are always plain.
//  - Reads fall back through plain → _<host> → _www until they find a match.
export class DocumentCookieJar implements CookieJar {
  private isSecure = true;

  constructor(
    private host: string,
    private domain: string,
  ) {}

  async get(name: CookieName): Promise<string> {
    const [cookie] = this.findCookieWithHost(name);
    return cookie ? cookie.split('=')[1] : '';
  }

  async set(name: CookieName, value: string): Promise<void> {
    const isExcludedDomain = EXCLUDED_DOMAINS.includes(this.domain);
    // _bhc on beehiiv-owned domains is host-scoped; _bhp and everything else stays plain
    const effectiveName = isExcludedDomain && name === '_bhc' ? `${name}_${this.host}` : name;
    const props = `domain=.${this.domain}; path=/; samesite=strict; ${this.isSecure ? 'secure;' : ''} max-age=${COOKIE_MAX_AGE_SECONDS}`;
    document.cookie = `${effectiveName}=${value}; ${props}`;
  }

  private findCookieWithHost(name: string): [string | undefined, string] {
    const allCookies = document.cookie.split(';');
    let cookie: string | undefined;
    const isExcludedDomain = EXCLUDED_DOMAINS.includes(this.domain);

    if (!isExcludedDomain) {
      cookie = this.findCookie(allCookies, name);
    }
    if (!cookie) {
      const hostScoped = `${name}_${this.host}`;
      cookie = this.findCookie(allCookies, hostScoped);
      if (cookie) return [cookie, hostScoped];
    }
    if (!cookie && this.host !== 'www') {
      const wwwScoped = `${name}_www`;
      cookie = this.findCookie(allCookies, wwwScoped);
      if (cookie) return [cookie, wwwScoped];
    }
    return [cookie, name];
  }

  private findCookie(allCookies: string[], name: string): string | undefined {
    return allCookies.find((cookie) => cookie.trim().startsWith(`${name}=`));
  }
}
