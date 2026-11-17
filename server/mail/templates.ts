// Transactional e-mails in Portuguese (Brazil), English and Spanish: an HTML version (tables and
// inline styles, which every mail client understands) and a plain-text version from the same
// content. Brand-neutral: the name at the top is MAIL_BRAND, else a plain "Family map".
//
// Order mails speak the order's language (`design.lang`, the language the customer designed in);
// the sign-in mail speaks the language of the page it was asked from.

export type MailLang = 'pt' | 'en' | 'es';

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

type Block =
  | { p: string; muted?: boolean }
  | { button: { label: string; url: string } }
  | { details: [string, string][] }
  | { links: { label: string; url: string }[] };

interface Content {
  lang: MailLang;
  brand: string;
  subject: string;
  /** The line mail apps show after the subject. */
  preheader: string;
  heading: string;
  blocks: Block[];
  footer: string;
}

const LOCALE_TAG: Record<MailLang, string> = { pt: 'pt-BR', en: 'en', es: 'es' };
const DEFAULT_BRAND: Record<MailLang, string> = { pt: 'Mapa de família', en: 'Family map', es: 'Mapa familiar' };

export const brandFor = (lang: MailLang, brand?: string) => brand || DEFAULT_BRAND[lang];

export const formatMailDate = (d: Date | string, lang: MailLang) => new Intl.DateTimeFormat(LOCALE_TAG[lang], { dateStyle: 'long' }).format(new Date(d));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function html(c: Content): string {
  const row = (inner: string, pad = '8px 32px') => `<tr><td style="padding:${pad};${FONT}">${inner}</td></tr>`;
  const blocks = c.blocks
    .map((b) => {
      if ('p' in b) return row(`<p style="margin:0;font-size:${b.muted ? 13 : 15}px;line-height:1.55;color:${b.muted ? '#6b7280' : '#1f2937'}">${esc(b.p)}</p>`);
      if ('button' in b)
        return row(
          `<a href="${esc(b.button.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:8px">${esc(b.button.label)}</a>`,
          '16px 32px',
        );
      if ('links' in b)
        return row(
          b.links
            .map((l) => `<a href="${esc(l.url)}" style="display:inline-block;margin:0 8px 8px 0;border:1px solid #2563eb;color:#2563eb;font-size:14px;font-weight:600;text-decoration:none;padding:9px 16px;border-radius:8px">${esc(l.label)}</a>`)
            .join(''),
          '12px 32px 4px',
        );
      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #e5e7eb">${b.details
          .map(
            ([k, v]) =>
              `<tr><td style="padding:8px 12px 8px 0;${FONT};font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;border-bottom:1px solid #e5e7eb">${esc(k)}</td><td style="padding:8px 0;${FONT};font-size:14px;color:#111827;border-bottom:1px solid #e5e7eb">${esc(v)}</td></tr>`,
          )
          .join('')}</table>`,
        '12px 32px',
      );
    })
    .join('\n');
  return `<!doctype html>
<html lang="${LOCALE_TAG[c.lang]}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">
${row(`<p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280">${esc(c.brand)}</p>`, '28px 32px 6px')}
${row(`<h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:600;color:#111827">${esc(c.heading)}</h1>`, '0 32px 8px')}
${blocks}
${row('&nbsp;', '8px 32px 20px')}
</table>
<p style="max-width:560px;margin:16px auto 0;${FONT};font-size:12px;line-height:1.5;color:#9ca3af">${esc(c.footer)}</p>
</td></tr></table>
</body>
</html>
`;
}

function text(c: Content): string {
  const out = [c.brand.toUpperCase(), '', c.heading, '='.repeat(Math.min(c.heading.length, 60)), ''];
  for (const b of c.blocks) {
    if ('p' in b) out.push(b.p, '');
    else if ('button' in b) out.push(`${b.button.label}: ${b.button.url}`, '');
    else if ('links' in b) out.push(...b.links.map((l) => `${l.label}: ${l.url}`), '');
    else out.push(...b.details.map(([k, v]) => `${k}: ${v}`), '');
  }
  out.push('--', c.footer, '');
  return out.join('\n');
}

const render = (c: Content): Rendered => ({ subject: c.subject, html: html(c), text: text(c) });

// ---------------------------------------------------------------------------------------------
// Sign-in link

const MAGIC = {
  pt: {
    subject: 'Seu link para entrar',
    heading: 'Entrar na sua conta',
    body: 'Clique no botão abaixo para entrar. O link vale por {minutes} minutos e só pode ser usado uma vez.',
    button: 'Entrar',
    ignore: 'Se você não pediu este link, pode ignorar este e-mail: ninguém entra na sua conta sem ele.',
    footer: 'Você recebeu este e-mail porque alguém pediu para entrar em {brand} com este endereço.',
  },
  en: {
    subject: 'Your sign-in link',
    heading: 'Sign in to your account',
    body: 'Click the button below to sign in. The link works for {minutes} minutes and only once.',
    button: 'Sign in',
    ignore: "If you didn't ask for this link, you can ignore this e-mail: nobody can sign in without it.",
    footer: 'You received this e-mail because someone asked to sign in to {brand} with this address.',
  },
  es: {
    subject: 'Tu enlace para entrar',
    heading: 'Entra en tu cuenta',
    body: 'Haz clic en el botón de abajo para entrar. El enlace vale por {minutes} minutos y solo se puede usar una vez.',
    button: 'Entrar',
    ignore: 'Si no pediste este enlace, puedes ignorar este correo: nadie puede entrar en tu cuenta sin él.',
    footer: 'Recibiste este correo porque alguien pidió entrar en {brand} con esta dirección.',
  },
} satisfies Record<MailLang, Record<string, string>>;

export function magicLinkMail(p: { lang: MailLang; url: string; minutes: number; brand?: string }): Rendered {
  const w = MAGIC[p.lang];
  const brand = brandFor(p.lang, p.brand);
  const v = { minutes: String(p.minutes), brand };
  return render({
    lang: p.lang,
    brand,
    subject: w.subject,
    preheader: fill(w.body, v),
    heading: w.heading,
    blocks: [{ p: fill(w.body, v) }, { button: { label: w.button, url: p.url } }, { p: w.ignore, muted: true }],
    footer: fill(w.footer, v),
  });
}

// ---------------------------------------------------------------------------------------------
// Orders

/** What an order mail needs to know, already in the order's language where it matters. */
export interface OrderMailInfo {
  lang: MailLang;
  number: string;
  /** "Impressão fine-art emoldurada A2, moldura preta" */
  product: string;
  /** The map's title, if the customer gave one. */
  title?: string;
  /** "R$ 349,90" */
  total: string;
  digital: boolean;
  orderUrl: string;
  brand?: string;
}

const ORDER = {
  pt: {
    order: 'Pedido',
    product: 'Produto',
    map: 'Mapa',
    total: 'Total',
    view: 'Ver o pedido',
    footer: 'Você recebeu este e-mail por causa de um pedido feito em {brand}. Para qualquer dúvida, basta responder.',
    paidSubject: 'Pedido {number} confirmado',
    paidHeading: 'Recebemos seu pagamento',
    paidBody: 'Obrigado! Seu pedido {number} está confirmado. Agora vamos preparar o arquivo do seu mapa em alta resolução.',
    paidNextDigital: 'Avisaremos por e-mail assim que os arquivos estiverem prontos para baixar.',
    paidNextPrint: 'Depois ele vai para a impressão, e avisaremos quando o pedido for despachado.',
    readySubject: 'Seu mapa está pronto para baixar ({number})',
    readyHeading: 'Seu mapa está pronto',
    readyBody: 'Os arquivos do seu mapa em alta resolução já podem ser baixados. Os links valem até {date}; depois disso, você pode pegar links novos na página do pedido.',
    pdf: 'PDF (para imprimir)',
    png: 'PNG, 300 dpi',
    readyReview: 'Gostou do resultado? Sua opinião nos ajuda muito: basta responder a este e-mail.',
    shippedSubject: 'Seu pedido {number} foi enviado',
    shippedHeading: 'Seu mapa está a caminho',
    shippedBody: 'Seu pedido {number} foi despachado.',
    tracking: 'Rastreamento',
    noTracking: 'Assim que tivermos o código de rastreamento, ele aparecerá na página do pedido.',
    track: 'Acompanhar o pedido',
    deliveredSubject: 'Seu pedido {number} foi entregue',
    deliveredHeading: 'Seu mapa chegou!',
    deliveredBody: 'Esperamos que goste do seu mapa de família. Se algo não estiver perfeito, responda a este e-mail e resolvemos.',
    review: 'Poderia nos contar o que achou? Uma avaliação curta ajuda outras famílias a nos encontrar e nos ajuda a melhorar.',
    reviewReply: 'Poderia nos contar o que achou? Basta responder a este e-mail: sua opinião ajuda outras famílias a nos encontrar e nos ajuda a melhorar.',
    reviewButton: 'Deixar uma avaliação',
    refundSubject: 'Reembolso do pedido {number}',
    refundHeading: 'Fizemos o seu reembolso',
    refundBody:
      'Devolvemos {amount} referente ao pedido {number} para a mesma forma de pagamento. Dependendo do banco ou do cartão, o valor pode levar de 5 a 10 dias úteis para aparecer.',
  },
  en: {
    order: 'Order',
    product: 'Product',
    map: 'Map',
    total: 'Total',
    view: 'View your order',
    footer: 'You received this e-mail because of an order placed with {brand}. If you have any questions, just reply.',
    paidSubject: 'Order {number} confirmed',
    paidHeading: "We've received your payment",
    paidBody: "Thank you! Your order {number} is confirmed. We're now preparing the high-resolution file of your map.",
    paidNextDigital: "We'll e-mail you as soon as the files are ready to download.",
    paidNextPrint: "Then it goes to print, and we'll let you know when it ships.",
    readySubject: 'Your map is ready to download ({number})',
    readyHeading: 'Your map is ready',
    readyBody: 'The high-resolution files of your map are ready to download. The links work until {date}; after that, you can get new ones from your order page.',
    pdf: 'PDF (for printing)',
    png: 'PNG, 300 dpi',
    readyReview: 'Happy with the result? A few words from you help us a lot: just reply to this e-mail.',
    shippedSubject: 'Your order {number} has shipped',
    shippedHeading: 'Your map is on its way',
    shippedBody: 'Your order {number} has been dispatched.',
    tracking: 'Tracking',
    noTracking: 'As soon as we have a tracking number, it will appear on your order page.',
    track: 'Track your order',
    deliveredSubject: 'Your order {number} was delivered',
    deliveredHeading: 'Your map has arrived!',
    deliveredBody: "We hope you love your family map. If anything isn't perfect, reply to this e-mail and we'll put it right.",
    review: 'Could you tell us what you think? A short review helps other families find us and helps us improve.',
    reviewReply: 'Could you tell us what you think? Just reply to this e-mail: your words help other families find us and help us improve.',
    reviewButton: 'Leave a review',
    refundSubject: 'Refund for order {number}',
    refundHeading: 'Your refund is on its way',
    refundBody: "We've refunded {amount} for order {number} to your original payment method. Depending on your bank or card, it can take 5–10 business days to appear.",
  },
  es: {
    order: 'Pedido',
    product: 'Producto',
    map: 'Mapa',
    total: 'Total',
    view: 'Ver el pedido',
    footer: 'Recibiste este correo por un pedido hecho en {brand}. Si tienes cualquier duda, solo responde.',
    paidSubject: 'Pedido {number} confirmado',
    paidHeading: 'Recibimos tu pago',
    paidBody: '¡Gracias! Tu pedido {number} está confirmado. Ahora preparamos el archivo de tu mapa en alta resolución.',
    paidNextDigital: 'Te escribiremos en cuanto los archivos estén listos para descargar.',
    paidNextPrint: 'Después pasa a impresión, y te avisaremos cuando el pedido salga.',
    readySubject: 'Tu mapa está listo para descargar ({number})',
    readyHeading: 'Tu mapa está listo',
    readyBody: 'Los archivos de tu mapa en alta resolución ya se pueden descargar. Los enlaces valen hasta el {date}; después, puedes obtener enlaces nuevos en la página del pedido.',
    pdf: 'PDF (para imprimir)',
    png: 'PNG, 300 ppp',
    readyReview: '¿Te gustó el resultado? Tu opinión nos ayuda mucho: solo responde a este correo.',
    shippedSubject: 'Tu pedido {number} fue enviado',
    shippedHeading: 'Tu mapa está en camino',
    shippedBody: 'Tu pedido {number} ya fue despachado.',
    tracking: 'Seguimiento',
    noTracking: 'En cuanto tengamos el código de seguimiento, aparecerá en la página del pedido.',
    track: 'Seguir el pedido',
    deliveredSubject: 'Tu pedido {number} fue entregado',
    deliveredHeading: '¡Tu mapa llegó!',
    deliveredBody: 'Esperamos que te encante tu mapa familiar. Si algo no está perfecto, responde a este correo y lo solucionamos.',
    review: '¿Nos cuentas qué te pareció? Una reseña corta ayuda a otras familias a encontrarnos y nos ayuda a mejorar.',
    reviewReply: '¿Nos cuentas qué te pareció? Solo responde a este correo: tu opinión ayuda a otras familias a encontrarnos y nos ayuda a mejorar.',
    reviewButton: 'Dejar una reseña',
    refundSubject: 'Reembolso del pedido {number}',
    refundHeading: 'Hicimos tu reembolso',
    refundBody: 'Devolvimos {amount} del pedido {number} a tu medio de pago original. Según tu banco o tarjeta, puede tardar de 5 a 10 días hábiles en aparecer.',
  },
} satisfies Record<MailLang, Record<string, string>>;

function orderContent(o: OrderMailInfo, k: { subject: string; heading: string }, blocks: Block[], extraVars: Record<string, string> = {}): Rendered {
  const w = ORDER[o.lang];
  const brand = brandFor(o.lang, o.brand);
  const v = { number: o.number, brand, ...extraVars };
  const details: [string, string][] = [[w.order, o.number], [w.product, o.product], ...(o.title ? [[w.map, o.title] as [string, string]] : []), [w.total, o.total]];
  const filled = blocks.map((b) => ('p' in b ? { ...b, p: fill(b.p, v) } : b));
  const first = filled.find((b): b is { p: string } => 'p' in b);
  return render({
    lang: o.lang,
    brand,
    subject: fill(k.subject, v),
    preheader: first?.p ?? fill(k.heading, v),
    heading: fill(k.heading, v),
    blocks: [...filled, { details }],
    footer: fill(w.footer, v),
  });
}

export function orderPaidMail(o: OrderMailInfo): Rendered {
  const w = ORDER[o.lang];
  return orderContent(o, { subject: w.paidSubject, heading: w.paidHeading }, [
    { p: w.paidBody },
    { p: o.digital ? w.paidNextDigital : w.paidNextPrint },
    { button: { label: w.view, url: o.orderUrl } },
  ]);
}

export function fileReadyMail(o: OrderMailInfo, downloads: { pdf?: string; png?: string; expiresAt: string }): Rendered {
  const w = ORDER[o.lang];
  const links = [downloads.pdf && { label: w.pdf, url: downloads.pdf }, downloads.png && { label: w.png, url: downloads.png }].filter((l): l is { label: string; url: string } => !!l);
  return orderContent(
    o,
    { subject: w.readySubject, heading: w.readyHeading },
    [{ p: w.readyBody }, { links }, { button: { label: w.view, url: o.orderUrl } }, { p: w.readyReview, muted: true }],
    { date: formatMailDate(downloads.expiresAt, o.lang) },
  );
}

export function shippedMail(o: OrderMailInfo, tracking: { carrier?: string; number?: string; url?: string }[], trackingNote?: string): Rendered {
  const w = ORDER[o.lang];
  const lines: [string, string][] = tracking.map((t) => [w.tracking, [t.carrier, t.number, t.url && t.url !== t.number ? t.url : undefined].filter(Boolean).join(' · ')]);
  if (!lines.length && trackingNote) lines.push([w.tracking, trackingNote]);
  return orderContent(o, { subject: w.shippedSubject, heading: w.shippedHeading }, [
    { p: w.shippedBody },
    lines.length ? { details: lines } : { p: w.noTracking },
    { button: { label: w.track, url: o.orderUrl } },
  ]);
}

export function deliveredMail(o: OrderMailInfo, reviewUrl?: string): Rendered {
  const w = ORDER[o.lang];
  return orderContent(o, { subject: w.deliveredSubject, heading: w.deliveredHeading }, [
    { p: w.deliveredBody },
    ...(reviewUrl ? [{ p: w.review }, { button: { label: w.reviewButton, url: reviewUrl } }] : [{ p: w.reviewReply }, { button: { label: w.view, url: o.orderUrl } }]),
  ]);
}

export function refundedMail(o: OrderMailInfo, amount: string): Rendered {
  const w = ORDER[o.lang];
  return orderContent(o, { subject: w.refundSubject, heading: w.refundHeading }, [{ p: w.refundBody }, { button: { label: w.view, url: o.orderUrl } }], { amount });
}
