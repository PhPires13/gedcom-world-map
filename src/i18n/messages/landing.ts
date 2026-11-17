// Words of the sales landing page (index.html / src/landing/landing.ts), in Portuguese (reference),
// English and Spanish. Keys ending in ".html" style answers are used with data-i18n-html (trusted
// markup written here, with links to the site's own pages only).
//
// PLACEHOLDERS for the owner to confirm before launch: delivery times (faq.delivery.a) and the
// returns promise (faq.returns.a).

import type { Messages } from '../core';

const pt = {
  'meta.title': 'Mapa da Família — a jornada da sua família em um mapa para pendurar na parede',
  'meta.description':
    'Transforme sua árvore genealógica em um mapa antigo emoldurado com as rotas de migração, as bandeiras e o sobrenome da sua família. Feito sob medida, impresso em papel fine-art.',
  brand: 'Mapa da Família',
  'nav.label': 'Navegação principal',
  'nav.how': 'Como funciona',
  'nav.styles': 'Estilos',
  'nav.prices': 'Preços',
  'nav.faq': 'Dúvidas',
  'nav.cta': 'Criar meu mapa',

  'hero.eyebrow': 'Mapa genealógico personalizado',
  'hero.title': 'A jornada da sua família em um mapa para pendurar na parede',
  'hero.lead':
    'De onde vieram seus bisavós? Transformamos sua árvore genealógica em um mapa de estilo antigo, com as rotas de migração, as bandeiras de cada terra e o sobrenome da família no cartucho. Impresso em papel fine-art e entregue emoldurado.',
  'hero.cta': 'Criar meu mapa',
  'hero.secondary': 'Ver o mapa interativo grátis',
  'hero.point1': 'Pessoas vivas nunca são impressas',
  'hero.point2': 'Papel de algodão com qualidade de museu',
  'hero.point3': 'Chega pronto para pendurar',
  'hero.imageAlt': 'Exemplo de mapa da família emoldurado, em estilo Pergaminho antigo, com os países da família em destaque',
  'hero.frameCaption': 'Pergaminho antigo · Países da família',

  'how.title': 'Como funciona',
  'how.lead': 'Do arquivo da árvore ao quadro na parede, em quatro passos.',
  'how.1.title': 'Traga sua árvore',
  'how.1.text':
    'Envie o arquivo GEDCOM do FamilySearch, MyHeritage ou Ancestry. Ainda não tem árvore? Mostramos como começar do zero em poucos minutos.',
  'how.2.title': 'Veja as rotas',
  'how.2.text':
    'Encontramos no mapa os lugares de nascimento e desenhamos as viagens de cada geração, de um continente a outro.',
  'how.3.title': 'Escolha o estilo',
  'how.3.text': 'Pergaminho antigo, carta náutica, moderno… Ajuste a área, a borda, as cores e o texto do cartucho, com a prévia ao vivo.',
  'how.4.title': 'Receba emoldurado',
  'how.4.text': 'Imprimimos em papel fine-art, emolduramos e enviamos para sua casa, pronto para pendurar ou presentear.',

  'styles.title': 'Escolha o estilo do seu mapa',
  'styles.lead': 'Cada estilo é desenhado com a sua família: os lugares, as rotas e o sobrenome são só seus.',
  'styles.try': 'Experimentar este estilo',
  'styles.tryLayout': 'Criar o mapa dos meus países',
  'style.homelands.name': 'Países da família',
  'style.homelands.desc':
    'Só as terras da sua família, desenhadas em destaque e próximas umas das outras, na direção real de cada uma. Combina com qualquer estilo.',
  'style.antique.name': 'Pergaminho antigo',
  'style.antique.desc': 'Papel envelhecido e rotas a tinta, como um atlas do século XVIII.',
  'style.nautical.name': 'Carta náutica',
  'style.nautical.desc': 'Linhas de rumo e rosa dos ventos, em azul-marinho sobre creme.',
  'style.modern.name': 'Moderno minimalista',
  'style.modern.desc': 'Terra em cinza-claro e rotas em cores vivas sobre papel quase branco.',
  'style.portolan.name': 'Carta portulana',
  'style.portolan.desc': 'Como as cartas dos navegadores portugueses, com rosas dos ventos e linhas de rumo.',
  'style.leather.name': 'Couro gravado',
  'style.leather.desc': 'Tons quentes de couro curtido, com relevo e dourado.',
  'style.woodburn.name': 'Madeira pirogravada',
  'style.woodburn.desc': 'Traços queimados em madeira clara, rústico e acolhedor.',
  'style.explorer.name': 'Diário de explorador',
  'style.explorer.desc': 'Um mapa de expedição, com anotações à mão e trajetos marcados.',

  'origins.title': 'Toda família tem uma travessia',
  'origins.lead': 'Algumas das histórias que mais aparecem nos mapas dos nossos clientes.',
  'origins.cta': 'Criar o mapa da minha família',
  'origin.pt.title': 'Famílias portuguesas no Brasil',
  'origin.pt.text': 'Do Minho, de Trás-os-Montes, dos Açores e da Madeira para o Rio, São Paulo e o Sul, de navio, geração após geração.',
  'origin.it.title': 'Italianos no Brasil',
  'origin.it.text': 'Do Vêneto, da Calábria e da Lombardia para as fazendas de café e as colônias da serra gaúcha.',
  'origin.es.title': 'Espanhóis na América Latina',
  'origin.es.text': 'Da Galícia, das Astúrias e das Canárias para Buenos Aires, Havana, Montevidéu e São Paulo.',

  'prices.title': 'Escolha como receber',
  'prices.lead': 'Preços na sua moeda. O valor final, com frete, aparece antes do pagamento.',
  'prices.from': 'a partir de',
  'prices.sizes': 'Tamanhos: {sizes}',
  'prices.shipping': '+ {amount} de frete',
  'prices.shippingIncl': 'Frete incluso',
  'prices.loading': 'Carregando preços…',
  'prices.unavailable': 'Veja o preço no editor, antes de pagar',
  'prices.placeholder': 'Preços de lançamento, ainda sujeitos a ajuste.',
  'prices.popular': 'Mais escolhido',
  'prices.cta': 'Criar meu mapa',
  'product.digital.name': 'Mapa digital',
  'product.digital.desc': 'PDF e PNG em alta resolução, para baixar logo após o pagamento e imprimir onde quiser.',
  'product.print.name': 'Impressão fine-art',
  'product.print.desc': 'Giclée em papel de algodão com qualidade de museu, enviada enrolada em um tubo.',
  'product.framed.name': 'Quadro emoldurado',
  'product.framed.desc': 'A impressão fine-art com passe-partout, em moldura de madeira, pronta para pendurar.',

  'gift.title': 'Um presente que ninguém mais vai dar',
  'gift.text':
    'Para os pais, para os avós, para quem guarda as histórias da família. Um mapa com o sobrenome deles e o caminho que os trouxe até aqui emociona na hora de abrir e fica na parede por gerações.',
  'gift.occasion1': 'Natal',
  'gift.occasion2': 'Dia das Mães e dos Pais',
  'gift.occasion3': 'Aniversários e bodas',
  'gift.occasion4': 'Reencontros de família',
  'gift.cta': 'Criar um presente',
  'gift.card': 'Dar um vale-presente',

  'trust.title': 'Feito com cuidado',
  'trust.privacy.title': 'Privacidade em primeiro lugar',
  'trust.privacy.text':
    'Pessoas vivas nunca são impressas: o mapa usa só a visualização pública da árvore. Seu arquivo é seu, e o mapa interativo funciona no seu navegador.',
  'trust.paper.title': 'Qualidade de museu',
  'trust.paper.text': 'Impressão giclée em papel 100% algodão, com tintas pigmentadas que duram décadas sem desbotar.',
  'trust.delivery.title': 'Entrega acompanhada',
  'trust.delivery.text': 'Embalagem reforçada e código de rastreio. Você acompanha cada etapa do pedido, da impressão à entrega.',

  'faq.title': 'Dúvidas frequentes',
  'faq.gedcom.q': 'O que é um arquivo GEDCOM?',
  'faq.gedcom.a':
    'É o formato padrão de árvores genealógicas (arquivo <b>.ged</b>). Todos os grandes sites de genealogia exportam a árvore nesse formato, com nomes, datas e lugares.',
  'faq.export.q': 'Como exporto minha árvore do FamilySearch, MyHeritage ou Ancestry?',
  'faq.export.a':
    '<b>MyHeritage:</b> Árvore genealógica → Gerenciar árvores → Exportar para GEDCOM.<br><b>Ancestry:</b> abra a árvore → Configurações da árvore → Exportar árvore → Baixar o arquivo GEDCOM.<br><b>FamilySearch:</b> a Árvore Familiar não exporta GEDCOM diretamente; use um programa parceiro (como RootsMagic ou Ancestral Quest) para baixar sua parte da árvore e exportar o .ged.',
  'faq.noTree.q': 'Não tenho árvore genealógica. E agora?',
  'faq.noTree.a':
    'Comece do zero de graça no FamilySearch ou no MyHeritage: com pais, avós e bisavós e os lugares onde nasceram, já sai um belo mapa. Quer ver como fica antes? <a href="app.html">Abra o mapa interativo</a> e experimente a árvore de exemplo.',
  'faq.delivery.q': 'Quanto tempo demora a entrega?',
  'faq.delivery.a':
    'O quadro é impresso e emoldurado em até 5 dias úteis. A entrega leva em geral de 5 a 12 dias úteis no Brasil e em Portugal, conforme o endereço; o prazo do seu pedido aparece antes do pagamento. O mapa digital chega na hora.',
  'faq.returns.q': 'E se algo der errado?',
  'faq.returns.a':
    'Se o quadro chegar danificado ou com defeito de impressão, refazemos e enviamos de novo, sem custo. Como cada mapa é feito sob medida, revise a prévia com calma antes de pagar; em caso de dúvida, fale com a gente pelo seu pedido.',
  'faq.edit.q': 'Posso ver e ajustar o mapa antes de comprar?',
  'faq.edit.a': 'Sim. O editor mostra a prévia exata do que será impresso, e você pode mudar estilo, área, cores e textos quantas vezes quiser.',

  'final.title': 'Pronto para ver de onde sua família veio?',
  'final.text': 'Crie a prévia de graça. Você só paga quando o mapa estiver do seu jeito.',

  'footer.tagline': 'Mapas genealógicos feitos sob medida, para pendurar na parede.',
  'footer.product': 'Produto',
  'footer.designer': 'Criar meu mapa',
  'footer.app': 'Mapa interativo',
  'footer.tree': 'Árvore genealógica',
  'footer.help': 'Ajuda',
  'footer.rights': '© {year} Mapa da Família',
};
type Key = keyof typeof pt;

