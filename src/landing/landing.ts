// The sales landing page (index.html): sells the framed heritage map and sends visitors to the
// print designer (print.html) or the free interactive map (app.html).
//
// Static words are data-i18n attributes translated from src/i18n/messages/landing.ts; the style
// gallery and the product cards are built here. Prices come live from GET /api/shop/catalogue in
// the visitor's currency ("from" = the cheapest size); if the API is down the cards still show,
// with a line pointing to the designer for the price.

import '@fontsource/eb-garamond/latin-500.css';
import '@fontsource/eb-garamond/latin-500-italic.css';
import '@fontsource/eb-garamond/latin-600.css';
import '@fontsource/jost/latin-400.css';
import '@fontsource/jost/latin-500.css';
import '@fontsource/jost/latin-600.css';
import './landing.css';

import flagAr from 'flag-icons/flags/4x3/ar.svg?url';
import flagBr from 'flag-icons/flags/4x3/br.svg?url';
import flagEs from 'flag-icons/flags/4x3/es.svg?url';
import flagIt from 'flag-icons/flags/4x3/it.svg?url';
import flagPt from 'flag-icons/flags/4x3/pt.svg?url';

import { startAnalytics, track } from '../analytics';
import { localised } from '../commerce/catalogue';
import { guessCountry, shop, type ShopCatalogue } from '../commerce/client';
import { currentLocale, formatMoney, makeT, onLocaleChange, translateStatic } from '../i18n/core';
import { landingMessages, type LandingKey } from '../i18n/messages/landing';
import { mountLanguageSwitcher } from '../i18n/switcher';
import { lowestPrices } from './prices';

const t = makeT(landingMessages);
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/**
 * Example prints in public/examples/<image>.jpg (added separately; a missing one is hidden and the
 * colour swatch under it shows instead). The first card is the "Países da família" layout (only
 * the family's countries, drawn large), the most striking example, shown wide.
 */
const GALLERY: { id: string; image: string; paper: string; ink: string; route: string; featured?: boolean }[] = [
  { id: 'homelands', image: 'woodburn-homelands', paper: '#e6cfa6', ink: '#4a2e1a', route: '#2b1a0e', featured: true },
  { id: 'antique', image: 'antique', paper: '#ecdcb9', ink: '#5b4630', route: '#8a2e1a' },
  { id: 'nautical', image: 'nautical', paper: '#f3ecda', ink: '#1d3557', route: '#1d3557' },
  { id: 'modern', image: 'modern', paper: '#f7f7f5', ink: '#9aa1a9', route: '#e4572e' },
  { id: 'portolan', image: 'portolan', paper: '#efe0bd', ink: '#7a5b2e', route: '#b23a2b' },
  { id: 'leather', image: 'leather', paper: '#8b5a3c', ink: '#3b2416', route: '#e0b25c' },
  { id: 'woodburn', image: 'woodburn', paper: '#e6cfa6', ink: '#4a2e1a', route: '#2b1a0e' },
  { id: 'explorer', image: 'explorer', paper: '#e3d6b4', ink: '#3f4a32', route: '#a1452a' },
];

/** The hero's framed example: the first of these that loads (none: the drawn placeholder stays). */
const HERO_IMAGES = ['antique-homelands', 'antique'];

const exampleUrl = (image: string) => `${import.meta.env.BASE_URL}examples/${image}.jpg`;

/** Product cards shown even when the shop's API can't be reached (catalogue order). */
const KNOWN_PRODUCTS = ['digital', 'print', 'framed'] as const;
const POPULAR = 'framed';

const FLAGS: Record<string, string> = { ar: flagAr, br: flagBr, es: flagEs, it: flagIt, pt: flagPt };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const known = (key: string): key is LandingKey => t.has(key);

// ---------- Hero image ----------

function mountHeroImage(): void {
  const art = $('#hero-art');
  const img = new Image();
  img.className = 'art-image';
  img.decoding = 'async';
  img.setAttribute('data-i18n-attr', 'alt:hero.imageAlt');
  img.alt = t('hero.imageAlt');
  const queue = [...HERO_IMAGES];
  img.addEventListener('load', () => {
    // The frame takes the example's own proportions, so nothing of the print is cropped.
    if (img.naturalWidth && img.naturalHeight) art.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    art.classList.add('has-image');
  });
  img.addEventListener('error', () => {
    const next = queue.shift();
    if (next) img.src = exampleUrl(next);
    else img.remove();
  });
  img.src = exampleUrl(queue.shift()!);
  art.append(img);
}

// ---------- Style gallery ----------

