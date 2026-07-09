// Single source of truth for the pixel payload contract.
// Changing a field here forces both pixel-v2 and pixel-shopify to update.

export interface TrackData {
  content_category?: string;
  content_ids?: string | number | (string | number)[];
  content_name?: string;
  content_type?: string;
  currency?: string;
  num_items?: number;
  predicted_ltv_cents?: number | string;
  search_string?: string;
  status?: boolean | string;
  value_cents?: number | string;
  order_id?: string | number;
  email?: string;
  // Pre-hashed email, supplied by advertisers who don't want to send raw PII
  // to the pixel. When present, shipped verbatim instead of hashing `email`.
  email_hash_sha256?: string;
  email_hash_sha1?: string;
}

export interface TrackOptions {
  pixelId?: string;
  data?: TrackData;
}

export interface EmailHashes {
  email_hash_sha256: string;
  email_hash_sha1: string;
}

export interface HostDomain {
  host: string;
  domain: string;
}

export interface PixelPayload {
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
  status?: boolean | string;
  value_cents?: number;
  email_hash_sha256: string;
  email_hash_sha1: string;
  order_id?: string;
  email_address_id?: string;
}

export interface InitOptions {
  autoConfig?: boolean;
  debug?: boolean;
  disableDedupe?: boolean;
  trackClientNavigation?: boolean;
  batchSize?: number;
  batchInterval?: number;
  retryAttempts?: number;
}
