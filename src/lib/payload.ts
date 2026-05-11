import type { CookieJar } from './cookies';
import { hashEmail } from './email-hash';
import type { PixelPayload, TrackData } from './types';
import { generateUUID, getInt } from './utils';

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
export async function buildPayload(ctx: BuildPayloadContext): Promise<PixelPayload> {
  const event_id = generateUUID();
  const timestamp = Date.now();

  const [bhc, bhp] = await Promise.all([ctx.cookies.get('_bhc'), ctx.cookies.get('_bhp')]);
  const [ad_network_placement_id, subscriber_id, email_address_id] = bhc.split('_');

  // Email comes either from explicit data, or as a URL query param fallback
  // (advertisers sometimes pass email in the conversion URL).
  let email = ctx.data.email || '';
  if (!email) {
    try {
      const url = new URL(ctx.url);
      email = url.searchParams.get('email') || '';
    } catch {
      // ignore — URL parsing failure means no email fallback
    }
  }

  const { email_hash_sha256, email_hash_sha1 } = await hashEmail(email);

  return {
    pixel_id: ctx.pixelId,
    ad_network_placement_id: ad_network_placement_id || '',
    subscriber_id: subscriber_id || '',
    profile_id: bhp,
    event: ctx.eventName,
    timestamp,
    landed_timestamp: timestamp,
    sent_timestamp: timestamp,
    event_id,
    url: ctx.url,
    user_agent: ctx.userAgent,
    script_version: ctx.scriptVersion,
    content_category: ctx.data.content_category,
    content_ids: ctx.data.content_ids,
    content_name: ctx.data.content_name,
    content_type: ctx.data.content_type,
    currency: ctx.data.currency,
    num_items: ctx.data.num_items,
    predicted_ltv_cents: getInt(ctx.data.predicted_ltv_cents),
    search_string: ctx.data.search_string,
    status: ctx.data.status,
    value_cents: getInt(ctx.data.value_cents),
    email_hash_sha256,
    email_hash_sha1,
    order_id: ctx.data.order_id,
    email_address_id,
  };
}
