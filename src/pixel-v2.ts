import { version as SCRIPT_VERSION } from '../package.json';
import { DocumentCookieJar, getHostDomain, parseClickId } from './lib/cookies';
import { dedupe } from './lib/dedupe';
import { buildPayload } from './lib/payload';
import { sendToApiary } from './lib/transport';
import type { InitOptions, PixelPayload, TrackOptions } from './lib/types';
import { generateUUID, isCrawler, validatePixelId } from './lib/utils';

declare global {
  interface Window {
    bhpx: BeehiivPixelQueue;
    bhp?: { track: typeof track };
  }
}

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

const bhpx = window.bhpx;
const queue = bhpx.queue || [];

let _pixelId = '';
let _cookies: DocumentCookieJar | null = null;
let _initPromise: Promise<void> | null = null;

const CONFIG = {
  BATCH_SIZE: 1,
  BATCH_INTERVAL: 1000,
  DISABLE_DEDUPE: false,
  DEBUG: false,
};

function debugLog(...args: unknown[]): void {
  if (CONFIG.DEBUG) {
    console.log('[bhpx]', ...args);
  }
}

const eventQueue: PixelPayload[] = [];
let batchTimeout: ReturnType<typeof setTimeout> | null = null;

// Resolved once init() completes its async cookie writes. Track gates on this
// so the GTM template's tight `init → track → track → track` loop can't fire
// events before _bhc/_bhp are written. See template.tpl line 345-355.
function isInitialized(): Promise<void> {
  if (!_initPromise) {
    throw new Error('Pixel not initialized — call bhpx("init", "PIXEL_ID") first');
  }
  return _initPromise;
}

async function init(pixelId: string, options: InitOptions = {}): Promise<void> {
  try {
    validatePixelId(pixelId);
    // Set sync state immediately so subsequent track() calls have what they
    // need even before the async cookie writes below complete.
    _pixelId = pixelId;

    const { host, domain } = getHostDomain(window.location.hostname);
    _cookies = new DocumentCookieJar(host, domain);

    debugLog(`beehiiv pixel v${SCRIPT_VERSION} initialized`);

    const config = {
      autoConfig: true,
      debug: false,
      disableDedupe: false,
      trackClientNavigation: true,
      batchSize: CONFIG.BATCH_SIZE,
      batchInterval: CONFIG.BATCH_INTERVAL,
      ...options,
    };

    Object.assign(CONFIG, {
      BATCH_SIZE: config.batchSize,
      BATCH_INTERVAL: config.batchInterval,
      DISABLE_DEDUPE: config.disableDedupe,
      DEBUG: config.debug,
    });

    if (!(await _cookies.get('_bhp'))) {
      await _cookies.set('_bhp', generateUUID());
    }

    const bhclId = parseClickId(window.location.href);
    if (bhclId) {
      const existing = await _cookies.get('_bhc');
      if (existing !== bhclId) {
        await _cookies.set('_bhc', bhclId);
        debugLog(`bhcl_id captured: ${bhclId}`);
      }
    }

    if (config.trackClientNavigation) {
      monitorUrlChanges(() => track('pageview'));
    }

    if (config.debug) {
      enableDebugMode();
    }
  } catch (error) {
    console.error('Initialization failed:', error);
    throw error;
  }
}

async function track(eventName: string, options: TrackOptions = {}): Promise<void> {
  try {
    if (isCrawler()) return;

    await isInitialized();

    const pixelId = options.pixelId || _pixelId;
    if (!pixelId) throw new Error('Pixel ID not initialized');
    if (options.pixelId) validatePixelId(options.pixelId);
    if (!eventName || typeof eventName !== 'string') {
      throw new Error('Invalid event name');
    }
    if (!_cookies) throw new Error('Cookie jar not initialized');

    const payload = await buildPayload({
      pixelId,
      eventName: eventName.toLowerCase(),
      url: window.location.href,
      userAgent: window.navigator.userAgent,
      scriptVersion: SCRIPT_VERSION,
      cookies: _cookies,
      data: options.data || {},
    });

    const debug = window.bhpx?.debug;
    if (debug && typeof debug === 'object' && 'log' in debug) {
      debug.log(`track: ${eventName} ${JSON.stringify(options.data || {})}`);
    }

    eventQueue.push(payload);

    if (!batchTimeout && eventQueue.length < CONFIG.BATCH_SIZE) {
      batchTimeout = setTimeout(processBatch, CONFIG.BATCH_INTERVAL);
    } else if (eventQueue.length >= CONFIG.BATCH_SIZE) {
      await processBatch();
    }
  } catch (error) {
    console.error('Tracking failed:', error);
  }
}

