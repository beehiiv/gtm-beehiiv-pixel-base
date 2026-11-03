// Local dedupe vs event_id. Offline: no network, no localStorage (dedupe
// tolerates its absence, so these exercise the in-batch path).
import { describe, expect, test } from 'bun:test';
import type { CookieJar, CookieName } from '../src/lib/cookies';
import { dedupe } from '../src/lib/dedupe';
import { buildPayload } from '../src/lib/payload';
import type { TrackData } from '../src/lib/types';

const Z = '00000000-0000-0000-0000-000000000000';

const cookies: CookieJar = {
  async get(name: CookieName) {
    return name === '_bhc' ? `${Z}_${Z}_${Z}` : '11111111-1111-1111-1111-111111111111';
  },
  async set() {},
};

const build = (data: TrackData) =>
  buildPayload({
    pixelId: Z,
    eventName: 'purchase',
    url: 'https://example.com/thank-you',
    userAgent: 'test',
    scriptVersion: 'test',
    cookies,
    data,
  });

describe('dedupe and event_id', () => {
  test('generated ids are ignored: identical payloads still collapse', async () => {
    // The original purpose of local dedupe: a script error that fires the
    // same event twice. Each call gets its own random id, which must not
    // make the duplicate look unique.
    const batch = await Promise.all([build({ value_cents: 500 }), build({ value_cents: 500 })]);
    expect(batch[0].event_id).not.toBe(batch[1].event_id);
    expect(dedupe(batch)).toHaveLength(1);
  });

  test('distinct supplied ids are two conversions, even with identical data', async () => {
    // Same customer buys the same $5 item twice within the dedupe window.
    const batch = await Promise.all([
      build({ event_id: 'ORD-1', value_cents: 500 }),
      build({ event_id: 'ORD-2', value_cents: 500 }),
    ]);
    expect(dedupe(batch)).toHaveLength(2);
  });

  test('the same supplied id twice is one conversion', async () => {
    // Thank-you page reload.
    const batch = await Promise.all([
      build({ event_id: 'ORD-1', value_cents: 500 }),
      build({ event_id: 'ORD-1', value_cents: 500 }),
    ]);
    expect(dedupe(batch)).toHaveLength(1);
  });
});
