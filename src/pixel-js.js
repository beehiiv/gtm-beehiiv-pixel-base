/** biome-ignore-all lint/complexity/useArrowFunction: <explanation> */
if (process.env.NODE_ENV === 'test') {
  /* Since we are testing the code in a Node.js environment, we need to mock the
   * browser environment. This script will normally run as a `<script>` block
   * in an HTML file.
   *
   * I've added some helper functions to the global object to make it easier to
   * write tests. The `assert_log` function will check if a message was logged
   * during the execution of the script. The `asserts` function will run the
   * assertions at the end of the test. The `logs` array will store all the
   * messages logged during the test. The `assert_fails` variable will keep
   * track of the number of failed assertions.
   *
   * We will set TEST_CASE to one of the following values to test different
   * scenarios: 'no_bhcl_id', 'bhcl_id', 'bhcl_id_exists', 'bhcl_id_expires'.
   *
   */

  const ad_network_placement_id = 'db50796a-6fee-4896-a4a9-50c525c8aa2f';
  const subscriber_id = '78ba0199-4e29-4bd0-9081-baa57f177056';
  const bhcl_id = `${ad_network_placement_id}_${subscriber_id}`;

  const cookieStore = {};

  const cookieHandler = {
    get(target, prop) {
      if (prop === 'cookie') {
        return Object.entries(cookieStore)
          .map(([key, value]) => `${key}=${value}`)
          .join('; ');
      }
      return target[prop];
    },
    set(target, prop, value) {
      if (prop === 'cookie') {
        const [nameValuePair] = value.split(';');
        const [key, val] = nameValuePair.split('=').map((str) => str.trim());
        cookieStore[key] = val;
        return true;
      }
      target[prop] = value;
      return true;
    },
  };

  global.document = new Proxy({}, cookieHandler);
  global.history = { pushState: () => {}, replaceState: () => {} };
  global.logs = [];
  global.assert_fails = 0;
  global.assert_log = (message, { inverse } = { inverse: false }) => {
    let found = logs.find((log) => log.includes(message));
    if (inverse) found = !found;
    console.log(found ? '✅' : '🚫', `${inverse ? 'NOT ' : ''}${message}`);
    if (!found) {
      assert_fails++;
    }
  };
  let search = '';
  let href = 'https://www.beehiiv.com/';
  let hostname = 'www.beehiiv.com';
  let expires_hours = 0;

  // default to assume user already has a _bhp cookie
  let cookie = '_bhp=some-profile-id';

  global.document.cookie = cookie;

  switch (process.env.TEST_CASE) {
    case 'no_bhcl_id': {
      global.asserts = () => {
        assert_log('no bhcl_id found');
      };
      break;
    }
    case 'bhcl_id': {
      search = `?bhcl_id=${bhcl_id}`;
      global.asserts = () => {
        assert_log('bhcl_id added to cookie: _bhcl_www');
        assert_log('sending first_visited event to pixel endpoint');
      };
      break;
    }
    case 'bhcl_id_exists': {
      global.document.cookie = `_bhcl_www=${bhcl_id}`;
      global.asserts = () => {
        assert_log('bhcl_id found in cookie: _bhcl_www');
        assert_log('invalid subscriber_id', { inverse: true });

        assert_log('sending pageview event to pixel endpoint');
      };
      break;
    }
    case 'bhcl_invalid_subsciber_id': {
      global.document.cookie = `_bhcl_www=${ad_network_placement_id}_invalid`;
      global.asserts = () => {
        assert_log('bhcl_id found in cookie: _bhcl_www');
        assert_log('invalid subscriber_id');
        assert_log('sending pageview event to pixel endpoint');
      };
      break;
    }
    case 'custom_event': {
      global.document.cookie = `_bhcl_www=${bhcl_id}`;
      global.runTest = () => {
        window.bhpx('track', 'conversion');
      };
      global.asserts = () => {
        assert_log('bhcl_id found in cookie: _bhcl_www');
        assert_log('sending conversion event to pixel endpoint');
      };
      break;
    }
    case 'custom_event_different_subdomain': {
      href = 'https://app.beehiiv.com/signup?plan=launch';
      hostname = 'app.beehiiv.com';
      global.document.cookie = `_bhcl_www=${bhcl_id}`;
      global.runTest = () => {
        window.bhpx('track', 'conversion', { host: 'www' });
      };
      global.asserts = () => {
        assert_log('using custom host: www');
        assert_log('bhcl_id found in cookie: _bhcl_www');
        assert_log('sending conversion event to pixel endpoint');
      };
      break;
    }
    case 'new_cookie_handling': {
      href = 'https://lp.join1440.com/24097';
      search = `?bhcl_id=${bhcl_id}`;
      hostname = 'lp.join1440.com';
      global.asserts = () => {
        assert_log('bhcl_id added to cookie: _bhcl');
        assert_log('sending first_visited event to pixel endpoint');
      };
      break;
    }
    case 'new_cookie_handling_conversion': {
      href = 'https://www.join1440.com';
      hostname = 'www.join1440.com';
      global.document.cookie = `_bhcl=${bhcl_id}`;
      global.runTest = () => {
        window.bhpx('track', 'conversion');
      };
      global.asserts = () => {
        assert_log('bhcl_id found in cookie: _bhcl');
        assert_log('sending conversion event to pixel endpoint');
      };
      break;
    }
    case 'custom_data': {
      global.document.cookie = `_bhcl_www=${bhcl_id}`;
      global.runTest = () => {
        window.bhpx('track', 'conversion', {
          data: {
            content_category: 'purchase',
            content_ids: ['abc', 'xyz'],
            num_items: 2,
            currency: 'USD',
            value_cents: '100',
          },
        });
      };
      global.asserts = () => {
        assert_log('bhcl_id found in cookie: _bhcl_www');
        assert_log('sending conversion event to pixel endpoint');
        assert_log('"content_category":"purchase"');
        assert_log('"value_cents":100');
        assert_log('"value_cents":101', { inverse: true });
        assert_log('"status":"anything"', { inverse: true });
      };
      break;
    }
    default:
      throw new Error(`Unknown test case: ${process.env.TEST_CASE}`);
  }

  import.meta.env = {
    VITE_PIXEL_APIARY_ENDPOINT: 'https://apiary.dev',
    VITE_PIXEL_EXPIRES_HOURS: expires_hours,
  };
  global.window = {
    location: {
      search,
      href,
      hostname,
    },
    navigator: {
      userAgent: 'node-test',
    },
    crypto: {
      getRandomValues: (function () {
        return function () {
          return [12, 43, 87, 65, 22, 94, 10, 77, 35, 56, 90, 28, 74, 31, 99, 48];
        };
      })(),
    },
    addEventListener: (event, listener) => {},
  };
  global.fetch = (function () {
    return function () {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
      });
    };
  })();
}

