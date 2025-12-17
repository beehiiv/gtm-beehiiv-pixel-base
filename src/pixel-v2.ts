import { md5 } from 'js-md5';
import { version as SCRIPT_VERSION } from '../package.json';

// Extend Window interface for our globals
declare global {
  interface Window {
    bhpx: BeehiivPixelQueue;
    bhp?: {
      track: typeof track;
    };
    ReactRouter?: unknown;
    React?: {
      useEffect: (...args: unknown[]) => unknown;
    };
  }
}

// Types
interface BeehiivPixelQueue {
  queue?: unknown[][];
  callMethod?: (...args: unknown[]) => void;
  debug?: DebugUtils | boolean;
  track?: typeof track;
}

interface DebugUtils {
  overlay: HTMLDivElement;
  clearLogs: () => void;
  toggleOverlay: () => void;
  getEventHistory: () => string[];
  log: (message: string) => void;
}

interface HostDomain {
  host: string;
  domain: string;
}

interface TrackOptions {
  data?: TrackData;
}

interface TrackData {
  content_category?: string;
  content_ids?: string[];
  content_name?: string;
  content_type?: string;
  currency?: string;
  num_items?: number;
  predicted_ltv_cents?: number | string;
  search_string?: string;
  status?: string;
  value_cents?: number | string;
  order_id?: string;
  email?: string;
}

interface PixelPayload {
  pixel_id: string;
  ad_network_placement_id: string;
  subscriber_id: string;
  profile_id: string;
  event: string;
  timestamp: number;
  landed_timestamp: number;
  sent_timestamp: number;
  event_id: string;
  url: string;
  user_agent: string;
  script_version: string;
  content_category?: string;
  content_ids?: string[];
  content_name?: string;
  content_type?: string;
  currency?: string;
  num_items?: number;
  predicted_ltv_cents?: number;
  search_string?: string;
  status?: string;
  value_cents?: number;
  email_hash_sha256: string;
  email_hash_sha1: string;
  email_hash_md5: string;
  order_id?: string;
  email_id?: string;
}

interface EmailHashes {
  email_hash_sha256: string;
  email_hash_sha1: string;
  email_hash_md5: string;
}

interface InitOptions {
  autoConfig?: boolean;
  debug?: boolean;
  trackClientNavigation?: boolean;
  batchSize?: number;
  batchInterval?: number;
  retryAttempts?: number;
}

interface ProcessedEvents {
  [hash: string]: number;
}

// Get the queue that was created by the base script
const bhpx = window.bhpx;
const queue = bhpx.queue || [];

let _pixelId = ''; // pixelId will be set during initialization
const isSecure = true;

// Configuration
const APIARY_ENDPOINT = import.meta.env.VITE_PIXEL_V2_APIARY_ENDPOINT as string;
const EXCLUDED_DOMAINS = ['beehiiv.com', 'staginghiiv.com', 'localhiiv.com'];
const CONFIG = {
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  REQUEST_TIMEOUT: 5000,
  RATE_LIMIT_INTERVAL: 0,
  BATCH_SIZE: 1,
  BATCH_INTERVAL: 1000,
  DEDUPE_TIME_PERIOD: 15 * 60, // 15 minutes in seconds
};

// Rate limiter implementation
const rateLimiter = {
  lastEvent: 0,
  minInterval: CONFIG.RATE_LIMIT_INTERVAL,
  canTrack(): boolean {
    const now = Date.now();
    if (now - this.lastEvent >= this.minInterval) {
      this.lastEvent = now;
      return true;
    }
    return false;
  },
};

// Event batching
const eventQueue: PixelPayload[] = [];
let batchTimeout: ReturnType<typeof setTimeout> | null = null;

