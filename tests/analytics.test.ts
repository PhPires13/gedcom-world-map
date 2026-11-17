import { describe, expect, it } from 'vitest';
import { makeTracker, PLAUSIBLE_SCRIPT, type TrackerHost } from '../src/analytics';

function fakeHost() {
  const appended: Record<string, unknown>[] = [];
  const host: TrackerHost = {
    document: {
      head: { append: (el: never) => void appended.push(el) },
      createElement: () => {
        const attrs: Record<string, string> = {};
        return { attrs, setAttribute: (k: string, v: string) => (attrs[k] = v) } as unknown as HTMLScriptElement;
      },
    },
  };
  return { host, appended };
}

describe('analytics', () => {
  it('does nothing without a Plausible domain', () => {
    const { host, appended } = fakeHost();
    const tracker = makeTracker(undefined, host);
    tracker.start();
    tracker.track('CTA click', { where: 'hero' });
    expect(appended).toHaveLength(0);
    expect(host.plausible).toBeUndefined();
    expect(() => makeTracker('', undefined).track('x')).not.toThrow();
  });

  it('loads Plausible once for the domain and queues events until it arrives', () => {
    const { host, appended } = fakeHost();
    const tracker = makeTracker('example.com', host);
    tracker.track('CTA click', { where: 'hero' });
    tracker.track('CTA click', { where: 'footer' });
    tracker.start();
    expect(appended).toHaveLength(1);
    const script = appended[0] as { src: string; defer: boolean; attrs: Record<string, string> };
    expect(script.src).toBe(PLAUSIBLE_SCRIPT);
    expect(script.defer).toBe(true);
    expect(script.attrs['data-domain']).toBe('example.com');
    expect(host.plausible?.q).toEqual([
      ['CTA click', { props: { where: 'hero' } }],
      ['CTA click', { props: { where: 'footer' } }],
    ]);
  });
});