function mountGallery(): void {
  const root = $('#gallery');
  root.innerHTML = GALLERY.map(
    (s) => `
    <article class="style-card${s.featured ? ' style-card-featured' : ''}">
      <div class="style-thumb" style="--sw-paper:${s.paper};--sw-ink:${s.ink};--sw-route:${s.route}">
        <svg class="style-swatch" viewBox="0 0 160 120" aria-hidden="true">
          <rect width="160" height="120" fill="var(--sw-paper)" />
          <path d="M98 18c14-4 28 2 32 12 3 9-6 14-2 22 4 9 16 10 14 20-2 11-18 10-26 18-7 8-2 20-14 22-11 2-16-10-26-14-11-4-24 2-28-8-4-11 10-18 10-28 0-11-10-20-4-30 6-9 30-10 44-14z" fill="var(--sw-ink)" fill-opacity=".22" stroke="var(--sw-ink)" stroke-width="1" />
          <path d="M30 96C58 86 70 52 112 40" fill="none" stroke="var(--sw-route)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 5" />
          <circle cx="30" cy="96" r="3.5" fill="var(--sw-route)" /><circle cx="112" cy="40" r="3.5" fill="var(--sw-route)" />
        </svg>
        <img loading="lazy" decoding="async" data-src="${esc(exampleUrl(s.image))}" data-i18n-attr="alt:style.${s.id}.name" alt="" />
      </div>
      <div class="style-body">
        <h3 data-i18n="style.${s.id}.name"></h3>
        <p data-i18n="style.${s.id}.desc"></p>
        <a class="text-link" href="print.html" data-cta="style" data-style="${s.id}" data-i18n="${s.featured ? 'styles.tryLayout' : 'styles.try'}"></a>
      </div>
    </article>`,
  ).join('');
  // A preview that isn't there (yet) is hidden; the swatch under it stays.
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-src]')) {
    img.addEventListener('load', () => img.closest('.style-thumb')!.classList.add('has-image'));
    img.addEventListener('error', () => img.remove());
    img.src = img.dataset.src!;
  }
}

// ---------- Origins ----------

function mountFlags(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-flag]')) {
    const url = FLAGS[el.dataset.flag!];
    if (url) el.style.backgroundImage = `url("${url}")`;
  }
}

// ---------- Products and prices ----------

type PriceState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; catalogue: ShopCatalogue };
let prices: PriceState = { status: 'loading' };

function priceLine(productId: string): string {
  if (prices.status === 'loading') return `<p class="price muted">${esc(t('prices.loading'))}</p>`;
  if (prices.status === 'error') return `<p class="price price-na">${esc(t('prices.unavailable'))}</p>`;
  const cat = prices.catalogue;
  const from = lowestPrices(cat).find((p) => p.productId === productId);
  if (!from) return `<p class="price price-na">${esc(t('prices.unavailable'))}</p>`;
  const amount = formatMoney(from.fromAmount / 100, cat.currency);
  const shipping =
    from.kind === 'digital'
      ? ''
      : from.shippingAmount > 0
        ? t('prices.shipping', { amount: formatMoney(from.shippingAmount / 100, cat.currency) })
        : t('prices.shippingIncl');
  return `<p class="price"><span class="price-from">${esc(t('prices.from'))}</span> <b>${esc(amount)}</b></p>
    <p class="price-meta">${esc(t('prices.sizes', { sizes: from.sizes.join(' · ') }))}${shipping ? ` · ${esc(shipping)}` : ''}</p>`;
}

function renderProducts(): void {
  const locale = currentLocale();
  const live = prices.status === 'ok' ? prices.catalogue.products : [];
  // The shop's products when it answered (it may sell fewer in this market), otherwise the known three.
  const ids = live.length ? live.map((p) => p.id) : [...KNOWN_PRODUCTS];
  $('#products').innerHTML = ids
    .map((id) => {
      const p = live.find((x) => x.id === id);
      const nameKey = `product.${id}.name`;
      const descKey = `product.${id}.desc`;
      const name = known(nameKey) ? t(nameKey) : p ? localised(p.name, locale) : id;
      const desc = known(descKey) ? t(descKey) : p ? localised(p.description, locale) : '';
      const popular = id === POPULAR;
      return `
      <article class="product${popular ? ' product-popular' : ''}">
        ${popular ? `<span class="badge">${esc(t('prices.popular'))}</span>` : ''}
        <h3>${esc(name)}</h3>
        <p class="product-desc">${esc(desc)}</p>
        <div class="product-price">${priceLine(id)}</div>
        <a class="btn ${popular ? 'btn-primary' : 'btn-outline'} btn-block" href="print.html" data-cta="product" data-product="${esc(id)}">${esc(t('prices.cta'))}</a>
      </article>`;
    })
    .join('');
  const note = $('#prices-note');
  note.hidden = !(prices.status === 'ok' && prices.catalogue.placeholderPrices);
  note.textContent = note.hidden ? '' : t('prices.placeholder');
}

async function loadPrices(): Promise<void> {
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000));
    const catalogue = await Promise.race([shop.catalogue(guessCountry()), timeout]);
    if (!catalogue || !Array.isArray(catalogue.products)) throw new Error('bad catalogue');
    prices = { status: 'ok', catalogue };
  } catch {
    prices = { status: 'error' };
  }
  renderProducts();
}

// ---------- Text in the current language ----------

function setMeta(name: string, content: string): void {
  document.querySelector(`meta[name="${name}"]`)?.setAttribute('content', content);
}

function renderText(): void {
  translateStatic(document, t);
  document.title = t('meta.title');
  setMeta('description', t('meta.description'));
  $('#rights').textContent = t('footer.rights', { year: new Date().getFullYear() });
  renderProducts();
}

// ---------- Analytics ----------

function trackCtas(): void {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest<HTMLElement>('[data-cta]');
    if (!a) return;
    const props: Record<string, string> = { where: a.dataset.cta!, to: a.getAttribute('href') ?? '', lang: currentLocale() };
    if (a.dataset.style) props.style = a.dataset.style;
    if (a.dataset.product) props.product = a.dataset.product;
    track('CTA click', props);
  });
}

// ---------- Start ----------

mountGallery();
mountHeroImage();
mountFlags();
mountLanguageSwitcher($('#lang-switch'));
renderText();
onLocaleChange(renderText);
trackCtas();
startAnalytics();
void loadPrices();