// Utility Functions
function isCrawler(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const crawlerRegex =
    /(bot|crawl|spider|slurp|archiver|indexer|facebookexternalhit|twitterbot|bingpreview|applebot|siteaudit|semrush|ahrefs|mj12bot|seznambot|screaming frog|dotbot)/i;
  return crawlerRegex.test(ua);
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getHostDomain(): HostDomain {
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return { host: '', domain: 'localhost' };
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

async function sendToServer(payload: PixelPayload[], retryAttempt = 0): Promise<void> {
  if (!rateLimiter.canTrack()) {
    console.warn('Rate limit exceeded, skipping event');
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

  try {
    navigator.sendBeacon(APIARY_ENDPOINT, JSON.stringify(payload));
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Request timed out');
    }

    if (retryAttempt < CONFIG.RETRY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, CONFIG.RETRY_DELAY * (retryAttempt + 1)));
      return sendToServer(payload, retryAttempt + 1);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function validatePixelId(pixelId: string): boolean {
  if (!pixelId || typeof pixelId !== 'string') {
    throw new Error('Invalid pixel ID');
  }
  // Add specific format validation if needed
  const pixelIdRegex = /^[a-zA-Z0-9-_]{8,}$/;
  if (!pixelIdRegex.test(pixelId)) {
    throw new Error('Invalid pixel ID format');
  }
  return true;
}

// Enhanced tracking with batching support
async function track(eventName: string, options: TrackOptions = {}): Promise<void> {
  try {
    if (isCrawler()) {
      // don't run the pixel for known crawlers
      return;
    }

    if (!_pixelId) {
      throw new Error('Pixel ID not initialized');
    }
    if (!eventName || typeof eventName !== 'string') {
      throw new Error('Invalid event name');
    }

    // Normalize event name to lowercase
    eventName = eventName.toLowerCase();
    const event_id = generateUUID();
    const timestamp = Date.now();
    const { host, domain } = getHostDomain();
    const bhc = getCookie('_bhc', host, domain) || '';
    const bhp = getCookie('_bhp', host, domain) || '';
    const [ad_network_placement_id, subscriber_id, email_id] = bhc.split('_');

    const data = options.data || {};
    const {
      content_category,
      content_ids,
      content_name,
      content_type,
      currency,
      num_items,
      predicted_ltv_cents,
      search_string,
      status,
      value_cents,
      order_id,
    } = data;

    let email = data.email || '';
    try {
      const url = new URL(window.top?.location.href || window.location.href);
      if (!email && url.searchParams.has('email')) {
        email = url.searchParams.get('email') || '';
      }
    } catch {
      // Ignore errors if URL parsing fails
      // or if the URL is not accessible due to security restrictions
    }

    const debug = window.bhpx?.debug;
    if (debug && typeof debug === 'object' && 'log' in debug) {
      debug.log(`track: ${eventName} ${JSON.stringify(data)}`);
    }

    const { email_hash_sha256, email_hash_sha1, email_hash_md5 } = await hashEmail(email);

    const payload: PixelPayload = {
      pixel_id: _pixelId,
      ad_network_placement_id: ad_network_placement_id || '',
      subscriber_id: subscriber_id || '',
      profile_id: bhp, // anonymous profile id
      event: eventName,
      timestamp,
      landed_timestamp: timestamp,
      sent_timestamp: timestamp,
      event_id,
      url: window.location.href,
      user_agent: window.navigator.userAgent,
      script_version: SCRIPT_VERSION,
      // custom data properties are optional
      content_category,
      content_ids,
      content_name,
      content_type,
      currency,
      num_items,
      predicted_ltv_cents: getInt(predicted_ltv_cents),
      search_string,
      status,
      value_cents: getInt(value_cents),
      email_hash_sha256,
      email_hash_sha1,
      email_hash_md5,
      order_id,
      email_id,
    };

    // Add to batch queue
    eventQueue.push(payload);

    // Set up batch processing if not already scheduled
    if (!batchTimeout && eventQueue.length < CONFIG.BATCH_SIZE) {
      batchTimeout = setTimeout(processBatch, CONFIG.BATCH_INTERVAL);
    } else if (eventQueue.length >= CONFIG.BATCH_SIZE) {
      await processBatch();
    }
  } catch (error) {
    console.error('Tracking failed:', error);
    if (window.bhpx.debug) {
      console.error('Debug details:', { eventName, options });
    }
  }
}

async function processBatch(): Promise<void> {
  if (eventQueue.length === 0) return;

  const batch = dedupe(eventQueue.splice(0, CONFIG.BATCH_SIZE));
  // If no events left after deduplication, exit early
  if (batch.length === 0) return;

  batchTimeout = null;

  try {
    sendToServer(batch);
  } catch (error) {
    console.error('Failed to process batch:', error);
    // Optionally, re-queue failed events
    eventQueue.unshift(...batch);
  }
}

function dedupe(events: PixelPayload[]): PixelPayload[] {
  const STORAGE_KEY = 'bhpx_processed_events';
  const currentTime = Math.floor(Date.now() / 1000); // current time in seconds

  // Load existing processed events from localStorage
  let processedEvents: ProcessedEvents = {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      processedEvents = JSON.parse(stored) as ProcessedEvents;
    }
  } catch (error) {
    console.warn('Failed to load processed events from localStorage:', error);
    processedEvents = {};
  }

  // Filter out events already processed within the dedupe time period
  const seen = new Set<string>();
  const filteredEvents = events.filter((event) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { timestamp, landed_timestamp, sent_timestamp, event_id, ...rest } = event;
    const eventJson = JSON.stringify(rest);
    const eventHash = md5(eventJson);

    // Check current batch
    if (seen.has(eventHash)) {
      const debug = window?.bhpx?.debug;
      if (debug && typeof debug === 'object' && 'log' in debug) {
        debug.log(`Event ${event_id} ${event.event} is a duplicate in the current batch and will be skipped.`);
      }
      return false;
    }

    // Check against previously processed events
    if (processedEvents[eventHash]) {
      const processedAt = processedEvents[eventHash];
      const timeDiff = currentTime - processedAt;

      if (timeDiff < CONFIG.DEDUPE_TIME_PERIOD) {
        const debug = window?.bhpx?.debug;
        if (debug && typeof debug === 'object' && 'log' in debug) {
          debug.log(`Event ${event_id} ${rest.event} is a duplicate since ${timeDiff} seconds ago and will be skipped.`);
        }
        return false;
      }
    }

    seen.add(eventHash);
    return true;
  });

  // Store newly processed events with timestamps
  const updatedProcessedEvents: ProcessedEvents = { ...processedEvents };

  // Add new events
  filteredEvents.forEach((event) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { timestamp, landed_timestamp, sent_timestamp, event_id, ...rest } = event;
    const eventJson = JSON.stringify(rest);
    const eventHash = md5(eventJson);
    updatedProcessedEvents[eventHash] = currentTime;
  });

  // Clean up expired events
  Object.keys(updatedProcessedEvents).forEach((hash) => {
    if (updatedProcessedEvents[hash] < currentTime - CONFIG.DEDUPE_TIME_PERIOD) {
      delete updatedProcessedEvents[hash];
    }
  });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProcessedEvents));
  } catch (error) {
    console.warn('Failed to save processed events to localStorage:', error);
  }

  return filteredEvents;
}

