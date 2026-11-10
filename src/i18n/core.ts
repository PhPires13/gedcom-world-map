// Site languages: Portuguese (the default), English and Spanish.
//
// The language is chosen once per visitor: their own choice if they made one, otherwise where they
// are (their device's time zone says which country without any network call), otherwise their
// browser's language, otherwise Portuguese. Each area of the site keeps its words in its own
// message file (src/i18n/messages/<area>.ts) with the same keys in all three languages, and gets
// a typed `t()` for them from `makeT`.

export type Locale = 'pt' | 'en' | 'es';

export const LOCALES: readonly Locale[] = ['pt', 'en', 'es'];
export const DEFAULT_LOCALE: Locale = 'pt';

/** Names shown in the language switcher, each in its own language. */
export const LOCALE_NAMES: Record<Locale, string> = { pt: 'Português', en: 'English', es: 'Español' };

const STORAGE_KEY = 'gedcom-world-map:locale';

// ---------- Where the visitor is ----------

/** Countries where the site should open in Portuguese. */
const PT_COUNTRIES = new Set(['BR', 'PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL', 'MO']);
/** Countries where the site should open in Spanish. */
const ES_COUNTRIES = new Set([
  'ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO', 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'PR', 'GQ',
]);

/** Language for a country code (ISO 3166-1 alpha-2); everywhere else gets English. */
export function localeForCountry(country: string): Locale {
  const c = country.toUpperCase();
  if (PT_COUNTRIES.has(c)) return 'pt';
  if (ES_COUNTRIES.has(c)) return 'es';
  return 'en';
}

/**
 * Country for an IANA time zone, for the zones of Portuguese- and Spanish-speaking countries
 * (the ones that change the language). Any other real zone means "elsewhere" (English);
 * an unknown or generic zone (UTC, Etc/…) returns null.
 */
const ZONE_COUNTRIES: Record<string, string> = {
  // Portuguese
  'Europe/Lisbon': 'PT', 'Atlantic/Azores': 'PT', 'Atlantic/Madeira': 'PT',
  'Africa/Luanda': 'AO', 'Africa/Maputo': 'MZ', 'Atlantic/Cape_Verde': 'CV', 'Africa/Bissau': 'GW',
  'Africa/Sao_Tome': 'ST', 'Asia/Dili': 'TL', 'Asia/Macau': 'MO',
  // Spanish
  'Europe/Madrid': 'ES', 'Africa/Ceuta': 'ES', 'Atlantic/Canary': 'ES',
  'America/Bogota': 'CO', 'America/Santiago': 'CL', 'America/Punta_Arenas': 'CL', 'Pacific/Easter': 'CL',
  'America/Lima': 'PE', 'America/Caracas': 'VE', 'America/Guayaquil': 'EC', 'Pacific/Galapagos': 'EC',
  'America/Guatemala': 'GT', 'America/Havana': 'CU', 'America/La_Paz': 'BO', 'America/Santo_Domingo': 'DO',
  'America/Tegucigalpa': 'HN', 'America/Asuncion': 'PY', 'America/El_Salvador': 'SV', 'America/Managua': 'NI',
  'America/Costa_Rica': 'CR', 'America/Panama': 'PA', 'America/Montevideo': 'UY', 'America/Puerto_Rico': 'PR',
  'Africa/Malabo': 'GQ',
};
const BRAZIL_ZONES = [
  'America/Sao_Paulo', 'America/Bahia', 'America/Fortaleza', 'America/Recife', 'America/Belem', 'America/Maceio',
  'America/Araguaina', 'America/Manaus', 'America/Cuiaba', 'America/Campo_Grande', 'America/Porto_Velho',
  'America/Boa_Vista', 'America/Rio_Branco', 'America/Eirunepe', 'America/Santarem', 'America/Noronha',
];
const MEXICO_ZONES = [
  'America/Mexico_City', 'America/Cancun', 'America/Merida', 'America/Monterrey', 'America/Matamoros',
  'America/Chihuahua', 'America/Ciudad_Juarez', 'America/Ojinaga', 'America/Mazatlan', 'America/Bahia_Banderas',
  'America/Hermosillo', 'America/Tijuana',
];
for (const z of BRAZIL_ZONES) ZONE_COUNTRIES[z] = 'BR';
for (const z of MEXICO_ZONES) ZONE_COUNTRIES[z] = 'MX';