const en: Record<Key, string> = {
  'meta.title': 'Heritage Map — your family’s journey on a map to hang on the wall',
  'meta.description':
    'Turn your family tree into a framed antique-style map with your family’s migration routes, flags and surname. Made to order, printed on fine-art paper.',
  brand: 'Heritage Map',
  'nav.label': 'Main navigation',
  'nav.how': 'How it works',
  'nav.styles': 'Styles',
  'nav.prices': 'Prices',
  'nav.faq': 'FAQ',
  'nav.cta': 'Create my map',

  'hero.eyebrow': 'Personalised family history map',
  'hero.title': 'Your family’s journey on a map to hang on the wall',
  'hero.lead':
    'Where did your great-grandparents come from? We turn your family tree into an antique-style map with the migration routes, the flag of each homeland and your family name in the cartouche. Printed on fine-art paper and delivered framed.',
  'hero.cta': 'Create my map',
  'hero.secondary': 'Try the interactive map for free',
  'hero.point1': 'Living people are never printed',
  'hero.point2': 'Museum-grade cotton paper',
  'hero.point3': 'Arrives ready to hang',
  'hero.imageAlt': 'Example of a framed family map in the Antique parchment style, with the family’s countries drawn large',
  'hero.frameCaption': 'Antique parchment · Family homelands',

  'how.title': 'How it works',
  'how.lead': 'From your tree file to a frame on the wall, in four steps.',
  'how.1.title': 'Bring your tree',
  'how.1.text':
    'Upload the GEDCOM file from FamilySearch, MyHeritage or Ancestry. No tree yet? We show you how to start from scratch in a few minutes.',
  'how.2.title': 'See the routes',
  'how.2.text': 'We place every birthplace on the map and draw each generation’s journeys, from one continent to another.',
  'how.3.title': 'Choose a style',
  'how.3.text': 'Antique parchment, nautical chart, modern… Adjust the area, border, colours and cartouche text with a live preview.',
  'how.4.title': 'Receive it framed',
  'how.4.text': 'We print it on fine-art paper, frame it and ship it to your door, ready to hang or to give.',

  'styles.title': 'Choose your map’s style',
  'styles.lead': 'Every style is drawn with your family: the places, the routes and the surname are yours alone.',
  'styles.try': 'Try this style',
  'styles.tryLayout': 'Map my family’s countries',
  'style.homelands.name': 'Family homelands',
  'style.homelands.desc':
    'Only your family’s countries, drawn large and close together, each in its real direction from the others. Works with every style.',
  'style.antique.name': 'Antique parchment',
  'style.antique.desc': 'Aged paper and inked routes, like an 18th-century atlas.',
  'style.nautical.name': 'Nautical chart',
  'style.nautical.desc': 'Rhumb lines and a compass rose, in navy ink on cream.',
  'style.modern.name': 'Modern minimal',
  'style.modern.desc': 'Light grey land and bright routes on near-white paper.',
  'style.portolan.name': 'Portolan chart',
  'style.portolan.desc': 'Like the Portuguese navigators’ charts, with compass roses and rhumb lines.',
  'style.leather.name': 'Tooled leather',
  'style.leather.desc': 'Warm tanned-leather tones with embossing and gold.',
  'style.woodburn.name': 'Pyrography on wood',
  'style.woodburn.desc': 'Lines burnt into pale wood, rustic and warm.',
  'style.explorer.name': 'Explorer’s journal',
  'style.explorer.desc': 'An expedition map with handwritten notes and marked trails.',

  'origins.title': 'Every family has a crossing',
  'origins.lead': 'Some of the stories we see most often on our customers’ maps.',
  'origins.cta': 'Create my family’s map',
  'origin.pt.title': 'Portuguese families in Brazil',
  'origin.pt.text': 'From the Minho, Trás-os-Montes, the Azores and Madeira to Rio, São Paulo and the South, by ship, generation after generation.',
  'origin.it.title': 'Italians in Brazil',
  'origin.it.text': 'From Veneto, Calabria and Lombardy to the coffee farms and the colonies of the southern highlands.',
  'origin.es.title': 'Spaniards in Latin America',
  'origin.es.text': 'From Galicia, Asturias and the Canary Islands to Buenos Aires, Havana, Montevideo and São Paulo.',

  'prices.title': 'Choose how to receive it',
  'prices.lead': 'Prices in your currency. The final amount, with shipping, is shown before you pay.',
  'prices.from': 'from',
  'prices.sizes': 'Sizes: {sizes}',
  'prices.shipping': '+ {amount} shipping',
  'prices.shippingIncl': 'Shipping included',
  'prices.loading': 'Loading prices…',
  'prices.unavailable': 'See the price in the designer, before you pay',
  'prices.placeholder': 'Launch prices, still subject to change.',
  'prices.popular': 'Most popular',
  'prices.cta': 'Create my map',
  'product.digital.name': 'Digital map',
  'product.digital.desc': 'High-resolution PDF and PNG to download right after payment and print anywhere.',
  'product.print.name': 'Fine-art print',
  'product.print.desc': 'Giclée on museum-grade cotton paper, shipped rolled in a tube.',
  'product.framed.name': 'Framed print',
  'product.framed.desc': 'The fine-art print with a mount, in a wood frame, ready to hang.',

  'gift.title': 'A gift no one else will give',
  'gift.text':
    'For parents, for grandparents, for whoever keeps the family stories. A map with their surname and the road that brought them here moves people the moment they open it, and stays on the wall for generations.',
  'gift.occasion1': 'Christmas',
  'gift.occasion2': 'Mother’s and Father’s Day',
  'gift.occasion3': 'Birthdays and anniversaries',
  'gift.occasion4': 'Family reunions',
  'gift.cta': 'Create a gift',
  'gift.card': 'Give a gift card',

  'trust.title': 'Made with care',
  'trust.privacy.title': 'Privacy first',
  'trust.privacy.text':
    'Living people are never printed: the map only uses your tree’s public view. Your file is yours, and the interactive map runs in your browser.',
  'trust.paper.title': 'Museum quality',
  'trust.paper.text': 'Giclée printing on 100% cotton paper with pigment inks that last for decades without fading.',
  'trust.delivery.title': 'Tracked delivery',
  'trust.delivery.text': 'Sturdy packaging and a tracking number. Follow every step of your order, from printing to delivery.',

  'faq.title': 'Questions',
  'faq.gedcom.q': 'What is a GEDCOM file?',
  'faq.gedcom.a':
    'It is the standard format for family trees (a <b>.ged</b> file). Every major genealogy site exports your tree in it, with names, dates and places.',
  'faq.export.q': 'How do I export my tree from FamilySearch, MyHeritage or Ancestry?',
  'faq.export.a':
    '<b>MyHeritage:</b> Family tree → Manage trees → Export to GEDCOM.<br><b>Ancestry:</b> open the tree → Tree settings → Export tree → Download your GEDCOM file.<br><b>FamilySearch:</b> Family Tree does not export GEDCOM directly; use a partner program (such as RootsMagic or Ancestral Quest) to download your part of the tree and export the .ged.',
  'faq.noTree.q': 'I don’t have a family tree. What now?',
  'faq.noTree.a':
    'Start from scratch for free on FamilySearch or MyHeritage: parents, grandparents and great-grandparents with their birthplaces already make a beautiful map. Want to see it first? <a href="app.html">Open the interactive map</a> and try the sample tree.',
  'faq.delivery.q': 'How long does delivery take?',
  'faq.delivery.a':
    'The frame is printed and assembled within 5 working days. Delivery usually takes 5 to 12 working days in Brazil and Portugal, depending on the address; your order’s estimate is shown before you pay. The digital map arrives instantly.',
  'faq.returns.q': 'What if something goes wrong?',
  'faq.returns.a':
    'If your frame arrives damaged or with a printing defect, we remake and resend it at no cost. As every map is made to order, take your time with the preview before paying; if in doubt, contact us from your order.',
  'faq.edit.q': 'Can I see and adjust the map before buying?',
  'faq.edit.a': 'Yes. The designer shows an exact preview of the print, and you can change the style, area, colours and text as often as you like.',

  'final.title': 'Ready to see where your family came from?',
  'final.text': 'Create the preview for free. You only pay when the map is just right.',

  'footer.tagline': 'Made-to-order family history maps, to hang on the wall.',
  'footer.product': 'Product',
  'footer.designer': 'Create my map',
  'footer.app': 'Interactive map',
  'footer.tree': 'Family tree',
  'footer.help': 'Help',
  'footer.rights': '© {year} Heritage Map',
};