// Enhanced click handling with validation
function handleClickIdentification(): void {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const bhclId = urlParams.get('bhcl_id');

    if (!bhclId) return;

    // Validate bhclId format
    const bhclIdRegex = /^[a-zA-Z0-9-_]{8,}$/;
    if (!bhclIdRegex.test(bhclId)) {
      console.error('Invalid bhcl_id format');
      return;
    }

    const { host, domain } = getHostDomain();

    const bhc = getCookie('_bhc', host, domain) || '';

    // Check if bhclId is already stored
    if (bhc === bhclId) {
      return;
    }
    // Store click data
    updateBHCCookie('_bhc', bhclId, host, domain);
  } catch (error) {
    console.error('Error in click identification:', error);
  }
}

// Enhanced initialization with validation and cleanup
function init(pixelId: string, options: InitOptions = {}): void {
  try {
    validatePixelId(pixelId);
    _pixelId = pixelId;

    console.log(`beehiiv pixel v${SCRIPT_VERSION} initialized`);

    const { host, domain } = getHostDomain();

    // Set user identification cookie if not exists
    if (!getCookie('_bhp', host, domain)) {
      updateCookie('_bhp', generateUUID(), domain);
    }

    // Handle ad click identification
    handleClickIdentification();

    const defaultConfig: Required<InitOptions> = {
      autoConfig: true,
      debug: false,
      trackClientNavigation: true,
      batchSize: CONFIG.BATCH_SIZE,
      batchInterval: CONFIG.BATCH_INTERVAL,
      retryAttempts: CONFIG.RETRY_ATTEMPTS,
    };

    const config = { ...defaultConfig, ...options };

    // Update global config with user options
    Object.assign(CONFIG, {
      BATCH_SIZE: config.batchSize,
      BATCH_INTERVAL: config.batchInterval,
      RETRY_ATTEMPTS: config.retryAttempts,
    });

    if (config.trackClientNavigation) {
      monitorUrlChanges(() => track('pageview'));
    }

    if (config.debug) {
      enableDebugMode();
    }
  } catch (error) {
    console.error('Initialization failed:', error);
  }
}