(function () {
  if (isCrawler()) {
    // don't run the pixel for known crawlers
    return;
  }

  let log = () => {};
  const APIARY_ENDPOINT = import.meta.env.VITE_PIXEL_APIARY_ENDPOINT;
  const EXCLUDED_DOMAINS = ['beehiiv.com', 'staginghiiv.com', 'localhiiv.com'];

  let isSecure = true;
  if (APIARY_ENDPOINT.includes('dev')) {
    log = console.log;
    isSecure = false;
    if (process.env.NODE_ENV === 'test') {
      log = (...message) => {
        logs.push(message.map((m) => JSON.stringify(m)).join(' '));
        console.log(...message);
      };
    }
  }

  try {
    log('pixel-js');
    let [ad_network_placement_id, subscriber_id, event, bhp] = get_bhcl_id();
    sendInitialEvent(event, ad_network_placement_id, subscriber_id, bhp);
  } catch (error) {
    console.error(error);
  }

  function sendInitialEvent(event, ad_network_placement_id, subscriber_id, bhp) {
    if (!ad_network_placement_id) return;
    sendEvent(event, ad_network_placement_id, subscriber_id, bhp);
    monitorUrlChanges(() => {
      sendEvent('pageview', ad_network_placement_id, subscriber_id, bhp);
    });
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

  function get_bhcl_id(options) {
    options = options || {};
    let { host, domain } = getHostDomain();

    let event = 'pageview';

    const urlParams = new URLSearchParams(window.location.search);
    let bhcl_id = urlParams.get('bhcl_id');
    // allow to override which host cookie to read
    // this is useful for cross-subdomain tracking
    if (options.host) {
      log(`using custom host: ${options.host}`);
      host = options.host;
    }

    const allCookies = document.cookie.split(';');
    const [bhcl, cookieName] = findCookieWithHost(allCookies, '_bhcl', host, domain);

    // generate a unique profile (bhp) cookie if it doesn't exist
    let bhp = getCookieValue(findCookie(allCookies, '_bhp'));
    if (!bhp) {
      bhp = generateUUID();
      updateCookie('_bhp', bhp, domain);
    }

    let cookie_bhcl_id = bhcl ? getCookieValue(bhcl) : '';
    if (bhcl_id && bhcl_id !== cookie_bhcl_id) {
      // if bhcl_id is in query string and not the same as cookie, set event to first_visited
      event = 'first_visited';
    } else if (cookie_bhcl_id) {
      bhcl_id = cookie_bhcl_id;
      log(`bhcl_id found in cookie: ${cookieName}`, bhcl_id);
    }
    if (bhcl_id) {
      updateBhclCookie(cookieName, bhcl_id, domain);
    }
    if (!bhcl_id) {
      log('no bhcl_id found');
      return [];
    }

    let [ad_network_placement_id, subscriber_id] = bhcl_id.split('_');
    // verify subscriber_id is a UUID
    if (subscriber_id && subscriber_id.match(/[^0-9a-f-]/)) {
      log(`invalid subscriber_id ${subscriber_id}`);

      subscriber_id = '';
    }

    return [ad_network_placement_id, subscriber_id, event, bhp];
  }

  function getHostDomain() {
    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return [];
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

  function updateBhclCookie(name, value, domain) {
    const isExcludedDomain = EXCLUDED_DOMAINS.includes(domain);
    if (!isExcludedDomain) {
      // expire old cookie
      if (name !== '_bhcl') {
        removeCookie(name, domain);
      }
      name = '_bhcl'; // override bhcl cookie name for non-beehiiv domains
    }
    updateCookie(name, value, domain);
    log(`bhcl_id added to cookie: ${name}`);
  }

  function updateCookie(name, value, domain) {
    const expires = 365 * 24 * 60 * 60;
    const cookieProps = `domain=.${domain}; path=/; samesite=strict; ${isSecure ? 'secure;' : ''} max-age=${expires}`;
    document.cookie = `${name}=${value}; ${cookieProps}`;
  }

  function removeCookie(name, domain) {
    const expires = 0;
    const value = '';
    const cookieProps = `domain=.${domain}; path=/; samesite=strict; ${isSecure ? 'secure;' : ''} max-age=${expires}`;
    document.cookie = `${name}=${value}; ${cookieProps}`;
  }

  function findCookie(allCookies, name) {
    return allCookies.find((cookie) => cookie.trim().startsWith(`${name}=`));
  }

  // find cookie for host or www
  // we are no longer appending the host to the _bhcl cookie name
  // so we need to check for no host, followed by current subdomain,
  // then finally www if no host
  // exclude beehiiv.com, staginghiiv.com, and localhiiv.com from
  // this logic since each subdomain is a different publication
  // so the cookies shoudln't be shared
  function findCookieWithHost(allCookies, name, host, domain) {
    let cookie;
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

  function getCookieValue(cookie) {
    return cookie ? cookie.split('=')[1] : '';
  }

  function sendEvent(event, ad_network_placement_id, subscriber_id, bhp, data) {
    if (!event || !ad_network_placement_id) return;

    const event_id = generateUUID();
    const timestamp = new Date().getTime();

    // pull values from data object
    // content_category [string]
    // content_ids [array of strings]
    // content_name [string]
    // content_type [string]
    // currency [string]
    // num_items [integer]
    // predicted_ltv_cents [integer]
    // search_string [string]
    // status [boolean]
    // value_cents [int]

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
    } = data || {};

    const payload = {
      ad_network_placement_id,
      subscriber_id: subscriber_id ?? '',
      profile_id: bhp ?? '', // anonymous profile id
      event,
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
    };
    log(`sending ${event} event to pixel endpoint`, JSON.parse(JSON.stringify(payload)));
    fetch(APIARY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([payload]), // payload as array
    })
      .then((response) => {
        log('response', response.ok, response.status, response.statusText);
      })
      .catch((error) => {
        console.error(error);
      });
  }

  function isCrawler() {
    const ua = navigator.userAgent.toLowerCase();
    const crawlerRegex =
      /(bot|crawl|spider|slurp|archiver|indexer|facebookexternalhit|twitterbot|bingpreview|applebot|siteaudit|semrush|ahrefs|mj12bot|seznambot|screaming frog|dotbot)/i;
    return crawlerRegex.test(ua);
  }

  function generateUUID() {
    // Generate 16 random bytes
    const arr = new Uint8Array(16);
    window.crypto.getRandomValues(arr);

    // Adjust specific bits to conform to the UUID v4 format
    arr[6] = (arr[6] & 0x0f) | 0x40; // Version 4
    arr[8] = (arr[8] & 0x3f) | 0x80; // Variant 10xx

    // Convert to hex string and insert hyphens
    return [...arr]
      .map((b, i) => {
        const hex = b.toString(16).padStart(2, '0');
        return i === 4 || i === 6 || i === 8 || i === 10 ? `-${hex}` : hex;
      })
      .join('');
  }

  function getInt(s) {
    if (typeof s === 'number') return s;
    if (typeof s === 'string') return parseInt(s, 10);
    return undefined;
  }

  window.bhpx = function (command, event, options) {
    // we don't care about the _event from `get_bhcl_id()`
    const [ad_network_placement_id, subscriber_id, _event, bhp] = get_bhcl_id(options);
    const { data } = options || {};
    switch (command) {
      case 'track':
        const valid_events = [
          'conversion',
          'lead',
          'complete_registration',
          'purchase',
          'initiate_checkout',
          'start_trial',
          'subscribe',
        ];
        if (!valid_events.includes(event)) {
          console.error('bhpx: invalid event', event);
          return;
        }
        sendEvent(event, ad_network_placement_id, subscriber_id, bhp, data);
        break;
      default:
        console.error('bhpx: unknown command', command);
    }
  };
})();

if (process.env.NODE_ENV === 'test') {
  console.log('-------------------------------');
  console.log('Verifying test case:', process.env.TEST_CASE);
  if (global.runTest) {
    global.runTest();
  }
  asserts(logs);
  console.log('-------------------------------');
  console.log(assert_fails === 0 ? '🎉 success!' : '💣 fail!');
  process.exit(assert_fails);
}