const es: Record<Key, string> = {
  'meta.title': 'Mapa Familiar — el viaje de tu familia en un mapa para colgar en la pared',
  'meta.description':
    'Convierte tu árbol genealógico en un mapa antiguo enmarcado con las rutas de migración, las banderas y el apellido de tu familia. Hecho a medida, impreso en papel fine art.',
  brand: 'Mapa Familiar',
  'nav.label': 'Navegación principal',
  'nav.how': 'Cómo funciona',
  'nav.styles': 'Estilos',
  'nav.prices': 'Precios',
  'nav.faq': 'Preguntas',
  'nav.cta': 'Crear mi mapa',

  'hero.eyebrow': 'Mapa genealógico personalizado',
  'hero.title': 'El viaje de tu familia en un mapa para colgar en la pared',
  'hero.lead':
    '¿De dónde vinieron tus bisabuelos? Convertimos tu árbol genealógico en un mapa de estilo antiguo, con las rutas de migración, la bandera de cada tierra y el apellido de la familia en la cartela. Impreso en papel fine art y entregado enmarcado.',
  'hero.cta': 'Crear mi mapa',
  'hero.secondary': 'Ver el mapa interactivo gratis',
  'hero.point1': 'Las personas vivas nunca se imprimen',
  'hero.point2': 'Papel de algodón con calidad de museo',
  'hero.point3': 'Llega listo para colgar',
  'hero.imageAlt': 'Ejemplo de mapa familiar enmarcado, en estilo Pergamino antiguo, con los países de la familia en grande',
  'hero.frameCaption': 'Pergamino antiguo · Países de la familia',

  'how.title': 'Cómo funciona',
  'how.lead': 'Del archivo del árbol al cuadro en la pared, en cuatro pasos.',
  'how.1.title': 'Trae tu árbol',
  'how.1.text':
    'Sube el archivo GEDCOM de FamilySearch, MyHeritage o Ancestry. ¿Aún no tienes árbol? Te mostramos cómo empezar desde cero en pocos minutos.',
  'how.2.title': 'Mira las rutas',
  'how.2.text': 'Ubicamos en el mapa los lugares de nacimiento y dibujamos los viajes de cada generación, de un continente a otro.',
  'how.3.title': 'Elige el estilo',
  'how.3.text': 'Pergamino antiguo, carta náutica, moderno… Ajusta el área, el borde, los colores y el texto de la cartela, con vista previa en vivo.',
  'how.4.title': 'Recíbelo enmarcado',
  'how.4.text': 'Lo imprimimos en papel fine art, lo enmarcamos y lo enviamos a tu casa, listo para colgar o regalar.',

  'styles.title': 'Elige el estilo de tu mapa',
  'styles.lead': 'Cada estilo se dibuja con tu familia: los lugares, las rutas y el apellido son solo tuyos.',
  'styles.try': 'Probar este estilo',
  'styles.tryLayout': 'Crear el mapa de mis países',
  'style.homelands.name': 'Países de la familia',
  'style.homelands.desc':
    'Solo las tierras de tu familia, dibujadas en grande y cerca unas de otras, cada una en su dirección real. Combina con cualquier estilo.',
  'style.antique.name': 'Pergamino antiguo',
  'style.antique.desc': 'Papel envejecido y rutas en tinta, como un atlas del siglo XVIII.',
  'style.nautical.name': 'Carta náutica',
  'style.nautical.desc': 'Líneas de rumbo y rosa de los vientos, en azul marino sobre crema.',
  'style.modern.name': 'Moderno minimalista',
  'style.modern.desc': 'Tierra gris claro y rutas de colores vivos sobre papel casi blanco.',
  'style.portolan.name': 'Carta portulana',
  'style.portolan.desc': 'Como las cartas de los navegantes portugueses, con rosas de los vientos y líneas de rumbo.',
  'style.leather.name': 'Cuero repujado',
  'style.leather.desc': 'Tonos cálidos de cuero curtido, con relieve y dorado.',
  'style.woodburn.name': 'Pirograbado en madera',
  'style.woodburn.desc': 'Trazos quemados en madera clara, rústico y cálido.',
  'style.explorer.name': 'Diario de explorador',
  'style.explorer.desc': 'Un mapa de expedición, con notas a mano y trayectos marcados.',

  'origins.title': 'Toda familia tiene una travesía',
  'origins.lead': 'Algunas de las historias que más aparecen en los mapas de nuestros clientes.',
  'origins.cta': 'Crear el mapa de mi familia',
  'origin.pt.title': 'Familias portuguesas en Brasil',
  'origin.pt.text': 'Del Miño, Trás-os-Montes, las Azores y Madeira a Río, São Paulo y el Sur, en barco, generación tras generación.',
  'origin.it.title': 'Italianos en Brasil',
  'origin.it.text': 'Del Véneto, Calabria y Lombardía a las haciendas de café y las colonias de la sierra gaúcha.',
  'origin.es.title': 'Españoles en América Latina',
  'origin.es.text': 'De Galicia, Asturias y Canarias a Buenos Aires, La Habana, Montevideo y São Paulo.',

  'prices.title': 'Elige cómo recibirlo',
  'prices.lead': 'Precios en tu moneda. El importe final, con envío, aparece antes del pago.',
  'prices.from': 'desde',
  'prices.sizes': 'Tamaños: {sizes}',
  'prices.shipping': '+ {amount} de envío',
  'prices.shippingIncl': 'Envío incluido',
  'prices.loading': 'Cargando precios…',
  'prices.unavailable': 'Mira el precio en el editor, antes de pagar',
  'prices.placeholder': 'Precios de lanzamiento, aún sujetos a cambios.',
  'prices.popular': 'El más elegido',
  'prices.cta': 'Crear mi mapa',
  'product.digital.name': 'Mapa digital',
  'product.digital.desc': 'PDF y PNG en alta resolución, para descargar justo después del pago e imprimir donde quieras.',
  'product.print.name': 'Impresión fine art',
  'product.print.desc': 'Giclée en papel de algodón con calidad de museo, enviada enrollada en un tubo.',
  'product.framed.name': 'Cuadro enmarcado',
  'product.framed.desc': 'La impresión fine art con paspartú, en marco de madera, lista para colgar.',

  'gift.title': 'Un regalo que nadie más va a dar',
  'gift.text':
    'Para los padres, para los abuelos, para quien guarda las historias de la familia. Un mapa con su apellido y el camino que los trajo hasta aquí emociona al abrirlo y queda en la pared por generaciones.',
  'gift.occasion1': 'Navidad',
  'gift.occasion2': 'Día de la Madre y del Padre',
  'gift.occasion3': 'Cumpleaños y aniversarios',
  'gift.occasion4': 'Reuniones familiares',
  'gift.cta': 'Crear un regalo',
  'gift.card': 'Regalar una tarjeta regalo',

  'trust.title': 'Hecho con cuidado',
  'trust.privacy.title': 'La privacidad primero',
  'trust.privacy.text':
    'Las personas vivas nunca se imprimen: el mapa usa solo la vista pública del árbol. Tu archivo es tuyo, y el mapa interactivo funciona en tu navegador.',
  'trust.paper.title': 'Calidad de museo',
  'trust.paper.text': 'Impresión giclée en papel 100 % algodón, con tintas pigmentadas que duran décadas sin decolorarse.',
  'trust.delivery.title': 'Envío con seguimiento',
  'trust.delivery.text': 'Embalaje reforzado y número de seguimiento. Sigues cada etapa del pedido, de la impresión a la entrega.',

  'faq.title': 'Preguntas frecuentes',
  'faq.gedcom.q': '¿Qué es un archivo GEDCOM?',
  'faq.gedcom.a':
    'Es el formato estándar de los árboles genealógicos (un archivo <b>.ged</b>). Todos los grandes sitios de genealogía exportan el árbol en este formato, con nombres, fechas y lugares.',
  'faq.export.q': '¿Cómo exporto mi árbol de FamilySearch, MyHeritage o Ancestry?',
  'faq.export.a':
    '<b>MyHeritage:</b> Árbol genealógico → Administrar árboles → Exportar a GEDCOM.<br><b>Ancestry:</b> abre el árbol → Configuración del árbol → Exportar árbol → Descargar el archivo GEDCOM.<br><b>FamilySearch:</b> el Árbol Familiar no exporta GEDCOM directamente; usa un programa asociado (como RootsMagic o Ancestral Quest) para descargar tu parte del árbol y exportar el .ged.',
  'faq.noTree.q': 'No tengo árbol genealógico. ¿Y ahora?',
  'faq.noTree.a':
    'Empieza desde cero gratis en FamilySearch o MyHeritage: con padres, abuelos y bisabuelos y sus lugares de nacimiento ya sale un mapa precioso. ¿Quieres verlo antes? <a href="app.html">Abre el mapa interactivo</a> y prueba el árbol de ejemplo.',
  'faq.delivery.q': '¿Cuánto tarda la entrega?',
  'faq.delivery.a':
    'El cuadro se imprime y enmarca en hasta 5 días hábiles. La entrega suele tardar de 5 a 12 días hábiles en Brasil y Portugal, según la dirección; el plazo de tu pedido aparece antes del pago. El mapa digital llega al instante.',
  'faq.returns.q': '¿Y si algo sale mal?',
  'faq.returns.a':
    'Si el cuadro llega dañado o con un defecto de impresión, lo rehacemos y lo enviamos de nuevo sin costo. Como cada mapa se hace a medida, revisa la vista previa con calma antes de pagar; si tienes dudas, escríbenos desde tu pedido.',
  'faq.edit.q': '¿Puedo ver y ajustar el mapa antes de comprar?',
  'faq.edit.a': 'Sí. El editor muestra la vista previa exacta de lo que se imprimirá, y puedes cambiar el estilo, el área, los colores y los textos cuantas veces quieras.',

  'final.title': '¿Listo para ver de dónde vino tu familia?',
  'final.text': 'Crea la vista previa gratis. Solo pagas cuando el mapa esté a tu gusto.',

  'footer.tagline': 'Mapas genealógicos hechos a medida, para colgar en la pared.',
  'footer.product': 'Producto',
  'footer.designer': 'Crear mi mapa',
  'footer.app': 'Mapa interactivo',
  'footer.tree': 'Árbol genealógico',
  'footer.help': 'Ayuda',
  'footer.rights': '© {year} Mapa Familiar',
};

export type LandingKey = Key;

export const landingMessages = { pt, en, es } satisfies Messages<Key>;