// Process any commands that were queued before the pixel loaded
bhpx.callMethod = (...rest: unknown[]): void => {
  const args = Array.prototype.slice.call(rest) as unknown[];
  const method = args[0] as string;
  const params = args.slice(1);

  switch (method) {
    case 'init': {
      init(params[0] as string, params[1] as InitOptions);
      break;
    }
    case 'track': {
      const trackFn = window.bhp?.track || track;
      trackFn(params[0] as string, params[1] as TrackOptions);
      break;
    }
    default: {
      console.error(`Unknown method: ${method}`);
    }
  }
};

// Process queued commands
while (queue.length > 0) {
  const cmd = queue.shift();
  if (cmd) {
    bhpx.callMethod.apply(null, cmd);
  }
}

// Export for testing (if needed)
export { track, init, generateUUID, getHostDomain, getCookie, validatePixelId, CONFIG };

function monitorUrlChanges(onUrlChange: () => void): void {
  // Save references to the original methods
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  // Create a custom event to detect history changes
  function triggerUrlChangeEvent(): void {
    const event = new Event('bhpx:urlchange');
    window.dispatchEvent(event);
  }

  // Override history.pushState
  history.pushState = function (...args: Parameters<typeof history.pushState>): void {
    originalPushState.apply(this, args);
    triggerUrlChangeEvent(); // Trigger the custom event
  };

  // Override history.replaceState
  history.replaceState = function (...args: Parameters<typeof history.replaceState>): void {
    originalReplaceState.apply(this, args);
    triggerUrlChangeEvent(); // Trigger the custom event
  };

  // Listen for popstate event
  window.addEventListener('popstate', () => {
    triggerUrlChangeEvent(); // Trigger the custom event
  });

  // Listen for the custom bhpx:urlchange event
  window.addEventListener('bhpx:urlchange', onUrlChange);
}

