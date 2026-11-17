// The sign-in page (login.html?next=/somewhere): asks for an e-mail address and sends a sign-in
// link (POST /api/auth/request). The link itself lands on the API, which starts the session and
// comes back to `next`. `?error=link` is where a used or expired link lands.

import '../commerce/shop.css';
import { currentLocale, onLocaleChange, translateStatic } from '../i18n/core';
import { mountLanguageSwitcher } from '../i18n/switcher';
import { ApiError } from '../tree/api';
import { account, DEV_EMAIL, type Me } from './api';
import { t } from './menu';

const params = new URLSearchParams(location.search);
/** Only same-site paths; the server checks again. */
const next = (() => {
  const n = params.get('next');
  return n && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n : undefined;
})();
const box = document.querySelector<HTMLElement>('#login')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let me: Me | undefined;
let state: { kind: 'form'; error?: () => string } | { kind: 'sent'; email: string } = {
  kind: 'form',
  error: params.get('error') === 'link' ? () => t('login.linkError') : undefined,
};
let typed = '';

function render() {
  document.title = t('login.pageTitle');
  translateStatic(document, t);
  const already =
    me && me.email !== DEV_EMAIL
      ? `<p class="ok-note">${esc(t('login.already', { email: me.email }))} <a href="${esc(next ?? './account.html')}">${esc(t('login.continue'))}</a></p><p class="muted small">${esc(t('login.other'))}</p>`
      : '';
  if (state.kind === 'sent') {
    box.innerHTML = `<div class="card">
      <h1>${esc(t('login.heading'))}</h1>
      <p class="ok-note">${esc(t('login.sent', { email: state.email }))}</p>
      <p class="muted small">${esc(t('login.sentHint'))}</p>
      <button class="btn" id="again">${esc(t('login.again'))}</button>
    </div>`;
    box.querySelector('#again')!.addEventListener('click', () => {
      state = { kind: 'form' };
      render();
    });
    return;
  }
  box.innerHTML = `<div class="card">
    <h1>${esc(t('login.heading'))}</h1>
    ${already}
    <p class="muted">${esc(t('login.intro'))}</p>
    ${state.error ? `<p class="error small" role="alert">${esc(state.error())}</p>` : ''}
    <form class="login-form" novalidate>
      <label for="email">${esc(t('login.email'))}</label>
      <input id="email" name="email" type="email" autocomplete="email" required placeholder="${esc(t('login.emailPlaceholder'))}" value="${esc(typed)}" />
      <button class="btn primary" type="submit">${esc(t('login.submit'))}</button>
    </form>
  </div>`;
  const form = box.querySelector<HTMLFormElement>('form')!;
  const input = form.querySelector<HTMLInputElement>('#email')!;
  input.addEventListener('input', () => (typed = input.value));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email || !input.checkValidity()) {
      input.reportValidity();
      return;
    }
    const button = form.querySelector<HTMLButtonElement>('button')!;
    button.disabled = true;
    button.textContent = t('login.sending');
    try {
      await account.requestLink(email, next, currentLocale());
      state = { kind: 'sent', email };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state = { kind: 'form', error: err instanceof ApiError && err.status === 429 ? () => t('login.tooMany') : () => t('login.failed', { error: message }) };
    }
    render();
  });
}

mountLanguageSwitcher(document.querySelector<HTMLElement>('#lang')!);
onLocaleChange(render);
render();
void account
  .me()
  .catch(() => undefined)
  .then((m) => {
    me = m;
    if (state.kind === 'form') render();
  });
