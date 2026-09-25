/*
 * Anúncios ML — LISTAGEM UNIFICADA.
 *
 * A tela tinha duas listagens ("Famílias" e "Sem agrupamento"), cada uma com
 * paginação própria, e um anúncio trocava de bloco quando o Mercado Livre
 * migrava o item para o modelo de User Products — sem nada ter mudado no
 * anúncio. A família é forma de agrupamento interno do ML, não categoria de
 * tela. Ver docs/AUDITORIA_ANUNCIOS_ML_LISTAGEM_UNIFICADA.md.
 *
 * O que só um navegador comprova, e por isso está aqui:
 *
 *   · existe UMA lista: agrupador e anúncio individual são linhas irmãs da
 *     mesma tabela, na mesma grade, sem aba, sem segundo container e sem
 *     segunda paginação;
 *   · a tela NÃO chama mais GET /anuncios-meli? (a listagem plana) — se
 *     chamasse, seria a segunda lista voltando;
 *   · o estoque do agrupador é a SOMA dos MLBUs, e não a soma dos MLBs: o
 *     fixture tem um MLBU com 2 anúncios de propósito, então somar por MLB
 *     daria 400 onde o certo é 300;
 *   · só o agrupador e o anúncio LEGADO com variações (variations_count > 0)
 *     expandem; um anúncio simples abre o modal direto, sem chevron nenhum;
 *   · o anúncio legado (item_id -> variations[] do ML, sem User Product)
 *     expande as variações DIRETO como filhas da própria linha — nenhum
 *     nível de família/UP fake entre elas. O clique fica no botão-toggle, não
 *     na linha (que continua abrindo o modal como qualquer outra);
 *   · nenhum PAINEL abre sozinho (ver MLBs, editar estoque continuam exigindo
 *     clique) — mas o DETALHE de cada agrupador visível é buscado sozinho em
 *     BACKGROUND assim que a página pinta, só para somar as métricas 7d na
 *     linha-mãe sem exigir clique nenhum; a primeira expansão de verdade
 *     reaproveita esse cache (gasta 0 requisições de detalhe) e busca só a
 *     margem, que o pré-carregamento NUNCA pede;
 *   · colapsar e reabrir o mesmo agrupador NÃO gasta requisição (cache);
 *   · abrir o agrupador A e o B antes de A responder não deixa a resposta
 *     atrasada de A pintar o painel de B (guarda por family_id);
 *   · trocar de conta invalida o cache — o agrupador do contexto anterior não
 *     pode reaparecer com os dados velhos (guarda de época);
 *   · a hierarquia da TELA é a da listagem oficial do ML, agrupador ->
 *     variação -> MLB, e o peso de cada nível importa: a variação se chama
 *     pelo NOME amigável ("Azul P") e o MLBU é legenda do tamanho de um SKU.
 *     Já houve os dois extremos aqui — uma faixa "PRODUTO MLBU-…" com o MLBU
 *     de manchete, e nenhum cabeçalho — e nenhum dos dois é o que se quer;
 *   · o nome da variação sai do TÍTULO, pela composição que o ML documenta
 *     (title = family_name + valores dos atributos que variam), e quando o
 *     título não está nessa forma o nome é o título INTEIRO — nunca um recorte
 *     adivinhado;
 *   · o identificador que a linha principal mostra é o do AGRUPADOR;
 *   · uma variação com 2 MLBs aparece UMA vez, com os dois anúncios abaixo
 *     dela e Clássico antes de Premium — sem depender disso: o padrão é
 *     preferência de ordem, e 1 ou 3 MLBs continuam funcionando;
 *   · clicar numa linha MLB do agrupador abre o MESMO modal da lista;
 *   · o estoque se edita NA LINHA do MLB, e o efeito respeita a regra do ML:
 *     available_quantity é replicado entre os itens do mesmo user_product_id,
 *     então salvar pelo Clássico move o Premium da mesma variação junto — e
 *     só ele, nunca outra variação da família. A lista de irmãos vem do
 *     servidor; o agregado do agrupador é recalculado somando por MLBU;
 *   · sair do campo de estoque NÃO salva (só Enter salva): é escrita num
 *     anúncio real, e uma recusa do ML devolve a célula ao valor anterior;
 *   · a capa do agrupador é a que o backend escolheu (cover.thumbnail):
 *     aparece com ele FECHADO, sobrevive à expansão e acompanha a busca — o
 *     front nunca recalcula a capa a partir dos itens;
 *   · NENHUM card de KPI fica desabilitado (era metade deles, em cada aba), e
 *     clicar num card recorta a lista única;
 *   · Métricas últ. 7 dias (views/vendas/conversão) e Margem são colunas
 *     PRÓPRIAS, carregadas DEPOIS que a linha já está na tela — nunca
 *     bloqueiam a abertura da página nem a expansão de um agrupador. A
 *     célula nasce "carregando" e se resolve sozinha quando a resposta
 *     chega; falha vira "—", nunca fica presa;
 *   · a busca de performance dos itens AVULSOS só pede os visíveis da
 *     página atual, sempre métricas + margem juntas;
 *   · a soma de métricas 7d do AGRUPADOR aparece sozinha, em background,
 *     assim que a família aparece na página — sem exigir clique. Ela nasce
 *     "carregando" (nunca uma soma parcial) e vira "—" só se a busca
 *     realmente falhar. Expandir de verdade não refaz essa chamada — só
 *     busca a margem que falta, e só dos filhos daquela família (nenhuma
 *     chamada de margem para MLB dentro de um agrupador ainda fechado).
 *     Reabrir uma família já conhecida, ou repintar uma linha depois de
 *     editar o estoque, lê do cache — não refaz chamada nenhuma;
 *   · margem NUNCA aparece na linha do agrupador (só existe por MLB, sem
 *     exceção para soma nem média — margem enganosa é pior que ausente, e
 *     nunca é buscada para um filho ainda oculto), e o texto de estado
 *     (quando não há número) é o vocabulário REAL do Motor de Margem —
 *     nunca um rótulo inventado nesta tela;
 *   · a soma de métricas 7d sobrevive a colapsar o painel — ela não depende
 *     de o painel estar visível, só de o cache já conhecer todos os filhos.
 */
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const PORTAL_DIR = __dirname;
const PROD_HOST = "venforce-server.onrender.com";

const N97 = { id: 87, nome: "N97 Comercial", slug: "n97", ativo: true, temGrant: true, grantStatus: "conectado", temBase: true, setupScore: 100, statusOperacional: "pronto", ultimaSincronizacao: null, pendencias: [] };
const N97_CONTAS = [
  { id: 42, cliente_id: 87, marketplace: "meli", nome: "Loja A", externalAccountLabel: "lojaa", ativo: true, grant: { token_status: "valid" }, base: { base_id: 9, nome: "Custo" } },
  { id: 43, cliente_id: 87, marketplace: "meli", nome: "Loja B", externalAccountLabel: "lojab", ativo: true, grant: { token_status: "valid" }, base: { base_id: 9, nome: "Custo" } },
];
const ME_CONTEXT = {
  ok: true,
  user: { id: 12, nome: "Pedro Gomes", email: null, role: "user" },
  squads: [], squadPrincipalId: null,
  clientes: [{ id: 87, slug: "n97", nome: "N97 Comercial", squadId: null, responsavelDireto: false, contasAtivas: 2 }],
  portfolio: { totalClientes: 1 },
  permissoes: { podeAdministrar: false },
};

// Capas. Quem escolhe é o backend (a lista devolve cover.thumbnail); o front
// só desenha. Os endereços abaixo são distintos de propósito: é a diferença
// entre eles que denuncia uma capa escolhida no lugar errado.
const CAPA_FAM1 = "https://http2.mlstatic.com/capa-fam1.jpg";
const CAPA_FAM1_BUSCA = "https://http2.mlstatic.com/capa-fam1-azul.jpg";
const CAPA_LOJA_B = "https://http2.mlstatic.com/capa-lojab.jpg";
const IMAGEM_DO_PRIMEIRO_ITEM = "https://http2.mlstatic.com/item-a1.jpg";
const IMAGEM_DO_ITEM_DA_FAM2 = "https://http2.mlstatic.com/item-b9.jpg";

// FAM-1 é o exemplo canônico do pedido, com a armadilha embutida:
//
//   MLBU-100 "Azul P"  estoque 100  ->  MLB-A1 e MLB-A2   (DOIS anúncios)
//   MLBU-200 "Azul M"  estoque 100  ->  MLB-A3
//   MLBU-300 "Azul G"  estoque 100  ->  MLB-A4
//
// Estoque correto = 300 (soma por MLBU). Somar por MLB daria 400. O caso de
// um MLBU com 2 MLBs está confirmado em produção (clientes 32 e 35).
//
// A capa de FAM-1 aponta de propósito para o SEGUNDO user product: a régua
// ingênua ("primeira imagem do primeiro item") escolheria a do MLBU-100.
const ESTOQUE_FAM1 = 300;
const LINHAS_CONTA_42 = [
  {
    tipo: "familia", key: "fam:FAM-1", family_id: "FAM-1",
    family_name: "Camiseta Dry Fit Masculina", titulo: "Camiseta Dry Fit Masculina",
    total_user_products: 3, total_itens: 4,
    estoque_total: ESTOQUE_FAM1, vendidos_total: 31,
    preco_min: 89.9, preco_max: 129.9, moeda: "BRL", score_min: 40,
    status_contagem: { ativos: 4, pausados: 0, encerrados: 0 },
    cover: { thumbnail: CAPA_FAM1, user_product_id: "MLBU-200" },
  },
  // Agrupador sem capa: o backend diz que nenhuma variação serve de capa, e o
  // front tem de respeitar isso mesmo tendo itens com imagem à mão.
  {
    tipo: "familia", key: "fam:FAM-2", family_id: "FAM-2",
    family_name: "Caneca Térmica 500ml", titulo: "Caneca Térmica 500ml",
    total_user_products: 1, total_itens: 1,
    estoque_total: 12, vendidos_total: 0,
    preco_min: 39.9, preco_max: 39.9, moeda: "BRL", score_min: 80,
    status_contagem: { ativos: 1, pausados: 0, encerrados: 0 },
    cover: { thumbnail: null, user_product_id: "MLBU-300" },
  },
  // Anúncio SEM agrupamento, na MESMA lista. Antes ele morava na outra aba.
  //
  // variations_count: 24 espelha o caso real da auditoria (MLB2652739620,
  // tênis com 24 variações reais de Cor x Tamanho no Mercado Livre, mas
  // family_id/user_product_id nulos — modelo legado, nunca migrado ao User
  // Products). É o caso que motivou este campo: sem ele, esta linha seria
  // indistinguível de um SKU único de verdade.
  {
    tipo: "item", key: "item:MLB-SEMUP", item_id: "MLB-SEMUP", family_id: null,
    titulo: "Anúncio legado sem agrupamento", sku: null,
    // preco_original só vem preenchido quando há promoção ativa no Mercado
    // Livre (mesma convenção do cabeçalho do modal) — usado pra provar que a
    // lista risca o preço cheio em cima do vigente (ver celulaPrecoHtml).
    preco: 49.9, preco_original: 69.9, moeda: "BRL", estoque: 3, vendidos: 1, status: "active",
    permalink: null, thumbnail: null, pictures_count: 1, is_full: false,
    catalog_listing: false, family_name: null, variations_count: 24,
    // No modelo legado (item_id -> variations[]) não há MLBU por variação —
    // o tipo comercial é do ANÚNCIO inteiro, então entra aqui, no card
    // principal (ver condicaoComercial/rowAnuncioHtml).
    listing_type_id: "gold_special",
    score_venforce: 40, revisado: false,
    total_itens: 1, total_user_products: 0, estoque_total: 3, vendidos_total: 1,
    cover: { thumbnail: null, user_product_id: null },
  },
  // Item avulso SEM variações no ML (variations_count 0/ausente) — controle
  // negativo do 7b: sem isto, um teste que só olhasse MLB-SEMUP não provaria
  // que a ausência do campo é o que desliga o chevron/painel.
  {
    tipo: "item", key: "item:MLB-SEMVAR", item_id: "MLB-SEMVAR", family_id: null,
    titulo: "Anúncio simples, sem variações no ML", sku: "SKU-SEMVAR",
    preco: 29.9, preco_original: null, moeda: "BRL", estoque: 8, vendidos: 0, status: "active",
    permalink: null, thumbnail: null, pictures_count: 3, is_full: false,
    catalog_listing: false, family_name: null, variations_count: 0,
    score_venforce: 55, revisado: false,
    total_itens: 1, total_user_products: 0, estoque_total: 8, vendidos_total: 0,
    cover: { thumbnail: null, user_product_id: null },
  },
];
// As variações REAIS do modelo legado de MLB-SEMUP (GET .../variacoes-legado),
// espelhando o payload que documentacao_api_meli/variacoes.md documenta para
// GET /items/{id}/variations — 2 das 24 "variações no ML" do fixture acima.
// image_url já reflete o RESULTADO do relacionamento picture_ids ->
// item.pictures que o backend real resolve (meliVariacoesLegadoService —
// coberto pela suíte Node); este mock só simula o resultado já pronto. As
// duas variações compartilharem a mesma URL (fallback pra capa do item,
// já que 15092589431 não tem imagem própria) é o comportamento esperado, não
// um bug de dedupe.
const VARIACOES_LEGADO_MLB_SEMUP = [
  { id: 15092589430, attribute_combinations: [{ id: "COLOR", name: "Color", value_id: "52005", value_name: "Preto" }, { id: "SIZE", name: "Talla", value_id: "9", value_name: "34 BR" }], price: 49.9, available_quantity: 2, sold_quantity: 5, image_url: "https://http2.mlstatic.com/D_preto-O.jpg" },
  { id: 15092589431, attribute_combinations: [{ id: "COLOR", name: "Color", value_id: "52049", value_name: "Nude" }, { id: "SIZE", name: "Talla", value_id: "10", value_name: "35 BR" }], price: 49.9, available_quantity: 1, sold_quantity: 3, image_url: "https://http2.mlstatic.com/D_preto-O.jpg" },
];
// Espelha avaliarBloqueioEdicaoVariacaoLegado (server/services/meliAnuncios/
// meliVariacoesLegadoService.js) — este mock simula a RESPOSTA que o backend
// real já entrega pronta; nenhum teste de frontend decide sozinho o que
// inventory_id significa.
function bloqueioVariacaoLegadoMock(v) {
  if (v.inventory_id) {
    return {
      podeEditarEstoque: false,
      motivoBloqueio: "INVENTORY_ID",
      motivoBloqueioTexto: "O estoque desta variação é gerenciado externamente (inventory_id) — a edição manual não é permitida.",
    };
  }
  return { podeEditarEstoque: true, motivoBloqueio: null, motivoBloqueioTexto: null };
}
let chamadasVariacoesLegado = [];
// Gancho para um teste substituir a resposta do GET .../variacoes-legado sem
// mexer no fixture compartilhado por 7c/7d/7f/7h (que dependem de preco 49.9).
let variacoesLegadoHandler = null;
// Mesma lista com q="Azul": o backend troca a variação relevante, e a capa da
// tela tem de trocar junto.
const LINHAS_CONTA_42_BUSCA = [
  Object.assign({}, LINHAS_CONTA_42[0], {
    cover: { thumbnail: CAPA_FAM1_BUSCA, user_product_id: "MLBU-200" },
  }),
];
// Recorte de um card de KPI: só o que o filtro alcança.
const LINHAS_CONTA_42_FILTRO = [LINHAS_CONTA_42[2]];
const LINHAS_CONTA_43 = [
  {
    tipo: "familia", key: "fam:FAM-1", family_id: "FAM-1",
    family_name: "FAMÍLIA DA LOJA B", titulo: "FAMÍLIA DA LOJA B",
    total_user_products: 1, total_itens: 1,
    estoque_total: 5, vendidos_total: 0,
    preco_min: 10, preco_max: 10, moeda: "BRL", score_min: 50,
    status_contagem: { ativos: 1, pausados: 0, encerrados: 0 },
    cover: { thumbnail: CAPA_LOJA_B, user_product_id: "MLBU-900" },
  },
];

function item(id, titulo, up, extra) {
  return Object.assign({
    item_id: id, user_product_id: up, family_id: "FAM-1", titulo: titulo,
    status: "active", preco: 89.9, moeda: "BRL", estoque: 100, vendidos: 5, score_venforce: 62, sku: "SKU-" + id,
    thumbnail: null, permalink: "https://produto.mercadolivre.com.br/" + id,
    listing_type_id: "gold_special",
    // Mesmos campos que o card avulso (LINHAS_CONTA_42) já usa para montar
    // badges — default "sem badge nenhum", como o item comum da família.
    pictures_count: 5, is_full: false, revisado: false, catalog_listing: false,
  }, extra || {});
}

// Os títulos de FAM-1 estão na forma que o ML documenta para o modelo de User
// Products: título do item = family_name + os valores dos atributos que variam
// ("Apple iPhone 256GB" -> "Apple iPhone 256GB Rojo", preco-variacao.md). É
// dela que sai o nome amigável da variação ("Azul P"), e é por isso que o
// fixture tem de respeitá-la — com títulos fora dessa forma, o teste validaria
// só o caminho de fallback.
//
// FAM-2 é o contrário DE PROPÓSITO: "Caneca Térmica Inox 500ml" não começa por
// "Caneca Térmica 500ml". É o título legado/editado, em que não existe sufixo
// para extrair — e o nome da variação tem de ser o título inteiro, nunca um
// recorte adivinhado.
const NOME_FAM1 = "Camiseta Dry Fit Masculina";
const DETALHE_CONTA_42 = {
  "FAM-1": {
    family_id: "FAM-1", family_name: NOME_FAM1,
    user_products: [
      // MLB-A1 tem imagem PRÓPRIA, diferente da capa: se o front voltar a
      // deduzir a capa pelo primeiro item, é esta que apareceria na linha.
      // A ordem AQUI é a do backend (por item_id) e é o Premium que vem
      // primeiro: se a tela apenas repetir a ordem recebida, a leitura
      // Clássico -> Premium do ML não acontece.
      //
      // Os dois títulos DIVERGEM de propósito. Pelo ML eles seriam iguais
      // (title é campo sincronizado por User Product), então esta variação é o
      // snapshot desatualizado: quem nomeia a variação é o primeiro item da
      // ordem de exibição (o Clássico), e o irmão com título diferente tem de
      // mostrar o seu na própria linha em vez de deixá-lo invisível.
      { user_product_id: "MLBU-100", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 2,
        itens: [item("MLB-A1", NOME_FAM1 + " Azul P (12 parcelas)", "MLBU-100",
                  {
                    thumbnail: IMAGEM_DO_PRIMEIRO_ITEM, listing_type_id: "gold_pro",
                    // Os 4 badges de propósito, para provar que o card do MLB
                    // dentro da família monta os mesmos badges do card legado
                    // (ver "8d" mais abaixo).
                    pictures_count: 1, is_full: true, revisado: true, catalog_listing: true,
                  }),
                item("MLB-A2", NOME_FAM1 + " Azul P", "MLBU-100",
                  { listing_type_id: "gold_special" })] },
      // As três formas de variação, de propósito: mista (acima), só Clássico
      // e só Premium. Nenhuma delas pode depender do padrão
      // Clássico + Premium para renderizar.
      { user_product_id: "MLBU-200", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 1,
        itens: [item("MLB-A3", NOME_FAM1 + " Azul M", "MLBU-200",
          { listing_type_id: "gold_special" })] },
      { user_product_id: "MLBU-300", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 1,
        itens: [item("MLB-A4", NOME_FAM1 + " Azul G", "MLBU-300",
          { listing_type_id: "gold_pro" })] },
    ],
  },
  "FAM-2": {
    family_id: "FAM-2", family_name: "Caneca Térmica 500ml",
    user_products: [
      { user_product_id: "MLBU-300C", site_id: "MLB", domain_id: "MLB-MUGS", total_itens: 1,
        itens: [item("MLB-B9", "Caneca Térmica Inox 500ml", "MLBU-300C",
          { family_id: "FAM-2", estoque: 12, thumbnail: IMAGEM_DO_ITEM_DA_FAM2 })] },
    ],
  },
};
const DETALHE_CONTA_43 = {
  "FAM-1": {
    family_id: "FAM-1", family_name: "FAMÍLIA DA LOJA B",
    user_products: [
      { user_product_id: "MLBU-900", site_id: "MLB", domain_id: "MLB-OTHER", total_itens: 1,
        itens: [item("MLB-Z9", "Produto exclusivo da Loja B", "MLBU-900", { estoque: 5 })] },
    ],
  },
};

// ── interruptores do cenário ───────────────────────────────────────────────
let atrasoDetalheFamilia = {};   // family_id -> ms
const pedidos = [];
// Escritas de estoque que chegaram ao "servidor", e o gancho para forçar uma
// resposta específica (recusa do ML, por exemplo).
const escritasEstoque = [];
let estoqueHandler = null;

// Escritas de estoque de VARIAÇÃO LEGADA (PATCH .../variacoes-legado/:id/estoque)
// e o gancho para forçar uma resposta específica (recusa comum ou perda
// crítica de variação).
const escritasEstoqueVariacaoLegado = [];
let estoqueVariacaoLegadoHandler = null;

// GET /anuncios-meli/performance (métricas últ. 7 dias + margem — sempre
// DEPOIS do primeiro paint, nunca bloqueia). `chamadasPerformance` registra
// cada chamada com os item_id EXATOS que vieram na query string — é o que
// prova "zero chamada para item oculto". `atrasoPerformance` simula a janela
// em que a linha já está na tela mas a resposta ainda não chegou.
// `performanceHandler`, quando setado, substitui a resposta padrão inteira
// (para simular indisponibilidade de margem ou falha total).
let atrasoPerformance = 0;
let performanceHandler = null;
const chamadasPerformance = [];

// GET /anuncios-meli/familias — `chamadasFamilias` registra page/ordenarPor
// de CADA chamada (prova que a paginação reenvia o mesmo critério global —
// ver testes 39d-h). `ordenarPorGlobalHandler`, quando setado, substitui a
// resposta padrão inteira sempre que a query trouxer um `ordenarPor` (o
// próprio backend só aplica esse campo quando o critério é global —
// faturamento_*/curvaAbc_* — nunca para margem_*/unidades_*, que continuam
// ordenação LOCAL de página, resolvida no frontend).
let chamadasFamilias = [];
let ordenarPorGlobalHandler = null; // (qs) => resposta completa de /anuncios-meli/familias

// Views nulo em MLB-A1 (sem dado) e vendas=0 real em MLB-A2 (fato, não
// ausência de dado) são o par que prova a régua de "—" vs "0" vs NaN.
const METRICAS_FIXTURE = {
  "MLB-SEMUP": { views: 259, vendas: 3, conversao: 1.2 },
  "MLB-A1": { views: null, vendas: 0, conversao: null },
  "MLB-A2": { views: 100, vendas: 0, conversao: 0 },
};
// MLB-A2 fica UNVALIDATED (sem custo na Base) de propósito — é o caso sem
// número, só rótulo. MLB-A1 fica LOSS (prejuízo) — cor de risco. MLB-SEMUP
// fica HEALTHY realizada — o caminho feliz.
const MARGEM_FIXTURE = {
  // precoOriginal confirma AO VIVO a mesma promoção que o snapshot
  // (preco_original: 69.9 no fixture da linha) já sinalizava — item usado
  // em vários testes como "o caminho feliz com promoção".
  "MLB-SEMUP": { origem: "realized", margin: 0.25, marginPercent: 25, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [], precoOriginal: 69.9 },
  "MLB-A1": { origem: "realized", margin: -0.05, marginPercent: -5, status: "LOSS", statusLabel: "Prejuízo", statusReasons: ["Margem negativa (-5.00%)."] },
  "MLB-A2": { origem: "projected", margin: null, marginPercent: null, status: "UNVALIDATED", statusLabel: "Não validado", statusReasons: ["Variáveis obrigatórias ausentes: custo."] },
};

const SEMENTE = `
  try {
    localStorage.setItem("vf-token", "lista-token");
    localStorage.setItem("vf-user", JSON.stringify({ id: 12, nome: "Pedro Gomes", role: "user" }));
    sessionStorage.removeItem("vf-ctx");
  } catch (e) {}
`;

function startServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    const target = path.resolve(PORTAL_DIR, u.pathname.replace(/^\/+/, ""));
    if (!target.startsWith(path.resolve(PORTAL_DIR) + path.sep)) { res.writeHead(403).end("forbidden"); return; }
    fs.readFile(target, (err, contents) => {
      if (err) { res.writeHead(404).end("not found"); return; }
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
      res.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(contents);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitChrome(port) {
  for (let i = 0; i < 200; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return; } catch (_) { /* aguardando */ }
    await sleep(50);
  }
  throw new Error("Chrome DevTools não iniciou.");
}

class Cdp {
  constructor(url) { this.socket = new WebSocket(url); this.nextId = 1; this.pending = new Map(); this.onEvent = null; }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const m = JSON.parse(event.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
        return;
      }
      if (m.method && this.onEvent) this.onEvent(m.method, m.params);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Falha na avaliação do navegador");
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function waitFor(cdp, expression, message) {
  for (let i = 0; i < 200; i++) {
    let ok = false;
    try { ok = await cdp.evaluate(`Boolean(${expression})`); } catch (_) { ok = false; }
    if (ok) return;
    await sleep(50);
  }
  throw new Error(message || `Timeout: ${expression}`);
}

// Mesma ideia de waitFor, mas para uma condição do lado do NODE (ex.:
// chamadasPerformance, que vive no interceptor — não no navegador).
async function waitForNode(fn, message) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await sleep(50);
  }
  throw new Error(message || "Timeout (condição do lado do Node)");
}

// aplicarOrdenacaoPerformance SEMPRE manda incluirMetricas=0 explícito (ver
// anuncios-meli.js) — é a única chamada a /performance que faz isso. O
// pré-carregamento automático de renderCatalogo (carregarPerformance,
// disparado depois de QUALQUER render, inclusive um catálogo vindo de
// ordenarPor GLOBAL) sempre pede métricas quando o item é novo, e por isso
// NÃO pode ser distinguido de aplicarOrdenacaoPerformance por um simples
// "chamadasPerformance.length === 0": itens já cacheados (reaproveitados de
// testes anteriores) não geram chamada nenhuma, mas itens NOVOS geram uma
// chamada de pré-carregamento legítima mesmo sob um critério global — essa
// chamada tem sempre incluirMetricas=true (nunca 0), o que a distingue de
// aplicarOrdenacaoPerformance de forma confiável.
function disparouOrdenacaoLocal(chamadas) {
  return chamadas.some((c) => c.incluirMetricas === false);
}

function contar(padrao, desde) {
  return pedidos.slice(desde).filter((u) => padrao.test(u)).length;
}

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

async function clicar(cdp, seletor, mensagem) {
  const ok = await cdp.evaluate(`(function(){ var e = document.querySelector(${JSON.stringify(seletor)}); if(!e) return false; e.click(); return true; })()`);
  assert.ok(ok, mensagem || `não achei ${seletor} para clicar`);
}

// Combo de ordenação novo (gatilho + popover + botão de direção) — abre o
// popover e clica no filtro pedido. base="" seleciona "Padrão".
async function selecionarOrdenacao(cdp, base) {
  await clicar(cdp, "#am-ordenacao-trigger", "não achei o gatilho de ordenação");
  await clicar(cdp, `.am-ordenacao-menu__item[data-base="${base}"]`, `não achei o item de ordenação "${base}" no menu`);
}

// Seletores da UI nova. O agrupador é uma linha .am-row como qualquer outra;
// o painel de expansão é o IRMÃO seguinte dela.
const linhaFam = (id) => `.am-row--grupo[data-familia=${JSON.stringify(id)}]`;
const painelFam = (id) => `${linhaFam(id)} + .am-grupo-painel`;

