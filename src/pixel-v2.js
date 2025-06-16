import md5 from 'js-md5';

// Get the queue that was created by the base script
const bhpx = window.bhpx;
const queue = bhpx.queue || [];

let _pixelId = ''; // pixelId will be set during initialization
const isSecure = true;

// Configuration
const APIARY_ENDPOINT = import.meta.env.VITE_PIXEL_V2_APIARY_ENDPOINT;
//"https://dev.ingestion.apiary.beehiiv.net/api/v2/ingestion/pixel";
const EXCLUDED_DOMAINS = ['beehiiv.com', 'staginghiiv.com', 'localhiiv.com'];
const CONFIG = {
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  REQUEST_TIMEOUT: 5000,
  RATE_LIMIT_INTERVAL: 100,
  BATCH_SIZE: 10,
  BATCH_INTERVAL: 1000,
};

// Rate limiter implementation
const rateLimiter = {
  lastEvent: 0,
  minInterval: CONFIG.RATE_LIMIT_INTERVAL,
  canTrack() {
    const now = Date.now();
    if (now - this.lastEvent >= this.minInterval) {
      this.lastEvent = now;
      return true;
    }
    return false;
  },
};

// Event batching
const eventQueue = [];
let batchTimeout = null;

// Utility Functions
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getHostDomain() {
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

async function sendToServer(payload, retryAttempt = 0) {
  if (!rateLimiter.canTrack()) {
    console.warn('Rate limit exceeded, skipping event');
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

  try {
    navigator.sendBeacon(APIARY_ENDPOINT, JSON.stringify(payload));
  } catch (error) {
    if (error.name === 'AbortError') {
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

function validatePixelId(pixelId) {
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
async function track(eventName, options = {}) {
  try {
    if (!_pixelId) {
      throw new Error('Pixel ID not initialized');
    }
    if (!eventName || typeof eventName !== 'string') {
      throw new Error('Invalid event name');
    }

    // Normalize event name to lowercase
    // biome-ignore lint/style/noParameterAssign:
    eventName = eventName.toLowerCase();
    const event_id = generateUUID();
    const timestamp = new Date().getTime();
    const { host, domain } = getHostDomain();
    const bhc = getCookie('_bhc', host, domain) || '';
    const bhp = getCookie('_bhp', host, domain) || '';
    const [ad_network_placement_id, subscriber_id] = bhc.split('_');

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
    } = data || {};

    let email = data.email || '';
    const url = new URL(window.top.location.href);
    if (!email && url.searchParams.has('email')) {
      email = url.searchParams.get('email');
    }

    window.bhpx?.debug?.log(`track: ${eventName} ${JSON.stringify(data)}`);

    const { email_hash_sha256, email_hash_sha1, email_hash_md5 } = await hashEmail(email);

    const payload = {
      pixel_id: _pixelId,
      ad_network_placement_id,
      subscriber_id,
      profile_id: bhp, // anonymous profile id
      event: eventName,
      timestamp,
      landed_timestamp: timestamp,
      sent_timestamp: timestamp,
      event_id,
      url: window.location.href,
      user_agent: window.navigator.userAgent,
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
      console.error('Debug details:', { eventName, customData });
    }
  }
}

async function processBatch() {
  if (eventQueue.length === 0) return;

  const batch = dedupe(eventQueue.splice(0, CONFIG.BATCH_SIZE));
  batchTimeout = null;

  try {
    sendToServer(batch);
  } catch (error) {
    console.error('Failed to process batch:', error);
    // Optionally, re-queue failed events
    eventQueue.unshift(...batch);
  }
}

function dedupe(events) {
  const seen = new Set();
  return events.filter((event) => {
    const { timestamp, landed_timestamp, sent_timestamp, event_id, ...rest } = event;
    const key = JSON.stringify(rest);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Enhanced click handling with validation
function handleClickIdentification() {
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
function init(pixelId, options = {}) {
  try {
    validatePixelId(pixelId);
    _pixelId = pixelId;

    const { domain } = getHostDomain();

    // Set user identification cookie if not exists
    if (!getCookie('_bhp')) {
      updateCookie('_bhp', generateUUID(), domain);
    }

    // Handle ad click identification
    handleClickIdentification();

    const defaultConfig = {
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
bhpx.callMethod = (...rest) => {
  const args = Array.prototype.slice.call(rest);
  const method = args[0];
  const params = args.slice(1);

  switch (method) {
    case 'init': {
      init.apply(null, params);
      break;
    }
    case 'track': {
      const trackFn = window.bhp?.track || track;
      trackFn.apply(null, params);
      break;
    }
    default: {
      console.error(`Unknown method: ${method}`);
    }
  }
};

// Process queued commands
while (queue.length > 0) {
  bhpx.callMethod.apply(null, queue.shift());
}

// Export for testing (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    track,
    init,
    generateUUID,
    getHostDomain,
    getCookie,
    validatePixelId,
    CONFIG,
  };
}

function monitorUrlChanges(onUrlChange) {
  // Save references to the original methods
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  // Create a custom event to detect history changes
  function triggerUrlChangeEvent() {
    const event = new Event('bhpx:urlchange');
    window.dispatchEvent(event);
  }

  // Override history.pushState
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    triggerUrlChangeEvent(); // Trigger the custom event
  };

  // Override history.replaceState
  history.replaceState = function (...args) {
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

function enableDebugMode() {
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

  function logToOverlay(message) {
    console.log('logging to overlay', message);
    const entry = document.createElement('div');
    entry.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
    entry.style.padding = '5px 0';
    entry.textContent = `${new Date().toISOString().slice(11, -1)} - ${message}`;
    debugOverlay.insertBefore(entry, debugOverlay.firstChild);

    // Keep only last 50 entries
    if (debugOverlay.children.length > 50) {
      debugOverlay.removeChild(debugOverlay.lastChild);
    }
  }

  // Override the original track function
  const originalTrack = window.bhpx.track || track;
  window.bhpx.track = function (eventName, params = {}) {
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
    const result = originalTrack.apply(this, [eventName, params]);

    const endTime = performance.now();
    console.log(`%cTracking Performance: ${Math.round(endTime - startTime)}ms`, debugStyles.params);

    return result;
  };

  // Monitor History API calls
  const debugHistory = (type, args) => {
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

  history.pushState = function (...args) {
    debugHistory('pushState', args);
    return originalPushState.apply(this, args);
  };

  history.replaceState = function (...args) {
    debugHistory('replaceState', args);
    return originalReplaceState.apply(this, args);
  };

  // Add React Router debug info if present
  if (window.ReactRouter) {
    const originalUseEffect = window.React.useEffect;
    window.React.useEffect = function () {
      if (args[0].toString().includes('history.listen')) {
        console.log('%cReact Router navigation detected', debugStyles.event);
        logToOverlay('React Router navigation');
      }
      return originalUseEffect.apply(this, args);
    };
  }

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
      return Array.from(debugOverlay.children).map((child) => child.textContent);
    },
    log: logToOverlay,
  };

  console.log('%cBeehiiv Pixel Debug Mode Enabled', 'color: #4a90e2; font-size: 14px; font-weight: bold;');
  console.log('Debug utilities available via window.bhpx.debug', window.bhpx.debug);
}

function getInt(s) {
  if (typeof s === 'number') return s;
  if (typeof s === 'string') return Number.parseInt(s, 10);
  return undefined;
}

function findCookieWithHost(name, host, domain) {
  const allCookies = document.cookie.split(';');
  let cookie;
  const isExcludedDomain = EXCLUDED_DOMAINS.includes(domain);

  if (!isExcludedDomain) {
    cookie = findCookie(allCookies, name);
  }
  if (!cookie) {
    // biome-ignore lint/style/noParameterAssign:
    name = `${name}_${host}`;
    cookie = findCookie(allCookies, name);
  }
  if (!cookie && host !== 'www') {
    // biome-ignore lint/style/noParameterAssign:
    name = `${name}_www`;
    cookie = findCookie(allCookies, name);
  }
  return [cookie, name];
}

function getCookieValue(cookie) {
  return cookie ? cookie.split('=')[1] : '';
}

function getCookie(name, host, domain) {
  const [cookie] = findCookieWithHost(name, host, domain);
  if (cookie) {
    return getCookieValue(cookie);
  }
  return '';
}

function updateBHCCookie(name, value, host, domain) {
  const isExcludedDomain = EXCLUDED_DOMAINS.includes(domain);
  if (isExcludedDomain) {
    // append host to beehiiv domains
    // biome-ignore lint/style/noParameterAssign:
    name = `${name}_${host}`;
  }
  updateCookie(name, value, domain);
  console.log(`bhcl_id added to cookie: ${name}`);
}

function updateCookie(name, value, domain) {
  const expires = 365 * 24 * 60 * 60;
  const cookieProps = `domain=.${domain}; path=/; samesite=strict; ${isSecure ? 'secure;' : ''} max-age=${expires}`;
  document.cookie = `${name}=${value}; ${cookieProps}`;
}

function findCookie(allCookies, name) {
  return allCookies.find((cookie) => cookie.trim().startsWith(`${name}=`));
}

async function hashEmail(email) {
  if (!email) {
    return { email_hash_sha256: '', email_hash_sha1: '', email_hash_md5: '' };
  }
  return await promiseAllObject({
    email_hash_sha256: generateHash(email, 'SHA-256'),
    email_hash_sha1: generateHash(email, 'SHA-1'),
    email_hash_md5: md5(email),
  });
}

async function generateHash(input, algorithm) {
  // Convert input string to ArrayBuffer
  const msgBuffer = new TextEncoder().encode(input);
  // Generate hash
  const hashBuffer = await crypto.subtle.digest(algorithm, msgBuffer);
  // Convert to hexadecimal string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = Object.values(promisesObj);
  const results = await Promise.all(promises);
  return keys.reduce((obj, key, index) => {
    obj[key] = results[index];
    return obj;
  }, {});
}
