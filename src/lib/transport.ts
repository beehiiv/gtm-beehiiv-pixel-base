import type { PixelPayload } from './types';

const APIARY_ENDPOINT = import.meta.env.VITE_PIXEL_V2_APIARY_ENDPOINT as string;

export interface TransportConfig {
  retryAttempts: number;
  retryDelay: number;
}

const DEFAULT_CONFIG: TransportConfig = {
  retryAttempts: 3,
  retryDelay: 1000,
};

// Sends a batch of payloads to apiary. Tries sendBeacon first (best-effort,
// fire-and-forget, survives page unload), falls back to fetch with retry if
// sendBeacon is unavailable or rejects the payload (typically over 64KB).
export async function sendToApiary(
  payloads: PixelPayload[],
  config: Partial<TransportConfig> = {},
): Promise<void> {
  if (payloads.length === 0) return;
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const body = JSON.stringify(payloads);

  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const sent = navigator.sendBeacon(APIARY_ENDPOINT, body);
    if (sent) return;
    // sendBeacon returns false when the user agent refuses to queue the
    // transfer (e.g. payload too large). Fall through to fetch retry.
  }

  await sendWithRetry(body, cfg, 0);
}

async function sendWithRetry(body: string, cfg: TransportConfig, attempt: number): Promise<void> {
  try {
    const response = await fetch(APIARY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
    if (!response.ok && response.status >= 500 && attempt < cfg.retryAttempts) {
      throw new Error(`apiary returned ${response.status}`);
    }
  } catch (err) {
    if (attempt < cfg.retryAttempts) {
      await new Promise((resolve) => setTimeout(resolve, cfg.retryDelay * (attempt + 1)));
      return sendWithRetry(body, cfg, attempt + 1);
    }
    throw err;
  }
}
