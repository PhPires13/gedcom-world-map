// The production sheet for manual fulfilment: one printable page an operator sends (or hands) to
// a local print lab and framer, with everything they need and nothing they don't.

import { formatMoney, type Product } from '../../src/commerce/catalogue';
import { describeDesign } from '../../src/commerce/design';
import { STATUS_LABELS } from '../../src/commerce/status';
import { loadPrintOptions } from '../print/assets';
import { PAPER_MM } from '../../src/print/geo';
import type { OrderRow } from './orders';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function productionSheet(o: OrderRow, product: Product | undefined, files: { png?: string; pdf?: string }): string {
  const [shortMm, longMm] = PAPER_MM[o.size];
  const landscape = o.design.orientation === 'landscape';
  const a = o.shippingAddress;
  const row = (k: string, v: string) => (v ? `<tr><th>${esc(k)}</th><td>${v}</td></tr>` : '');
  const d = describeDesign(o.design, loadPrintOptions());
  const px = o.files.widthPx ? `${o.files.widthPx} × ${o.files.heightPx} px (300 dpi)` : 'not made yet';
  return `<!doctype html>
<html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ficha de produção ${esc(o.number)}</title>
<style>
  body { font: 14px/1.45 system-ui, sans-serif; color: #222; max-width: 760px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 22px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  table { border-collapse: collapse; width: 100%; } th { text-align: left; width: 34%; color: #555; font-weight: 600; vertical-align: top; }
  th, td { padding: 4px 8px 4px 0; } .big { font-size: 18px; font-weight: 700; } .muted { color: #666; font-size: 12px; }
  .box { border: 2px solid #222; padding: 10px 14px; margin-top: 10px; } a { word-break: break-all; }
  @media print { .noprint { display: none; } body { margin: 0; } }
</style></head><body>
<p class="noprint"><button onclick="print()">Imprimir / Print</button></p>
<h1>Ficha de produção · Production sheet</h1>
<p class="big">${esc(o.number)} · ${esc(product?.name.pt ?? o.productId)} ${esc(o.size)}</p>
<p class="muted">Encomenda de ${esc(new Date(o.createdAt).toLocaleDateString('pt-BR'))} · estado: ${esc(STATUS_LABELS[o.status].pt)}</p>

<h2>O que produzir · What to make</h2>
<table>
${row('Produto · Product', esc(product?.name.pt ?? o.productId))}
${row('Formato · Size', `${esc(o.size)}: ${landscape ? `${longMm} × ${shortMm}` : `${shortMm} × ${longMm}`} mm, ${landscape ? 'paisagem (landscape)' : 'retrato (portrait)'}`)}
${row('Papel · Paper', esc(product?.material?.pt ?? ''))}
${row('Moldura · Frame', o.kind === 'framed' ? `${esc(o.frameColour ?? '')}, com passe-partout e vidro` : 'sem moldura (enrolar em tubo)')}
${row('Desenho · Design', `${esc(d.style)} · layout ${esc(d.layout)} · moldura desenhada ${esc(d.border)} · acabamento ${esc(d.finish)}`)}
${row('Impressão · Print', 'Giclée, 100% sem margens, sem redimensionar; perfil sRGB. Print at 100%, no scaling, borderless.')}
${row('Ficheiro · File', `${px}`)}
${row('PNG', files.png ? `<a href="${esc(files.png)}">${esc(files.png)}</a>` : 'ainda não disponível')}
${row('PDF', files.pdf ? `<a href="${esc(files.pdf)}">${esc(files.pdf)}</a>` : '')}
</table>
<p class="muted">Os links expiram em 30 dias; peça um novo na página de operações. Links expire in 30 days.</p>

<h2>Enviar para · Ship to</h2>
${
  a
    ? `<div class="box">${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? `<br>${esc(a.line2)}` : ''}<br>${esc(a.postalCode)} ${esc(a.city)}${a.state ? ` – ${esc(a.state)}` : ''}<br>${esc(a.country)}${a.phone ? `<br>Tel. ${esc(a.phone)}` : ''}${a.taxId ? `<br>CPF/CNPJ ${esc(a.taxId)}` : ''}</div>`
    : '<p>(produto digital: sem envio)</p>'
}
<p class="muted">Contacto do cliente: ${esc(o.email)} · valor declarado: ${esc(formatMoney(o.totalAmount, o.currency))}</p>

<h2>Depois · Afterwards</h2>
<p>Quando o laboratório aceitar o trabalho, marque a encomenda como <b>Em produção</b>; quando sair, <b>Enviado</b> (com o código de rastreio na nota); quando chegar, <b>Entregue</b>.</p>
</body></html>`;
}
