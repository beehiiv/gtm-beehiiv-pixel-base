import type { CookieJar } from './cookies';
import { hashEmail } from './email-hash';
import type { PixelPayload, TrackData } from './types';
import {
  generateUUID,
  getInt,
  isValidUUID,
  toIdString,
  toStringArray,
  toStringField,
  warnIfChanged,
} from './utils';

export interface BuildPayloadContext {
  pixelId: string;
  eventName: string;
  url: string;
  userAgent: string;
  scriptVersion: string;
  cookies: CookieJar;
  data: TrackData;
}

// Builds the canonical pixel payload from an event context. Both pixel-v2
// (direct injection) and pixel-shopify (sandbox) funnel through this so the
// payload schema can't drift between environments.
//
// Sanitization philosophy: be lenient with what callers send (Shopify hands
// us scalars, GTM hands us strings-pretending-to-be-numbers, etc.) but ship
// Apiary exactly what it expects. Coerce silently when the meaning is
// preserved; warn-and-drop only when the data is truly garbage (objects
// where a primitive belongs, NaN, empty strings).
export async function buildPayload(ctx: BuildPayloadContext): Promise<PixelPayload> {
  const event_id = generateUUID();
  const timestamp = Date.now();

  const [bhc, bhp] = await Promise.all([ctx.cookies.get('_bhc'), ctx.cookies.get('_bhp')]);
  // _bhc is `<placement>_<subscriber>_<email_address>`. If a click URL ships
  // with unsubstituted template placeholders (e.g. `?bhcl_id={UUID}_{SUBSCRIBER}_{ID}`),
  // we end up with literal "SUBSCRIBER"/"ID" strings here. Drop anything that
  // isn't a real UUID so the backend's UUID validator doesn't reject the event.
  const [rawPlacement, rawSubscriber, rawEmail] = bhc.split('_');
  const ad_network_placement_id = isValidUUID(rawPlacement) ? rawPlacement : '';
  const subscriber_id = isValidUUID(rawSubscriber) ? rawSubscriber : '';
  const email_address_id = isValidUUID(rawEmail) ? rawEmail : undefined;

  // Advertisers who don't want to hand the pixel raw PII can pass a
  // pre-computed hash directly. When provided, we ship it verbatim into the
  // same field we'd otherwise fill — hashing here would double-hash it.
  let email_hash_sha256 = toStringField(ctx.data.email_hash_sha256) ?? '';
  let email_hash_sha1 = toStringField(ctx.data.email_hash_sha1) ?? '';

  // Fall back to the `email` field only for the algorithm(s) the caller didn't
  // already supply a hash for. Email comes from explicit data, or as a URL query
  // param fallback (advertisers sometimes pass it in the conversion URL).
  if (!email_hash_sha256 || !email_hash_sha1) {
    // Coerce first — a misconfigured datalayer can hand us a number/boolean,
    // and the string ops below (.includes/.test) would throw on a non-string.
    let email = toStringField(ctx.data.email) ?? '';
    if (!email) {
      try {
        const url = new URL(ctx.url);
        email = url.searchParams.get('email') || '';
      } catch {
        // ignore — URL parsing failure means no email fallback
      }
    }

    // A real email always contains `@` — hash it. If it has no `@`, it's almost
    // certainly already a hash: some advertisers drop their pre-hashed value
    // straight into `email`. Never hash that — sha256(sha256(email)) matches
    // nothing — so route it to the field its hex length identifies instead.
    if (email.includes('@')) {
      const computed = await hashEmail(email);
      email_hash_sha256 = email_hash_sha256 || computed.email_hash_sha256;
      email_hash_sha1 = email_hash_sha1 || computed.email_hash_sha1;
    } else if (email) {
      if (!email_hash_sha256 && /^[a-f0-9]{64}$/i.test(email)) {
        email_hash_sha256 = email;
      } else if (!email_hash_sha1 && /^[a-f0-9]{40}$/i.test(email)) {
        email_hash_sha1 = email;
      } else {
        console.warn('[bhpx] email: value has no "@" and is not a recognized hash — dropped');
      }
    }
  }

  const d = ctx.data;
  const content_category = toStringField(d.content_category);
  const content_ids = toStringArray(d.content_ids);
  const content_name = toStringField(d.content_name);
  const content_type = toStringField(d.content_type);
  const currency = toStringField(d.currency);
  const num_items = getInt(d.num_items);
  const predicted_ltv_cents = getInt(d.predicted_ltv_cents);
  const search_string = toStringField(d.search_string);
  // status is intentionally NOT coerced. Apiary's Avro schema treats this
  // field as a union that does NOT include string — coercing a boolean
  // `false` to the string `"false"` (which toStringField would do) caused
  // every page_viewed event from advertisers passing `status: false` to
  // get rejected with "status: unknown union type string". Pass it through
  // verbatim and let Apiary's schema be the source of truth.
  const status = d.status;
  const value_cents = getInt(d.value_cents);
  const order_id = toIdString(d.order_id);

  warnIfChanged('content_category', d.content_category, content_category);
  warnIfChanged('content_ids', d.content_ids, content_ids);
  warnIfChanged('content_name', d.content_name, content_name);
  warnIfChanged('content_type', d.content_type, content_type);
  warnIfChanged('currency', d.currency, currency);
  warnIfChanged('num_items', d.num_items, num_items);
  warnIfChanged('predicted_ltv_cents', d.predicted_ltv_cents, predicted_ltv_cents);
  warnIfChanged('search_string', d.search_string, search_string);
  warnIfChanged('value_cents', d.value_cents, value_cents);
  warnIfChanged('order_id', d.order_id, order_id);

  return {
    pixel_id: ctx.pixelId,
    ad_network_placement_id,
    subscriber_id,
    profile_id: bhp,
    event: ctx.eventName,
    timestamp,
    landed_timestamp: timestamp,
    sent_timestamp: timestamp,
    event_id,
    url: ctx.url,
    user_agent: ctx.userAgent,
    script_version: ctx.scriptVersion,
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
    email_hash_sha256,
    email_hash_sha1,
    order_id,
    email_address_id,
  };
}
