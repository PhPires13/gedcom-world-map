// The few words of a share's link preview (the page at /s/:id that WhatsApp, Facebook & co. read,
// and its picture). Made on the server, which can't load src/i18n/core.ts (it needs the DOM), so
// these live here as plain functions, like the print renderer's own words.

import type { ShareSummary } from './snapshot';

export type PreviewLang = 'pt' | 'en' | 'es';

export const PREVIEW_TAGS: Record<PreviewLang, string> = { pt: 'pt-BR', en: 'en', es: 'es' };

/** First of pt / en / es in an Accept-Language header, else Portuguese. */
export function previewLang(acceptLanguage: string | undefined): PreviewLang {
  for (const part of (acceptLanguage ?? '').split(',')) {
    const base = part.trim().split(/[-;]/)[0].toLowerCase();
    if (base === 'pt' || base === 'en' || base === 'es') return base;
  }
  return 'pt';
}

const pl = (n: number, one: string, other: string) => (n === 1 ? one : other);

const WORDS: Record<
  PreviewLang,
  {
    title: (family: string) => string;
    subtitle: string;
    open: string;
    counts: (people: [number, string], generations: [number, string]) => string;
    description: (c: Record<'people' | 'generations' | 'places', [number, string]>, years: string) => string;
  }
> = {
  pt: {
    title: (f) => `Família ${f} — mapa das migrações`,
    subtitle: 'Mapa das migrações',
    open: 'Abrir o mapa',
    counts: ([p, ps], [g, gs]) => `${ps} ${pl(p, 'pessoa', 'pessoas')} · ${gs} ${pl(g, 'geração', 'gerações')}`,
    description: ({ people: [p, ps], generations: [g, gs], places: [l, ls] }, years) =>
      `${ps} ${pl(p, 'pessoa', 'pessoas')} em ${gs} ${pl(g, 'geração', 'gerações')}, de ${ls} ${pl(l, 'lugar', 'lugares')}${years ? ` (${years})` : ''}. Veja de onde a família veio.`,
  },
  en: {
    title: (f) => `The ${f} family — migration map`,
    subtitle: 'Migration map',
    open: 'Open the map',
    counts: ([p, ps], [g, gs]) => `${ps} ${pl(p, 'person', 'people')} · ${gs} ${pl(g, 'generation', 'generations')}`,
    description: ({ people: [p, ps], generations: [g, gs], places: [l, ls] }, years) =>
      `${ps} ${pl(p, 'person', 'people')} across ${gs} ${pl(g, 'generation', 'generations')}, from ${ls} ${pl(l, 'place', 'places')}${years ? ` (${years})` : ''}. See where the family came from.`,
  },
  es: {
    title: (f) => `Familia ${f} — mapa de las migraciones`,
    subtitle: 'Mapa de las migraciones',
    open: 'Abrir el mapa',
    counts: ([p, ps], [g, gs]) => `${ps} ${pl(p, 'persona', 'personas')} · ${gs} ${pl(g, 'generación', 'generaciones')}`,
    description: ({ people: [p, ps], generations: [g, gs], places: [l, ls] }, years) =>
      `${ps} ${pl(p, 'persona', 'personas')} en ${gs} ${pl(g, 'generación', 'generaciones')}, de ${ls} ${pl(l, 'lugar', 'lugares')}${years ? ` (${years})` : ''}. Mira de dónde vino la familia.`,
  },
};

/** Title, description and the other words of a share's preview, in `lang`. */
export function previewText(lang: PreviewLang, family: string, s: ShareSummary) {
  const w = WORDS[lang];
  const n = (x: number): [number, string] => [x, new Intl.NumberFormat(PREVIEW_TAGS[lang]).format(x)];
  const years = s.fromYear !== undefined && s.toYear !== undefined && s.fromYear !== s.toYear ? `${s.fromYear}–${s.toYear}` : '';
  return {
    title: w.title(family),
    description: w.description({ people: n(s.people), generations: n(s.generations), places: n(s.places) }, years),
    subtitle: w.subtitle,
    /** "19 pessoas · 4 gerações · 1790–1925", under the title on the preview picture. */
    counts: [w.counts(n(s.people), n(s.generations)), years].filter(Boolean).join(' · '),
    open: w.open,
  };
}
