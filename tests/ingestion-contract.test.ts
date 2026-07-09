// Ingestion contract tests.
//
// Every test builds a payload via the real buildPayload() and POSTs it to
// the production ingestion endpoint with all-zeros UUIDs for pixel_id /
// ad_network_placement_id / subscriber_id so we don't pollute any
// advertiser's reporting. Apiary still validates the shape and rejects
// anything its Avro schema doesn't accept — which is exactly what we want
// these tests to catch.
//
// These tests exist because our TypeScript types describe pixel intent,
// not the Apiary wire contract. The v2.2.4 → 2.2.5 regression (status
// being silently coerced from boolean to string because the type said
// `string`) is the canonical example. Apiary is the source of truth; the
// tests below pin our payload shape to that truth, per failure mode we've
// seen in the wild.
//
// Run with:  pnpm test:ingestion
//
// These hit a real network — they're intentionally NOT part of the default
// test suite. Run before deploying any payload-shape change.
import { describe, expect, test } from 'bun:test';
import type { CookieJar, CookieName } from '../src/lib/cookies';
import { buildPayload } from '../src/lib/payload';
import type { TrackData } from '../src/lib/types';

const INGESTION_URL = 'https://ingestion.prod.apiarydata.net/api/v2/ingestion/pixel';
const ALL_ZEROS_UUID = '00000000-0000-0000-0000-000000000000';

class TestCookieJar implements CookieJar {
  private store = new Map<CookieName, string>();
  constructor(initial?: Partial<Record<CookieName, string>>) {
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        if (v) this.store.set(k as CookieName, v);
      }
    }
  }
  async get(name: CookieName): Promise<string> {
    return this.store.get(name) ?? '';
  }
  async set(name: CookieName, value: string): Promise<void> {
    this.store.set(name, value);
  }
}

async function buildAndSubmit(data: TrackData, eventName = 'pageview') {
  const payload = await buildPayload({
    pixelId: ALL_ZEROS_UUID,
    eventName,
    url: 'https://example.com/contract-test',
    userAgent: 'beehiiv-contract-test/1.0',
    scriptVersion: '0.0.0-contract-test',
    cookies: new TestCookieJar({
      _bhc: `${ALL_ZEROS_UUID}_${ALL_ZEROS_UUID}_${ALL_ZEROS_UUID}`,
      _bhp: '11111111-1111-1111-1111-111111111111',
    }),
    data,
  });
  const res = await fetch(INGESTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([payload]),
  });
  const body = await res.text();
  return { payload, status: res.status, body };
}

// ──────────────────────────────────────────────────────────────────────────
// The fields below are the ones we've seen Apiary reject in the wild — one
// test per failure mode, asserting both the pixel's output shape and that
// Apiary accepts it.
// ──────────────────────────────────────────────────────────────────────────

