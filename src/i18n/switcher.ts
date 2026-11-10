// A small language picker for any page: Português / English / Español.

import { LOCALES, LOCALE_NAMES, currentLocale, onLocaleChange, setLocale, type Locale } from './core';
import './switcher.css';

const LABEL: Record<Locale, string> = { pt: 'Idioma', en: 'Language', es: 'Idioma' };

/**
 * Put a language picker inside `container`. Choosing a language saves it and fires the
 * language-change listeners (each area re-renders its own text).
 */
export function mountLanguageSwitcher(container: HTMLElement): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'lang-switcher';
  select.innerHTML = LOCALES.map((l) => `<option value="${l}">${LOCALE_NAMES[l]}</option>`).join('');
  const sync = (l: Locale) => {
    select.value = l;
    select.setAttribute('aria-label', LABEL[l]);
    select.title = LABEL[l];
  };
  sync(currentLocale());
  select.addEventListener('change', () => setLocale(select.value as Locale));
  onLocaleChange(sync);
  container.append(select);
  return select;
}
