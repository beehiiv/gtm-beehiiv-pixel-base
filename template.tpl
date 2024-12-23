___TERMS_OF_SERVICE___

By creating or modifying this file you agree to Google Tag Manager's Community
Template Gallery Developer Terms of Service available at
https://developers.google.com/tag-manager/gallery-tos (or such other URL as
Google may provide), as modified from time to time.


___INFO___

{
  "type": "TAG",
  "id": "cvt_temp_public_id",
  "version": 1,
  "securityGroups": [],
  "displayName": "beehiiv Base Pixel",
  "categories: [
    "ANALYTICS",
    "ADVERTISING",
    "CONVERSIONS",
    "REMARKETING",
    "EMAIL_MARKETING",
    "ATTRIBUTION"
    ]
  "brand": {
    "id": "github.com_beehiiv_gtm_beehiiv_pixel_base",
    "displayName": "beehiiv",
    "thumbnail":"https://pbs.twimg.com/profile_images/1703611336431661056/B3_gromQ_400x400.jpg"
  },
  "description": "beehiiv Pixel for tracking conversions with the beehiiv Ad Network.",
  "containerContexts": [
    "WEB"
  ]
}


___TEMPLATE_PARAMETERS___

[]


___SANDBOXED_JS_FOR_WEB_TEMPLATE___

const log = require('logToConsole');
const sendPixel = require('sendPixel');
const encodeUriComponent = require('encodeUriComponent');
const decodeUriComponent = require('decodeUriComponent');
const getCookieValues = require('getCookieValues');
const setCookie = require('setCookie');
const generateRandom = require('generateRandom');
const getTimestampMillis = require('getTimestampMillis');
const getUrl = require('getUrl');
const getReferrerUrl = require('getReferrerUrl');
const getType = require('getType');
const parseUrl = require('parseUrl');
const JSON = require('JSON');
const Math = require('Math');

// Helper functions
const makeString = function(value) {
  if (value == undefined) {
    return undefined;
  }
  return getType(value) === 'string' ? value : value.toString();
};

const makeInteger = function(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const result = require('makeInteger')(value);
  return result !== undefined ? result : undefined;
};

const parseUrlParams = function(url) {
  var params = {};
  var searchIndex = url.indexOf('?');
  if (searchIndex !== -1) {
    var searchParams = url.slice(searchIndex + 1).split('&');
    for (var i = 0; i < searchParams.length; i++) {
      var pair = searchParams[i].split('=');
      params[decodeUriComponent(pair[0])] = decodeUriComponent(pair[1] || '');
    }
  }
  return params;
};

const get_bhcl_id = function() {
  const urlObject = parseUrl(getUrl());
  if (!urlObject || !urlObject.hostname) {
    log('Invalid URL or missing hostname');
    return [];
  }
  
  const hostname = urlObject.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return [];
  
  let host = "";
  let domain = "";
  const parts = hostname.split(".");
  if (parts.length < 3) {
    domain = parts[parts.length - 2] + '.' + parts[parts.length - 1];
  } else {
    host = parts[0];
    domain = parts[parts.length - 2] + '.' + parts[parts.length - 1];
  }
  
  let event = "pageview";
  const urlParams = parseUrlParams(getUrl());
  let bhcl_id = urlParams.bhcl_id;
  
  if (bhcl_id) {
    updateCookie(bhcl_id, host, domain);
    event = "first_visited";
  }
  
  const cookieName = '_bhcl_' + (host || 'www');
  bhcl_id = getCookieValues(cookieName)[0];
  
  if (!bhcl_id) {
    log('no bhcl_id found');
    return [];
  }
  
  log('bhcl_id found in cookie: ' + cookieName, bhcl_id);
  const bhcl_parts = bhcl_id.split('_');
  return [bhcl_parts[0], bhcl_parts[1], event];
};

const updateCookie = function(bhcl_id, host, domain) {
  const expires = 365 * 24 * 60 * 60;
  if (bhcl_id) {
    const cookieName = '_bhcl_' + (host || 'www');
    setCookie(cookieName, bhcl_id, {
      domain: '.' + domain,
      path: '/',
      'max-age': expires,
      secure: true,
      httpOnly: false,
      sameSite: 'strict'
    });
    log('bhcl_id added to cookie: ' + cookieName);
  }
};

const generateUUID = function() {
  let uuid = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4';
    } else if (i === 19) {
      uuid += (generateRandom(0, 3) + 8).toString(16);
    } else {
      uuid += generateRandom(0, 15).toString(16);
    }
  }
  return uuid;
};

const sendEvent = function(event, ad_network_placement_id, subscriber_id, eventData) {
  if (!event || !ad_network_placement_id || !subscriber_id) return;
  
  const event_id = generateUUID();
  const timestamp = getTimestampMillis();
  
  const payload = {
    ad_network_placement_id: makeString(ad_network_placement_id),
    subscriber_id: makeString(subscriber_id),
    event: makeString(event),
    timestamp: timestamp,
    landed_timestamp: timestamp,
    sent_timestamp: timestamp,
    event_id: event_id,
    url: makeString(getUrl()),
    referrer: makeString(getReferrerUrl()),
    content_category: makeString(eventData.content_category),
    content_ids: makeString(eventData.content_ids),
    content_name: makeString(eventData.content_name),
    content_type: makeString(eventData.content_type),
    currency: makeString(eventData.currency),
    num_items: makeInteger(eventData.num_items),
    predicted_ltv_cents: makeInteger(eventData.predicted_ltv_cents),
    search_string: makeString(eventData.search_string),
    status: makeString(eventData.status),
    value_cents: makeInteger(eventData.value_cents)
  };
  
  log('sending ' + event + ' event to pixel endpoint', payload);
  
  sendPixel('https://ingestion.apiary.beehiiv.net/api/v1/ingestion/pixel?data=' + encodeUriComponent(JSON.stringify([payload])), function() {
    log('Pixel sent successfully');
    data.gtmOnSuccess();
  }, function() {
    log('Failed to send pixel');
    data.gtmOnFailure();
  });
};