describe('Apiary ingestion contract', () => {
  test('minimal pageview — no optional fields', async () => {
    const { status, body } = await buildAndSubmit({});
    expect(status, body).toBe(201);
  });

  test('status: false (boolean) — the v2.2.4 regression', async () => {
    // Apiary's Avro schema for status is a union that does NOT include
    // string. v2.2.4 coerced this boolean to "false" and Apiary 400'd.
    // 2.2.5 passes the boolean through verbatim.
    const { payload, status, body } = await buildAndSubmit({ status: false });
    expect(payload.status).toBe(false);
    expect(status, body).toBe(201);
  });

  test('status: true (boolean)', async () => {
    const { payload, status, body } = await buildAndSubmit({ status: true });
    expect(payload.status).toBe(true);
    expect(status, body).toBe(201);
  });

  test('content_ids: scalar string — Shopify variant id shape', async () => {
    // Shopify datalayers hand us a single variant id; toStringArray()
    // should wrap it as ["43018101555409"] before send.
    const { payload, status, body } = await buildAndSubmit({
      content_ids: '43018101555409',
      content_type: 'product',
    });
    expect(payload.content_ids).toEqual(['43018101555409']);
    expect(status, body).toBe(201);
  });

  test('content_ids: array of strings — already-correct shape', async () => {
    const { payload, status, body } = await buildAndSubmit({
      content_ids: ['111', '222'],
    });
    expect(payload.content_ids).toEqual(['111', '222']);
    expect(status, body).toBe(201);
  });

  test('value_cents: float drift (e.g. 32.63 * 100)', async () => {
    // 32.63 * 100 === 3263.0000000000005 in JS. Backend's decimal validator
    // rejected the floating tail until getInt() started rounding.
    const { payload, status, body } = await buildAndSubmit({
      value_cents: 32.63 * 100,
      currency: 'usd',
    });
    expect(payload.value_cents).toBe(3263);
    expect(status, body).toBe(201);
  });

  test('value_cents: string', async () => {
    const { payload, status, body } = await buildAndSubmit({
      value_cents: '1734',
      currency: 'usd',
    });
    expect(payload.value_cents).toBe(1734);
    expect(status, body).toBe(201);
  });

  test('order_id: numeric — Shopify order id shape', async () => {
    // Shopify hands us numeric order ids; Apiary wants string.
    const { payload, status, body } = await buildAndSubmit({
      order_id: 4138434 as unknown as string,
    });
    expect(payload.order_id).toBe('4138434');
    expect(status, body).toBe(201);
  });

  test('order_id: already a string', async () => {
    const { payload, status, body } = await buildAndSubmit({
      order_id: '4138434',
    });
    expect(payload.order_id).toBe('4138434');
    expect(status, body).toBe(201);
  });

  test('email: raw value is hashed, not passed through', async () => {
    const { payload, status, body } = await buildAndSubmit({
      email: 'contract-test@example.com',
    });
    // sha256 hex is 64 chars, sha1 is 40 — and neither equals the raw input.
    expect(payload.email_hash_sha256.length).toBe(64);
    expect(payload.email_hash_sha1.length).toBe(40);
    expect(payload.email_hash_sha256).not.toBe('contract-test@example.com');
    expect(status, body).toBe(201);
  });

  test('email_hash_sha256: pre-hashed value passes through verbatim', async () => {
    // Advertisers who won't send raw PII supply the hash themselves; we must
    // NOT re-hash it (that gave clients sha256(sha256(email))).
    const preHashed = 'a'.repeat(64);
    const { payload, status, body } = await buildAndSubmit({
      email_hash_sha256: preHashed,
    });
    expect(payload.email_hash_sha256).toBe(preHashed);
    expect(status, body).toBe(201);
  });

  test('non-string email from a misconfigured datalayer does not throw', async () => {
    // GTM/datalayer can hand us a scalar that isn't a string; the string ops
    // in the routing logic must not blow up on it.
    const { payload, status, body } = await buildAndSubmit({
      email: 12345 as unknown as string,
    });
    expect(payload.email_hash_sha256).toBe('');
    expect(status, body).toBe(201);
  });

  test('hash-shaped value in the email field is routed, not re-hashed', async () => {
    // The Slack-thread scenario: advertiser puts their sha256 in `email`.
    // Hashing it would ship sha256(sha256(email)); instead we detect the hex
    // shape (no `@`) and route it verbatim to email_hash_sha256.
    const preHashed = 'c'.repeat(64);
    const { payload, status, body } = await buildAndSubmit({ email: preHashed });
    expect(payload.email_hash_sha256).toBe(preHashed);
    expect(status, body).toBe(201);
  });

  test('email_hash_sha256 wins over raw email when both are sent', async () => {
    const preHashed = 'b'.repeat(64);
    const { payload } = await buildAndSubmit({
      email: 'contract-test@example.com',
      email_hash_sha256: preHashed,
    });
    // Provided sha256 is verbatim; sha1 still falls back to hashing the email.
    expect(payload.email_hash_sha256).toBe(preHashed);
    expect(payload.email_hash_sha1.length).toBe(40);
  });

  test('purchase event with full payload', async () => {
    const { payload, status, body } = await buildAndSubmit(
      {
        order_id: '4138434',
        content_ids: '43018101555409',
        content_type: 'product',
        currency: 'usd',
        num_items: 1,
        value_cents: 1734,
        email: 'contract-test@example.com',
      },
      'purchase',
    );
    expect(payload.event).toBe('purchase');
    expect(payload.email_hash_sha256.length).toBe(64);
    expect(status, body).toBe(201);
  });
});
