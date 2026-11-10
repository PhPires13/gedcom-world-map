# Languages

The site speaks **Portuguese (default)**, **English** and **Spanish**.

## How the language is chosen

`currentLocale()` in `core.ts` decides once per visitor, in this order:

1. the visitor's own choice (saved in `localStorage` by the language switcher);
2. **where they are**: the device's time zone gives the country with no network call
   (Brazil, Portugal, Angola… → Portuguese; Spain, Mexico, Argentina… → Spanish; anywhere else → English);
3. their browser languages (first of pt / es / en found);
4. Portuguese.

`localeTag()` gives the formatting tag: `pt-BR` (or `pt-PT` for visitors in Portugal), `es`/`es-ES`, `en`.

## Writing text in an area

Each area keeps its words in `src/i18n/messages/<area>.ts`:

```ts
import type { Messages } from '../core';

const pt = {
  'stats.people': '{count} pessoas',
  'upload.title': 'Solte um arquivo .ged aqui',
};
type Key = keyof typeof pt;

export const mapMessages = {
  pt,
  en: { 'stats.people': '{count} people', 'upload.title': 'Drop a .ged file here' },
  es: { 'stats.people': '{count} personas', 'upload.title': 'Suelta un archivo .ged aquí' },
} satisfies Messages<Key>;
```

- Portuguese is the reference; TypeScript refuses an English or Spanish file that misses a key.
- Placeholders are `{name}`; for plurals or anything fancier a message can be a function `(vars) => string`
  (use `plural()` from `core.ts`).
- In code: `const t = makeT(mapMessages); t('stats.people', { count })`.
- Static HTML: `data-i18n="key"` (text), `data-i18n-html="key"` (trusted markup), `data-i18n-attr="placeholder:key; title:key"`,
  then `translateStatic(document, t)`; call it again in `onLocaleChange`.
- Numbers, prices and dates: `formatNumber`, `formatMoney`, `formatDate` from `core.ts` — never hand-format.
- Every page mounts `mountLanguageSwitcher(el)` from `switcher.ts` in its header, and re-renders its text in `onLocaleChange`
  without losing what the visitor loaded (no page reload).

## Wording

- Portuguese is written for Brazil (the main market), in a neutral tone that also reads well in Portugal
  (avoid strongly regional words when a neutral one exists).
- Spanish is neutral Latin American Spanish.
- Keep genealogy terms consistent across areas: *árvore genealógica / family tree / árbol genealógico*,
  *geração / generation / generación*, *documento / document / documento*, *comprovado / proven / comprobado*,
  *provável / probable / probable*, *possível / possible / posible*, *em conflito / in conflict / en conflicto*,
  *sem fonte / unsupported / sin fuente*.