export function countryForTimeZone(zone: string | undefined): string | null {
  if (!zone) return null;
  if (ZONE_COUNTRIES[zone]) return ZONE_COUNTRIES[zone];
  if (zone.startsWith('America/Argentina/') || zone === 'America/Buenos_Aires') return 'AR';
  // A real place elsewhere in the world: not a Portuguese- or Spanish-speaking country.
  if (/^(Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\//.test(zone)) return 'ZZ';
  return null;
}

/** Language for a browser language tag such as "pt-BR" or "es-419"; null for any other language. */
export function localeForLanguageTag(tag: string): Locale | null {
  const base = tag.toLowerCase().split(/[-_]/)[0];
  return base === 'pt' || base === 'en' || base === 'es' ? base : null;
}

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/**
 * The visitor's language: their saved choice, else where they are (time zone), else their
 * browser languages, else Portuguese. Pure, so it can be tested; `currentLocale()` feeds it.
 */
export function detectLocale(input: { saved?: string | null; timeZone?: string; languages?: readonly string[] }): Locale {
  if (isLocale(input.saved)) return input.saved;
  const country = countryForTimeZone(input.timeZone);
  if (country) return localeForCountry(country);
  for (const tag of input.languages ?? []) {
    const l = localeForLanguageTag(tag);
    if (l) return l;
  }
  return DEFAULT_LOCALE;
}

// ---------- The current language ----------

let current: Locale | null = null;
let region: string | null = null;
const listeners = new Set<(l: Locale) => void>();

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** The visitor's language (decided on first use, then fixed until they change it). */
export function currentLocale(): Locale {
  if (!current) {
    const tz = timeZone();
    region = countryForTimeZone(tz);
    current = detectLocale({ saved: readSaved(), timeZone: tz, languages: typeof navigator === 'undefined' ? [] : navigator.languages });
    if (typeof document !== 'undefined') document.documentElement.lang = localeTag();
  }
  return current;
}

/**
 * BCP 47 tag for formatting numbers, dates and prices: Portuguese as written in Portugal for
 * visitors there, Brazilian Portuguese otherwise; Spanish and English as is.
 */
export function localeTag(locale: Locale = currentLocale()): string {
  if (locale === 'pt') return region === 'PT' ? 'pt-PT' : 'pt-BR';
  if (locale === 'es') return region === 'ES' ? 'es-ES' : 'es';
  return 'en';
}

/** Switch language, remember the choice, and tell every part of the page to re-render. */
export function setLocale(locale: Locale): void {
  if (locale === currentLocale()) return;
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* not remembered, still switched */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = localeTag();
  for (const fn of listeners) fn(locale);
}

/** Run `fn` whenever the language changes (re-render what shows text). Returns an unsubscribe. */
export function onLocaleChange(fn: (l: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Messages ----------

/** A message: plain text with optional `{name}` placeholders, or a function for anything fancier. */
export type Message = string | ((vars: Record<string, string | number>) => string);

/** An area's messages: Portuguese is the reference; English and Spanish must have every key. */
export type Messages<K extends string> = Record<Locale, Record<K, Message>>;

/** Fill `{name}` placeholders. */
export function interpolate(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * A typed `t()` for one area's messages, always in the current language (falling back to
 * Portuguese, then to the key, if a message is missing at runtime).
 *
 *   const t = makeT(mapMessages);
 *   t('stats.people', { count: 34 })
 */
export function makeT<K extends string>(messages: Messages<K>) {
  const t = (key: K, vars: Record<string, string | number> = {}): string => {
    const msg = messages[currentLocale()][key] ?? messages[DEFAULT_LOCALE][key];
    if (msg === undefined) return key;
    return typeof msg === 'function' ? msg(vars) : interpolate(msg, vars);
  };
  /** Whether this area has a message for `key` (so `translateStatic` leaves other areas' keys alone). */
  t.has = (key: string): key is K => key in messages[DEFAULT_LOCALE];
  return t;
}

/** A `t()` from `makeT`, or any function from key to text (then every key is treated as its own). */
type Translator<K extends string> = ((key: K) => string) & { has?: (key: string) => boolean };

/**
 * Translate static HTML under `root` (and `root` itself): elements with `data-i18n="key"` get their
 * text, `data-i18n-html="key"` their markup, and `data-i18n-attr="placeholder:key; title:key"` sets
 * attributes. Keys this area's `t` doesn't have are skipped, so several areas can share a page,
 * each translating only its own. Call again after a language change.
 */
export function translateStatic<K extends string>(root: ParentNode, t: Translator<K>): void {
  const owns = (key: string | undefined): key is K => !!key && (t.has ? t.has(key) : true);
  const all = <E extends Element>(sel: string): HTMLElement[] => {
    const found = [...root.querySelectorAll<HTMLElement>(sel)];
    if (root instanceof HTMLElement && root.matches(sel)) found.unshift(root);
    return found as HTMLElement[] & E[];
  };
  for (const el of all('[data-i18n]')) if (owns(el.dataset.i18n)) el.textContent = t(el.dataset.i18n);
  for (const el of all('[data-i18n-html]')) if (owns(el.dataset.i18nHtml)) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of all('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr!.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && owns(key)) el.setAttribute(attr, t(key));
    }
  }
}

// ---------- Formatting ----------

/** A number in the visitor's conventions (34 → "34", 1234.5 → "1.234,5" in Portuguese). */
export const formatNumber = (n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(localeTag(), opts).format(n);

/** A price, e.g. formatMoney(129, 'BRL') → "R$ 129,00" in Brazilian Portuguese. */
export const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat(localeTag(), { style: 'currency', currency }).format(amount);

/** A date (ISO string or Date) in the visitor's conventions. */
export function formatDate(d: string | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? String(d) : new Intl.DateTimeFormat(localeTag(), opts).format(date);
}

/**
 * Choose between singular and plural words for a count, in the current language. Zero always takes
 * the plural ("0 pessoas"), although the standard rules make it singular in Portuguese.
 */
export function plural(count: number, one: string, other: string): string {
  if (count === 0) return other;
  return new Intl.PluralRules(localeTag()).select(count) === 'one' ? one : other;
}