const validEvents = ['conversion','lead','complete_registration','purchase','initiate_checkout','start_trial','subscribe'];

const bhpx = function(command, event, options) {
  if (!command) {
    log('bhpx: missing command');
    data.gtmOnFailure();
    return;
  }

  const bhcl_result = get_bhcl_id();
  if (!bhcl_result || bhcl_result.length < 2) {
    log('bhpx: failed to get bhcl_id');
    data.gtmOnFailure();
    return;
  }

  const ad_network_placement_id = bhcl_result[0];
  const subscriber_id = bhcl_result[1];

  if (!ad_network_placement_id || !subscriber_id) {
    log('bhpx: missing required ids');
    data.gtmOnFailure();
    return;
  }

  if (command !== 'track') {
    log('bhpx: unknown command', command);
    data.gtmOnFailure();
    return;
  }

  if (validEvents.indexOf(event) === -1) {
    log('bhpx: invalid event', event);
    data.gtmOnFailure();
    return;
  }

  if (!options || !options.data) {
    log('bhpx: missing event data');
    data.gtmOnFailure();
    return;
  }

  sendEvent(event, ad_network_placement_id, subscriber_id, options.data);
};

// Main execution
log('pixel-js');
const bhcl_result = get_bhcl_id();
if (!bhcl_result || bhcl_result.length < 3) {
  log('Failed to get bhcl_id');
  data.gtmOnFailure();
  return;
}

const ad_network_placement_id = bhcl_result[0];
const subscriber_id = bhcl_result[1];
const event = bhcl_result[2];

if (!ad_network_placement_id || !subscriber_id || !event) {
  log('Missing required parameters');
  data.gtmOnFailure();
  return;
}

sendEvent(event, ad_network_placement_id, subscriber_id, data);


___WEB_PERMISSIONS___

[
  {
    "instance": {
      "key": {
        "publicId": "logging",
        "versionId": "1"
      },
      "param": [
        {
          "key": "environments",
          "value": {
            "type": 1,
            "string": "debug"
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  },
  {
    "instance": {
      "key": {
        "publicId": "get_cookies",
        "versionId": "1"
      },
      "param": [
        {
          "key": "cookieAccess",
          "value": {
            "type": 1,
            "string": "specific"
          }
        },
        {
          "key": "cookieNames",
          "value": {
            "type": 2,
            "listItem": [
              {
                "type": 1,
                "string": "bhcl_id"
              },
              {
                "type": 1,
                "string": "_bhcl_tagmanager"
              }
            ]
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  },
  {
    "instance": {
      "key": {
        "publicId": "get_referrer",
        "versionId": "1"
      },
      "param": [
        {
          "key": "urlParts",
          "value": {
            "type": 1,
            "string": "any"
          }
        },
        {
          "key": "queriesAllowed",
          "value": {
            "type": 1,
            "string": "any"
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  },
  {
    "instance": {
      "key": {
        "publicId": "send_pixel",
        "versionId": "1"
      },
      "param": [
        {
          "key": "allowedUrls",
          "value": {
            "type": 1,
            "string": "specific"
          }
        },
        {
          "key": "urls",
          "value": {
            "type": 2,
            "listItem": [
              {
                "type": 1,
                "string": "https://ingestion.apiary.beehiiv.net/api/v1/ingestion/pixel"
              }
            ]
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  },
  {
    "instance": {
      "key": {
        "publicId": "set_cookies",
        "versionId": "1"
      },
      "param": [
        {
          "key": "allowedCookies",
          "value": {
            "type": 2,
            "listItem": [
              {
                "type": 3,
                "mapKey": [
                  {
                    "type": 1,
                    "string": "name"
                  },
                  {
                    "type": 1,
                    "string": "domain"
                  },
                  {
                    "type": 1,
                    "string": "path"
                  },
                  {
                    "type": 1,
                    "string": "secure"
                  },
                  {
                    "type": 1,
                    "string": "session"
                  }
                ],
                "mapValue": [
                  {
                    "type": 1,
                    "string": "bhcl_id"
                  },
                  {
                    "type": 1,
                    "string": "*"
                  },
                  {
                    "type": 1,
                    "string": "*"
                  },
                  {
                    "type": 1,
                    "string": "any"
                  },
                  {
                    "type": 1,
                    "string": "any"
                  }
                ]
              }
            ]
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  },
  {
    "instance": {
      "key": {
        "publicId": "get_url",
        "versionId": "1"
      },
      "param": [
        {
          "key": "urlParts",
          "value": {
            "type": 1,
            "string": "any"
          }
        },
        {
          "key": "queriesAllowed",
          "value": {
            "type": 1,
            "string": "any"
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  }
]


___TESTS___

scenarios: []


___NOTES___

Created on 12/23/2024, 2:08:23 PM


