import { describe, expect, it } from 'vitest';
import {
  countryForTimeZone,
  detectLocale,
  interpolate,
  plural,
  localeForCountry,
  localeForLanguageTag,
  makeT,
  type Messages,
} from '../src/i18n/core';

describe('language by where the visitor is', () => {
  it('maps countries to Portuguese, Spanish or English', () => {
    for (const c of ['BR', 'PT', 'AO', 'MZ', 'cv']) expect(localeForCountry(c)).toBe('pt');
    for (const c of ['ES', 'MX', 'AR', 'CO', 'CL', 'UY']) expect(localeForCountry(c)).toBe('es');
    for (const c of ['US', 'GB', 'FR', 'IT', 'ZZ']) expect(localeForCountry(c)).toBe('en');
  });

  it('reads the country from the time zone', () => {
    expect(countryForTimeZone('America/Sao_Paulo')).toBe('BR');
    expect(countryForTimeZone('America/Manaus')).toBe('BR');
    expect(countryForTimeZone('Europe/Lisbon')).toBe('PT');
    expect(countryForTimeZone('Atlantic/Azores')).toBe('PT');
    expect(countryForTimeZone('Europe/Madrid')).toBe('ES');
    expect(countryForTimeZone('America/Argentina/Buenos_Aires')).toBe('AR');
    expect(countryForTimeZone('America/Mexico_City')).toBe('MX');
    expect(countryForTimeZone('America/New_York')).toBe('ZZ'); // elsewhere → English
    expect(countryForTimeZone('UTC')).toBeNull();
    expect(countryForTimeZone(undefined)).toBeNull();
  });

  it('reads browser language tags', () => {
    expect(localeForLanguageTag('pt-BR')).toBe('pt');
    expect(localeForLanguageTag('es-419')).toBe('es');
    expect(localeForLanguageTag('en_GB')).toBe('en');
    expect(localeForLanguageTag('fr-FR')).toBeNull();
  });

  it('prefers the saved choice, then location, then browser language, then Portuguese', () => {
    expect(detectLocale({ saved: 'es', timeZone: 'America/Sao_Paulo', languages: ['en-US'] })).toBe('es');
    expect(detectLocale({ saved: 'xx', timeZone: 'America/Sao_Paulo', languages: ['en-US'] })).toBe('pt');
    expect(detectLocale({ timeZone: 'Europe/Madrid', languages: ['en-US'] })).toBe('es');
    expect(detectLocale({ timeZone: 'Europe/London', languages: ['pt-PT'] })).toBe('en'); // where they are wins
    expect(detectLocale({ timeZone: 'UTC', languages: ['fr-FR', 'es-ES'] })).toBe('es');
    expect(detectLocale({ timeZone: 'UTC', languages: ['fr-FR'] })).toBe('pt');
    expect(detectLocale({})).toBe('pt');
  });
});

describe('messages', () => {
  it('fills placeholders and keeps unknown ones', () => {
    expect(interpolate('{count} pessoas em {place}', { count: 3, place: 'Braga' })).toBe('3 pessoas em Braga');
    expect(interpolate('{missing}', {})).toBe('{missing}');
  });

  it('uses the plural for zero and many, the singular for one', () => {
    expect(plural(0, 'pessoa', 'pessoas')).toBe('pessoas');
    expect(plural(1, 'pessoa', 'pessoas')).toBe('pessoa');
    expect(plural(3, 'pessoa', 'pessoas')).toBe('pessoas');
  });

  it('tells which keys belong to an area, so areas sharing a page leave each other alone', () => {
    const msgs = { pt: { a: 'A' }, en: { a: 'A' }, es: { a: 'A' } } satisfies Messages<'a'>;
    const t = makeT(msgs);
    expect(t.has('a')).toBe(true);
    expect(t.has('other.area.key')).toBe(false);
  });

  it('gives a typed t() that supports text and functions', () => {
    const msgs = {
      pt: { hello: 'Olá, {name}', n: (v: Record<string, string | number>) => `${v.count} itens` },
      en: { hello: 'Hello, {name}', n: (v: Record<string, string | number>) => `${v.count} items` },
      es: { hello: 'Hola, {name}', n: (v: Record<string, string | number>) => `${v.count} elementos` },
    } satisfies Messages<'hello' | 'n'>;
    const t = makeT(msgs);
    // Default language in the test environment (no saved choice, UTC zone in CI) is Portuguese or by
    // browser language; whichever it is, the result is one of the three translations.
    expect(['Olá, Ana', 'Hello, Ana', 'Hola, Ana']).toContain(t('hello', { name: 'Ana' }));
    expect(t('n', { count: 2 })).toMatch(/^2 /);
  });
});
