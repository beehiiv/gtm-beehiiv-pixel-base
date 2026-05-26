// Single source of truth for the event names the beehiiv pixel accepts.
// Both pixel-v2 and pixel-shopify gate track() on this list — events with any
// other name are dropped client-side with a console warning. Keep this in sync
// with the README's "Supported Events" table.

export const SUPPORTED_EVENTS = [
  'pageview',
  'conversion',
  'lead',
  'complete_registration',
  'purchase',
  'initiate_checkout',
  'start_trial',
  'subscribe',
] as const;

export type SupportedEvent = (typeof SUPPORTED_EVENTS)[number];

const SUPPORTED_SET = new Set<string>(SUPPORTED_EVENTS);

export function isSupportedEvent(name: string): name is SupportedEvent {
  return SUPPORTED_SET.has(name);
}