function enableDebugMode(): void {
  window.bhpx.debug = true;
  const debugStyles = {
    group: 'color: #4a90e2; font-weight: bold; font-size: 12px;',
    event: 'color: #2ecc71; font-weight: bold;',
    params: 'color: #9b59b6;',
    warning: 'color: #e67e22; font-weight: bold;',
    error: 'color: #e74c3c; font-weight: bold;',
  };

  // Create debug overlay
  const debugOverlay = document.createElement('div');
  debugOverlay.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 10px;
        border-radius: 5px;
        font-family: monospace;
        font-size: 12px;
        z-index: 9999;
        max-height: 300px;
        overflow-y: auto;
        max-width: 400px;
      `;
  document.body.appendChild(debugOverlay);

  function logToOverlay(message: string): void {
    console.log('logging to overlay', message);
    const entry = document.createElement('div');
    entry.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
    entry.style.padding = '5px 0';
    entry.textContent = `${new Date().toISOString().slice(11, -1)} - ${message}`;
    debugOverlay.insertBefore(entry, debugOverlay.firstChild);

    // Keep only last 50 entries
    if (debugOverlay.children.length > 50) {
      debugOverlay.removeChild(debugOverlay.lastChild!);
    }
  }

  // Override the original track function
  const originalTrack = window.bhpx.track || track;
  window.bhpx.track = async function (eventName: string, params: TrackOptions = {}): Promise<void> {
    // Console logging
    console.group('%cBeehiiv Pixel Debug', debugStyles.group);
    console.log(`%cEvent: ${eventName.toLowerCase()}`, debugStyles.event);
    console.log('%cParameters:', debugStyles.params, params);

    // Add SPA-specific debug info
    console.log('%cRouting Info:', debugStyles.params, {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      title: document.title,
      referrer: document.referrer,
    });

    console.groupEnd();

    // Overlay logging
    logToOverlay(`${eventName} tracked - ${JSON.stringify(params)}`);

    // Performance monitoring for SPA
    const startTime = performance.now();

    // Call original track function
    await originalTrack.apply(this, [eventName, params]);

    const endTime = performance.now();
    console.log(`%cTracking Performance: ${Math.round(endTime - startTime)}ms`, debugStyles.params);
  };

  // Monitor History API calls
  const debugHistory = (type: string, args: unknown[]): void => {
    console.group('%cHistory API Debug', debugStyles.group);
    console.log(`%c${type} called:`, debugStyles.event, {
      state: args[0],
      title: args[1],
      url: args[2],
    });
    console.groupEnd();

    logToOverlay(`History ${type}: ${args[2]}`);
  };

  // Override History API methods
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args: Parameters<typeof history.pushState>): void {
    debugHistory('pushState', args);
    return originalPushState.apply(this, args);
  };

  history.replaceState = function (...args: Parameters<typeof history.replaceState>): void {
    debugHistory('replaceState', args);
    return originalReplaceState.apply(this, args);
  };

  // Export debug utilities to window for console access
  window.bhpx.debug = {
    overlay: debugOverlay,
    clearLogs: () => {
      debugOverlay.innerHTML = '';
    },
    toggleOverlay: () => {
      debugOverlay.style.display = debugOverlay.style.display === 'none' ? 'block' : 'none';
    },
    getEventHistory: () => {
      return Array.from(debugOverlay.children).map((child) => child.textContent || '');
    },
    log: logToOverlay,
  };

  console.log('%cBeehiiv Pixel Debug Mode Enabled', 'color: #4a90e2; font-size: 14px; font-weight: bold;');
  console.log('Debug utilities available via window.bhpx.debug', window.bhpx.debug);
}

function getInt(s: number | string | undefined): number | undefined {
  if (typeof s === 'number') return s;
  if (typeof s === 'string') return Number.parseInt(s, 10);
  return undefined;
}

function findCookieWithHost(name: string, host: string, domain: string): [string | undefined, string] {
  const allCookies = document.cookie.split(';');
  let cookie: string | undefined;
  const isExcludedDomain = EXCLUDED_DOMAINS.includes(domain);

  if (!isExcludedDomain) {
    cookie = findCookie(allCookies, name);
  }
  if (!cookie) {
    name = `${name}_${host}`;
    cookie = findCookie(allCookies, name);
  }
  if (!cookie && host !== 'www') {
    name = `${name}_www`;
    cookie = findCookie(allCookies, name);
  }
  return [cookie, name];
}

function getCookieValue(cookie: string): string {
  return cookie ? cookie.split('=')[1] : '';
}

function getCookie(name: string, host: string, domain: string): string {
  const [cookie] = findCookieWithHost(name, host, domain);
  if (cookie) {
    return getCookieValue(cookie);
  }
  return '';
}

function updateBHCCookie(name: string, value: string, host: string, domain: string): void {
  const isExcludedDomain = EXCLUDED_DOMAINS.includes(domain);
  if (isExcludedDomain) {
    // append host to beehiiv domains
    name = `${name}_${host}`;
  }
  updateCookie(name, value, domain);
  console.log(`bhcl_id added to cookie: ${name}`);
}

function updateCookie(name: string, value: string, domain: string): void {
  const expires = 365 * 24 * 60 * 60;
  const cookieProps = `domain=.${domain}; path=/; samesite=strict; ${isSecure ? 'secure;' : ''} max-age=${expires}`;
  document.cookie = `${name}=${value}; ${cookieProps}`;
}

function findCookie(allCookies: string[], name: string): string | undefined {
  return allCookies.find((cookie) => cookie.trim().startsWith(`${name}=`));
}

async function hashEmail(email: string): Promise<EmailHashes> {
  if (!email) {
    return { email_hash_sha256: '', email_hash_sha1: '', email_hash_md5: '' };
  }
  return await promiseAllObject({
    email_hash_sha256: generateHash(email, 'SHA-256'),
    email_hash_sha1: generateHash(email, 'SHA-1'),
    email_hash_md5: Promise.resolve(md5(email)),
  });
}

async function generateHash(input: string, algorithm: AlgorithmIdentifier): Promise<string> {
  // Convert input string to ArrayBuffer
  const msgBuffer = new TextEncoder().encode(input);
  // Generate hash
  const hashBuffer = await crypto.subtle.digest(algorithm, msgBuffer);
  // Convert to hexadecimal string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function promiseAllObject<T extends Record<string, Promise<string>>>(
  promisesObj: T
): Promise<{ [K in keyof T]: string }> {
  const keys = Object.keys(promisesObj) as (keyof T)[];
  const promises = Object.values(promisesObj);
  const results = await Promise.all(promises);
  return keys.reduce(
    (obj, key, index) => {
      obj[key] = results[index];
      return obj;
    },
    {} as { [K in keyof T]: string }
  );
}
