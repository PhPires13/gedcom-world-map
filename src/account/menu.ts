// The account entry point in a page header: "Entrar" when nobody is signed in, else the
// account's e-mail with "Minha conta" and "Sair". Follows the language switcher.

import './account.css';
import { makeT, onLocaleChange } from '../i18n/core';
import { accountMessages } from '../i18n/messages/account';
import { account, loginUrl, type Me } from './api';

export const t = makeT(accountMessages);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Puts the account menu in `container`. Resolves with the signed-in user (undefined if none or
 * if the API can't be reached: then the menu shows "Entrar").
 */
export async function mountAccountMenu(container: HTMLElement): Promise<Me | undefined> {
  container.classList.add('account-menu');
  let me: Me | undefined;
  const render = () => {
    container.innerHTML = me
      ? `<details><summary title="${esc(t('menu.signedInAs', { email: me.email }))}">${esc(me.email)}</summary>
           <div class="account-pop">
             <a href="./account.html">${esc(t('menu.account'))}</a>
             <button type="button" data-act="logout">${esc(t('menu.signOut'))}</button>
           </div></details>`
      : `<a class="account-signin" href="${esc(loginUrl())}">${esc(t('menu.signIn'))}</a>`;
    container.querySelector('[data-act="logout"]')?.addEventListener('click', async () => {
      await account.logout().catch(() => undefined);
      location.href = './login.html';
    });
  };
  render();
  onLocaleChange(render);
  try {
    me = await account.me();
  } catch {
    me = undefined;
  }
  render();
  return me;
}