function wireInterception(cdp) {
  const excecoes = [];
  const respond = async (m, p) => {
    try { await cdp.send(m, p); } catch (err) { if (!/Invalid InterceptionId/.test(err.message || "")) throw err; }
  };
  cdp.onEvent = async (method, params) => {
    if (method === "Runtime.exceptionThrown") {
      excecoes.push(`${params?.exceptionDetails?.text || ""} ${params?.exceptionDetails?.exception?.description || ""}`.trim());
    }
    if (method !== "Fetch.requestPaused") return;
    const url = params.request.url;
    if (!url.includes(PROD_HOST)) { await respond("Fetch.continueRequest", { requestId: params.requestId }); return; }
    const cors = [
      { name: "access-control-allow-origin", value: "*" },
      { name: "access-control-allow-headers", value: "authorization,content-type" },
      { name: "access-control-allow-methods", value: "GET,POST,PATCH,OPTIONS" },
    ];
    if (params.request.method === "OPTIONS") { await respond("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: cors }); return; }
    const corpo = (obj, code) => respond("Fetch.fulfillRequest", {
      requestId: params.requestId, responseCode: code || 200,
      responseHeaders: [...cors, { name: "content-type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(obj)).toString("base64"),
    });

    const caminho = url.replace(`https://${PROD_HOST}`, "");
    pedidos.push(caminho);
    const conta = new URL(url).searchParams.get("clienteContaId") || "42";

    if (url.includes("/me/context")) { await corpo(ME_CONTEXT); return; }
    if (url.includes("/operacao/cliente-360/clientes")) { await corpo({ ok: true, clientes: [N97] }); return; }
    if (/\/clientes\/[^/?]+\/contas/.test(url)) { await corpo({ ok: true, cliente: N97, contas: N97_CONTAS }); return; }

    if (url.includes("/anuncios-meli/clientes")) {
      await corpo({ ok: true, clientes: [{ id: 87, nome: "N97 Comercial", slug: "n97", mlConectado: true, totalAnuncios: 5 }] });
      return;
    }
    if (url.includes("/anuncios-meli/resumo")) {
      await corpo({ ok: true, resumo: { total: 11, ativos: 9, pausados: 2, scoreBaixo: 3, semSku: 1, full: 2, ultimaSync: new Date().toISOString() } });
      return;
    }

    // IMPORTANTE: /familias/:familyId tem de ser casado ANTES do detalhe
    // genérico /anuncios-meli/:itemId — é o mesmo cuidado de ordem que a rota
    // do Express precisou ter no backend.
    const mDetalheFam = caminho.match(/^\/anuncios-meli\/familias\/([^/?]+)/);
    if (mDetalheFam) {
      const familyId = decodeURIComponent(mDetalheFam[1]);
      const atraso = atrasoDetalheFamilia[familyId];
      if (atraso) await sleep(atraso);
      const fonte = conta === "43" ? DETALHE_CONTA_43 : DETALHE_CONTA_42;
      const familia = fonte[familyId];
      if (!familia) { await corpo({ ok: false, motivo: "Família não encontrada." }, 404); return; }
      await corpo({ ok: true, cliente: { slug: "n97", nome: "N97 Comercial" }, familia });
      return;
    }

    // A LISTA — uma só, com linhas dos dois tipos.
    if (caminho.startsWith("/anuncios-meli/familias")) {
      const qs = new URL(url).searchParams;
      const termo = qs.get("q");
      const filtro = qs.get("filtro");
      const ordenarPor = qs.get("ordenarPor");
      chamadasFamilias.push({ page: qs.get("page"), ordenarPor });
      if (ordenarPorGlobalHandler && ordenarPor) { await corpo(ordenarPorGlobalHandler(qs)); return; }
      let anuncios;
      if (conta === "43") anuncios = LINHAS_CONTA_43;
      else if (filtro) anuncios = LINHAS_CONTA_42_FILTRO;
      else if (termo) anuncios = LINHAS_CONTA_42_BUSCA;
      else anuncios = LINHAS_CONTA_42;
      await corpo({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        anuncios,
        paginacao: { page: 1, limit: 20, total: anuncios.length, totalPaginas: 1 },
      });
      return;
    }

    // GET /anuncios-meli/performance — precisa vir ANTES do detalhe genérico
    // /anuncios-meli/:itemId, senão "performance" seria lido como um itemId
    // (o mesmo cuidado de ordem que /familias/:familyId já tem acima).
    if (caminho.startsWith("/anuncios-meli/performance")) {
      const qs = new URL(url).searchParams;
      const idsPedidos = (qs.get("itemIds") || "").split(",").filter(Boolean);
      const familiasPedidas = (qs.get("familias") || "").split("|").filter(Boolean);
      // O front SEMPRE manda os dois flags de forma explícita (nunca omite):
      // é o que prova, do lado do teste, se uma chamada pediu só métricas
      // (pré-carregamento em background de agrupador ainda fechado) ou só
      // margem (expansão depois que o pré-carregamento já trouxe a métrica).
      const incluirMetricas = qs.get("incluirMetricas") !== "0";
      const incluirMargem = qs.get("incluirMargem") !== "0";
      const incluirFaturamento = qs.get("incluirFaturamento") === "1";
      const incluirUnidades = qs.get("incluirUnidades") === "1";
      const incluirCurvaAbc = qs.get("incluirCurvaAbc") === "1";
      chamadasPerformance.push({
        itemIds: idsPedidos, familias: familiasPedidas, conta,
        incluirMetricas, incluirMargem, incluirFaturamento, incluirUnidades, incluirCurvaAbc,
      });
      if (atrasoPerformance) await sleep(atrasoPerformance);
      if (performanceHandler) { await corpo(performanceHandler(idsPedidos, conta, familiasPedidas)); return; }

      const metricas7d = {};
      const margem = {};
      idsPedidos.forEach((id) => {
        if (incluirMetricas) metricas7d[id] = METRICAS_FIXTURE[id] || { views: 10, vendas: 1, conversao: 10 };
        if (incluirMargem) margem[id] = MARGEM_FIXTURE[id] || { origem: "projected", margin: 0.2, marginPercent: 20, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [] };
      });
      await corpo({
        ok: true, metricas7d, margem, margemIndisponivel: null,
        faturamento: null, unidadesVendidas: null, curvaAbc: null, margemPorFamilia: null,
      });
      return;
    }

    // PATCH /anuncios-meli/:itemId/variacoes-legado/:variationId/estoque —
    // escrita real de estoque de uma variação legada. Precisa vir ANTES do
    // GET .../variacoes-legado logo abaixo: o regex dele casaria este mesmo
    // caminho (é um prefixo dele) e devolveria a resposta de LEITURA para um
    // PATCH de ESCRITA.
    const mEstoqueVariacaoLegado = caminho.match(/^\/anuncios-meli\/([^/?]+)\/variacoes-legado\/([^/?]+)\/estoque/);
    if (mEstoqueVariacaoLegado) {
      const itemId = decodeURIComponent(mEstoqueVariacaoLegado[1]);
      const variationId = Number(decodeURIComponent(mEstoqueVariacaoLegado[2]));
      const enviado = JSON.parse(params.request.postData || "{}");
      escritasEstoqueVariacaoLegado.push({ itemId, variationId, corpo: enviado });
      if (estoqueVariacaoLegadoHandler) { await corpo(estoqueVariacaoLegadoHandler(itemId, variationId, enviado)); return; }

      const base = itemId === "MLB-SEMUP" ? VARIACOES_LEGADO_MLB_SEMUP : [];
      const atualizadas = base.map((v) =>
        v.id === variationId ? { ...v, available_quantity: Number(enviado.estoque) } : v
      );
      await corpo({
        ok: true,
        variacoes: atualizadas.map((v) => Object.assign({
          id: v.id,
          atributos: v.attribute_combinations.map((ac) => ({ nome: ac.name, valor: ac.value_name })),
          preco: v.price, estoque: v.available_quantity, vendidos: v.sold_quantity,
          image_url: v.image_url || null,
        }, bloqueioVariacaoLegadoMock(v))),
      });
      return;
    }

    // GET /anuncios-meli/:itemId/variacoes-legado — expansão do modelo LEGADO
    // (item_id -> variations[]). Precisa vir ANTES do detalhe genérico, mesmo
    // cuidado de /familias/:familyId e /performance acima.
    const mVariacoesLegado = caminho.match(/^\/anuncios-meli\/([^/?]+)\/variacoes-legado/);
    if (mVariacoesLegado) {
      const itemId = decodeURIComponent(mVariacoesLegado[1]);
      chamadasVariacoesLegado.push(itemId);
      const bruto = itemId === "MLB-SEMUP"
        ? (variacoesLegadoHandler ? variacoesLegadoHandler() : VARIACOES_LEGADO_MLB_SEMUP)
        : [];
      await corpo({ ok: true, variacoes: bruto.map((v) => Object.assign({
        id: v.id,
        atributos: v.attribute_combinations.map((ac) => ({ nome: ac.name, valor: ac.value_name })),
        preco: v.price, estoque: v.available_quantity, vendidos: v.sold_quantity,
        image_url: v.image_url || null,
      }, bloqueioVariacaoLegadoMock(v))) });
      return;
    }

    // PATCH /anuncios-meli/:itemId/estoque — a escrita de estoque.
    //
    // A resposta imita o backend real: devolve o valor CONFIRMADO (que pode
    // não ser o enviado) e `itens_sincronizados`, os outros MLBs do mesmo
    // user_product_id que o ML replica. A tela não pode deduzir essa lista —
    // ela vem daqui.
    const mEstoque = caminho.match(/^\/anuncios-meli\/([^/?]+)\/estoque/);
    if (mEstoque) {
      const itemId = decodeURIComponent(mEstoque[1]);
      const enviado = JSON.parse(params.request.postData || "{}");
      escritasEstoque.push({ itemId, corpo: enviado });
      if (estoqueHandler) { await corpo(estoqueHandler(itemId, enviado)); return; }

      const irmaos = [];
      let upDoItem = null;
      Object.keys(DETALHE_CONTA_42).forEach((fam) => {
        DETALHE_CONTA_42[fam].user_products.forEach((up) => {
          if (!up.itens.some((i) => i.item_id === itemId)) return;
          upDoItem = up.user_product_id;
          up.itens.forEach((i) => { if (i.item_id !== itemId) irmaos.push(i.item_id); });
        });
      });
      const quantidade = Number(enviado.estoque);
      await corpo({
        ok: true,
        estoque: quantidade,
        // available_quantity = 0 pausa o anúncio no ML (out_of_stock). O status
        // vem do servidor porque é o ML que o reporta.
        anuncio: {
          item_id: itemId,
          estoque: quantidade,
          status: quantidade === 0 ? "paused" : "active",
          sub_status: quantidade === 0 ? "out_of_stock" : null,
        },
        itens_sincronizados: irmaos,
        user_product_id: upDoItem,
      });
      return;
    }

    const mDetalhe = caminho.match(/^\/anuncios-meli\/([^/?]+)(\?|$)/);
    if (mDetalhe && mDetalhe[1] !== "") {
      const itemId = mDetalhe[1];
      await corpo({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        anuncio: {
          item_id: itemId, titulo: "Camiseta Dry Fit Azul P", sku: "SKU-" + itemId,
          marca: "DryCo", modelo: "DF1", preco: 89.9, moeda: "BRL", estoque: 100, vendidos: 30,
          status: "active", listing_type_id: "gold_special", category_id: "MLB1055",
          permalink: "https://produto.mercadolivre.com.br/" + itemId, thumbnail: null,
          pictures_count: 2, pictures_json: [], attributes_json: [], is_full: false,
          health: 0.8, score_venforce: 70, revisado: false, cliente_conta_id: Number(conta),
          last_synced_at: new Date().toISOString(), catalog_listing: false, family_name: null,
        },
        descricao: "Descrição de teste.", descricaoEstado: "ok", descricaoErro: null,
        categoriaNome: "Camisetas",
      });
      return;
    }

    // A listagem PLANA (GET /anuncios-meli?…) não deve mais ser chamada por
    // esta tela: ela era a segunda lista. Continua respondida para o caso de
    // alguém a chamar — e a verificação 2 falha se isso acontecer.
    if (url.includes("/anuncios-meli")) {
      await corpo({ ok: true, anuncios: [], paginacao: { page: 1, limit: 24, total: 0, totalPaginas: 1 } });
      return;
    }

    await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
  };
  return excecoes;
}

async function run() {
  const server = await startServer();
  const porta = server.address().port;
  const debugPort = 23000 + Math.floor(Math.random() * 900);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--window-size=1440,900",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-lista-${process.pid}`, "about:blank",
  ], { stdio: "ignore" });

  let cdp;
  try {
    await waitChrome(debugPort);
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEMENTE });
    const excecoes = wireInterception(cdp);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        window.__erros = [];
        addEventListener("error", function (e) {
          window.__erros.push(String(e.message) + " @ " + e.filename + ":" + e.lineno);
        });
        addEventListener("unhandledrejection", function (e) {
          window.__erros.push("rejeição: " + String((e.reason && e.reason.stack) || e.reason));
        });
      `,
    });

    pedidos.length = 0;
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
    await waitFor(cdp, "document.querySelector('.vf-shell__sidebar')", "Shell V3 não montou");
    await waitFor(cdp, "document.getElementById('vf-shell-main').hidden === false", "gating de conta não liberou a tela");

    /* ── 1 a 3: existe UMA lista ─────────────────────────────────────────── */

    await check("1 — uma lista só: agrupadores e anúncios individuais são linhas irmãs", async () => {
      await waitFor(cdp, "document.querySelector('.am-listagem .am-row')", "a lista não renderizou");
      const estado = await cdp.evaluate(`(function(){
        var listas = document.querySelectorAll('.am-listagem');
        var linhas = Array.from(document.querySelectorAll('.am-listagem > .am-row'));
        return {
          listas: listas.length,
          linhas: linhas.length,
          grupos: linhas.filter(function(r){ return r.classList.contains('am-row--grupo'); }).length,
          itens: linhas.filter(function(r){ return r.hasAttribute('data-item'); }).length,
          // tudo dentro da MESMA tabela: nenhuma linha em outro container
          todasNaMesmaLista: linhas.every(function(r){ return r.parentElement === listas[0]; }),
          // os artefatos das duas abas não podem existir nem escondidos
          seletorDeModo: document.getElementById('am-modo'),
          containerDeFamilias: document.getElementById('am-familias-container'),
          arvore: document.querySelectorAll('.am-arvore, .am-familia').length,
          // UMA paginação, contando GRUPOS: são 4 linhas para 7 anúncios reais
          // (4 em FAM-1, 1 em FAM-2, 2 sem agrupador — um deles com variações
          // legadas, ver MLB-SEMUP/MLB-SEMVAR).
          paginacoes: document.querySelectorAll('.am-paginacao').length,
          contagem: (document.querySelector('.am-paginacao .vf-pagination__info') || {}).textContent,
        }; })()`);
      assert.strictEqual(estado.listas, 1, "existe mais de uma tabela na tela");
      assert.strictEqual(estado.linhas, 4, "4 linhas: 2 agrupadores + 2 anúncios individuais");
      assert.strictEqual(estado.grupos, 2);
      assert.strictEqual(estado.itens, 2);
      assert.strictEqual(estado.todasNaMesmaLista, true);
      assert.strictEqual(estado.seletorDeModo, null, "o seletor de aba continua no DOM");
      assert.strictEqual(estado.containerDeFamilias, null, "o segundo container continua no DOM");
      assert.strictEqual(estado.arvore, 0, "a árvore separada continua sendo montada");
      assert.strictEqual(estado.paginacoes, 1, "voltou a existir mais de uma paginação");
      assert.ok(/\b4\b/.test(estado.contagem || "") && !/\b7\b/.test(estado.contagem || ""),
        `a paginação precisa contar grupos (4), não anúncios (7): "${estado.contagem}"`);
    });

    await check("2 — a tela não chama mais a listagem plana (não existe segunda lista)", async () => {
      const planas = pedidos.filter((u) => /^\/anuncios-meli\?/.test(u));
      assert.deepStrictEqual(planas, [], `a tela pediu a listagem plana: ${JSON.stringify(planas)}`);
      const listas = pedidos.filter((u) => /^\/anuncios-meli\/familias\?/.test(u));
      assert.strictEqual(listas.length, 1, `a lista foi pedida ${listas.length}x no boot: ${JSON.stringify(listas)}`);
    });

    await check("3 — o agrupador e o anúncio individual dividem a mesma grade de colunas", async () => {
      const cols = await cdp.evaluate(`(function(){
        var g = document.querySelector('.am-row--grupo');
        var i = document.querySelector('.am-row[data-item]');
        var cs = function(e){ return getComputedStyle(e).gridTemplateColumns; };
        return { grupo: cs(g), item: cs(i) }; })()`);
      assert.strictEqual(cols.grupo, cols.item,
        `as duas formas de linha têm grades diferentes: ${cols.grupo} vs ${cols.item}`);
    });

    /* ── 4: a soma de estoque ───────────────────────────────────────────── */

    await check("4 — o agrupador mostra a soma do estoque dos MLBUs (300, não 400)", async () => {
      const cel = await cdp.evaluate(`(function(){
        var r = document.querySelector('${linhaFam("FAM-1")}');
        var nums = r.querySelectorAll('.am-row__num');
        return { estoque: nums[0].textContent.trim(), vendidos: nums[1].textContent.trim(),
                 titulo: nums[0].getAttribute('title') || '' }; })()`);
      assert.strictEqual(cel.estoque, String(ESTOQUE_FAM1),
        "a coluna de estoque do agrupador não é a soma que a API devolveu");
      assert.strictEqual(cel.vendidos, "31");
      assert.ok(/varia/i.test(cel.titulo), `o estoque somado precisa se explicar: "${cel.titulo}"`);

      const individual = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMUP"]');
        return r.querySelectorAll('.am-row__num')[0].textContent.trim(); })()`);
      assert.strictEqual(individual, "3", "o anúncio individual precisa manter o próprio estoque");
    });

    await check("5 — o agrupador resume 3 variações / 4 anúncios e a faixa de preço", async () => {
      const t = await cdp.evaluate(`document.querySelector('${linhaFam("FAM-1")}').innerText`);
      assert.ok(/3 variações/.test(t), `não resumiu as variações: ${JSON.stringify(t)}`);
      assert.ok(/4 anúncios/.test(t), `não resumiu os anúncios: ${JSON.stringify(t)}`);
      assert.ok(/89,90/.test(t) && /129,90/.test(t), `a faixa de preço não apareceu: ${JSON.stringify(t)}`);
    });

    /* ── 6 e 7: nada abre sozinho; só o agrupador expande ───────────────── */

    await check("6 — nenhum PAINEL abre sozinho, mas o detalhe de cada agrupador é pré-carregado em background", async () => {
      // O pré-carregamento (para somar métricas 7d na linha-mãe) busca o
      // detalhe de CADA agrupador visível — 1 chamada por família, sem
      // clique nenhum. É o oposto do que esta verificação testava antes: a
      // ausência de chamada virou a REGRA NOVA (exatamente 1 por família).
      await waitForNode(() => contar(/\/familias\/FAM-1/, 0) >= 1 && contar(/\/familias\/FAM-2/, 0) >= 1,
        "o pré-carregamento em background não buscou o detalhe dos dois agrupadores");

      const abertas = await cdp.evaluate("document.querySelectorAll('.am-row--grupo[aria-expanded=\"true\"]').length");
      assert.strictEqual(abertas, 0, "algum agrupador já veio expandido");
      const mlbs = await cdp.evaluate("document.querySelectorAll('.am-mlb').length");
      assert.strictEqual(mlbs, 0, "o pré-carregamento não pode pintar o painel — só busca dado em background");
      assert.strictEqual(contar(/\/familias\/FAM-1/, 0), 1, "o pré-carregamento não pode gastar mais de 1 chamada por família");
      assert.strictEqual(contar(/\/familias\/FAM-2/, 0), 1);
    });

    await check("7 — um anúncio SEM variações no ML não tem toggle nem painel", async () => {
      const estado = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMVAR"]');
        var prox = r.nextElementSibling;
        return {
          temToggle: Boolean(r.querySelector('.am-row__variacoes-toggle')),
          proxEhPainel: Boolean(prox && prox.classList.contains('am-grupo-painel')),
        }; })()`);
      assert.strictEqual(estado.temToggle, false, "anúncio sem variações não pode ganhar botão de expandir");
      assert.strictEqual(estado.proxEhPainel, false, "criou painel para uma linha sem nada dentro");
    });

    /* ── 7b: variações do modelo LEGADO (auditoria MLB2652739620) ───────── */

    await check("7b — anúncio legado com variations_count > 0 mostra a contagem (estrutural, sem cara de badge) e ganha um toggle", async () => {
      const estado = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMUP"]');
        var toggle = r.querySelector('.am-row__variacoes-toggle');
        var info = r.querySelector('.am-row__variacoes-info');
        return {
          infoTexto: info ? info.textContent : null,
          infoEhBadge: Boolean(info && info.closest('.am-row__badges')),
          badgesTexto: r.querySelector('.am-row__badges').textContent,
          temToggleNaLinha: Boolean(toggle),
          toggleAriaExpanded: toggle && toggle.getAttribute('aria-expanded'),
        }; })()`);
      assert.strictEqual(estado.infoTexto, "24 variações",
        `a contagem precisa aparecer como informação estrutural, sem o "no ML" redundante: ${JSON.stringify(estado.infoTexto)}`);
      assert.strictEqual(estado.infoEhBadge, false, "a contagem não pode morar em .am-row__badges (não é status como Full/Sem SKU)");
      assert.ok(!/variaç/i.test(estado.badgesTexto),
        `a contagem de variações saiu de .am-row__badges, não pode sobrar lá: ${JSON.stringify(estado.badgesTexto)}`);
      assert.strictEqual(estado.temToggleNaLinha, true, "variations_count > 0 precisa ganhar um botão de expandir");
      assert.strictEqual(estado.toggleAriaExpanded, "false", "começa fechado");
    });

    await check("7b2 — anúncio legado mostra o tipo (Clássico/Premium) no card principal, reaproveitando .am-mlb__cond", async () => {
      const estado = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMUP"]');
        var cond = r.querySelector('.am-mlb__cond');
        return { texto: cond ? cond.textContent : null };
      })()`);
      assert.strictEqual(estado.texto, "Clássico",
        `listing_type_id "gold_special" precisa virar "Clássico" no card principal: ${JSON.stringify(estado.texto)}`);
    });

    await check("7c — clicar no toggle expande as variações DIRETO abaixo da linha do item (sem UP/família fake)", async () => {
      chamadasVariacoesLegado = [];
      await clicar(cdp, '.am-row[data-item="MLB-SEMUP"] .am-row__variacoes-toggle');
      await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-SEMUP"] + .am-grupo-painel .am-mlb--variacao-legado')`,
        "o painel de variações legadas não carregou");

      const estado = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMUP"]');
        var toggle = r.querySelector('.am-row__variacoes-toggle');
        var painel = r.nextElementSibling;
        var linhas = Array.from(painel.querySelectorAll('.am-mlb--variacao-legado'));
        return {
          toggleAriaExpanded: toggle.getAttribute('aria-expanded'),
          painelEscondido: painel.hidden,
          totalLinhas: linhas.length,
          primeira: linhas[0].innerText,
          temAgrupadorFake: Boolean(painel.querySelector('.am-row--grupo, .am-variacao')),
          thumbSrcs: linhas.map(function (l) {
            var img = l.querySelector('.am-mlb__thumb img');
            return img ? img.getAttribute('src') : null;
          }),
          temPromo: Boolean(linhas[0].querySelector('.am-mlb__preco--promo')),
          temCondNaVariacao: Boolean(linhas[0].querySelector('.am-mlb__cond')),
        }; })()`);
      assert.strictEqual(estado.toggleAriaExpanded, "true");
      assert.strictEqual(estado.painelEscondido, false);
      assert.strictEqual(estado.totalLinhas, 2, "o fixture devolveu 2 variações");
      assert.ok(/Preto/.test(estado.primeira) && /34 BR/.test(estado.primeira),
        `a variação precisa mostrar a combinação de atributos: ${JSON.stringify(estado.primeira)}`);
      assert.ok(/49,90/.test(estado.primeira), "a variação precisa mostrar o preço");
      assert.strictEqual(estado.temAgrupadorFake, false,
        "não pode existir nível de família/User Product entre o item e suas variações legadas");
      assert.strictEqual(estado.temPromo, false,
        "sem precoAtual ao vivo (fixture padrão de margem não traz), não pode aparecer o par cheio riscado/atual em destaque");
      assert.strictEqual(estado.temCondNaVariacao, false,
        "o tipo do anúncio (Clássico/Premium) é só do card principal — não pode repetir em cada linha expandida");
      assert.strictEqual(chamadasVariacoesLegado.length, 1, "exatamente 1 chamada ao expandir");
      assert.deepStrictEqual(chamadasVariacoesLegado, ["MLB-SEMUP"]);
      assert.deepStrictEqual(
        estado.thumbSrcs,
        ["https://http2.mlstatic.com/D_preto-O.jpg", "https://http2.mlstatic.com/D_preto-O.jpg"],
        "as duas variações mostram thumbnail — compartilhar a mesma URL (fallback pra capa do item) é esperado, não quebra a linha"
      );
    });

    await check("7d — reabrir (colapsar/expandir) o mesmo item NÃO refaz a chamada (cache)", async () => {
      await clicar(cdp, '.am-row[data-item="MLB-SEMUP"] .am-row__variacoes-toggle'); // fecha
      const escondidoAoFechar = await cdp.evaluate(`document.querySelector('.am-row[data-item="MLB-SEMUP"] + .am-grupo-painel').hidden`);
      assert.strictEqual(escondidoAoFechar, true, "fechar o toggle precisa esconder o painel");

      await clicar(cdp, '.am-row[data-item="MLB-SEMUP"] .am-row__variacoes-toggle'); // reabre
      const visivel = await cdp.evaluate(`!document.querySelector('.am-row[data-item="MLB-SEMUP"] + .am-grupo-painel').hidden`);
      assert.strictEqual(visivel, true);
      assert.strictEqual(chamadasVariacoesLegado.length, 1, "reabrir não pode gastar uma segunda chamada");
    });

    await check("7e — clicar no TÍTULO do item ainda abre o modal de detalhe (o toggle não tomou a linha inteira)", async () => {
      const antes = pedidos.length;
      await clicar(cdp, '.am-row[data-item="MLB-SEMUP"] .am-row__titulo');
      await waitFor(cdp, "document.getElementById('am-det-modal')",
        "clicar no título do item legado precisa continuar abrindo o modal");
      await waitFor(cdp, "document.getElementById('am-det-titulo')", "o modal não terminou de carregar");
      assert.strictEqual(contar(/^\/anuncios-meli\/MLB-SEMUP\?/, antes), 1, "o modal precisa buscar o detalhe do item");
      // Fecha o modal para não atrapalhar as próximas verificações.
      await clicar(cdp, '#am-det-modal [data-acao="fechar"]');
    });

    const celEstoqueVariacaoLegado = (variationId) =>
      `.am-row[data-item="MLB-SEMUP"] + .am-grupo-painel .am-mlb--variacao-legado[data-variacao="${variationId}"] .am-estoque`;

    await check("7f — editar o estoque de UMA variação legada: PATCH por variação, painel repintado com os dados frescos do backend", async () => {
      escritasEstoqueVariacaoLegado.length = 0;
      const antesGets = chamadasVariacoesLegado.length;

      await clicar(cdp, `${celEstoqueVariacaoLegado(15092589430)} .am-estoque__btn`);
      await waitFor(cdp, `document.querySelector('${celEstoqueVariacaoLegado(15092589430)} .am-estoque__input')`,
        "o campo de edição da variação não abriu");
      await cdp.evaluate(`(function(){
        var inp = document.querySelector('${celEstoqueVariacaoLegado(15092589430)} .am-estoque__input');
        inp.value = '9';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await waitFor(cdp, `document.querySelector('${celEstoqueVariacaoLegado(15092589430)} .am-estoque__btn')`,
        "a variação não voltou ao estado de leitura após salvar");

      const estado = await cdp.evaluate(`(function(){
        var painel = document.querySelector('.am-row[data-item="MLB-SEMUP"] + .am-grupo-painel');
        var linhas = Array.from(painel.querySelectorAll('.am-mlb--variacao-legado'));
        return {
          totalLinhas: linhas.length,
          estoqueAlvo: document.querySelector('${celEstoqueVariacaoLegado(15092589430)} .am-estoque__btn').textContent.trim(),
          estoqueOutra: document.querySelector('${celEstoqueVariacaoLegado(15092589431)} .am-estoque__btn').textContent.trim(),
        }; })()`);

      assert.strictEqual(escritasEstoqueVariacaoLegado.length, 1, "esperava exatamente 1 PATCH");
      assert.strictEqual(escritasEstoqueVariacaoLegado[0].itemId, "MLB-SEMUP");
      assert.strictEqual(escritasEstoqueVariacaoLegado[0].variationId, 15092589430);
      assert.strictEqual(escritasEstoqueVariacaoLegado[0].corpo.estoque, 9);
      assert.strictEqual(estado.totalLinhas, 2, "o painel continua com as 2 variações depois de repintar");
      assert.strictEqual(estado.estoqueAlvo, "9", "a variação editada precisa refletir o valor confirmado pelo backend");
      assert.strictEqual(estado.estoqueOutra, "1", "a OUTRA variação não pode mudar — cada edição é por variação, sem propagação");
      assert.strictEqual(chamadasVariacoesLegado.length, antesGets,
        "sucesso não pode disparar um novo GET — o backend já devolveu as variações frescas na resposta do PATCH");
    });

    await check("7g — recusa comum do Mercado Livre: a variação volta ao valor anterior, sem sucesso silencioso", async () => {
      estoqueVariacaoLegadoHandler = () => ({ ok: false, codigo: "VARIACAO_GERENCIADA_EXTERNAMENTE", motivo: "Estoque gerenciado externamente." });

      await clicar(cdp, `${celEstoqueVariacaoLegado(15092589430)} .am-estoque__btn`);
      await waitFor(cdp, `document.querySelector('${celEstoqueVariacaoLegado(15092589430)} .am-estoque__input')`,
        "o campo de edição da variação não abriu");
      await cdp.evaluate(`(function(){
        var inp = document.querySelector('${celEstoqueVariacaoLegado(15092589430)} .am-estoque__input');
        inp.value = '77';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await waitFor(cdp, "document.querySelector('.vf-toast.is-danger')", "a recusa do backend não virou aviso na tela");

      const estoqueAlvo = await cdp.evaluate(
        `document.querySelector('${celEstoqueVariacaoLegado(15092589430)} .am-estoque__btn').textContent.trim()`
      );
      assert.strictEqual(estoqueAlvo, "9", "recusa comum não pode alterar o valor exibido — continua o da verificação 7f");
      estoqueVariacaoLegadoHandler = null;
    });

    await check("7h — perda crítica de variação: nunca sucesso, o painel é recarregado do zero (cache descartado)", async () => {
      // O GET de recarregamento (.../variacoes-legado) não passa por este
      // handler — só o PATCH. Por isso não precisa "desarmar" nada depois: a
      // releitura forçada sempre cai no fixture padrão.
      estoqueVariacaoLegadoHandler = () => ({
        ok: false, codigo: "PERDA_DE_VARIACAO", critico: true,
        motivo: "Uma ou mais variações podem ter sido removidas. Confira no Mercado Livre.",
      });
      const antesGets = chamadasVariacoesLegado.length;

      await clicar(cdp, `${celEstoqueVariacaoLegado(15092589430)} .am-estoque__btn`);
      await waitFor(cdp, `document.querySelector('${celEstoqueVariacaoLegado(15092589430)} .am-estoque__input')`,
        "o campo de edição da variação não abriu");
      await cdp.evaluate(`(function(){
        var inp = document.querySelector('${celEstoqueVariacaoLegado(15092589430)} .am-estoque__input');
        inp.value = '3';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await waitFor(cdp, "document.querySelector('.vf-toast.is-danger')", "a perda crítica não virou aviso na tela");

      // A releitura forçada é assíncrona: espera o painel voltar a mostrar as
      // 2 variações (prova de que o GET de recarregamento completou).
      await waitFor(cdp, `(function(){
        var painel = document.querySelector('.am-row[data-item="MLB-SEMUP"] + .am-grupo-painel');
        return painel && painel.querySelectorAll('.am-mlb--variacao-legado').length === 2;
      })()`, "o painel não recarregou depois da perda crítica");

      assert.ok(chamadasVariacoesLegado.length > antesGets,
        "perda crítica precisa forçar uma NOVA leitura — o cache local não é mais confiável");
      estoqueVariacaoLegadoHandler = null;
    });

    await check("7i — variação sem image_url mantém o ícone de fallback, sem quebrar a irmã com imagem", async () => {
      estoqueVariacaoLegadoHandler = () => ({
        ok: true,
        variacoes: [
          { id: 15092589430, atributos: [{ nome: "Color", valor: "Preto" }], preco: 49.9, estoque: 5, vendidos: 5, image_url: null },
          { id: 15092589431, atributos: [{ nome: "Color", valor: "Nude" }], preco: 49.9, estoque: 1, vendidos: 3, image_url: "https://http2.mlstatic.com/D_preto-O.jpg" },
        ],
      });

      await clicar(cdp, `${celEstoqueVariacaoLegado(15092589430)} .am-estoque__btn`);
      await waitFor(cdp, `document.querySelector('${celEstoqueVariacaoLegado(15092589430)} .am-estoque__input')`,
        "o campo de edição da variação não abriu");
      await cdp.evaluate(`(function(){
        var inp = document.querySelector('${celEstoqueVariacaoLegado(15092589430)} .am-estoque__input');
        inp.value = '5';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await waitFor(cdp, `document.querySelector('${celEstoqueVariacaoLegado(15092589430)} .am-estoque__btn')`,
        "a variação não voltou ao estado de leitura após salvar");

      const estado = await cdp.evaluate(`(function(){
        var painel = document.querySelector('.am-row[data-item="MLB-SEMUP"] + .am-grupo-painel');
        var linhas = Array.from(painel.querySelectorAll('.am-mlb--variacao-legado'));
        return linhas.map(function (l) {
          var thumb = l.querySelector('.am-mlb__thumb');
          return { temImg: Boolean(thumb.querySelector('img')), temSvg: Boolean(thumb.querySelector('svg')) };
        }); })()`);
      assert.strictEqual(estado[0].temImg, false, "sem image_url, a linha não pode renderizar <img>");
      assert.strictEqual(estado[0].temSvg, true, "sem image_url, cai no mesmo ícone de fallback já usado em anúncios sem foto");
      assert.strictEqual(estado[1].temImg, true, "a variação irmã com image_url continua mostrando a própria imagem");
      estoqueVariacaoLegadoHandler = null;
    });

    /* ── 8 a 10: expansão explícita, hierarquia e UP com 2 MLBs ─────────── */

    let antesExpandir = pedidos.length;
    await check("8 — expandir o agrupador põe os MLBs direto abaixo dele, reaproveitando o pré-carregamento (0 requisição nova de detalhe)", async () => {
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-mlb')`, "o painel do agrupador não carregou");
      const estado = await cdp.evaluate(`(function(){
        var r = document.querySelector('${linhaFam("FAM-1")}');
        var p = r.nextElementSibling;
        return {
          expandido: r.getAttribute('aria-expanded'),
          painelVisivel: !p.hidden,
          variacoes: p.querySelectorAll('.am-variacao').length,
          mlbs: p.querySelectorAll('.am-mlb').length,
          // Os MLBs são filhos do bloco de variação, e o bloco é filho direto
          // do painel: dois níveis de caixa, nenhum nível de tela entre eles.
          mlbsForaDeVariacao: p.querySelectorAll('.am-mlb:not(.am-variacao .am-mlb)').length,
        }; })()`);
      assert.strictEqual(estado.expandido, "true");
      assert.strictEqual(estado.painelVisivel, true);
      assert.strictEqual(estado.variacoes, 3, "o agrupador tem 3 variações");
      assert.strictEqual(estado.mlbs, 4, "o agrupador tem 4 anúncios no total");
      assert.strictEqual(estado.mlbsForaDeVariacao, 0);
      // A família já tinha sido pré-carregada em background na verificação 6
      // — expandir de verdade não pode buscar o detalhe de novo.
      assert.strictEqual(contar(/\/familias\/FAM-1/, antesExpandir), 0,
        "expandir refez a chamada de detalhe que o pré-carregamento em background já tinha feito");
    });

    await check("8b — a expansão é a continuação da tabela: colunas alinhadas ao cabeçalho", async () => {
      // A expansão já foi uma tabela SEPARADA, com grade própria: preço e
      // estoque do MLB caíam embaixo de outras colunas do cabeçalho. Agora a
      // grade é uma só, e o recuo do filho sai da miniatura (encostada à
      // direita da própria coluna), nunca do padding da linha — que
      // deslocaria a grade inteira.
      const g = await cdp.evaluate(`(function(){
        var cab = document.querySelector('.am-listagem__head');
        var mae = document.querySelector('.am-row[data-item]');
        var filho = document.querySelector('.am-mlb');
        var m = function(e){ var s = getComputedStyle(e);
          return { cols: s.gridTemplateColumns, esq: s.paddingLeft, dir: s.paddingRight, gap: s.columnGap }; };
        // x da coluna de estoque em cada nível, medido na tela
        var col = function(e, sel, n){ var c = e.querySelectorAll(sel)[n];
          return c ? Math.round(c.getBoundingClientRect().left) : null; };
        return {
          cab: m(cab), mae: m(mae), filho: m(filho),
          xEstoqueCab: col(cab, 'span', 4),
          xEstoqueMae: col(mae, '.am-row__num', 0),
          xEstoqueFilho: col(filho, '.am-mlb__num', 0),
        }; })()`);
      assert.deepStrictEqual(g.filho, g.mae,
        `a linha do MLB não usa a mesma grade/padding da linha da lista: ${JSON.stringify(g)}`);
      assert.deepStrictEqual(g.mae, g.cab, "a linha da lista não usa a mesma grade do cabeçalho");
      assert.strictEqual(g.xEstoqueFilho, g.xEstoqueMae,
        `a coluna Estoque do MLB não cai embaixo da coluna Estoque da lista (${g.xEstoqueFilho} vs ${g.xEstoqueMae})`);
      assert.strictEqual(g.xEstoqueMae, g.xEstoqueCab,
        `a coluna Estoque não cai embaixo do rótulo ESTOQUE (${g.xEstoqueMae} vs ${g.xEstoqueCab})`);
      // Métricas últ. 7 dias + Margem + Faturamento são 3 colunas NOVAS (grade
      // 8 -> 11): a grade tem de ter exatamente 11 faixas, e as três colunas
      // precisam alinhar entre cabeçalho/mãe/filho tanto quanto Estoque já
      // alinha — senão a expansão desalinharia bem no ponto que se corrigiu.
      const largurasCab = g.cab.cols.split(" ").filter(Boolean);
      assert.strictEqual(largurasCab.length, 11, `a grade precisa ter 11 colunas: ${g.cab.cols}`);
    });

    await check("8c — Faturamento, Métricas últ. 7 dias e Margem alinham entre cabeçalho, mãe e filho", async () => {
      const x = await cdp.evaluate(`(function(){
        var cab = document.querySelector('.am-listagem__head');
        var mae = document.querySelector('.am-row[data-item]');
        var filho = document.querySelector('.am-mlb');
        var col = function(e, sel, n){ var c = e.querySelectorAll(sel)[n];
          return c ? Math.round(c.getBoundingClientRect().left) : null; };
        return {
          faturamentoCab: col(cab, 'span', 6), faturamentoMae: col(mae, '.am-faturamento', 0), faturamentoFilho: col(filho, '.am-faturamento', 0),
          metricasCab: col(cab, 'span', 7), metricasMae: col(mae, '.am-metricas7d', 0), metricasFilho: col(filho, '.am-metricas7d', 0),
          margemCab: col(cab, 'span', 8), margemMae: col(mae, '.am-margem', 0), margemFilho: col(filho, '.am-margem', 0),
        }; })()`);
      assert.strictEqual(x.faturamentoMae, x.faturamentoCab, "coluna Faturamento não cai sob o rótulo do cabeçalho");
      assert.strictEqual(x.faturamentoFilho, x.faturamentoMae, "coluna Faturamento do MLB não alinha com a linha-mãe");
      assert.strictEqual(x.metricasMae, x.metricasCab, "coluna Métricas últ. 7 dias não cai sob o rótulo do cabeçalho");
      assert.strictEqual(x.metricasFilho, x.metricasMae, "coluna Métricas últ. 7 dias do MLB não alinha com a linha-mãe");
      assert.strictEqual(x.margemMae, x.margemCab, "coluna Margem não cai sob o rótulo do cabeçalho");
      assert.strictEqual(x.margemFilho, x.margemMae, "coluna Margem do MLB não alinha com a linha-mãe");
    });

    await check("8d — o card do MLB dentro da família tem os mesmos badges e o mesmo medidor de score do card legado", async () => {
      // MLB-A1 tem os 4 badges do fixture (Catálogo/Full/fotos/Revisado). Se
      // o card da família ainda escondesse essas informações (auditoria
      // "padronizar card MLB dentro de agrupadores"), .am-mlb__badges nem
      // existiria.
      const estado = await cdp.evaluate(`(function(){
        var filho = document.querySelector('.am-mlb[data-item="MLB-A1"]');
        var badges = filho.querySelector('.am-mlb__badges');
        var gauge = filho.querySelector('.am-gauge');
        return {
          temBadges: Boolean(badges),
          badgesTexto: badges ? badges.textContent : null,
          temTagCatalogo: Boolean(badges && badges.querySelector('.vf-tag.is-primary')),
          temTagFull: Boolean(badges && badges.querySelector('.vf-tag.is-info')),
          temTagFotos: Boolean(badges && badges.querySelector('.vf-tag.is-warning')),
          temTagRevisado: Boolean(badges && badges.querySelector('.vf-tag.is-success')),
          temGauge: Boolean(gauge),
          temScoreSimplesTambem: Boolean(filho.querySelector('.am-mlb__score')),
        }; })()`);
      assert.strictEqual(estado.temBadges, true, "o MLB dentro da família precisa ter .am-mlb__badges, igual ao card legado");
      assert.strictEqual(estado.temTagCatalogo, true, `faltou a tag Catálogo: ${estado.badgesTexto}`);
      assert.strictEqual(estado.temTagFull, true, `faltou a tag Full: ${estado.badgesTexto}`);
      assert.strictEqual(estado.temTagFotos, true, `faltou a tag de fotos: ${estado.badgesTexto}`);
      assert.strictEqual(estado.temTagRevisado, true, `faltou a tag Revisado: ${estado.badgesTexto}`);
      assert.strictEqual(estado.temGauge, true, "o MLB dentro da família precisa usar o mesmo medidor semicircular (.am-gauge) do card legado");
      assert.strictEqual(estado.temScoreSimplesTambem, false, "não pode sobrar o número simples de score junto do medidor");
    });

    await check("9 — a variação com 2 MLBs aparece UMA vez, Clássico antes de Premium", async () => {
      const up = await cdp.evaluate(`(function(){
        var alvo = Array.from(document.querySelectorAll(
          '${painelFam("FAM-1")} .am-variacao[data-user-product="MLBU-100"]'));
        var linhas = alvo.length ? Array.from(alvo[0].querySelectorAll('.am-mlb')) : [];
        return {
          ocorrencias: alvo.length,
          itens: linhas.map(function(r){ return r.getAttribute('data-item'); }),
          condicoes: linhas.map(function(r){
            var c = r.querySelector('.am-mlb__cond');
            return c ? c.textContent : null; }),
        }; })()`);
      assert.strictEqual(up.ocorrencias, 1, "a variação foi duplicada na tela");
      // O backend entrega MLB-A1 (Premium) antes de MLB-A2 (Clássico): a tela
      // reordena para a leitura do ML, sem depender de o padrão existir.
      assert.deepStrictEqual(up.itens, ["MLB-A2", "MLB-A1"]);
      assert.deepStrictEqual(up.condicoes, ["Clássico", "Premium"]);
    });

    await check("9b — cada variação é nome amigável + MLBU discreto, e o nome sai do título do ML", async () => {
      // O padrão do negócio é Clássico + Premium por variação, mas NÃO é
      // regra. As três formas precisam sair igualmente bem: mista, só
      // Clássico, só Premium — e as três precisam ter NOME.
      //
      // O nome vem da composição que o ML documenta (título = family_name +
      // valores dos atributos que variam): subtraindo "Camiseta Dry Fit
      // Masculina" do título sobra "Azul P" / "Azul M" / "Azul G", que é
      // exatamente o rótulo da listagem oficial.
      const formas = await cdp.evaluate(`(function(){
        return Array.from(document.querySelectorAll('${painelFam("FAM-1")} .am-variacao'))
          .map(function(b){
            var nome = b.querySelector('.am-variacao__nome');
            var id = b.querySelector('.am-variacao__id');
            return {
              up: b.getAttribute('data-user-product'),
              nome: nome ? nome.textContent : null,
              mlbu: id ? id.textContent : null,
              origem: b.getAttribute('data-nome-origem'),
              mlbs: Array.from(b.querySelectorAll('.am-mlb')).map(function(r){ return r.getAttribute('data-item'); }),
              condicoes: Array.from(b.querySelectorAll('.am-mlb__cond')).map(function(c){ return c.textContent; }),
            }; }); })()`);
      assert.deepStrictEqual(formas, [
        { up: "MLBU-100", nome: "Azul P", mlbu: "MLBU-100", origem: "sufixo",
          mlbs: ["MLB-A2", "MLB-A1"], condicoes: ["Clássico", "Premium"] },
        { up: "MLBU-200", nome: "Azul M", mlbu: "MLBU-200", origem: "sufixo",
          mlbs: ["MLB-A3"], condicoes: ["Clássico"] },
        { up: "MLBU-300", nome: "Azul G", mlbu: "MLBU-300", origem: "sufixo",
          mlbs: ["MLB-A4"], condicoes: ["Premium"] },
      ], `a matriz de variações mudou: ${JSON.stringify(formas, null, 2)}`);
    });

    await check("9b2 — o nome da variação é MAIS destacado que o MLBU ao lado dele", async () => {
      // A regra do pedido: nome em destaque, MLBU pequeno/discreto. Sem isso o
      // nível volta a ser "o nível do MLBU", que é o que se corrigiu. Medido
      // no estilo computado, não na classe: é o tamanho que o operador vê.
      const peso = await cdp.evaluate(`(function(){
        var b = document.querySelector('${painelFam("FAM-1")} .am-variacao');
        var n = getComputedStyle(b.querySelector('.am-variacao__nome'));
        var i = getComputedStyle(b.querySelector('.am-variacao__id'));
        var t = getComputedStyle(document.querySelector('${painelFam("FAM-1")} .am-mlb .am-mlb__ids'));
        return {
          nome: parseFloat(n.fontSize), pesoNome: Number(n.fontWeight),
          mlbu: parseFloat(i.fontSize), pesoMlbu: Number(i.fontWeight),
          legendaDaLinha: parseFloat(t.fontSize),
        }; })()`);
      assert.ok(peso.nome > peso.mlbu,
        `o nome da variação tem de ser maior que o MLBU (${peso.nome} vs ${peso.mlbu})`);
      assert.ok(peso.pesoNome > peso.pesoMlbu,
        `o nome da variação tem de ser mais pesado que o MLBU (${peso.pesoNome} vs ${peso.pesoMlbu})`);
      assert.strictEqual(peso.mlbu, peso.legendaDaLinha,
        "o MLBU tem de ter o tamanho de legenda da linha (o mesmo do MLB/SKU), não um tamanho próprio");
    });

    await check("9c — variação única com título fora da forma do ML: nome é o título inteiro", async () => {
      await clicar(cdp, linhaFam("FAM-2"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-2")} .am-mlb')`, "FAM-2 não abriu");
      const f2 = await cdp.evaluate(`(function(){
        var p = document.querySelector('${painelFam("FAM-2")}');
        var b = p.querySelector('.am-variacao');
        return {
          variacoes: p.querySelectorAll('.am-variacao').length,
          mlbs: Array.from(p.querySelectorAll('.am-mlb')).map(function(r){ return r.getAttribute('data-item'); }),
          nome: b.querySelector('.am-variacao__nome').textContent,
          mlbu: b.querySelector('.am-variacao__id').textContent,
          origem: b.getAttribute('data-nome-origem'),
          irmas: p.querySelectorAll('.am-mlb--irma').length,
        }; })()`);
      assert.strictEqual(f2.variacoes, 1);
      assert.deepStrictEqual(f2.mlbs, ["MLB-B9"]);
      // "Caneca Térmica Inox 500ml" NÃO começa por "Caneca Térmica 500ml": não
      // há sufixo para extrair, então o nome é o título inteiro. Um recorte
      // parcial aqui ("Inox", "Inox 500ml") seria regra inventada.
      assert.strictEqual(f2.nome, "Caneca Térmica Inox 500ml");
      assert.strictEqual(f2.origem, "titulo", "o nome deveria ter caído no fallback do título inteiro");
      assert.strictEqual(f2.mlbu, "MLBU-300C");
      assert.strictEqual(f2.irmas, 0);
      // Volta a FAM-2 ao estado fechado para não mudar o cenário das próximas.
      await clicar(cdp, linhaFam("FAM-2"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-2")}').hidden === true`, "FAM-2 não colapsou");
    });

    await check("10 — a variação é subtítulo, não entidade: o MLBU aparece só como legenda dela", async () => {
      const estado = await cdp.evaluate(`(function(){
        var painel = document.querySelector('${painelFam("FAM-1")}');
        var bloco = painel.querySelector('.am-variacao');
        // Todo texto "MLBU-…" visível na página, e onde ele mora.
        var ondeApareceMlbu = Array.from(document.querySelectorAll('body *'))
          .filter(function(e){
            if (e.children.length) return false;                 // só folhas
            return /MLBU-/.test(e.textContent || '');
          })
          .map(function(e){ return e.className || e.tagName; });
        return {
          // A faixa "PRODUTO MLBU-… · 2 anúncios" que era o nível intermediário
          // não pode voltar: o nível agora se chama pelo NOME da variação.
          faixaAntiga: document.querySelectorAll('.am-up, .am-up__head, .am-up__contagem').length,
          tag: bloco.tagName,
          temRole: bloco.hasAttribute('role'),
          temTabindex: bloco.hasAttribute('tabindex'),
          chaveInterna: bloco.getAttribute('data-user-product'),
          ondeApareceMlbu: ondeApareceMlbu,
          // Um MLBU por variação — nem zero (perdeu a legenda), nem repetido
          // em cada linha de anúncio.
          quantosMlbu: document.querySelectorAll('.am-variacao__id').length,
          quantasVariacoes: document.querySelectorAll('.am-variacao').length,
        }; })()`);
      assert.strictEqual(estado.faixaAntiga, 0, "a faixa antiga do User Product voltou");
      assert.strictEqual(estado.tag, "DIV");
      assert.strictEqual(estado.temRole, false, "a variação não pode ser controle: ela não abre nada");
      assert.strictEqual(estado.temTabindex, false, "a variação não pode receber foco: não há ação nela");
      assert.strictEqual(estado.chaveInterna, "MLBU-100", "o MLBU tem de seguir disponível como dado");
      assert.strictEqual(estado.quantosMlbu, estado.quantasVariacoes,
        "cada variação mostra exatamente um MLBU");
      assert.deepStrictEqual(
        Array.from(new Set(estado.ondeApareceMlbu)),
        ["am-variacao__id vf-mono"],
        `MLBU escrito fora da legenda da variação: ${JSON.stringify(estado.ondeApareceMlbu)}`
      );
    });

    await check("10b — a linha principal do agrupador mostra o ID do agrupador", async () => {
      const ids = await cdp.evaluate(`(function(){
        var ids = document.querySelector('${linhaFam("FAM-1")} .am-row__ids');
        return { texto: ids.innerText, mono: Array.from(ids.querySelectorAll('.vf-mono'))
          .map(function(e){ return e.textContent; }) }; })()`);
      assert.deepStrictEqual(ids.mono, ["FAM-1"],
        `o ID maior do agrupador não aparece na linha principal: ${JSON.stringify(ids)}`);
      assert.ok(/3 variações/.test(ids.texto), "os agregados do grupo saíram da linha principal");
    });

    await check("10c — o título não é repetido na linha quando a variação já o disse", async () => {
      // Com o nome da variação acima, o título na linha do anúncio seria a
      // terceira repetição da mesma frase. Ele volta a aparecer SÓ quando
      // difere de verdade — o que no fixture é o caso do Premium de MLBU-100,
      // que está com título divergente no snapshot.
      const titulos = await cdp.evaluate(`(function(){
        return Array.from(document.querySelectorAll(
          '${painelFam("FAM-1")} .am-variacao[data-user-product="MLBU-100"] .am-mlb'))
          .map(function(r){
            var t = r.querySelector('.am-mlb__titulo');
            return { item: r.getAttribute('data-item'), titulo: t ? t.textContent : null };
          }); })()`);
      assert.deepStrictEqual(titulos, [
        // Clássico: o título nomeou a variação, então não se repete na linha.
        { item: "MLB-A2", titulo: null },
        // Premium: título divergente no snapshot — aparece, porque esconder
        // seria esconder um dado real.
        { item: "MLB-A1", titulo: "Camiseta Dry Fit Masculina Azul P (12 parcelas)" },
      ], JSON.stringify(titulos));
    });

    /* ── 11: cache — colapsar e reabrir não gasta requisição ────────────── */

    await check("11 — colapsar e reabrir o mesmo agrupador NÃO gasta requisição nova", async () => {
      const antes = pedidos.length;
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")}').hidden === true`, "não colapsou");
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")}').hidden === false`, "não reabriu");
      const mlbs = await cdp.evaluate(`document.querySelectorAll('${painelFam("FAM-1")} .am-mlb').length`);
      assert.strictEqual(mlbs, 4, "o conteúdo não voltou ao reabrir");
      assert.strictEqual(contar(/\/familias\/FAM-1/, antes), 0, "reabrir gastou requisição — o cache não funcionou");
    });

    /* ── 12: guarda de corrida entre dois agrupadores ───────────────────── */

    await check("12 — resposta atrasada do agrupador A não pinta o painel do agrupador B", async () => {
      // Recarregar a página é o jeito honesto de zerar o cache da FAM-1 sem
      // abrir um hook de teste dentro do código de produção.
      atrasoDetalheFamilia = { "FAM-1": 700 };
      pedidos.length = 0;
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
      await waitFor(cdp, "document.querySelector('.am-row--grupo')", "a lista não voltou depois do reload");

      await clicar(cdp, linhaFam("FAM-1"));
      await clicar(cdp, linhaFam("FAM-2"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-2")} .am-mlb')`, "o agrupador B não carregou");

      const b = await cdp.evaluate(`(function(){
        return Array.from(document.querySelectorAll('${painelFam("FAM-2")} .am-mlb'))
          .map(function(r){ return r.getAttribute('data-item'); }); })()`);
      assert.deepStrictEqual(b, ["MLB-B9"], "o painel do agrupador B recebeu dados de outro agrupador");

      // Espera a resposta atrasada de A chegar e confirma que ela foi para o
      // painel de A, sem contaminar o de B.
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-mlb')`, "o agrupador A não carregou depois do atraso");
      const depois = await cdp.evaluate(`(function(){
        return Array.from(document.querySelectorAll('${painelFam("FAM-2")} .am-mlb'))
          .map(function(r){ return r.getAttribute('data-item'); }); })()`);
      assert.deepStrictEqual(depois, ["MLB-B9"], "a resposta atrasada de A sobrescreveu o painel de B");
      atrasoDetalheFamilia = {};
    });

    /* ── 13: troca de conta invalida o cache ───────────────────────────── */

    await check("13 — trocar de conta limpa o cache: o agrupador não volta com dados da conta anterior", async () => {
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-mlb')`, "FAM-1 precisa estar carregada antes da troca");
      // O MLBU saiu da tela mas continua sendo a chave do agrupamento: é por
      // ele que se comprova QUAL conta pintou o painel.
      const antesTroca = await cdp.evaluate(
        `document.querySelector('${painelFam("FAM-1")} .am-variacao').getAttribute('data-user-product')`);
      assert.strictEqual(antesTroca, "MLBU-100");

      await cdp.evaluate("window.VF.context.setConta('43')");
      await waitFor(cdp, `(function(){ var t = document.querySelector('.am-row--grupo .am-row__titulo');
        return t && t.textContent === 'FAMÍLIA DA LOJA B'; })()`,
        "a lista não trocou junto com a conta");

      const abertas = await cdp.evaluate("document.querySelectorAll('.am-row--grupo[aria-expanded=\"true\"]').length");
      assert.strictEqual(abertas, 0, "o agrupador continuou expandido depois da troca de conta");

      // O cache velho (family_id="FAM-1" da conta 42) foi limpo na troca — o
      // pré-carregamento em background da conta NOVA busca de novo, mesmo o
      // family_id sendo o MESMO texto nas duas contas do fixture.
      await waitFor(cdp, `(function(){
        var t = document.querySelector('${linhaFam("FAM-1")} .am-metricas7d');
        return t && !t.classList.contains('am-metricas7d--carregando'); })()`,
        "o pré-carregamento em background da conta nova não terminou");

      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-mlb')`, "o agrupador da nova conta não carregou");
      const up = await cdp.evaluate(
        `document.querySelector('${painelFam("FAM-1")} .am-variacao').getAttribute('data-user-product')`);
      assert.strictEqual(up, "MLBU-900", "veio o dado cacheado da conta anterior — o cache velho vazou para a conta nova");
    });

    /* ── 14 e 15: os cards de KPI valem para a lista inteira ────────────── */

    await check("14 — nenhum card de KPI fica desabilitado", async () => {
      const estado = await cdp.evaluate(`(function(){
        var m = {};
        document.querySelectorAll('#am-resumo [data-kpi]').forEach(function(b){ m[b.getAttribute('data-kpi')] = b.disabled; });
        return m; })()`);
      const desabilitados = Object.keys(estado).filter((k) => estado[k]);
      assert.deepStrictEqual(desabilitados, [],
        `com uma lista só, nenhum card pode ficar fora: ${JSON.stringify(desabilitados)}`);
      assert.ok(Object.keys(estado).length >= 8, "os cards de KPI não montaram");
    });

    await check("15 — clicar num card de KPI recorta a lista única", async () => {
      // Volta para a conta 42, que tem os três tipos de linha.
      await cdp.evaluate("window.VF.context.setConta('42')");
      await waitFor(cdp, "document.querySelectorAll('.am-listagem > .am-row').length === 4", "a lista da conta 42 não voltou");
      const antes = pedidos.length;
      await clicar(cdp, '#am-resumo [data-kpi="sem_sku"]');
      await waitFor(cdp, "document.querySelectorAll('.am-listagem > .am-row').length === 1", "o filtro não recortou a lista");
      const pedido = pedidos.slice(antes).filter((u) => /^\/anuncios-meli\/familias\?/.test(u)).pop();
      assert.ok(/[?&]filtro=sem_sku/.test(pedido || ""), `o filtro não chegou à lista única: ${pedido}`);
      assert.strictEqual(contar(/^\/anuncios-meli\?/, antes), 0, "o filtro caiu na listagem plana");
      const indicador = await cdp.evaluate("document.getElementById('am-filtros-ativos').classList.contains('am-hidden')");
      assert.strictEqual(indicador, false, "o filtro ligado pelo operador precisa contar como filtro ativo");
      // Desliga para não contaminar as verificações seguintes.
      await clicar(cdp, '#am-resumo [data-kpi="sem_sku"]');
      await waitFor(cdp, "document.querySelectorAll('.am-listagem > .am-row').length === 4", "o filtro não foi desligado");
    });

    /* ── 16 e 17: as duas formas de linha abrem o mesmo modal ───────────── */

    await check("16 — clicar numa linha MLB do agrupador abre o modal do MLB CERTO", async () => {
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, "document.querySelector('.am-mlb')", "o agrupador não trouxe linhas MLB");

      // A ação do filho tem de sair do item_id DELE. Alvo escolhido de
      // propósito: a segunda linha de MLBU-100 (a irmã, MLB-A1) — se alguma
      // ação usasse o identificador do grupo ou o do primeiro filho, é aqui
      // que apareceria.
      const alvo = await cdp.evaluate(`(function(){
        var linhas = document.querySelectorAll('.am-variacao[data-user-product="MLBU-100"] .am-mlb');
        var r = linhas[1];
        var link = r.querySelector('.am-row__link');
        return { item: r.getAttribute('data-item'), href: link ? link.getAttribute('href') : null,
                 irma: r.classList.contains('am-mlb--irma') }; })()`);
      assert.strictEqual(alvo.item, "MLB-A1");
      assert.strictEqual(alvo.irma, true);
      // "Abrir no Mercado Livre" é permalink por ITEM, nunca do grupo.
      assert.strictEqual(alvo.href, "https://produto.mercadolivre.com.br/MLB-A1",
        `o link externo do filho não aponta para o próprio MLB: ${alvo.href}`);

      const antes = pedidos.length;
      await clicar(cdp, '.am-variacao[data-user-product="MLBU-100"] .am-mlb--irma');
      await waitFor(cdp, "document.querySelector('.am-det-modal')", "o modal não abriu pela linha do agrupador");
      await waitFor(cdp, "document.getElementById('am-det-titulo')", "o modal não terminou de carregar");
      const m = await cdp.evaluate(`(function(){
        var e = document.querySelector('.am-det-modal');
        return { role: e.getAttribute('role'), modal: e.getAttribute('aria-modal') }; })()`);
      assert.strictEqual(m.role, "dialog");
      assert.strictEqual(m.modal, "true");
      assert.strictEqual(contar(/^\/anuncios-meli\/MLB-A1\?/, antes), 1,
        "o modal precisa pedir o detalhe do MLB clicado");
      // Nenhuma requisição de detalhe pode sair com o identificador do grupo.
      assert.strictEqual(contar(/^\/anuncios-meli\/FAM-/, 0), 0,
        "alguma ação de item saiu com family_id no lugar do item_id");
    });

    await check("17 — clicar no anúncio individual abre o MESMO modal, direto", async () => {
      await clicar(cdp, '.am-det-modal [data-acao="fechar"]');
      await waitFor(cdp, "!document.querySelector('.am-det-modal')", "o modal não fechou");
      const antes = pedidos.length;
      await clicar(cdp, '.am-row[data-item="MLB-SEMUP"]');
      await waitFor(cdp, "document.querySelector('.am-det-modal')", "o modal não abriu pela linha individual");
      await waitFor(cdp, "document.getElementById('am-det-titulo')", "o modal não terminou de carregar");
      assert.strictEqual(contar(/^\/anuncios-meli\/MLB-SEMUP\?/, antes), 1,
        "a linha individual precisa abrir o detalhe do próprio MLB");
    });

    /* ── 18 a 21: a capa do agrupador é a que o backend escolheu ────────── */

    // O reload devolve a tela ao contexto da conta 42 e fecha o modal do 17.
    // Guardo os erros de JS acumulados até aqui porque o documento novo zera
    // window.__erros e a última verificação precisa cobrir a sessão inteira.
    // Acumulador de erros de JS entre os vários reloads deste arquivo: cada
    // Page.navigate reinicia window.__erros (o script que o zera roda de
    // novo em todo documento novo), então cada reload precisa somar o que já
    // tinha antes de navegar — a checagem final soma tudo + o que sobrou.
    let errosAcumulados = await cdp.evaluate("window.__erros || []");
    pedidos.length = 0;
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
    await waitFor(cdp, "document.querySelector('.am-row--grupo')", "a lista não voltou depois do reload");

    const capaDe = (familyId) => `(function(){
      var m = document.querySelector(${JSON.stringify(linhaFam(familyId) + " .am-row__thumb")});
      var img = m && m.querySelector('img');
      return { temImg: Boolean(img), src: img ? img.getAttribute('src') : null,
               temPlaceholder: Boolean(m && m.querySelector('svg')) }; })()`;

    await check("18 — o agrupador FECHADO já mostra a capa escolhida pela API", async () => {
      // A capa vem PRONTA na lista (cover.thumbnail) — não depende da busca
      // de detalhe, que agora roda sozinha em BACKGROUND para todo
      // agrupador visível (é dali que vêm as métricas 7d agregadas, nunca a
      // capa). Por isso a verificação não é mais "zero chamada de detalhe":
      // é "a capa certa aparece MESMO SEM esperar essa chamada responder".
      const capa = await cdp.evaluate(capaDe("FAM-1"));
      assert.strictEqual(capa.temImg, true, "o agrupador fechado continuou no placeholder cinza");
      assert.strictEqual(capa.src, CAPA_FAM1, "a capa não é a que veio em cover.thumbnail");
      assert.strictEqual(capa.temPlaceholder, false, "o ícone de placeholder ficou junto da imagem");
    });

    await check("19 — agrupador sem capa na API mantém o placeholder", async () => {
      const capa = await cdp.evaluate(capaDe("FAM-2"));
      assert.strictEqual(capa.temImg, false, "inventou imagem para um agrupador sem cover.thumbnail");
      assert.strictEqual(capa.temPlaceholder, true, "sem capa a moldura precisa manter o ícone");
    });

    await check("20 — expandir não altera a capa: quem decide é o backend", async () => {
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-mlb')`, "FAM-1 não abriu");
      const fam1 = await cdp.evaluate(capaDe("FAM-1"));
      assert.strictEqual(fam1.src, CAPA_FAM1,
        `a expansão trocou a capa pela imagem de um item (${fam1.src})`);

      // FAM-2 é o caso decisivo: o item TEM imagem e a API disse que o
      // agrupador não tem capa. Se o front voltar a deduzir, se entrega aqui.
      await clicar(cdp, linhaFam("FAM-2"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-2")} .am-mlb')`, "FAM-2 não abriu");
      const fam2 = await cdp.evaluate(capaDe("FAM-2"));
      assert.strictEqual(fam2.temImg, false,
        `o front recalculou a capa a partir dos itens (${fam2.src})`);
      assert.strictEqual(fam2.temPlaceholder, true);
    });

    await check("21 — a busca troca a capa conforme a variação relevante da API", async () => {
      const antes = pedidos.length;
      await cdp.evaluate(`(function(){
        var i = document.getElementById('am-busca');
        i.value = 'Azul';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitFor(cdp,
        `(function(){ var i = document.querySelector('${linhaFam("FAM-1")} .am-row__thumb img');
           return i && i.getAttribute('src') === ${JSON.stringify(CAPA_FAM1_BUSCA)}; })()`,
        "a capa não acompanhou a busca");
      const pedido = pedidos.slice(antes).filter((u) => /^\/anuncios-meli\/familias\?/.test(u)).pop();
      assert.ok(/[?&]q=Azul/.test(pedido || ""), `a busca não chegou à lista: ${pedido}`);
      assert.strictEqual(contar(/^\/anuncios-meli\?/, antes), 0, "a busca também disparou a listagem plana");
    });

    /* ── 23 a 27: estoque editável na linha do MLB ──────────────────────── */

    // O cenário volta ao estado sem busca (a 21 deixou q=Azul, e com ele a
    // lista só tem FAM-1).
    const abrirFam1Limpo = async () => {
      await cdp.evaluate(`(function(){
        var i = document.getElementById('am-busca');
        i.value = '';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitFor(cdp, `document.querySelector('${linhaFam("FAM-2")}')`, "a lista não voltou ao estado sem busca");
      if (!(await cdp.evaluate(`document.querySelector('${painelFam("FAM-1")} .am-mlb') !== null`))) {
        await clicar(cdp, linhaFam("FAM-1"));
      }
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-mlb')`, "FAM-1 não reabriu");
    };

    const celEstoque = (item) => `.am-mlb[data-item="${item}"] .am-estoque`;

    await check("23 — a célula de estoque do MLB é editável e NÃO abre o modal", async () => {
      await abrirFam1Limpo();
      const antes = pedidos.length;
      await clicar(cdp, `${celEstoque("MLB-A2")} .am-estoque__btn`);
      await waitFor(cdp, `document.querySelector('${celEstoque("MLB-A2")} .am-estoque__input')`,
        "o clique no estoque não abriu o campo");
      const estado = await cdp.evaluate(`(function(){
        var inp = document.querySelector('${celEstoque("MLB-A2")} .am-estoque__input');
        var cel = document.querySelector('${celEstoque("MLB-A2")}');
        var col = function(sel){ var e = document.querySelector(sel);
          return e ? Math.round(e.getBoundingClientRect().left) : null; };
        return {
          valor: inp.value,
          focado: document.activeElement === inp,
          modalAberto: Boolean(document.getElementById('am-det-titulo')),
          // Editar não pode mexer na grade: a célula continua na coluna de
          // estoque, alinhada ao cabeçalho.
          xCelula: Math.round(cel.getBoundingClientRect().left),
          xCabecalho: col('.am-listagem__head span:nth-child(5)'),
        }; })()`);
      assert.strictEqual(estado.valor, "100", "o campo tem de abrir com o estoque atual");
      assert.strictEqual(estado.focado, true, "o campo tem de receber o foco para o operador digitar direto");
      assert.strictEqual(estado.modalAberto, false,
        "o clique na célula de estoque abriu o modal do anúncio — a célula é controle próprio da linha");
      assert.strictEqual(estado.xCelula, estado.xCabecalho,
        `editar deslocou a coluna de estoque (${estado.xCelula} vs ${estado.xCabecalho})`);
      assert.strictEqual(contar(/\/estoque/, antes), 0, "abrir o campo não pode escrever nada");
    });

    await check("24 — Esc cancela sem escrever no Mercado Livre", async () => {
      const antes = pedidos.length;
      await cdp.evaluate(`(function(){
        var inp = document.querySelector('${celEstoque("MLB-A2")} .am-estoque__input');
        inp.value = '77';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      })()`);
      await waitFor(cdp, `document.querySelector('${celEstoque("MLB-A2")} .am-estoque__btn')`,
        "Esc não devolveu a célula ao estado de leitura");
      const estado = await cdp.evaluate(`(function(){
        return {
          texto: document.querySelector('${celEstoque("MLB-A2")} .am-estoque__btn').textContent.trim(),
          modalAberto: Boolean(document.getElementById('am-det-titulo')),
        }; })()`);
      assert.strictEqual(estado.texto, "100", "Esc tem de restaurar o valor anterior");
      assert.strictEqual(estado.modalAberto, false, "o Esc dentro do campo não pode vazar para a linha");
      assert.strictEqual(contar(/\/estoque/, antes), 0, "Esc não pode ter escrito no Mercado Livre");
    });

    await check("25 — Enter salva, e o irmão do MESMO MLBU acompanha o estoque", async () => {
      // A regra do ML: available_quantity é replicado em todos os itens do
      // mesmo user_product_id. Salvar a partir do Clássico tem de mover o
      // Premium junto — e a lista de irmãos vem do servidor, não é deduzida.
      const antes = pedidos.length;
      escritasEstoque.length = 0;
      await clicar(cdp, `${celEstoque("MLB-A2")} .am-estoque__btn`);
      await waitFor(cdp, `document.querySelector('${celEstoque("MLB-A2")} .am-estoque__input')`, "o campo não abriu");
      await cdp.evaluate(`(function(){
        var inp = document.querySelector('${celEstoque("MLB-A2")} .am-estoque__input');
        inp.value = '55';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await waitFor(cdp,
        `(function(){ var b = document.querySelector('${celEstoque("MLB-A2")} .am-estoque__btn');
           return b && b.textContent.trim() === '55'; })()`,
        "o estoque salvo não apareceu na célula");

      assert.strictEqual(escritasEstoque.length, 1, "esperava exatamente uma escrita");
      assert.strictEqual(escritasEstoque[0].itemId, "MLB-A2");
      assert.strictEqual(escritasEstoque[0].corpo.estoque, 55);
      assert.strictEqual(escritasEstoque[0].corpo.clienteSlug, "n97");
      assert.strictEqual(contar(/^\/anuncios-meli\/MLB-A2\/estoque/, antes), 1);

      const depois = await cdp.evaluate(`(function(){
        var ler = function(item){
          var b = document.querySelector('.am-mlb[data-item="' + item + '"] .am-estoque .am-estoque__btn');
          return b ? b.textContent.trim() : null; };
        return {
          editado: ler('MLB-A2'),
          irmao: ler('MLB-A1'),
          outraVariacao: ler('MLB-A3'),
          // O Enter que salva não pode subir para a linha, que trata Enter
          // como "abrir o modal". Salvar substitui o conteudo da celula e
          // desliga o campo do documento, entao um guard que dependa de
          // closest() a partir do alvo ja nao acha a celula: a barreira tem
          // de vir ANTES de mexer no DOM.
          modalAberto: Boolean(document.getElementById('am-det-titulo')),
        }; })()`);
      assert.strictEqual(depois.modalAberto, false, "o Enter de salvar abriu o modal do anúncio");
      assert.strictEqual(depois.editado, "55");
      assert.strictEqual(depois.irmao, "55",
        "o irmão do mesmo MLBU tem de acompanhar: o ML replica available_quantity por User Product");
      assert.strictEqual(depois.outraVariacao, "100",
        "outra variação (outro MLBU) não pode se mover — a replicação é por UP, não por família");
    });

    await check("26 — o estoque agregado do agrupador acompanha, somando por MLBU", async () => {
      // 55 (MLBU-100, que tem 2 MLBs) + 100 + 100 = 255. Se a tela somasse
      // item a item daria 310, que é o bug que a listagem unificada corrigiu.
      const agregado = await cdp.evaluate(`(function(){
        var c = document.querySelectorAll('${linhaFam("FAM-1")} .am-row__num');
        return { estoque: c[0].textContent.trim(), vendidos: c[1].textContent.trim() }; })()`);
      assert.strictEqual(agregado.estoque, "255",
        `o agregado do agrupador não acompanhou a edição somando por MLBU: ${agregado.estoque}`);
      assert.strictEqual(agregado.vendidos, "31", "vendidos não tem nada a ver com a edição de estoque");
      // A expansão continua aberta: repintar a linha-mãe não pode fechar o
      // painel e tirar o operador de onde ele estava.
      const aberto = await cdp.evaluate(
        `(function(){ var p = document.querySelector('${painelFam("FAM-1")}');
           return { visivel: p && !p.hidden, mlbs: p ? p.querySelectorAll('.am-mlb').length : 0,
                    aria: document.querySelector('${linhaFam("FAM-1")}').getAttribute('aria-expanded') }; })()`);
      assert.deepStrictEqual(aberto, { visivel: true, mlbs: 4, aria: "true" },
        "salvar o estoque fechou ou esvaziou a expansão");
    });

    await check("27 — recusa do Mercado Livre: a célula volta ao valor anterior e o motivo aparece", async () => {
      estoqueHandler = () => ({
        ok: false,
        codigo: "item.available_quantity.invalid",
        motivo: "O Mercado Livre recusou esta quantidade para o anúncio.",
      });
      try {
        // O aviso de sucesso da 25 ainda pode estar na tela (os toasts vivem
        // ~3s): limpar a pilha é o que garante que o aviso lido aqui é O desta
        // verificação.
        await cdp.evaluate(`(function(){
          var s = document.getElementById('am-toast-stack');
          if (s) s.innerHTML = '';
        })()`);
        await clicar(cdp, `${celEstoque("MLB-A2")} .am-estoque__btn`);
        await waitFor(cdp, `document.querySelector('${celEstoque("MLB-A2")} .am-estoque__input')`, "o campo não abriu");
        await cdp.evaluate(`(function(){
          var inp = document.querySelector('${celEstoque("MLB-A2")} .am-estoque__input');
          inp.value = '9';
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        })()`);
        await waitFor(cdp, "document.querySelector('.vf-toast')", "a recusa do ML não virou aviso na tela");
        const estado = await cdp.evaluate(`(function(){
          return {
            texto: document.querySelector('${celEstoque("MLB-A2")} .am-estoque__btn').textContent.trim(),
            irmao: document.querySelector('.am-mlb[data-item="MLB-A1"] .am-estoque__btn').textContent.trim(),
            aviso: document.querySelector('.vf-toast').innerText,
            toastDeErro: Boolean(document.querySelector('.vf-toast.is-danger')),
          }; })()`);
        assert.strictEqual(estado.texto, "55",
          "recusado pelo ML, o número na tela tem de ser o de antes — nunca o que o operador digitou");
        assert.strictEqual(estado.irmao, "55", "uma recusa não pode mover o irmão");
        assert.match(estado.aviso, /recusou esta quantidade/,
          `o motivo do ML precisa chegar ao operador: ${estado.aviso}`);
        assert.strictEqual(estado.toastDeErro, true, "a recusa tem de ser sinalizada como erro");
      } finally {
        estoqueHandler = null;
      }
    });

    await check("27b — o anúncio individual também edita estoque; o agrupador e o item legado COM variações NÃO", async () => {
      // "Cada linha MLB" inclui o anúncio sem agrupamento: ele é um MLB como
      // qualquer outro. A linha do AGRUPADOR é uma exceção, e não por
      // esquecimento: o estoque dela é a soma das variações, não um número
      // que exista no Mercado Livre para ser escrito. O item LEGADO COM
      // variações (MLB-SEMUP, variations_count 24) é a OUTRA exceção, pela
      // mesma razão de fundo: o ML trata available_quantity da raiz do item
      // como agregado quando há variations[] (variacoes.md, "Modificar
      // estoque") — só a linha de cada variação (ver checks 7f/38f) pode
      // escrever. MLB-SEMVAR (mesmo "sem UP", mas SEM variações no ML) é quem
      // prova o caso individual editável de verdade.
      const onde = await cdp.evaluate(`(function(){
        return {
          individual: Boolean(document.querySelector('.am-row[data-item="MLB-SEMVAR"] .am-estoque')),
          agrupador: Boolean(document.querySelector('${linhaFam("FAM-1")} .am-estoque')),
          itemLegadoComVariacoes: Boolean(document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-estoque')),
        }; })()`);
      assert.strictEqual(onde.individual, true, "o anúncio individual sem variações precisa ter estoque editável");
      assert.strictEqual(onde.agrupador, false,
        "a linha do agrupador não pode ter estoque editável: o número dela é soma, não dado do ML");
      assert.strictEqual(onde.itemLegadoComVariacoes, false,
        "item legado COM variações não pode editar estoque no card principal: isso é por variação (ver 7f/38f)");

      const antes = pedidos.length;
      escritasEstoque.length = 0;
      await clicar(cdp, '.am-row[data-item="MLB-SEMVAR"] .am-estoque .am-estoque__btn');
      await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-SEMVAR"] .am-estoque__input')`,
        "o campo não abriu no anúncio individual");
      await cdp.evaluate(`(function(){
        var inp = document.querySelector('.am-row[data-item="MLB-SEMVAR"] .am-estoque__input');
        inp.value = '0';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await waitFor(cdp,
        `(function(){ var b = document.querySelector('.am-row[data-item="MLB-SEMVAR"] .am-estoque__btn');
           return b && b.textContent.trim() === '0'; })()`,
        "o estoque 0 não apareceu na linha do anúncio individual");

      assert.strictEqual(escritasEstoque.length, 1);
      assert.strictEqual(escritasEstoque[0].corpo.estoque, 0, "zero tem de chegar ao servidor como 0");
      assert.strictEqual(contar(/^\/anuncios-meli\/MLB-SEMVAR\/estoque/, antes), 1);

      // available_quantity = 0 pausa o anúncio no ML. O status na linha vem do
      // que o servidor reportou — deixá-la "Ativo" seria a tela mentindo.
      const depois = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMVAR"]');
        return {
          status: r.querySelector('.vf-status').textContent.trim(),
          estoque: r.querySelector('.am-estoque__btn').textContent.trim(),
          modalAberto: Boolean(document.getElementById('am-det-titulo')),
        }; })()`);
      assert.strictEqual(depois.estoque, "0");
      assert.strictEqual(depois.status, "Pausado",
        "estoque 0 pausa o anúncio no ML: a linha tem de acompanhar o status que o servidor devolveu");
      assert.strictEqual(depois.modalAberto, false, "editar o estoque abriu o modal do anúncio");
    });

    /* ── 29 a 38: Métricas últ. 7 dias + Margem ─────────────────────────
     *
     * Bloco isolado com reload próprio: as verificações de "antes/depois da
     * resposta" precisam de uma página recém-carregada, sem cache de
     * performance de nenhuma verificação anterior.
     */

    errosAcumulados = errosAcumulados.concat(await cdp.evaluate("window.__erros || []"));
    pedidos.length = 0;
    chamadasPerformance.length = 0;
    atrasoPerformance = 400; // atraso proposital: dá tempo de observar o "carregando" antes da resposta
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
    await waitFor(cdp, "document.querySelector('.am-row[data-item]')", "a lista não voltou depois do reload");

    await check("29 — a linha já está completa (título, preço) ANTES de /performance responder — inclusive a soma do agrupador", async () => {
      const estado = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMUP"]');
        var fam1 = document.querySelector('${linhaFam("FAM-1")} .am-metricas7d');
        return {
          tituloExiste: Boolean(r.querySelector('.am-row__titulo')),
          precoExiste: /49,90/.test(r.querySelector('.am-row__preco').textContent),
          metricasCarregando: r.querySelector('.am-metricas7d').classList.contains('am-metricas7d--carregando'),
          margemCarregando: r.querySelector('.am-margem').classList.contains('am-margem--carregando'),
          agrupadorCarregando: fam1.classList.contains('am-metricas7d--carregando'),
          agrupadorMargemTexto: document.querySelector('${linhaFam("FAM-1")} .am-margem').textContent.trim(),
        }; })()`);
      assert.strictEqual(estado.tituloExiste, true, "a lista não pode esperar /performance para renderizar o resto da linha");
      assert.strictEqual(estado.precoExiste, true);
      assert.strictEqual(estado.metricasCarregando, true, "a célula tem de nascer 'carregando', não vazia nem quebrada");
      assert.strictEqual(estado.margemCarregando, true);
      assert.strictEqual(estado.agrupadorCarregando, true,
        "a soma do agrupador também nasce 'carregando' — nunca uma soma parcial antes de todos os filhos responderem");
      assert.strictEqual(estado.agrupadorMargemTexto, "—", "a margem do agrupador nunca aparece, nem durante o carregamento");
    });

    await check("30 — depois que /performance responde, a célula do item avulso pinta os números reais", async () => {
      atrasoPerformance = 0;
      await waitFor(cdp, `(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMUP"]');
        return r && !r.querySelector('.am-metricas7d').classList.contains('am-metricas7d--carregando'); })()`,
        "as métricas não resolveram depois da resposta");
      const dados = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMUP"]');
        var linhas = Array.from(r.querySelectorAll('.am-metricas7d .am-metricas7d__linha')).map(function(e){ return e.textContent; });
        return {
          linhas: linhas,
          margemValor: (r.querySelector('.am-margem__valor') || {}).textContent || null,
          margemOrigem: (r.querySelector('.am-margem__origem') || {}).textContent || null,
        }; })()`);
      assert.deepStrictEqual(dados.linhas, ["👁 259", "🛒 3 · 1,2%"], JSON.stringify(dados.linhas));
      assert.strictEqual(dados.margemValor, "25,0%");
      assert.strictEqual(dados.margemOrigem, "Realizada");
    });

    await check("30b — o agrupador mostra a SOMA das métricas 7d dos filhos SOZINHO, sem precisar expandir", async () => {
      // MLB-A1 (views null) + MLB-A2 (100) + MLB-A3/A4 (10 cada, default do
      // fixture) = 120 views; vendas 0+0+1+1 = 2; conversão 2/120 = 1,7%.
      await waitFor(cdp, `(function(){
        var t = document.querySelector('${linhaFam("FAM-1")} .am-metricas7d');
        return t && !t.classList.contains('am-metricas7d--carregando'); })()`,
        "a soma do agrupador não resolveu depois da resposta do pré-carregamento");
      const estado = await cdp.evaluate(`(function(){
        var r = document.querySelector('${linhaFam("FAM-1")}');
        return {
          linhas: Array.from(r.querySelectorAll('.am-metricas7d .am-metricas7d__linha')).map(function(e){ return e.textContent; }),
          margemTexto: r.querySelector('.am-margem').textContent.trim(),
          expandido: r.getAttribute('aria-expanded'),
          mlbsRenderizados: document.querySelectorAll('${painelFam("FAM-1")} .am-mlb').length,
        }; })()`);
      assert.deepStrictEqual(estado.linhas, ["👁 120", "🛒 2 · 1,7%"],
        `o agrupador não somou os filhos automaticamente: ${JSON.stringify(estado.linhas)}`);
      assert.strictEqual(estado.margemTexto, "—", "a margem do agrupador continua ausente mesmo com a soma pronta");
      assert.strictEqual(estado.expandido, "false", "a soma automática não pode expandir o painel sozinha");
      assert.strictEqual(estado.mlbsRenderizados, 0, "a soma automática só busca dado — não pinta os MLBs no painel");
    });

    await check("30c — item com promoção ativa (preco_original) mostra o preço cheio riscado ACIMA do preço vigente", async () => {
      const preco = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMUP"]');
        var cel = r.querySelector('.am-row__preco');
        var original = cel.querySelector('.am-row__preco-original');
        var atual = cel.querySelector('.am-row__preco-atual');
        return {
          temClassePromo: cel.classList.contains('am-row__preco--promo'),
          original: original ? original.textContent.trim() : null,
          atual: atual ? atual.textContent.trim() : null,
          // "acima": no DOM (coluna via flex-direction:column) o original vem
          // ANTES do atual — é essa ordem que a CSS empilha de cima pra baixo.
          ordemDom: Array.from(cel.children).map(function(e){ return e.className; }),
        };
      })()`);
      assert.strictEqual(preco.temClassePromo, true, "a célula precisa sinalizar o estado de promoção");
      assert.strictEqual(preco.original, "R$ 69,90", "o preço cheio (preco_original) precisa aparecer");
      assert.strictEqual(preco.atual, "R$ 49,90", "o preço vigente continua sendo o mesmo de sempre");
      assert.ok(/preco-original/.test(preco.ordemDom[0]), `o preço cheio riscado precisa vir ANTES (acima) do vigente no DOM: ${JSON.stringify(preco.ordemDom)}`);
    });

    await check("31 — régua do boot: 1 chamada com métricas+margem+faturamento (avulso) + 1 chamada só de métricas por agrupador visível + 1 chamada de faturamento consolidado das famílias", async () => {
      assert.strictEqual(contar(/\/familias\/FAM-1/, 0), 1, "o pré-carregamento de FAM-1 devia ter gastado exatamente 1 chamada de detalhe");
      assert.strictEqual(contar(/\/familias\/FAM-2/, 0), 1, "o pré-carregamento de FAM-2 devia ter gastado exatamente 1 chamada de detalhe");

      assert.strictEqual(chamadasPerformance.length, 4,
        `o boot deveria disparar 4 chamadas de performance (1 avulso + 1 por agrupador + 1 de faturamento consolidado): ${JSON.stringify(chamadasPerformance)}`);

      const doAvulso = chamadasPerformance.find((c) => c.itemIds.includes("MLB-SEMUP"));
      assert.ok(doAvulso, "não achei a chamada dos itens avulsos");
      assert.deepStrictEqual(doAvulso.itemIds.slice().sort(), ["MLB-SEMUP", "MLB-SEMVAR"],
        "os dois anúncios avulsos (com e sem variações legadas) estão visíveis como ITEM no boot");
      assert.strictEqual(doAvulso.incluirMetricas, true);
      assert.strictEqual(doAvulso.incluirMargem, true, "o item avulso pede métricas E margem juntas, como sempre");
      assert.strictEqual(doAvulso.incluirFaturamento, true,
        "o % faturamento do item avulso é bundlado na MESMA chamada de métricas+margem — não é uma chamada à parte");

      const doFam1 = chamadasPerformance.find((c) => c.itemIds.includes("MLB-A1"));
      assert.ok(doFam1, "não achei a chamada em background dos filhos de FAM-1");
      assert.deepStrictEqual(doFam1.itemIds.slice().sort(), ["MLB-A1", "MLB-A2", "MLB-A3", "MLB-A4"],
        "o pré-carregamento de FAM-1 precisa pedir exatamente os 4 filhos — nem mais, nem menos");
      assert.strictEqual(doFam1.incluirMetricas, true);
      assert.strictEqual(doFam1.incluirMargem, false,
        "o pré-carregamento em background NUNCA pode pedir margem de um filho ainda oculto");
      assert.strictEqual(doFam1.incluirFaturamento, false,
        "o pré-carregamento por filho NUNCA pede faturamento — o consolidado da família vem de outra chamada, por familias=");

      const doFam2 = chamadasPerformance.find((c) => c.itemIds.includes("MLB-B9"));
      assert.ok(doFam2, "não achei a chamada em background do filho de FAM-2");
      assert.deepStrictEqual(doFam2.itemIds.slice().sort(), ["MLB-B9"]);
      assert.strictEqual(doFam2.incluirMargem, false);

      const doFaturamentoFamilias = chamadasPerformance.find((c) => c.familias.length && !c.itemIds.length);
      assert.ok(doFaturamentoFamilias, "não achei a chamada de faturamento consolidado das famílias visíveis");
      assert.deepStrictEqual(doFaturamentoFamilias.familias.slice().sort(), ["FAM-1", "FAM-2"],
        "as duas famílias visíveis na página precisam ir na MESMA chamada — nunca uma por família");
      assert.strictEqual(doFaturamentoFamilias.incluirFaturamento, true);
      assert.strictEqual(doFaturamentoFamilias.incluirMargem, false,
        "a chamada de faturamento consolidado não pode gastar o Motor de Margem para mais nada além do faturamento");
    });

    await check("32 — expandir a família pinta as métricas dos filhos NA HORA (já vinham do pré-carregamento) e busca só a margem que faltava", async () => {
      const antesPerformance = chamadasPerformance.length;
      const antesPedidos = pedidos.length;
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-mlb')`, "FAM-1 não expandiu");

      // As métricas do filho já pintam no PRIMEIRO frame da expansão — nunca
      // passam por "carregando": o pré-carregamento em background já tinha
      // trazido a resposta antes mesmo do clique.
      const metricasNaAbertura = await cdp.evaluate(`(function(){
        var c = document.querySelector('.am-mlb[data-item="MLB-A2"] .am-metricas7d');
        return { carregando: c.classList.contains('am-metricas7d--carregando'),
                 linhas: Array.from(c.querySelectorAll('.am-metricas7d__linha')).map(function(e){ return e.textContent; }) }; })()`);
      assert.strictEqual(metricasNaAbertura.carregando, false,
        "as métricas do filho não podiam nascer 'carregando' na expansão — já estavam no cache do pré-carregamento");
      assert.deepStrictEqual(metricasNaAbertura.linhas, ["👁 100", "🛒 0 · 0,0%"]);

      await waitFor(cdp, `(function(){
        var c = document.querySelector('.am-mlb[data-item="MLB-A2"] .am-margem');
        return c && !c.classList.contains('am-margem--carregando'); })()`, "a margem dos filhos não resolveu");

      assert.strictEqual(contar(/\/familias\/FAM-1/, antesPedidos), 0,
        "a família já tinha sido pré-carregada em background — expandir não pode buscar o detalhe de novo");
      assert.strictEqual(chamadasPerformance.length, antesPerformance + 1, "expandir devia disparar exatamente 1 chamada nova de performance");
      const ultima = chamadasPerformance[chamadasPerformance.length - 1];
      assert.deepStrictEqual(ultima.itemIds.slice().sort(), ["MLB-A1", "MLB-A2", "MLB-A3", "MLB-A4"],
        "a chamada da expansão precisa ter exatamente os 4 filhos de FAM-1 — nem mais, nem menos");
      assert.strictEqual(ultima.incluirMargem, true, "a expansão de verdade tem de pedir a margem");
      assert.strictEqual(ultima.incluirMetricas, false,
        "as métricas 7d já vieram do pré-carregamento em background — expandir não pode refazer essa chamada");
      // MLB-B9 (filho de FAM-2) já apareceu no histórico ANTES desta
      // verificação — é o pré-carregamento em background da verificação 31,
      // legítimo mesmo com FAM-2 fechada. O que não pode acontecer é ele
      // aparecer numa chamada NOVA disparada por clicar em FAM-1, e a
      // asserção acima (o conteúdo exato de `ultima`) já garante isso.
    });

    await check("33 — reabrir a MESMA família não refaz a chamada de performance (cache)", async () => {
      const antes = chamadasPerformance.length;
      await clicar(cdp, linhaFam("FAM-1")); // colapsa
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")}').hidden === true`, "não colapsou");
      await clicar(cdp, linhaFam("FAM-1")); // reabre
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")}').hidden === false`, "não reabriu");

      const semCarregando = await cdp.evaluate(`(function(){
        var c = document.querySelector('.am-mlb[data-item="MLB-A2"] .am-margem');
        return c ? c.classList.contains('am-margem--carregando') : true; })()`);
      assert.strictEqual(semCarregando, false,
        "reabrir precisa mostrar os dados já conhecidos de imediato, sem voltar a 'carregando'");
      assert.strictEqual(chamadasPerformance.length, antes,
        "reabrir a mesma família gastou uma chamada de performance nova — o cache não funcionou");
    });

    await check("34 — a linha do AGRUPADOR continua sem número de margem mesmo depois de expandida e com os filhos resolvidos", async () => {
      const estado = await cdp.evaluate(`(function(){
        var r = document.querySelector('${linhaFam("FAM-1")}');
        var m = r.querySelector('.am-margem');
        return {
          margemTexto: m.textContent.trim(), margemTemValor: Boolean(r.querySelector('.am-margem__valor')),
          margemClasse: m.className,
        }; })()`);
      // Margem: NUNCA agrega, mesmo expandida — regra do usuário sem exceção.
      assert.strictEqual(estado.margemTexto, "—");
      assert.strictEqual(estado.margemTemValor, false, "a linha do agrupador não pode mostrar número de margem");
      assert.ok(/am-margem--indisponivel/.test(estado.margemClasse));
    });

    await check("34b — a linha do AGRUPADOR ainda expandida com o painel colapsado continua com a soma", async () => {
      // Colapsar não pode apagar o agregado que a linha-mãe já mostra — ele
      // não depende do painel estar visível, só do cache já conhecer os filhos.
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")}').hidden === true`, "FAM-1 não colapsou");
      const texto = await cdp.evaluate(`document.querySelector('${linhaFam("FAM-1")} .am-metricas7d').textContent.trim()`);
      assert.notStrictEqual(texto, "—", "colapsar não pode apagar a soma das métricas já conhecida");
      // Reabre para não alterar o estado esperado pelas próximas verificações.
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")}').hidden === false`, "FAM-1 não reabriu");
    });

    await check("34c — o agrupador FAM-2 (nunca expandido pelo operador) TAMBÉM mostra a soma automática", async () => {
      // FAM-2 nunca recebeu um clique de expandir neste bloco — mas o
      // pré-carregamento em background já buscou o único filho dela (a régua
      // da verificação 31 prova isso), então a soma aparece sozinha, igual à
      // de FAM-1. Isto é o oposto do comportamento antigo (que exigia
      // expandir): mostrar "—" aqui seria a REGRESSÃO agora.
      const estado = await cdp.evaluate(`(function(){
        var t = document.querySelector('${linhaFam("FAM-2")} .am-metricas7d');
        return {
          linhas: Array.from(t.querySelectorAll('.am-metricas7d__linha')).map(function(e){ return e.textContent; }),
          classe: t.className,
        }; })()`);
      assert.deepStrictEqual(estado.linhas, ["👁 10", "🛒 1 · 10,0%"],
        `FAM-2 (1 filho, MLB-B9, sem fixture específica) devia mostrar a soma automática: ${JSON.stringify(estado.linhas)}`);
      assert.ok(!/am-metricas7d--indisponivel|am-metricas7d--carregando/.test(estado.classe), estado.classe);
    });

    await check("35 — conversão nunca é NaN/Infinity: '—' sem views, número real (inclusive 0%) com views", async () => {
      const linhas = await cdp.evaluate(`(function(){
        function ler(item){
          return Array.from(document.querySelectorAll('.am-mlb[data-item="' + item + '"] .am-metricas7d .am-metricas7d__linha'))
            .map(function(e){ return e.textContent; });
        }
        return { a1: ler("MLB-A1"), a2: ler("MLB-A2") }; })()`);
      assert.deepStrictEqual(linhas.a1, ["👁 —", "🛒 0"],
        "sem views (dado desconhecido), a conversão some — mas vendas=0 real ainda aparece como número");
      assert.deepStrictEqual(linhas.a2, ["👁 100", "🛒 0 · 0,0%"],
        "vendas=0 real COM views>0 é uma conversão real de 0,0% — nunca um travessão escondendo o fato");
      const semNan = await cdp.evaluate(`!/NaN|Infinity/.test(document.querySelector('${painelFam("FAM-1")}').innerText)`);
      assert.strictEqual(semNan, true, "NaN/Infinity nunca pode vazar para a tela");
    });

    await check("36 — margem sem número (UNVALIDATED): rótulo REAL do Motor, com a razão real como tooltip", async () => {
      const estado = await cdp.evaluate(`(function(){
        var c = document.querySelector('.am-mlb[data-item="MLB-A2"] .am-margem');
        var e = c.querySelector('.am-margem__estado');
        return { texto: e ? e.textContent : null, title: e ? e.getAttribute('title') : null,
                 temValor: Boolean(c.querySelector('.am-margem__valor')) }; })()`);
      assert.strictEqual(estado.texto, "Não validado", "o texto tem de ser o rótulo real do Motor (LABELS.UNVALIDATED)");
      assert.match(estado.title || "", /custo/i, "a razão real (statusReasons) precisa estar acessível");
      assert.strictEqual(estado.temValor, false, "sem margem computável não pode inventar número");
    });

    await check("37 — margem negativa usa cor de risco; o selo mostra a origem certa", async () => {
      const estado = await cdp.evaluate(`(function(){
        var c = document.querySelector('.am-mlb[data-item="MLB-A1"] .am-margem');
        var v = c.querySelector('.am-margem__valor');
        return { texto: v ? v.textContent : null, classe: v ? v.className : null,
                 origem: (c.querySelector('.am-margem__origem') || {}).textContent || null,
                 temDot: Boolean(c.querySelector('.vf-info-dot')),
                 tipTexto: (c.querySelector('.vf-info__tip') || {}).textContent || null }; })()`);
      assert.strictEqual(estado.texto, "-5,0%");
      assert.ok(/is-danger/.test(estado.classe), `prejuízo tem de usar a cor de risco: ${estado.classe}`);
      assert.strictEqual(estado.origem, "Realizada");
      assert.strictEqual(estado.temDot, true, "precisa existir o selo discreto de explicação (vf-info-dot)");
      assert.match(estado.tipTexto || "", /Calculada pelo Motor de Margem/,
        "o tooltip discreto tem de dizer que a margem vem do Motor de Margem");
    });

    await check("38 — margem indisponível no nível de CONTEXTO: mensagem real do backend, em vez de número ou 'Não validado'", async () => {
      performanceHandler = (ids) => {
        const metricas7d = {};
        ids.forEach((id) => { metricas7d[id] = { views: 5, vendas: 0, conversao: null }; });
        return {
          ok: true, metricas7d, margem: {},
          margemIndisponivel: { codigo: "BASE_MELI_NAO_VINCULADA", mensagem: "Base de custos MELI não vinculada para esta operação." },
        };
      };
      try {
        await clicar(cdp, linhaFam("FAM-2"));
        await waitFor(cdp, `document.querySelector('${painelFam("FAM-2")} .am-mlb')`, "FAM-2 não expandiu");
        await waitFor(cdp, `(function(){
          var c = document.querySelector('.am-mlb[data-item="MLB-B9"] .am-margem');
          return c && !c.classList.contains('am-margem--carregando'); })()`, "a margem de FAM-2 não resolveu");
        const estado = await cdp.evaluate(`(function(){
          var c = document.querySelector('.am-mlb[data-item="MLB-B9"] .am-margem');
          var e = c.querySelector('.am-margem__estado');
          return { texto: e ? e.textContent : c.textContent.trim(), temValor: Boolean(c.querySelector('.am-margem__valor')) }; })()`);
        assert.match(estado.texto, /Base de custos MELI não vinculada/,
          "tem de mostrar a MESMA mensagem que o backend mandou — nunca uma tradução própria");
        assert.strictEqual(estado.temValor, false);
        // Fecha para não contaminar o próximo bloco.
        await clicar(cdp, linhaFam("FAM-2"));
        await waitFor(cdp, `document.querySelector('${painelFam("FAM-2")}').hidden === true`, "FAM-2 não colapsou");
      } finally {
        performanceHandler = null;
      }
    });

    await check("38b — precoAtual (ao vivo, do Motor) atualiza in-place o valor 'atual', sem apagar o preço riscado (agora também ao vivo)", async () => {
      // achado do merge com feat/anuncios-motor-margem-pausados: a célula de
      // preço tem DOIS donos (riscado + atual ao vivo) e uma resolução de
      // conflito ingênua no GitHub (accept current/incoming inteiro) apaga
      // um dos dois. Aqui provamos que os dois convivem — o riscado, desde a
      // auditoria de preço cheio, também vem do Motor (item.pricing.list /
      // margem[itemId].precoOriginal), não mais congelado no snapshot
      // (a.preco_original) enquanto o Motor CONTINUA confirmando a mesma
      // promoção (ver 38c/38d para os casos em que o Motor diverge do snapshot).
      performanceHandler = (ids) => {
        const margem = {};
        ids.forEach((id) => {
          margem[id] = Object.assign(
            {},
            MARGEM_FIXTURE[id] || { origem: "projected", margin: 0.2, marginPercent: 20, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [] },
            id === "MLB-SEMUP" ? { precoAtual: 44.9, precoOriginal: 69.9 } : {}
          );
        });
        return { ok: true, metricas7d: {}, margem, margemIndisponivel: null };
      };
      try {
        pedidos.length = 0;
        chamadasPerformance.length = 0;
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await waitFor(cdp, "document.querySelector('.am-row[data-item]')", "a lista não recarregou");
        await waitFor(cdp, `(function(){
          var el = document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-row__preco-atual');
          return el && /44,90/.test(el.textContent);
        })()`, "o preço 'atual' não atualizou ao vivo (precoAtual do Motor)");

        const estado = await cdp.evaluate(`(function(){
          var cel = document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-row__preco');
          return {
            original: cel.querySelector('.am-row__preco-original').textContent.trim(),
            atual: cel.querySelector('.am-row__preco-atual').textContent.trim(),
          };
        })()`);
        assert.strictEqual(estado.original, "R$ 69,90", "o preço riscado não pode sumir quando o preço ao vivo chega");
        assert.strictEqual(estado.atual, "R$ 44,90", "o valor atual precisa refletir precoAtual (ao vivo), não mais o sincronizado (R$ 49,90)");
      } finally {
        performanceHandler = null;
      }
    });

    await check("38c — precoOriginal (ao vivo, do Motor) FAZ NASCER o preço riscado num item que NÃO tinha promoção na sincronização", async () => {
      // Auditoria de preço cheio: até aqui, uma promoção que só existe no
      // sale_price (automação de preço, por exemplo — original_price do
      // /items fica null nesse caso, ver documentacao_api_meli) nunca
      // aparecia riscada, porque a lista só lia o snapshot (a.preco_original)
      // do momento da sincronização. MLB-A2 (filha de FAM-1) nasce SEM
      // preco_original no fixture — aqui o Motor traz a promoção ao vivo.
      performanceHandler = (ids) => {
        const metricas7d = {};
        const margem = {};
        ids.forEach((id) => {
          metricas7d[id] = METRICAS_FIXTURE[id] || { views: 10, vendas: 1, conversao: 10 };
          margem[id] = Object.assign(
            {},
            MARGEM_FIXTURE[id] || { origem: "projected", margin: 0.2, marginPercent: 20, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [] },
            id === "MLB-A2" ? { precoAtual: 79.9, precoOriginal: 99.9 } : {}
          );
        });
        return { ok: true, metricas7d, margem, margemIndisponivel: null };
      };
      try {
        pedidos.length = 0;
        chamadasPerformance.length = 0;
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await waitFor(cdp, "document.querySelector('.am-row[data-item]')", "a lista não recarregou");
        await clicar(cdp, linhaFam("FAM-1"));
        await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-mlb')`, "FAM-1 não expandiu");
        await waitFor(cdp, `(function(){
          var cel = document.querySelector('.am-mlb[data-item="MLB-A2"] .am-mlb__preco');
          return cel && cel.classList.contains('am-mlb__preco--promo');
        })()`, "a filha MLB-A2 não ganhou o preço riscado ao vivo");

        const estado = await cdp.evaluate(`(function(){
          var cel = document.querySelector('.am-mlb[data-item="MLB-A2"] .am-mlb__preco');
          var original = cel.querySelector('.am-mlb__preco-original');
          var atual = cel.querySelector('.am-mlb__preco-atual');
          return {
            original: original ? original.textContent.trim() : null,
            atual: atual ? atual.textContent.trim() : null,
          };
        })()`);
        assert.strictEqual(estado.original, "R$ 99,90", "o preço cheio ao vivo (sale_price.regular_amount) precisa aparecer mesmo sem promoção no snapshot");
        assert.strictEqual(estado.atual, "R$ 79,90");
      } finally {
        performanceHandler = null;
      }
    });

    await check("38d — precoOriginal ausente ao vivo APAGA o preço riscado que só existia no snapshot da sincronização", async () => {
      // Espelho de 38c: a promoção pode ter ACABADO desde a última
      // sincronização (preco_original do banco ainda é 69.90) — o Motor, ao
      // vivo, não traz mais regular_amount, e a lista não pode continuar
      // mostrando um preço cheio que já não existe no Mercado Livre.
      performanceHandler = (ids) => {
        const metricas7d = {};
        const margem = {};
        ids.forEach((id) => {
          metricas7d[id] = METRICAS_FIXTURE[id] || { views: 10, vendas: 1, conversao: 10 };
          margem[id] = Object.assign(
            {},
            MARGEM_FIXTURE[id] || { origem: "projected", margin: 0.2, marginPercent: 20, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [] },
            id === "MLB-SEMUP" ? { precoAtual: 49.9, precoOriginal: null } : {}
          );
        });
        return { ok: true, metricas7d, margem, margemIndisponivel: null };
      };
      try {
        pedidos.length = 0;
        chamadasPerformance.length = 0;
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await waitFor(cdp, "document.querySelector('.am-row[data-item]')", "a lista não recarregou");
        await waitFor(cdp, `(function(){
          var cel = document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-row__preco');
          return cel && !cel.classList.contains('am-row__preco--promo');
        })()`, "o preço riscado do snapshot não sumiu quando o Motor deixou de confirmar a promoção");

        const estado = await cdp.evaluate(`(function(){
          var cel = document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-row__preco');
          return {
            temOriginal: Boolean(cel.querySelector('.am-row__preco-original')),
            texto: cel.textContent.trim(),
          };
        })()`);
        assert.strictEqual(estado.temOriginal, false, "sem regular_amount ao vivo, o riscado não pode continuar vindo só do snapshot");
        assert.strictEqual(estado.texto, "R$ 49,90");
      } finally {
        performanceHandler = null;
      }
    });

    await check("38e — precoOriginal ao vivo IGUAL ao precoAtual não é promoção: mostra só o preço atual, sem riscado", async () => {
      // Bug reportado após 38c/38d: quando sale_price.regular_amount volta
      // igual a amount (não é mais um desconto — o ML pode devolver os dois
      // iguais fora de promoção), o código antigo ainda tratava
      // `precoOriginal != null` como "tem promoção" e riscava o MESMO valor
      // do preço atual (ex.: "R$ 98,00" riscado sobre "R$ 98,00" atual).
      // MLB-SEMUP TEM preco_original no snapshot (69.90) — prova que o Motor
      // ao vivo (dizendo "sem diferença real") também vence o snapshot aqui,
      // igual 38d já provava para precoOriginal null.
      performanceHandler = (ids) => {
        const metricas7d = {};
        const margem = {};
        ids.forEach((id) => {
          metricas7d[id] = METRICAS_FIXTURE[id] || { views: 10, vendas: 1, conversao: 10 };
          margem[id] = Object.assign(
            {},
            MARGEM_FIXTURE[id] || { origem: "projected", margin: 0.2, marginPercent: 20, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [] },
            id === "MLB-SEMUP" ? { precoAtual: 98, precoOriginal: 98 } : {}
          );
        });
        return { ok: true, metricas7d, margem, margemIndisponivel: null };
      };
      try {
        pedidos.length = 0;
        chamadasPerformance.length = 0;
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await waitFor(cdp, "document.querySelector('.am-row[data-item]')", "a lista não recarregou");
        await waitFor(cdp, `(function(){
          var el = document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-row__preco');
          return el && /98,00/.test(el.textContent);
        })()`, "o preço 'atual' não atualizou ao vivo");

        const estado = await cdp.evaluate(`(function(){
          var cel = document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-row__preco');
          return {
            classe: cel.className,
            temOriginal: Boolean(cel.querySelector('.am-row__preco-original')),
            texto: cel.textContent.trim(),
          };
        })()`);
        assert.ok(!/--promo\b/.test(estado.classe), `precoOriginal igual ao atual não é promoção — classe: ${estado.classe}`);
        assert.strictEqual(estado.temOriginal, false, "não pode riscar o mesmo valor que já é o preço atual");
        assert.strictEqual(estado.texto, "R$ 98,00");
      } finally {
        performanceHandler = null;
      }
    });

    await check("38f — variação legada: cheio riscado (variation.price) + vigente em destaque (preço ao vivo do anúncio), MESMO componente visual da linha principal", async () => {
      // Investigação confirmou: o ML não documenta sale_price/promoção por
      // variação (só por ANÚNCIO). A origem dos dados não mudou — só a
      // apresentação: agora usa o MESMO par "cheio riscado / atual em
      // destaque" da linha principal (ver celulaPrecoHtml), com
      // variation.price sempre no papel de "cheio" e o preço ao vivo do
      // anúncio sempre no papel de "atual" — nunca o contrário.
      performanceHandler = (ids) => {
        const margem = {};
        ids.forEach((id) => {
          margem[id] = Object.assign(
            {},
            MARGEM_FIXTURE[id] || { origem: "projected", margin: 0.2, marginPercent: 20, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [] },
            id === "MLB-SEMUP" ? { precoAtual: 89.9, precoOriginal: 99.9 } : {}
          );
        });
        return { ok: true, metricas7d: {}, margem, margemIndisponivel: null };
      };
      // variation.price precisa ser MAIOR que o preço ao vivo do anúncio
      // (89.9) para o par riscado/destaque nascer — replica o exemplo pedido
      // (R$ 99,00 riscado / R$ 89,90 em destaque), sem mexer no fixture
      // compartilhado por 7c/7d/7f/7h (que dependem de price 49.9).
      variacoesLegadoHandler = () => VARIACOES_LEGADO_MLB_SEMUP.map((v) => Object.assign({}, v, { price: 99.9 }));
      try {
        pedidos.length = 0;
        chamadasVariacoesLegado = [];
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await waitFor(cdp, "document.querySelector('.am-row[data-item]')", "a lista não recarregou");
        // Confirma que a promoção do ANÚNCIO (linha-mãe) já chegou antes de
        // expandir — senão a variação não teria de onde tirar o "atual".
        await waitFor(cdp, `(function(){
          var el = document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-row__preco-atual');
          return el && /89,90/.test(el.textContent);
        })()`, "a promoção do anúncio não chegou na linha-mãe antes da expansão");

        await clicar(cdp, '.am-row[data-item="MLB-SEMUP"] .am-row__variacoes-toggle');
        await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-SEMUP"] + .am-grupo-painel .am-mlb--variacao-legado')`,
          "o painel de variações legadas não carregou");

        const estado = await cdp.evaluate(`(function(){
          var linhas = Array.from(document.querySelectorAll('.am-row[data-item="MLB-SEMUP"] + .am-grupo-painel .am-mlb--variacao-legado'));
          return linhas.map(function (l) {
            var cel = l.querySelector('.am-mlb__preco');
            var original = cel.querySelector('.am-mlb__preco-original');
            var atual = cel.querySelector('.am-mlb__preco-atual');
            var img = l.querySelector('.am-mlb__thumb img');
            return {
              temPromo: cel.classList.contains('am-mlb__preco--promo'),
              cheioRiscado: original ? original.textContent.trim() : null,
              atualDestaque: atual ? atual.textContent.trim() : null,
              thumbSrc: img ? img.getAttribute('src') : null,
            };
          }); })()`);

        assert.strictEqual(estado.length, 2, "o fixture continua com 2 variações");
        estado.forEach(function (linha, i) {
          assert.strictEqual(linha.temPromo, true, `variação ${i}: precisa ganhar a classe --promo (mesmo componente da linha principal)`);
          assert.strictEqual(linha.cheioRiscado, "R$ 99,90",
            `variação ${i}: o valor riscado precisa ser o PRÓPRIO da variação (variation.price), nunca um preço inventado`);
          assert.strictEqual(linha.atualDestaque, "R$ 89,90",
            `variação ${i}: o valor em destaque precisa ser o preço ao vivo do ANÚNCIO, nunca um sale_price fabricado por variação`);
          assert.strictEqual(linha.thumbSrc, "https://http2.mlstatic.com/D_preto-O.jpg",
            `variação ${i}: a melhoria de preço não pode ter quebrado a imagem da variação`);
        });
      } finally {
        performanceHandler = null;
        variacoesLegadoHandler = null;
      }
    });

    await check("38g — variação com inventory_id nasce BLOQUEADA (sem botão, motivo visível de cara); a livre continua editável", async () => {
      // O contrato vem PRONTO do backend (podeEditarEstoque/motivoBloqueio) —
      // esta tela nunca decide sozinha se inventory_id bloqueia. A variação
      // 15092589430 ganha inventory_id só nesta checagem (via
      // variacoesLegadoHandler, sem mexer no fixture compartilhado por
      // 7c/7d/7f/7h); a 15092589431 continua livre.
      variacoesLegadoHandler = () => VARIACOES_LEGADO_MLB_SEMUP.map((v) =>
        v.id === 15092589430 ? Object.assign({}, v, { inventory_id: "INV-BLOQ-1" }) : v
      );
      try {
        pedidos.length = 0;
        chamadasVariacoesLegado = [];
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await waitFor(cdp, "document.querySelector('.am-row[data-item]')", "a lista não recarregou");

        await clicar(cdp, '.am-row[data-item="MLB-SEMUP"] .am-row__variacoes-toggle');
        await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-SEMUP"] + .am-grupo-painel .am-mlb--variacao-legado')`,
          "o painel de variações legadas não carregou");

        const estado = await cdp.evaluate(`(function(){
          var linhas = Array.from(document.querySelectorAll('.am-row[data-item="MLB-SEMUP"] + .am-grupo-painel .am-mlb--variacao-legado'));
          return linhas.map(function (l) {
            var cel = l.querySelector('.am-estoque');
            var valorEl = cel.querySelector('.am-estoque__valor') || cel.querySelector('.am-estoque__btn');
            return {
              bloqueada: cel.classList.contains('am-estoque--bloqueado'),
              temBotao: Boolean(cel.querySelector('.am-estoque__btn')),
              temInfoDot: Boolean(cel.querySelector('.vf-info-dot')),
              titulo: cel.getAttribute('title') || '',
              valor: valorEl ? valorEl.textContent.trim() : '',
            };
          }); })()`);

        assert.strictEqual(estado.length, 2, "o fixture continua com 2 variações");
        // 15092589430 é a PRIMEIRA linha (mesma ordem do fixture) e a que
        // ganhou inventory_id nesta checagem.
        assert.strictEqual(estado[0].bloqueada, true, "variação com inventory_id precisa nascer bloqueada, sem esperar clique");
        assert.strictEqual(estado[0].temBotao, false, "bloqueada não pode ter botão de editar");
        assert.strictEqual(estado[0].temInfoDot, true, "o motivo do bloqueio precisa estar visível, não escondido");
        assert.match(estado[0].titulo, /gerenciado externamente/i, `o motivo do ML não pode ser escondido: "${estado[0].titulo}"`);
        assert.strictEqual(estado[0].valor, "2", "o valor do estoque continua visível mesmo bloqueada");

        assert.strictEqual(estado[1].bloqueada, false, "variação sem inventory_id continua editável");
        assert.strictEqual(estado[1].temBotao, true, "editável precisa ter o botão de sempre");
        assert.strictEqual(estado[1].temInfoDot, false, "editável não ganha selo de bloqueio");

        // Clicar na variação editável ainda abre o editor normalmente —
        // a mudança não pode ter quebrado o caminho que já funcionava.
        const celEditavel = '.am-row[data-item="MLB-SEMUP"] + .am-grupo-painel .am-mlb--variacao-legado[data-variacao="15092589431"] .am-estoque';
        await clicar(cdp, `${celEditavel} .am-estoque__btn`);
        await waitFor(cdp, `document.querySelector('${celEditavel} .am-estoque__input')`,
          "a variação livre deveria continuar abrindo o editor normalmente");
      } finally {
        variacoesLegadoHandler = null;
      }
    });

    /* ── 39a-c: ordenação por performance (margem/unidades) ─────────────── */
    // Ver auditoria "Anúncios ML — filtros de performance". Os 3 cenários
    // pedidos: MLB individual, família agregada (não expandida) e família
    // expandida (filhos já em cache).

    await check("39a — ordenar por margem (MLB individual): marginPercent decide a ordem — o MESMO valor que a coluna Margem mostra, NUNCA profit (R$) — sem margem fica no fim", async () => {
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      // profit é o OPOSTO de marginPercent de propósito: se o código ainda
      // usasse profit (o bug relatado), SEMVAR (profit 999) venceria SEMUP
      // (profit 1) e a ordem sairia invertida.
      performanceHandler = () => ({
        ok: true, metricas7d: {}, margemIndisponivel: null,
        margem: {
          "MLB-SEMUP": { marginPercent: 30, profit: 1 },
          "MLB-SEMVAR": { marginPercent: 20, profit: 999 },
        },
        faturamento: null, unidadesVendidas: null, curvaAbc: null, margemPorFamilia: null,
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'margem_desc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitForNode(() => chamadasPerformance.length >= 1, "a ordenação não disparou GET /performance");
      await waitFor(cdp, `(function(){
        var r = document.querySelector('.am-listagem > .am-row');
        return r && r.getAttribute('data-item') === 'MLB-SEMUP';
      })()`, "MLB-SEMUP (marginPercent 30) deveria ir para o topo ao ordenar por margem decrescente");

      const ordem = await cdp.evaluate(`Array.from(document.querySelectorAll('.am-listagem > .am-row')).map(function(r){
        return r.getAttribute('data-item') || r.getAttribute('data-familia'); })`);
      assert.deepStrictEqual(ordem.slice(0, 2), ["MLB-SEMUP", "MLB-SEMVAR"],
        "maior marginPercent (30%) antes do menor (20%), mesmo com profit invertido — famílias sem margemPorFamilia (null) ficam no fim");

      const margemTexto = await cdp.evaluate(`document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-margem__valor').textContent.trim()`);
      assert.strictEqual(margemTexto, "30,0%", "a coluna Margem tem de mostrar o MESMO valor usado para decidir a ordem");

      assert.strictEqual(chamadasPerformance[0].incluirMargem, true);
      assert.deepStrictEqual(chamadasPerformance[0].familias.sort(), ["FAM-1", "FAM-2"],
        "as famílias da página inteira precisam ir junto — o backend resolve/agrega os filhos delas");
      performanceHandler = null;
    });

    await check("39a2 — ordenar por margem (MLB com margem + família com margem + sem margem, juntos): maiores primeiro, sem margem sempre no fim", async () => {
      // Cenário pedido na correção: MLB A 30%, MLB B 20%, "C" sem margem —
      // aqui C é representado por FAM-2 (sem entrada em margemPorFamilia),
      // e FAM-1 entra como a família COM margem, para provar que family e
      // item competem pelo MESMO critério de ordenação (maior primeiro).
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      performanceHandler = () => ({
        ok: true, metricas7d: {}, margemIndisponivel: null,
        margem: {
          "MLB-SEMUP": { marginPercent: 30 },   // "A"
          "MLB-SEMVAR": { marginPercent: 20 },  // "B"
        },
        margemPorFamilia: { "FAM-1": 25 },      // família COM margem, entre A e B
        // FAM-2 fica de fora de propósito — "C: sem margem".
        faturamento: null, unidadesVendidas: null, curvaAbc: null,
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'margem_desc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitForNode(() => chamadasPerformance.length >= 1, "a ordenação não disparou GET /performance");
      await waitFor(cdp, `(function(){
        var r = document.querySelector('.am-listagem > .am-row');
        return r && r.getAttribute('data-item') === 'MLB-SEMUP';
      })()`, "MLB-SEMUP (30%) deveria ir para o topo");

      const ordem = await cdp.evaluate(`Array.from(document.querySelectorAll('.am-listagem > .am-row')).map(function(r){
        return r.getAttribute('data-item') || r.getAttribute('data-familia'); })`);
      assert.deepStrictEqual(ordem, ["MLB-SEMUP", "FAM-1", "MLB-SEMVAR", "FAM-2"],
        `esperado A(30%), família(25), B(20%), sem margem por último: ${JSON.stringify(ordem)}`);
      performanceHandler = null;
    });

    await check("39b — ordenar por margem (família agregada, NÃO expandida): margemPorFamilia alta leva a família ao topo, sem buscar os filhos", async () => {
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      performanceHandler = () => ({
        ok: true, metricas7d: {}, margemIndisponivel: null,
        margem: { "MLB-SEMUP": { profit: 5 }, "MLB-SEMVAR": { profit: 1 } },
        margemPorFamilia: { "FAM-1": 999, "FAM-2": 0.5 },
        faturamento: null, unidadesVendidas: null, curvaAbc: null,
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'margem_desc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitForNode(() => chamadasPerformance.length >= 1, "a ordenação não disparou GET /performance");
      await waitFor(cdp, `(function(){
        var r = document.querySelector('.am-listagem > .am-row');
        return r && r.getAttribute('data-familia') === 'FAM-1';
      })()`, "FAM-1 (margemPorFamilia 999) deveria ir para o topo, acima dos itens avulsos");

      assert.ok(!pedidos.some((p) => p.startsWith("/anuncios-meli/familias/FAM-1")),
        "margem por família já vem agregada do backend — ordenar por margem NUNCA busca o detalhe/filhos da família");
      performanceHandler = null;
    });

    await check("39c — ordenar por unidades vendidas (família JÁ EXPANDIDA): soma os filhos do cache, sem buscar o detalhe de novo", async () => {
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-mlb')`, "FAM-1 não expandiu para o teste de cache");

      pedidos.length = 0;
      chamadasPerformance.length = 0;
      performanceHandler = () => ({
        ok: true, metricas7d: {}, margemIndisponivel: null, margem: {},
        // FAM-1 (MLB-A1..A4, ver DETALHE_CONTA_42): 2+3+1+1 = 7 unidades.
        unidadesVendidas: { periodoDias: 7, porItem: { "MLB-A1": 2, "MLB-A2": 3, "MLB-A3": 1, "MLB-A4": 1, "MLB-SEMUP": 20, "MLB-SEMVAR": 0 } },
        faturamento: null, curvaAbc: null, margemPorFamilia: null,
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'unidades_desc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitForNode(() => chamadasPerformance.length >= 1, "a ordenação não disparou GET /performance");
      await waitFor(cdp, `(function(){
        var r = document.querySelector('.am-listagem > .am-row');
        return r && r.getAttribute('data-item') === 'MLB-SEMUP';
      })()`, "MLB-SEMUP (20 unidades) deveria vir antes da família (soma 7)");

      const ordem = await cdp.evaluate(`Array.from(document.querySelectorAll('.am-listagem > .am-row')).map(function(r){
        return r.getAttribute('data-item') || r.getAttribute('data-familia'); })`);
      assert.strictEqual(ordem[0], "MLB-SEMUP");
      assert.strictEqual(ordem[1], "FAM-1", "FAM-1 (soma 2+3+1+1=7) fica acima de FAM-2 (sem cache, vai para o fim) e de MLB-SEMVAR (0)");

      assert.ok(!pedidos.some((p) => p.startsWith("/anuncios-meli/familias/FAM-1")),
        "a família já estava expandida/em cache — ordenar por unidades reaproveita, nunca busca o detalhe de novo");
      performanceHandler = null;
    });

    /* ── 39d-h: ordenação GLOBAL por %Faturamento/Curva ABC (ordenarPor no
       backend, sobrevive à troca de página) ──────────────────────────────
       SUBSTITUI os antigos testes "39d-h" desta suíte, que exercitavam
       faturamento_desc/curvaAbc_asc via aplicarOrdenacaoPerformance (GET
       /performance, ordenação LOCAL da página). A partir da Task 5/6 esses
       dois critérios viraram GLOBAIS (ordenarPor= em /anuncios-meli/familias,
       ranking contra o catálogo inteiro, não só a página atual — ver
       ORDENACOES_GLOBAIS em anuncios-meli.js) — os testes antigos ficaram
       incompatíveis com o novo contrato (aplicarOrdenacaoPerformance() nunca
       mais é chamada para esses dois critérios, ver Garantia de aceite #2) e
       foram substituídos pelos cinco abaixo (39d-h). Os dois critérios
       escrevem nos MESMOS caches (faturamentoCache/curvaAbcCache/
       *PorFamiliaCache) que as células da lista já liam antes — só a origem
       do valor mudou (resposta de /familias, não de /performance). A linha
       de FAMÍLIA fechada é um branch de produção à parte (chaveia pelo cache
       "PorFamilia", por family_id, não pelo cache de item) — coberta
       EXECUTADAMENTE pelo teste 39h abaixo (misto item+família), não só por
       leitura de código: 39h prova que o valor consolidado pinta na célula
       certa e que nenhuma chamada de detalhe de família dispara à toa. Curva
       ABC não ganhou um teste de UI dedicado nesta rodada porque percorre o
       EXATO MESMO branch de carregarAnuncios que %Faturamento (incluindo o
       mesmo branch de família que 39h exercita — nenhuma lógica própria não
       coberta); a ordenação em si já tem cobertura de backend (Task 5). */

    await check("39d — faturamento_desc: front manda ordenarPor e PINTA direto da resposta, sem 2ª chamada a /performance", async () => {
      chamadasFamilias.length = 0;
      chamadasPerformance.length = 0;
      ordenarPorGlobalHandler = () => ({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        ordenacaoAplicada: true, ordenacaoIndisponivel: null,
        anuncios: [
          { tipo: "item", item_id: "MLB-SEMUP", key: "item:MLB-SEMUP", titulo: "Item A", status: "active", faturamentoPercentual: 0.30, cover: { thumbnail: null } },
          { tipo: "item", item_id: "MLB-SEMVAR", key: "item:MLB-SEMVAR", titulo: "Item B", status: "active", faturamentoPercentual: 0.10, cover: { thumbnail: null } },
        ],
        paginacao: { page: 1, limit: 20, total: 2, totalPaginas: 1 },
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'faturamento_desc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitFor(cdp, `(function(){
        var r = document.querySelector('.am-listagem > .am-row');
        return r && r.getAttribute('data-item') === 'MLB-SEMUP';
      })()`, "MLB-SEMUP (30%) deveria vir primeiro");

      // NÃO é chamadasPerformance.length === 0: MLB-SEMUP/MLB-SEMVAR são
      // reaproveitados de testes anteriores desta suíte, então o
      // pré-carregamento automático de renderCatalogo nem chega a bater na
      // rede para eles (cache já completo) — o length ser 0 aqui é
      // consequência disso, não prova por si só que aplicarOrdenacaoPerformance
      // não rodou. A prova robusta é o fingerprint (ver disparouOrdenacaoLocal).
      assert.ok(!disparouOrdenacaoLocal(chamadasPerformance),
        "ordenação global não pode ter disparado aplicarOrdenacaoPerformance (fingerprint incluirMetricas=0) — o valor já veio na listagem");
      const texto = await cdp.evaluate(`document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-faturamento__valor, .am-row[data-item="MLB-SEMUP"] [data-faturamento]')?.textContent || ''`);
      assert.ok(texto.includes("30"), `célula de %Faturamento deveria pintar 30% direto da resposta da listagem: "${texto}"`);
      ordenarPorGlobalHandler = null;
      console.log("  ✓ 39d");
    });

    await check("39e — trocar de página com faturamento_desc ativo: ordenarPor viaja para a página 2, dropdown continua mostrando o critério, e o ranking NÃO reinicia (último da pág.1 > primeiro da pág.2)", async () => {
      chamadasFamilias.length = 0;
      // 2 itens por página, valores DECRESCENTES cruzando a borda — é o
      // cenário exato do relato original (10/9/8 -> 20/15/12 seria o bug; o
      // esperado é 30/20 -> 10/5, sempre caindo).
      ordenarPorGlobalHandler = (qs) => ({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        ordenacaoAplicada: true, ordenacaoIndisponivel: null,
        anuncios: qs.get("page") === "2"
          ? [
              { tipo: "item", item_id: "MLB-PAG2-A", key: "item:MLB-PAG2-A", titulo: "Item pág2 A", status: "active", faturamentoPercentual: 0.10, cover: { thumbnail: null } },
              { tipo: "item", item_id: "MLB-PAG2-B", key: "item:MLB-PAG2-B", titulo: "Item pág2 B", status: "active", faturamentoPercentual: 0.05, cover: { thumbnail: null } },
            ]
          : [
              { tipo: "item", item_id: "MLB-PAG1-A", key: "item:MLB-PAG1-A", titulo: "Item pág1 A", status: "active", faturamentoPercentual: 0.30, cover: { thumbnail: null } },
              { tipo: "item", item_id: "MLB-PAG1-B", key: "item:MLB-PAG1-B", titulo: "Item pág1 B", status: "active", faturamentoPercentual: 0.20, cover: { thumbnail: null } },
            ],
        paginacao: { page: Number(qs.get("page") || 1), limit: 2, total: 4, totalPaginas: 2 },
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'faturamento_desc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-PAG1-A"]')`, "página 1 não carregou");
      const ultimaPag1 = await cdp.evaluate(`document.querySelector('.am-row[data-item="MLB-PAG1-B"] [data-faturamento], .am-row[data-item="MLB-PAG1-B"] .am-faturamento__valor')?.textContent || ''`);

      // A UI desta tela pagina com Anterior/Próxima (am-pag-prev/am-pag-next),
      // sem botões de número de página — "página 2" aqui é "clicar Próxima".
      await clicar(cdp, '#am-pag-next');
      await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-PAG2-A"]')`, "página 2 não carregou");
      const primeiraPag2 = await cdp.evaluate(`document.querySelector('.am-row[data-item="MLB-PAG2-A"] [data-faturamento], .am-row[data-item="MLB-PAG2-A"] .am-faturamento__valor')?.textContent || ''`);

      assert.ok(chamadasFamilias.some((c) => c.page === "2" && c.ordenarPor === "faturamento_desc"),
        "a chamada da página 2 tem de levar ordenarPor=faturamento_desc — é exatamente o bug relatado (ordenação reiniciava ao trocar de página)");
      const valorDropdown = await cdp.evaluate(`document.getElementById('am-ordenacao').value`);
      assert.strictEqual(valorDropdown, "faturamento_desc", "trocar de página NÃO pode resetar o dropdown quando o critério é global");

      // VALIDAÇÃO ESPECÍFICA pedida: último item da página 1 (20%) tem de
      // valer MAIS que o primeiro item da página 2 (10%) — nunca o ranking
      // "reiniciando" (o que apareceria como pág.2 > pág.1, ex.: 10% -> 30%).
      const paraNumero = (t) => parseFloat(String(t).replace(",", ".").replace("%", "").trim());
      assert.ok(paraNumero(ultimaPag1) > paraNumero(primeiraPag2),
        `último item da página 1 (${ultimaPag1}) tem de ser MAIOR que o primeiro da página 2 (${primeiraPag2}) — faturamento_desc nunca reinicia o ranking na borda de página`);
      ordenarPorGlobalHandler = null;
      console.log("  ✓ 39e");
    });

    await check("39f — ordenacaoIndisponivel: mostra aviso inline, não quebra a lista", async () => {
      ordenarPorGlobalHandler = () => ({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        ordenacaoAplicada: false,
        ordenacaoIndisponivel: { codigo: "BASE_NAO_VINCULADA", mensagem: "Vincule uma Base para ordenar por Faturamento." },
        anuncios: [{ tipo: "item", item_id: "MLB-SEMUP", key: "item:MLB-SEMUP", titulo: "Item A", status: "active", cover: { thumbnail: null } }],
        paginacao: { page: 1, limit: 20, total: 1, totalPaginas: 1 },
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'faturamento_asc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-SEMUP"]')`, "lista tem de continuar respondendo mesmo sem ordenação");
      await waitFor(cdp, `(function(){
        var el = document.getElementById('am-ordenacao-aviso');
        return el && !el.hidden && el.textContent.includes('Vincule uma Base');
      })()`, "aviso de ordenacaoIndisponivel deveria aparecer com a mensagem do backend");
      ordenarPorGlobalHandler = null;
      // Devolve o dropdown a "Padrão" antes do próximo teste — sem isso
      // AM.ordenarPor fica preso em 'faturamento_asc' e vaza para 39g/39i em
      // diante (mesma classe de cuidado de estado global entre testes já
      // documentada nesta suíte).
      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = '';
        s.dispatchEvent(new Event('change'));
      })()`);
      console.log("  ✓ 39f");
    });

    await check("39g — front NUNCA reordena AM.anuncios localmente para critério global: renderiza EXATAMENTE a ordem que o backend mandou, mesmo que pareça 'fora de ordem'", async () => {
      // Backend de propósito NÃO manda os valores em ordem decrescente
      // (30% depois de 10%) — se o front ainda tivesse QUALQUER resquício do
      // comportamento antigo (reordenar AM.anuncios em memória, como
      // aplicarOrdenacaoPerformance fazia), a tela corrigiria essa "ordem
      // errada" e o teste pegaria isso. O contrato correto é: pra critério
      // global, o front confia cegamente na ordem do backend.
      chamadasPerformance.length = 0;
      ordenarPorGlobalHandler = () => ({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        ordenacaoAplicada: true, ordenacaoIndisponivel: null,
        anuncios: [
          { tipo: "item", item_id: "MLB-FORA-1", key: "item:MLB-FORA-1", titulo: "X", status: "active", faturamentoPercentual: 0.10, cover: { thumbnail: null } },
          { tipo: "item", item_id: "MLB-FORA-2", key: "item:MLB-FORA-2", titulo: "Y", status: "active", faturamentoPercentual: 0.30, cover: { thumbnail: null } },
          { tipo: "item", item_id: "MLB-FORA-3", key: "item:MLB-FORA-3", titulo: "Z", status: "active", faturamentoPercentual: 0.20, cover: { thumbnail: null } },
        ],
        paginacao: { page: 1, limit: 20, total: 3, totalPaginas: 1 },
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'faturamento_desc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-FORA-1"]')`, "lista não carregou");

      const ordemRenderizada = await cdp.evaluate(`Array.from(document.querySelectorAll('.am-listagem > .am-row')).map(function(r){
        return r.getAttribute('data-item'); })`);
      assert.deepStrictEqual(ordemRenderizada, ["MLB-FORA-1", "MLB-FORA-2", "MLB-FORA-3"],
        `o front reordenou localmente (ordem renderizada: ${JSON.stringify(ordemRenderizada)}) — para critério global, a ordem tem de ser EXATAMENTE a que o backend mandou, nunca recalculada em memória`);
      // MLB-FORA-1/2/3 são NOVOS (propositalmente, pra provar a ordem "fora
      // de ordem"): o pré-carregamento automático de renderCatalogo VAI
      // bater em /performance para eles (métricas/margem ainda não
      // cacheadas) — isso é esperado e não tem relação com
      // aplicarOrdenacaoPerformance. A prova real é o fingerprint
      // (incluirMetricas=0, ver disparouOrdenacaoLocal acima).
      assert.ok(!disparouOrdenacaoLocal(chamadasPerformance),
        "nenhuma chamada com o fingerprint de aplicarOrdenacaoPerformance (incluirMetricas=0) pode ter disparado para um critério global");
      ordenarPorGlobalHandler = null;
      // Idem 39f: devolve o dropdown/AM.ordenarPor a "Padrão" antes dos
      // testes seguintes (39i em diante), que esperam a listagem padrão da
      // conta 42 (LINHAS_CONTA_42), não os 3 itens fabricados aqui.
      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = '';
        s.dispatchEvent(new Event('change'));
      })()`);
      console.log("  ✓ 39g");
    });

    await check("39h — faturamento_desc com FAMÍLIA fechada misturada a item: pinta o consolidado na chave certa (family_id, não item_id), sem abrir/buscar detalhe da família", async () => {
      // FAM-1 é reaproveitada de propósito (já usada e cacheada por dezenas de
      // testes anteriores desta suíte) — é o que prova que NENHUM detalhe de
      // família é buscado por causa da ordenação global: se o front tentasse
      // abrir/expandir a família só porque ela veio na resposta, haveria uma
      // chamada NOVA a /anuncios-meli/familias/FAM-1, e não há (o cache já
      // resolve garantirFamiliaDetalhe sem rede — mesmo raciocínio do 39d
      // reaproveitar MLB-SEMUP/MLB-SEMVAR já cacheados).
      pedidos.length = 0;
      ordenarPorGlobalHandler = () => ({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        ordenacaoAplicada: true, ordenacaoIndisponivel: null,
        anuncios: [
          // Família primeiro, de propósito: se o código escrevesse o valor
          // consolidado no cache ERRADO (faturamentoCache, o de ITEM, em vez
          // de faturamentoPorFamiliaCache) chaveado por family_id, a célula
          // da família ficaria em "—" e a deste teste pegaria isso.
          { tipo: "familia", key: "fam:FAM-1", family_id: "FAM-1", family_name: "Camiseta Dry Fit Masculina",
            titulo: "Camiseta Dry Fit Masculina", faturamentoPercentual: 0.42, cover: { thumbnail: null } },
          { tipo: "item", item_id: "MLB-SEMUP", key: "item:MLB-SEMUP", titulo: "Item A", status: "active",
            faturamentoPercentual: 0.15, cover: { thumbnail: null } },
        ],
        paginacao: { page: 1, limit: 20, total: 2, totalPaginas: 1 },
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'faturamento_desc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitFor(cdp, `document.querySelector('${linhaFam("FAM-1")}')`, "a linha da família não renderizou");
      await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-SEMUP"]')`, "a linha do item não renderizou");

      // Painel de FAM-1 tem de continuar FECHADO — a asserção é sobre a linha
      // FECHADA do agrupador, nunca sobre o painel expandido.
      const painelAberto = await cdp.evaluate(`(function(){ var p = document.querySelector('${painelFam("FAM-1")}'); return Boolean(p && !p.hidden); })()`);
      assert.strictEqual(painelAberto, false, "pré-condição do teste: o painel de FAM-1 precisa estar FECHADO (renderCatalogo reconstrói a lista do zero a cada ordenação global)");

      const textoFamilia = await cdp.evaluate(`document.querySelector('${linhaFam("FAM-1")} .am-faturamento .am-faturamento__valor')?.textContent.trim() || ''`);
      assert.strictEqual(textoFamilia, "42,0%",
        `a linha FECHADA da família tem de mostrar o consolidado (faturamentoPorFamiliaCache["FAM-1"]) — se o valor tivesse ido pro cache de ITEM por engano, a célula ficaria em "—": recebido "${textoFamilia}"`);

      const textoItem = await cdp.evaluate(`document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-faturamento .am-faturamento__valor')?.textContent.trim() || ''`);
      assert.strictEqual(textoItem, "15,0%", `a linha do item individual tem de mostrar o seu próprio percentual: recebido "${textoItem}"`);

      assert.ok(!pedidos.some((p) => p.startsWith("/anuncios-meli/familias/FAM-1")),
        "nenhuma chamada de detalhe de família pode ter disparado só por causa da ordenação global — o consolidado já veio pronto na resposta da listagem");
      ordenarPorGlobalHandler = null;
      // Devolve o dropdown/AM.ordenarPor a "Padrão" antes de 39i em diante
      // (mesmo cuidado de 39f/39g).
      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = '';
        s.dispatchEvent(new Event('change'));
      })()`);
      console.log("  ✓ 39h");
    });

    // BUG (achado na revisão final do plano): aplicarOrdenacaoPerformance(null)
    // (chamada pelo branch "sem critério" do dropdown) restaura
    // AM_ordemOriginalAnuncios em memória — mas esse snapshot fica null
    // durante ordenação GLOBAL de propósito (ver carregarAnuncios), então
    // "Padrão" depois de um critério global snapshotava a PRÓPRIA ordem
    // global corrente e a "restaurava" — a lista ficava presa na ordem
    // global mesmo com o dropdown voltando a mostrar "Padrão", sem nenhuma
    // requisição nova ao backend. O fix: quando o critério anterior era
    // global, voltar a "Padrão" tem de refazer a busca (sem ordenarPor=),
    // nunca restaurar snapshot.
    await check("39h2 — voltar para 'Padrão' depois de ordenação global refaz a busca ao backend (sem ordenarPor) e a lista volta à ordem padrão real, não à ordem global 'congelada'", async () => {
      chamadasFamilias.length = 0;
      // Ordem DELIBERADAMENTE diferente da ordem padrão (LINHAS_CONTA_42
      // começa com FAM-1) — se o bug estivesse presente, "Padrão" continuaria
      // mostrando esta ordem (MLB-SEMVAR primeiro), nunca a de LINHAS_CONTA_42.
      ordenarPorGlobalHandler = () => ({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        ordenacaoAplicada: true, ordenacaoIndisponivel: null,
        anuncios: [
          { tipo: "item", item_id: "MLB-SEMVAR", key: "item:MLB-SEMVAR", titulo: "Anúncio simples, sem variações no ML", status: "active", faturamentoPercentual: 0.40, cover: { thumbnail: null } },
          { tipo: "item", item_id: "MLB-SEMUP", key: "item:MLB-SEMUP", titulo: "Anúncio legado sem agrupamento", status: "active", faturamentoPercentual: 0.10, cover: { thumbnail: null } },
        ],
        paginacao: { page: 1, limit: 20, total: 2, totalPaginas: 1 },
      });

      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = 'faturamento_desc';
        s.dispatchEvent(new Event('change'));
      })()`);
      await waitFor(cdp, `(function(){
        var r = document.querySelector('.am-listagem > .am-row');
        return r && r.getAttribute('data-item') === 'MLB-SEMVAR';
      })()`, "ordenação global não aplicou (pré-condição do teste)");

      ordenarPorGlobalHandler = null;
      chamadasFamilias.length = 0;

      // O gesto do operador: selecionar "Padrão" no dropdown.
      await cdp.evaluate(`(function(){
        var s = document.getElementById('am-ordenacao');
        s.value = '';
        s.dispatchEvent(new Event('change'));
      })()`);

      // Precisa vir uma NOVA requisição a /anuncios-meli/familias, sem
      // ordenarPor — nunca um restore silencioso em memória.
      await waitForNode(() => chamadasFamilias.some((c) => !c.ordenarPor),
        "voltar a 'Padrão' depois de um critério global tem de disparar uma nova busca ao backend sem ordenarPor= — não pode só restaurar um snapshot em memória");

      // A lista renderizada tem de ser a ordem PADRÃO real (LINHAS_CONTA_42:
      // FAM-1 primeiro), não a ordem global "congelada" (MLB-SEMVAR primeiro).
      await waitFor(cdp, `document.querySelector('${linhaFam("FAM-1")}')`, "a família FAM-1 (1ª linha da ordem padrão) não voltou a aparecer");
      const primeiraLinha = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-listagem > .am-row');
        return r ? (r.getAttribute('data-familia') ? 'fam:' + r.getAttribute('data-familia') : 'item:' + r.getAttribute('data-item')) : null;
      })()`);
      assert.strictEqual(primeiraLinha, "fam:FAM-1", `a 1ª linha depois de 'Padrão' tem de ser FAM-1 (ordem real de LINHAS_CONTA_42), não a ordem global congelada: recebido "${primeiraLinha}"`);

      const valorDropdown = await cdp.evaluate(`document.getElementById('am-ordenacao').value`);
      assert.strictEqual(valorDropdown, "", "dropdown precisa continuar mostrando 'Padrão'");
      console.log("  ✓ 39h2");
    });

    await check("39i — carregar a listagem (SEM ordenar) já preenche a coluna Faturamento (percentual + valor absoluto) e a tag Curva ABC sozinhas — individual bundlado na 1ª chamada, família numa chamada própria", async () => {
      // Recarrega do zero: precisa provar que o preenchimento acontece no
      // PRIMEIRO carregamento, não por causa de cache deixado por um teste
      // de ordenação anterior (ver bug relatado — "todos os anúncios
      // mostram '—'" mesmo sem o operador nunca ter tocado no dropdown).
      // Curva ABC entra no MESMO carregamento automático (ver auditoria
      // "Curva ABC sempre visível + faturamento absoluto") — não depende
      // mais de o operador ter ordenado por ela.
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      performanceHandler = (ids, conta, familias) => {
        const metricas7d = {}, margem = {};
        ids.forEach((id) => {
          metricas7d[id] = METRICAS_FIXTURE[id] || { views: 10, vendas: 1, conversao: 10 };
          margem[id] = MARGEM_FIXTURE[id] || { origem: "projected", margin: 0.2, marginPercent: 20, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [] };
        });
        return {
          ok: true, metricas7d, margem, margemIndisponivel: null,
          // Fração 0–1 (receita/receitaTotalPeriodo) — nunca já em escala
          // 0–100 pronta, mesmo contrato usado nos testes de ordenação
          // global por faturamento acima. porItemValor/porFamiliaValor: R$
          // absoluto, aditivo ao percentual — nunca derivado dele aqui no
          // mock (mesma regra do backend real).
          faturamento: {
            periodoDias: 30,
            porItem: { "MLB-SEMUP": 0.095, "MLB-SEMVAR": 0.011 },
            porFamilia: { "FAM-1": 0.333, "FAM-2": 0.044 },
            porItemValor: { "MLB-SEMUP": 950.5, "MLB-SEMVAR": 11 },
            porFamiliaValor: { "FAM-1": 3330, "FAM-2": 44 },
          },
          curvaAbc: {
            periodoDias: 30,
            porItem: { "MLB-SEMUP": "A", "MLB-SEMVAR": "C" },
            porFamilia: { "FAM-1": "B", "FAM-2": "C" },
          },
          unidadesVendidas: null, margemPorFamilia: null,
        };
      };
      try {
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await waitFor(cdp, "document.querySelector('.am-row[data-item]')", "a lista não recarregou");

        await waitFor(cdp, `(function(){
          var c = document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-faturamento__valor');
          return c && c.textContent.trim() === '9,5%';
        })()`, "a coluna Faturamento do item avulso não preencheu sozinha, sem o operador ordenar");
        await waitFor(cdp, `(function(){
          var c = document.querySelector('${linhaFam("FAM-1")} .am-faturamento__valor');
          return c && c.textContent.trim() === '33,3%';
        })()`, "a coluna Faturamento da família não preencheu sozinha, sem o operador ordenar");

        const semup = await cdp.evaluate(`document.querySelector('.am-row[data-item="MLB-SEMVAR"] .am-faturamento__valor').textContent.trim()`);
        assert.strictEqual(semup, "1,1%");

        // Valor absoluto (2ª linha da célula) — nunca mais "do faturamento".
        const valorAbsolutoSemup = await cdp.evaluate(`document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-faturamento__legenda').textContent.trim()`);
        assert.strictEqual(valorAbsolutoSemup, "R$ 950,50", `célula precisa mostrar o valor absoluto (R$), nunca o texto antigo "do faturamento": recebido "${valorAbsolutoSemup}"`);
        const valorAbsolutoFam = await cdp.evaluate(`document.querySelector('${linhaFam("FAM-1")} .am-faturamento__legenda').textContent.trim()`);
        assert.strictEqual(valorAbsolutoFam, "R$ 3.330,00", "família usa o valor ABSOLUTO consolidado (porFamiliaValor, soma dos filhos), nunca o de um filho isolado");

        // Curva ABC: tag SEMPRE visível quando existe dado — sem nenhuma
        // ordenação selecionada — e SEM o prefixo "ABC" (só a letra).
        await waitFor(cdp, `(function(){
          var t = document.querySelector('.am-row[data-item="MLB-SEMUP"] [data-abc-item] .vf-tag');
          return t && t.textContent.trim() === 'A';
        })()`, "a tag de Curva ABC do item avulso deveria aparecer sozinha, sem o operador ordenar por ela");
        const textoTagAbc = await cdp.evaluate(`document.querySelector('.am-row[data-item="MLB-SEMUP"] [data-abc-item] .vf-tag').textContent.trim()`);
        assert.strictEqual(textoTagAbc, "A", `a tag tem de mostrar só a letra, nunca "ABC A": recebido "${textoTagAbc}"`);
        const textoTagAbcFam = await cdp.evaluate(`(function(){ var t = document.querySelector('${linhaFam("FAM-1")} [data-abc-familia] .vf-tag'); return t ? t.textContent.trim() : null; })()`);
        assert.strictEqual(textoTagAbcFam, "B", "a família fechada mostra a Curva ABC CONSOLIDADA (porFamilia), nunca a de um filho isolado");

        assert.ok(chamadasPerformance.some((c) => c.incluirFaturamento === true && c.incluirCurvaAbc === true && !c.familias.length && c.itemIds.includes("MLB-SEMUP")),
          "o preenchimento do item avulso tem de vir BUNDLADO na mesma chamada de métricas/margem do carregamento automático — Curva ABC junto, nunca uma chamada extra");
        assert.ok(chamadasPerformance.some((c) => c.incluirFaturamento === true && c.incluirCurvaAbc === true && c.familias.length > 0 && !c.itemIds.length),
          "o consolidado da família (faturamento + Curva ABC) precisa de uma chamada própria, com familias= — não itera os filhos um a um");
      } finally {
        performanceHandler = null;
      }
    });

    // BUG: faturamentoConteudoHtml passava a fração crua do backend (0–1)
    // direto para formatarPercentualCompacto, que espera um número já em
    // escala 0–100 (é o contrato de marginPercent/conversao) — 0.3 (30%)
    // virava "0,3%" em vez de "30,0%". Ver auditoria "Validação participação
    // faturamento". Caso mínimo, item E família, exatamente como reportado.
    await check("39j — escala do percentual: fração 0.3 do backend renderiza 30,0% (item e família), nunca 0,3%", async () => {
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      performanceHandler = (ids) => {
        const metricas7d = {}, margem = {};
        ids.forEach((id) => {
          metricas7d[id] = METRICAS_FIXTURE[id] || { views: 10, vendas: 1, conversao: 10 };
          margem[id] = MARGEM_FIXTURE[id] || { origem: "projected", margin: 0.2, marginPercent: 20, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [] };
        });
        return {
          ok: true, metricas7d, margem, margemIndisponivel: null,
          faturamento: {
            periodoDias: 30,
            porItem: { "MLB-SEMUP": 0.3, "MLB-SEMVAR": 0.01 },
            porFamilia: { "FAM-1": 0.3, "FAM-2": 0.01 },
          },
          unidadesVendidas: null, curvaAbc: null, margemPorFamilia: null,
        };
      };
      try {
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await waitFor(cdp, "document.querySelector('.am-row[data-item]')", "a lista não recarregou");

        await waitFor(cdp, `(function(){
          var c = document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-faturamento__valor');
          return c && c.textContent.trim() === '30,0%';
        })()`, "item: backend mandou 0.3 (fração) — a célula tem de mostrar 30,0%, nunca 0,3%");

        await waitFor(cdp, `(function(){
          var c = document.querySelector('${linhaFam("FAM-1")} .am-faturamento__valor');
          return c && c.textContent.trim() === '30,0%';
        })()`, "família: porFamilia também é fração — mesma escala do item, mesmo bug, mesma correção");
      } finally {
        performanceHandler = null;
      }
    });

    // BUG/lacuna: expandir uma família nunca pedia incluirFaturamento para os
    // filhos (só incluirMargem) — a célula de Faturamento de um MLB dentro do
    // painel aberto ficava presa em "—" para sempre. Ver auditoria "Anúncios
    // ML — participação no faturamento em famílias". porFamilia (0.4) é
    // deliberadamente DIFERENTE da soma dos porItem dos filhos (0.05+0.02+
    // 0.03+0.01=0.11) — se o frontend algum dia passar a somar percentuais de
    // filho para "completar" o agrupador, este teste denuncia (esperaria
    // 40,0% e receberia 11,0%).
    await check("39k — família expandida: cada filho mostra sua participação INDIVIDUAL (porItem); o agrupador mantém a CONSOLIDADA (porFamilia), nunca a soma dos filhos", async () => {
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      const PORITEM_FILHOS = { "MLB-A1": 0.05, "MLB-A2": 0.02, "MLB-A3": 0.03, "MLB-A4": 0.01 };
      performanceHandler = (ids) => {
        const metricas7d = {}, margem = {}, porItem = {};
        ids.forEach((id) => {
          metricas7d[id] = METRICAS_FIXTURE[id] || { views: 10, vendas: 1, conversao: 10 };
          margem[id] = MARGEM_FIXTURE[id] || { origem: "projected", margin: 0.2, marginPercent: 20, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [] };
          if (PORITEM_FILHOS[id] != null) porItem[id] = PORITEM_FILHOS[id];
        });
        return {
          ok: true, metricas7d, margem, margemIndisponivel: null,
          faturamento: { periodoDias: 30, porItem, porFamilia: { "FAM-1": 0.4, "FAM-2": 0.01 } },
          unidadesVendidas: null, curvaAbc: null, margemPorFamilia: null,
        };
      };
      try {
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await waitFor(cdp, "document.querySelector('.am-row[data-item]')", "a lista não recarregou");

        // 1. Família FECHADA: o agrupador já mostra o consolidado, sem precisar expandir.
        await waitFor(cdp, `(function(){
          var c = document.querySelector('${linhaFam("FAM-1")} .am-faturamento__valor');
          return c && c.textContent.trim() === '40,0%';
        })()`, "família fechada: o agrupador precisa mostrar o percentual consolidado (porFamilia)");

        const antes = chamadasPerformance.length;
        await clicar(cdp, linhaFam("FAM-1"));
        await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-mlb')`, "FAM-1 não expandiu");

        await waitForNode(() => chamadasPerformance.length > antes, "expandir a família não disparou uma nova chamada de performance");
        const daExpansao = chamadasPerformance.slice(antes).find((c) => c.itemIds.indexOf("MLB-A1") !== -1);
        assert.ok(daExpansao, "não encontrei a chamada de performance disparada pela expansão de FAM-1");
        assert.strictEqual(daExpansao.incluirFaturamento, true,
          "expandir a família precisa pedir incluirFaturamento=true para os filhos (bundlado com a margem, mesmo Motor)");

        // 2. Família EXPANDIDA: cada filho mostra o SEU PRÓPRIO percentual.
        await waitFor(cdp, `(function(){
          var c = document.querySelector('.am-mlb[data-item="MLB-A1"] .am-faturamento__valor');
          return c && c.textContent.trim() === '5,0%';
        })()`, "MLB-A1 (filho) tem de mostrar sua participação INDIVIDUAL (porItem), nunca a da família");
        const a2 = await cdp.evaluate(`document.querySelector('.am-mlb[data-item="MLB-A2"] .am-faturamento__valor').textContent.trim()`);
        assert.strictEqual(a2, "2,0%");
        const a3 = await cdp.evaluate(`document.querySelector('.am-mlb[data-item="MLB-A3"] .am-faturamento__valor').textContent.trim()`);
        assert.strictEqual(a3, "3,0%");
        const a4 = await cdp.evaluate(`document.querySelector('.am-mlb[data-item="MLB-A4"] .am-faturamento__valor').textContent.trim()`);
        assert.strictEqual(a4, "1,0%");

        // 3. O agrupador expandido continua com o CONSOLIDADO do backend —
        //    nunca vira a soma dos filhos (5+2+3+1 = 11%, valor que provaria
        //    soma de percentuais no frontend, proibida pela regra do usuário).
        const familia = await cdp.evaluate(`document.querySelector('${linhaFam("FAM-1")} .am-faturamento__valor').textContent.trim()`);
        assert.strictEqual(familia, "40,0%",
          "o agrupador expandido não pode virar a soma dos filhos (11%) — tem de continuar com porFamilia (40%)");
      } finally {
        performanceHandler = null;
      }
    });

    /* ── 39: resiliência — falha total nunca deixa a célula presa ───────── */

    errosAcumulados = errosAcumulados.concat(await cdp.evaluate("window.__erros || []"));
    pedidos.length = 0;
    chamadasPerformance.length = 0;
    performanceHandler = () => ({ ok: false, motivo: "Falha simulada de /performance" });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
    await waitFor(cdp, "document.querySelector('.am-row[data-item]')", "a lista não voltou depois do reload");

    await check("39 — falha total de /performance resolve para '—', a lista continua usável — inclusive a soma do agrupador", async () => {
      await waitFor(cdp, `(function(){
        var c = document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-metricas7d');
        return c && !c.classList.contains('am-metricas7d--carregando'); })()`,
        "a falha nunca resolveu o estado de carregamento — a célula ficou presa");
      const estado = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMUP"]');
        return {
          metricas: r.querySelector('.am-metricas7d').textContent.trim(),
          margem: r.querySelector('.am-margem').textContent.trim(),
          linhaAindaClicavel: r.getAttribute('role') === 'button',
        }; })()`);
      assert.strictEqual(estado.metricas, "—", "falha total tem de virar travessão, nunca ficar preso em 'carregando'");
      assert.strictEqual(estado.margem, "—");
      assert.strictEqual(estado.linhaAindaClicavel, true, "a falha de performance não pode quebrar a linha em si");

      // A falha alcança IGUALMENTE o pré-carregamento em background: a soma
      // do agrupador também não pode ficar presa em "carregando" para sempre.
      await waitFor(cdp, `(function(){
        var t = document.querySelector('${linhaFam("FAM-1")} .am-metricas7d');
        return t && !t.classList.contains('am-metricas7d--carregando'); })()`,
        "a falha do pré-carregamento em background nunca resolveu o estado de carregamento da soma do agrupador");
      const agrupador = await cdp.evaluate(`(function(){
        var t = document.querySelector('${linhaFam("FAM-1")} .am-metricas7d');
        return { texto: t.textContent.trim(), classe: t.className }; })()`);
      assert.strictEqual(agrupador.texto, "—", "falha do pré-carregamento tem de virar travessão, nunca ficar presa em 'carregando'");
      assert.ok(/am-metricas7d--indisponivel/.test(agrupador.classe), agrupador.classe);

      performanceHandler = null;
    });

    /* ── 39l–39s: combo de ordenação (filtro + direção) — UI nova ────────── */

    await check("39l — estado inicial: combo mostra Padrão com a direção desabilitada", async () => {
      const estado = await cdp.evaluate(`(function(){
        var dir = document.getElementById('am-ordenacao-dir');
        return {
          rotulo: document.getElementById('am-ordenacao-trigger-label').textContent.trim(),
          dirTexto: dir.textContent.trim(),
          dirDesabilitado: dir.disabled,
          valorSelect: document.getElementById('am-ordenacao').value,
        }; })()`);
      assert.strictEqual(estado.rotulo, "Padrão");
      assert.strictEqual(estado.dirTexto, "—");
      assert.strictEqual(estado.dirDesabilitado, true);
      assert.strictEqual(estado.valorSelect, "");
    });

    await check("39m — escolher 'Margem' no menu aplica a direção padrão dela (maior → menor) no select oculto", async () => {
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      performanceHandler = () => ({
        ok: true, metricas7d: {}, margemIndisponivel: null,
        margem: { "MLB-SEMUP": { marginPercent: 10 }, "MLB-SEMVAR": { marginPercent: 5 } },
        faturamento: null, unidadesVendidas: null, curvaAbc: null, margemPorFamilia: null,
      });
      await selecionarOrdenacao(cdp, "margem");
      await waitForNode(() => chamadasPerformance.length >= 1, "escolher Margem no combo não disparou a ordenação");
      const estado = await cdp.evaluate(`(function(){
        var dir = document.getElementById('am-ordenacao-dir');
        var menu = document.getElementById('am-ordenacao-menu');
        return {
          valorSelect: document.getElementById('am-ordenacao').value,
          rotulo: document.getElementById('am-ordenacao-trigger-label').textContent.trim(),
          dirTexto: dir.textContent.trim(),
          menuFechado: menu.hasAttribute('hidden'),
        }; })()`);
      assert.strictEqual(estado.valorSelect, "margem_desc", "direção padrão de Margem é maior → menor (desc)");
      assert.strictEqual(estado.rotulo, "Margem");
      assert.strictEqual(estado.dirTexto, "Maior → menor");
      assert.strictEqual(estado.menuFechado, true, "escolher um filtro tem de fechar o popover");
      performanceHandler = null;
    });

    await check("39n — o botão de direção alterna sem trocar de filtro", async () => {
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      performanceHandler = () => ({
        ok: true, metricas7d: {}, margemIndisponivel: null,
        margem: { "MLB-SEMUP": { marginPercent: 10 }, "MLB-SEMVAR": { marginPercent: 5 } },
        faturamento: null, unidadesVendidas: null, curvaAbc: null, margemPorFamilia: null,
      });
      await clicar(cdp, "#am-ordenacao-dir", "não achei o botão de direção");
      await waitForNode(() => chamadasPerformance.length >= 1, "alternar a direção não disparou a ordenação");
      const estado = await cdp.evaluate(`(function(){
        return {
          valorSelect: document.getElementById('am-ordenacao').value,
          rotulo: document.getElementById('am-ordenacao-trigger-label').textContent.trim(),
          dirTexto: document.getElementById('am-ordenacao-dir').textContent.trim(),
        }; })()`);
      assert.strictEqual(estado.valorSelect, "margem_asc");
      assert.strictEqual(estado.rotulo, "Margem", "alternar a direção não pode trocar o filtro");
      assert.strictEqual(estado.dirTexto, "Menor → maior");
      performanceHandler = null;
    });

    await check("39o — trocar de filtro (Margem → Curva ABC) usa a direção padrão dele (A → C), não herda a direção anterior", async () => {
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      performanceHandler = () => ({
        ok: true, metricas7d: {}, margemIndisponivel: null,
        margem: null, faturamento: null, unidadesVendidas: null,
        curvaAbc: { porItem: { "MLB-SEMUP": "A", "MLB-SEMVAR": "C" }, porFamilia: {} },
        margemPorFamilia: null,
      });
      await selecionarOrdenacao(cdp, "curvaAbc");
      await waitForNode(() => chamadasPerformance.length >= 1, "escolher Curva ABC não disparou a ordenação");
      const estado = await cdp.evaluate(`(function(){
        return {
          valorSelect: document.getElementById('am-ordenacao').value,
          rotulo: document.getElementById('am-ordenacao-trigger-label').textContent.trim(),
          dirTexto: document.getElementById('am-ordenacao-dir').textContent.trim(),
        }; })()`);
      assert.strictEqual(estado.valorSelect, "curvaAbc_asc", "veio de Margem:asc, mas Curva ABC tem direção padrão própria (A → C)");
      assert.strictEqual(estado.rotulo, "Curva ABC");
      assert.strictEqual(estado.dirTexto, "A → C");
      performanceHandler = null;
    });

    await check("39p — clicar de novo no filtro já ativo preserva a direção atual (não reseta pra padrão)", async () => {
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      performanceHandler = () => ({
        ok: true, metricas7d: {}, margemIndisponivel: null,
        margem: null, faturamento: null, unidadesVendidas: null,
        curvaAbc: { porItem: { "MLB-SEMUP": "A", "MLB-SEMVAR": "C" }, porFamilia: {} },
        margemPorFamilia: null,
      });
      // Curva ABC está em "asc" (A → C) — alterna pra "desc" (C → A) antes de reselecionar.
      await clicar(cdp, "#am-ordenacao-dir", "não achei o botão de direção");
      await waitForNode(() => chamadasPerformance.length >= 1, "alternar a direção não disparou a ordenação");
      assert.strictEqual(
        await cdp.evaluate(`document.getElementById('am-ordenacao').value`),
        "curvaAbc_desc"
      );

      pedidos.length = 0;
      chamadasPerformance.length = 0;
      await selecionarOrdenacao(cdp, "curvaAbc");
      // Mesmo filtro, mesma direção — não é uma mudança de valor, então o
      // <select> não dispara "change" de novo (nenhuma chamada nova esperada).
      await sleep(150);
      const estado = await cdp.evaluate(`(function(){
        return {
          valorSelect: document.getElementById('am-ordenacao').value,
          dirTexto: document.getElementById('am-ordenacao-dir').textContent.trim(),
        }; })()`);
      assert.strictEqual(estado.valorSelect, "curvaAbc_desc", "reselecionar o filtro já ativo tem de manter a direção (C → A), não voltar pro padrão (A → C)");
      assert.strictEqual(estado.dirTexto, "C → A");
      assert.strictEqual(chamadasPerformance.length, 0, "reselecionar o mesmo filtro/direção não deveria refazer a chamada");
      performanceHandler = null;
    });

    await check("39q — escolher 'Padrão' desabilita e apaga a direção", async () => {
      pedidos.length = 0;
      await selecionarOrdenacao(cdp, "");
      await waitFor(cdp, `document.getElementById('am-ordenacao').value === ""`,
        "escolher Padrão não voltou o select para o valor vazio");
      const estado = await cdp.evaluate(`(function(){
        var dir = document.getElementById('am-ordenacao-dir');
        return {
          rotulo: document.getElementById('am-ordenacao-trigger-label').textContent.trim(),
          dirTexto: dir.textContent.trim(),
          dirDesabilitado: dir.disabled,
        }; })()`);
      assert.strictEqual(estado.rotulo, "Padrão");
      assert.strictEqual(estado.dirTexto, "—");
      assert.strictEqual(estado.dirDesabilitado, true);
    });

    await check("39r — clicar fora do combo fecha o popover sem aplicar nada", async () => {
      await clicar(cdp, "#am-ordenacao-trigger", "não achei o gatilho de ordenação");
      const abertoAntes = await cdp.evaluate(`!document.getElementById('am-ordenacao-menu').hasAttribute('hidden')`);
      assert.strictEqual(abertoAntes, true, "clicar no gatilho deveria abrir o popover");
      const valorAntes = await cdp.evaluate(`document.getElementById('am-ordenacao').value`);
      await clicar(cdp, "#am-catalogo-titulo", "não achei um alvo fora do combo para clicar");
      const estado = await cdp.evaluate(`(function(){
        return {
          fechado: document.getElementById('am-ordenacao-menu').hasAttribute('hidden'),
          valorSelect: document.getElementById('am-ordenacao').value,
        }; })()`);
      assert.strictEqual(estado.fechado, true, "clicar fora tem de fechar o popover");
      assert.strictEqual(estado.valorSelect, valorAntes, "clicar fora não pode mudar a ordenação");
    });

    await check("39s — uma nova busca reseta a ordenação: o combo volta a mostrar 'Padrão'", async () => {
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      performanceHandler = () => ({
        ok: true, metricas7d: {}, margemIndisponivel: null,
        margem: { "MLB-SEMUP": { marginPercent: 10 }, "MLB-SEMVAR": { marginPercent: 5 } },
        faturamento: null, unidadesVendidas: null, curvaAbc: null, margemPorFamilia: null,
      });
      await selecionarOrdenacao(cdp, "margem");
      await waitForNode(() => chamadasPerformance.length >= 1, "escolher Margem não disparou a ordenação");
      assert.strictEqual(await cdp.evaluate(`document.getElementById('am-ordenacao').value`), "margem_desc");

      await cdp.evaluate(`(function(){
        var busca = document.getElementById('am-busca');
        busca.value = 'variação';
        busca.dispatchEvent(new Event('input'));
      })()`);
      await waitFor(cdp, `document.getElementById('am-ordenacao').value === ""`,
        "uma nova busca tem de zerar a ordenação (comportamento antigo, ver carregarAnuncios)");
      const estado = await cdp.evaluate(`(function(){
        var dir = document.getElementById('am-ordenacao-dir');
        return {
          rotulo: document.getElementById('am-ordenacao-trigger-label').textContent.trim(),
          dirDesabilitado: dir.disabled,
        }; })()`);
      assert.strictEqual(estado.rotulo, "Padrão", "o combo tem de ressincronizar visualmente com o select depois do reset");
      assert.strictEqual(estado.dirDesabilitado, true);
      performanceHandler = null;
    });

    /* ── 40: nenhum erro de JS na página (sempre a última) ──────────────── */

    await check("40 — nenhum erro de JavaScript durante os fluxos", async () => {
      const jsErros = errosAcumulados.concat(await cdp.evaluate("window.__erros || []"));
      assert.deepStrictEqual(jsErros, [], `erros de JS: ${JSON.stringify(jsErros)}`);
      assert.deepStrictEqual(excecoes, [], `exceções: ${JSON.stringify(excecoes)}`);
    });

    console.log(`\n✓ ${checks} verificações da listagem unificada de Anúncios ML`);
  } catch (err) {
    try {
      const jsErros = await cdp.evaluate("window.__erros || []");
      if (jsErros && jsErros.length) console.error("erros de JS na página:", JSON.stringify(jsErros, null, 2));
    } catch (_) { /* a sessão pode já ter caído */ }
    throw err;
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGTERM");
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
