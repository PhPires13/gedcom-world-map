// Privacy-friendly analytics, off by default.
//
// Nothing happens unless the build sets VITE_PLAUSIBLE_DOMAIN (the site's domain as registered in
// Plausible, e.g. "mapadafamilia.com.br"). Then `startAnalytics()` loads Plausible's script once
// (no cookies, no personal data; it counts the page view itself) and `track(event, props?)` sends
// Plausible custom events. Events sent before the script arrives wait in Plausible's documented
// queue stub and are sent when it loads.

export type TrackProps = Record<string, string | number | boolean>;

type PlausibleFn = ((event: string, options?: { props?: TrackProps }) => void) & { q?: unknown[][] };

/** The page parts the tracker touches, so tests can pass a fake. */
export interface TrackerHost {
  plausible?: PlausibleFn;
  document: { head: { append(el: never): void }; createElement(tag: 'script'): HTMLScriptElement };
}

export const PLAUSIBLE_SCRIPT = 'https://plausible.io/js/script.js';

export interface Tracker {
  /** Load the script (once). */
  start(): void;
  /** Send a custom event; loads the script first if needed. */
  track(event: string, props?: TrackProps): void;
}

/** A tracker for `domain` on `host`; both methods do nothing when `domain` is empty. */
export function makeTracker(domain: string | undefined, host: TrackerHost | undefined): Tracker {
  if (!domain || !host) return { start: () => {}, track: () => {} };
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    if (!host.plausible) {
      const stub: PlausibleFn = (...args: unknown[]) => {
        (stub.q ??= []).push(args);
      };
      host.plausible = stub;
    }
    const s = host.document.createElement('script');
    s.defer = true;
    s.src = PLAUSIBLE_SCRIPT;
    s.setAttribute('data-domain', domain);
    host.document.head.append(s as never);
  };
  return {
    start,
    track(event, props) {
      start();
      try {
        host.plausible?.(event, props ? { props } : undefined);
      } catch {
        /* analytics never breaks the page */
      }
    },
  };
}

const tracker = makeTracker(
  (import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined)?.trim(),
  typeof window === 'undefined' ? undefined : (window as unknown as TrackerHost),
);

/** Load analytics (counts the page view) when VITE_PLAUSIBLE_DOMAIN is set; otherwise nothing. */
export const startAnalytics = (): void => tracker.start();

/** Send an analytics event; a no-op unless VITE_PLAUSIBLE_DOMAIN is set. */
export const track = (event: string, props?: TrackProps): void => tracker.track(event, props);
