// The shop's words in the visitor's language, shared by the order page, the operations page and
// the designer's Order panel. (The server keeps its own English/Portuguese texts: production
// sheet, error messages, `describeDesign` in design.ts.)

import { currentLocale, formatMoney, makeT } from '../i18n/core';
import { shopMessages, type ShopKey } from '../i18n/messages/shop';
import { hasPrintKey, printMessages } from '../i18n/messages/print';
import { localised, type Currency, type Localised, type ProductKind } from './catalogue';
import type { DesignSpec } from './design';
import type { OrderStatus } from './status';

export const t = makeT(shopMessages);

/** A key built at run time (an option id, a colour), if the shop's messages have it. */
const has = (key: string): key is ShopKey => key in shopMessages.pt;

/** An amount in minor units (34990) as a price in the visitor's conventions. */
export const money = (minor: number, currency: Currency | string) => formatMoney(minor / 100, currency);

export const statusLabel = (s: OrderStatus) => t(`status.${s}`);
export const statusDescription = (s: OrderStatus) => t(`statusDesc.${s}`);

/** A catalogue text (product name, description, material) in the visitor's language. */
export const inLocale = (text: Localised) => localised(text, currentLocale());

export const productKindName = (kind: ProductKind) => t(`product.${kind}`);

/** A frame colour from the catalogue ("antique gold") in the visitor's language. */
export function frameColourName(colour: string): string {
  const key = `frame.${colour.trim().toLowerCase().replace(/\s+/g, '-')}`;
  return has(key) ? t(key) : colour;
}

type Named = { id: string; name: string };

const tPrint = makeT(printMessages);

/**
 * A design option's name (style, layout, border, finish) in the visitor's language — the same words
 * the print designer showed the customer — else its own name from the data file.
 */
function optionName(kind: 'style' | 'layout' | 'border' | 'finish', list: Named[], id: string): string {
  const key = `${kind}.${id}.name`;
  return hasPrintKey(key) ? tPrint(key) : (list.find((x) => x.id === id)?.name ?? id);
}

/** The design in words, for the order and operations pages (the server's `describeDesign`, translated). */
export function designWords(d: DesignSpec, names: { styles: Named[]; layouts: Named[]; borders: Named[]; finishes: Named[] }) {
  const scale = d.flagScale ?? 1;
  const size = scale === 1 ? 'medium' : scale < 1 ? 'small' : scale < 1.45 ? 'large' : 'xlarge';
  return {
    style: optionName('style', names.styles, d.styleId),
    // Orders placed before layouts existed have none: they were geographic.
    layout: optionName('layout', names.layouts, d.layoutId ?? names.layouts[0]?.id ?? 'accurate'),
    border: d.borderId ? optionName('border', names.borders, d.borderId) : t('design.border.own'),
    finish: d.finishId ? optionName('finish', names.finishes, d.finishId) : t('design.finish.own'),
    flags:
      d.show.flags === 'none'
        ? t('design.flags.none')
        : t('design.flags.withSize', { flags: t(`design.flags.${d.show.flags}`), size: t(`design.flagSize.${size}`) }),
    surnames: d.show.surnames !== false,
    routes:
      (d.routes ?? 'detailed') === 'essential'
        ? d.maxRoutes
          ? t('design.routes.essentialMax', { max: d.maxRoutes })
          : t('design.routes.essential')
        : t('design.routes.detailed'),
  };
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Date and time of an order event. */
export const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
