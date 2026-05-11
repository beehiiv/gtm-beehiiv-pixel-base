import type { PixelPayload } from './types';

const STORAGE_KEY = 'bhpx_processed_events';
const DEDUPE_TIME_PERIOD_SECONDS = 15 * 60;

interface ProcessedEvents {
  [hash: string]: number;
}

// Sync 32-bit djb2 hash — collision rate is negligible for the small number
// of events any single user fires within a 15-minute window. Replaces the
// previous MD5-based dedupe so we can drop the js-md5 dependency entirely.
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

// Filters a batch to remove events that match a previously-seen event (within
// the 15-min window) or that duplicate another event in the current batch.
// Stable: preserves the order of non-duplicate events.
export function dedupe(events: PixelPayload[]): PixelPayload[] {
  const currentTime = Math.floor(Date.now() / 1000);

  let processedEvents: ProcessedEvents = {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) processedEvents = JSON.parse(stored) as ProcessedEvents;
  } catch (error) {
    console.warn('Failed to load processed events from localStorage:', error);
  }

  const seen = new Set<string>();
  const filtered = events.filter((event) => {
    const eventHash = hashEventForDedupe(event);

    if (seen.has(eventHash)) return false;

    if (processedEvents[eventHash]) {
      const age = currentTime - processedEvents[eventHash];
      if (age < DEDUPE_TIME_PERIOD_SECONDS) return false;
    }

    seen.add(eventHash);
    return true;
  });

  const updated: ProcessedEvents = { ...processedEvents };
  filtered.forEach((event) => {
    updated[hashEventForDedupe(event)] = currentTime;
  });

  // Garbage-collect expired entries so localStorage doesn't grow unbounded.
  Object.keys(updated).forEach((hash) => {
    if (updated[hash] < currentTime - DEDUPE_TIME_PERIOD_SECONDS) {
      delete updated[hash];
    }
  });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('Failed to save processed events to localStorage:', error);
  }

  return filtered;
}

// Excludes timestamps and event_id from the hash so a "same event, different
// instant" still dedupes. Without this, every pageview would be unique.
function hashEventForDedupe(event: PixelPayload): string {
  const { timestamp, landed_timestamp, sent_timestamp, event_id, ...rest } = event;
  void timestamp;
  void landed_timestamp;
  void sent_timestamp;
  void event_id;
  return hashString(JSON.stringify(rest));
}