async function processBatch(): Promise<void> {
  if (eventQueue.length === 0) return;
  const drained = eventQueue.splice(0, CONFIG.BATCH_SIZE);
  const batch = CONFIG.DISABLE_DEDUPE ? drained : dedupe(drained);
  batchTimeout = null;
  if (batch.length === 0) return;
  try {
    await sendToApiary(batch);
  } catch (error) {
    console.error('Failed to process batch:', error);
    eventQueue.unshift(...batch);
  }
}

debugLog(`beehiiv pixel v${SCRIPT_VERSION} loaded`);

bhpx.callMethod = (...rest: unknown[]): void => {
  const args = Array.prototype.slice.call(rest) as unknown[];
  const method = args[0] as string;
  const params = args.slice(1);

  switch (method) {
    case 'init': {
      _initPromise = init(params[0] as string, params[1] as InitOptions);
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

// Drain any commands that the queue stub collected before this script loaded.
while (queue.length > 0) {
  const cmd = queue.shift();
  if (cmd) bhpx.callMethod.apply(null, cmd);
}

export { track, init, isInitialized, CONFIG };

function monitorUrlChanges(onUrlChange: () => void): void {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  function triggerUrlChangeEvent(): void {
    window.dispatchEvent(new Event('bhpx:urlchange'));
  }

  history.pushState = function (...args: Parameters<typeof history.pushState>): void {
    originalPushState.apply(this, args);
    triggerUrlChangeEvent();
  };

  history.replaceState = function (...args: Parameters<typeof history.replaceState>): void {
    originalReplaceState.apply(this, args);
    triggerUrlChangeEvent();
  };

  window.addEventListener('popstate', triggerUrlChangeEvent);
  window.addEventListener('bhpx:urlchange', onUrlChange);
}

function enableDebugMode(): void {
  window.bhpx.debug = true;
  const debugStyles = {
    group: 'color: #4a90e2; font-weight: bold; font-size: 12px;',
    event: 'color: #2ecc71; font-weight: bold;',
    params: 'color: #9b59b6;',
  };

  const debugOverlay = document.createElement('div');
  debugOverlay.style.cssText = `
    position: fixed; bottom: 20px; right: 20px;
    background: rgba(0,0,0,0.8); color: white;
    padding: 10px; border-radius: 5px;
    font-family: monospace; font-size: 12px;
    z-index: 9999; max-height: 300px; overflow-y: auto; max-width: 400px;
  `;
  document.body.appendChild(debugOverlay);

  function logToOverlay(message: string): void {
    const entry = document.createElement('div');
    entry.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
    entry.style.padding = '5px 0';
    entry.textContent = `${new Date().toISOString().slice(11, -1)} - ${message}`;
    debugOverlay.insertBefore(entry, debugOverlay.firstChild);
    if (debugOverlay.children.length > 50) {
      debugOverlay.removeChild(debugOverlay.lastChild!);
    }
  }

  const originalTrack = window.bhpx.track || track;
  window.bhpx.track = async function (eventName: string, params: TrackOptions = {}): Promise<void> {
    console.group('%cBeehiiv Pixel Debug', debugStyles.group);
    console.log(`%cEvent: ${eventName.toLowerCase()}`, debugStyles.event);
    console.log('%cParameters:', debugStyles.params, params);
    console.log('%cRouting Info:', debugStyles.params, {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      title: document.title,
      referrer: document.referrer,
    });
    console.groupEnd();
    logToOverlay(`${eventName} tracked - ${JSON.stringify(params)}`);
    await originalTrack.apply(this, [eventName, params]);
  };

  window.bhpx.debug = {
    overlay: debugOverlay,
    clearLogs: () => {
      debugOverlay.innerHTML = '';
    },
    toggleOverlay: () => {
      debugOverlay.style.display = debugOverlay.style.display === 'none' ? 'block' : 'none';
    },
    getEventHistory: () => Array.from(debugOverlay.children).map((c) => c.textContent || ''),
    log: logToOverlay,
  };

  console.log(
    '%cBeehiiv Pixel Debug Mode Enabled',
    'color: #4a90e2; font-size: 14px; font-weight: bold;',
  );
}
