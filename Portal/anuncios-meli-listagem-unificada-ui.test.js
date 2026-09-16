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
 *   · só o agrupador expande; o anúncio individual abre o modal direto;
 *   · nenhum agrupador abre sozinho, e expandir gasta exatamente 1 requisição;
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
 *     clicar num card recorta a lista única.
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
  {
    tipo: "item", key: "item:MLB-SEMUP", item_id: "MLB-SEMUP", family_id: null,
    titulo: "Anúncio legado sem agrupamento", sku: null,
    preco: 49.9, moeda: "BRL", estoque: 3, vendidos: 1, status: "active",
    permalink: null, thumbnail: null, pictures_count: 1, is_full: false,
    catalog_listing: false, family_name: null,
    score_venforce: 40, revisado: false,
    total_itens: 1, total_user_products: 0, estoque_total: 3, vendidos_total: 1,
    cover: { thumbnail: null, user_product_id: null },
  },
];
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
                  { thumbnail: IMAGEM_DO_PRIMEIRO_ITEM, listing_type_id: "gold_pro" }),
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
          // UMA paginação, contando GRUPOS: são 3 linhas para 6 anúncios reais
          // (4 em FAM-1, 1 em FAM-2, 1 sem agrupador).
          paginacoes: document.querySelectorAll('.am-paginacao').length,
          contagem: (document.querySelector('.am-paginacao .vf-pagination__info') || {}).textContent,
        }; })()`);
      assert.strictEqual(estado.listas, 1, "existe mais de uma tabela na tela");
      assert.strictEqual(estado.linhas, 3, "3 linhas: 2 agrupadores + 1 anúncio individual");
      assert.strictEqual(estado.grupos, 2);
      assert.strictEqual(estado.itens, 1);
      assert.strictEqual(estado.todasNaMesmaLista, true);
      assert.strictEqual(estado.seletorDeModo, null, "o seletor de aba continua no DOM");
      assert.strictEqual(estado.containerDeFamilias, null, "o segundo container continua no DOM");
      assert.strictEqual(estado.arvore, 0, "a árvore separada continua sendo montada");
      assert.strictEqual(estado.paginacoes, 1, "voltou a existir mais de uma paginação");
      assert.ok(/\b3\b/.test(estado.contagem || "") && !/\b6\b/.test(estado.contagem || ""),
        `a paginação precisa contar grupos (3), não anúncios (6): "${estado.contagem}"`);
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

    await check("6 — nenhum agrupador abre sozinho", async () => {
      const abertas = await cdp.evaluate("document.querySelectorAll('.am-row--grupo[aria-expanded=\"true\"]').length");
      assert.strictEqual(abertas, 0, "algum agrupador já veio expandido");
      const mlbs = await cdp.evaluate("document.querySelectorAll('.am-mlb').length");
      assert.strictEqual(mlbs, 0, "houve carga de detalhe sem o usuário pedir");
      assert.strictEqual(contar(/\/familias\/FAM/, 0), 0, "gastou requisição de detalhe sem clique");
    });

    await check("7 — o anúncio individual não tem painel para expandir", async () => {
      const estado = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMUP"]');
        var prox = r.nextElementSibling;
        return {
          temAriaExpanded: r.hasAttribute('aria-expanded'),
          temChevron: Boolean(r.querySelector('.am-row__chevron')),
          proxEhPainel: Boolean(prox && prox.classList.contains('am-grupo-painel')),
        }; })()`);
      assert.strictEqual(estado.temAriaExpanded, false, "anúncio individual não expande nada");
      assert.strictEqual(estado.temChevron, false);
      assert.strictEqual(estado.proxEhPainel, false, "criou painel para uma linha sem nada dentro");
    });

    /* ── 8 a 10: expansão explícita, hierarquia e UP com 2 MLBs ─────────── */

    let antesExpandir = pedidos.length;
    await check("8 — expandir o agrupador busca o detalhe e põe os MLBs direto abaixo dele", async () => {
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
      assert.strictEqual(contar(/\/familias\/FAM-1/, antesExpandir), 1, "deve gastar exatamente 1 requisição");
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

      const antes = pedidos.length;
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-mlb')`, "o agrupador da nova conta não carregou");
      const up = await cdp.evaluate(
        `document.querySelector('${painelFam("FAM-1")} .am-variacao').getAttribute('data-user-product')`);
      assert.strictEqual(up, "MLBU-900", "veio o dado cacheado da conta anterior");
      assert.strictEqual(contar(/\/familias\/FAM-1/, antes), 1, "o cache velho impediu a busca na conta nova");
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
      await waitFor(cdp, "document.querySelectorAll('.am-listagem > .am-row').length === 3", "a lista da conta 42 não voltou");
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
      await waitFor(cdp, "document.querySelectorAll('.am-listagem > .am-row').length === 3", "o filtro não foi desligado");
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
    const errosAteAqui = await cdp.evaluate("window.__erros || []");
    pedidos.length = 0;
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
    await waitFor(cdp, "document.querySelector('.am-row--grupo')", "a lista não voltou depois do reload");

    const capaDe = (familyId) => `(function(){
      var m = document.querySelector(${JSON.stringify(linhaFam(familyId) + " .am-row__thumb")});
      var img = m && m.querySelector('img');
      return { temImg: Boolean(img), src: img ? img.getAttribute('src') : null,
               temPlaceholder: Boolean(m && m.querySelector('svg')) }; })()`;

    await check("18 — o agrupador FECHADO já mostra a capa escolhida pela API", async () => {
      const capa = await cdp.evaluate(capaDe("FAM-1"));
      assert.strictEqual(capa.temImg, true, "o agrupador fechado continuou no placeholder cinza");
      assert.strictEqual(capa.src, CAPA_FAM1, "a capa não é a que veio em cover.thumbnail");
      assert.strictEqual(capa.temPlaceholder, false, "o ícone de placeholder ficou junto da imagem");
      assert.strictEqual(contar(/\/familias\/FAM-1/, 0), 0, "a capa não pode custar requisição de detalhe");
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

    await check("27b — o anúncio individual também edita estoque; o agrupador NÃO", async () => {
      // "Cada linha MLB" inclui o anúncio sem agrupamento: ele é um MLB como
      // qualquer outro. A linha do AGRUPADOR é a exceção, e não por esquecimento:
      // o estoque dela é a soma das variações, não um número que exista no
      // Mercado Livre para ser escrito.
      const onde = await cdp.evaluate(`(function(){
        return {
          individual: Boolean(document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-estoque')),
          agrupador: Boolean(document.querySelector('${linhaFam("FAM-1")} .am-estoque')),
        }; })()`);
      assert.strictEqual(onde.individual, true, "o anúncio individual precisa ter estoque editável");
      assert.strictEqual(onde.agrupador, false,
        "a linha do agrupador não pode ter estoque editável: o número dela é soma, não dado do ML");

      const antes = pedidos.length;
      escritasEstoque.length = 0;
      await clicar(cdp, '.am-row[data-item="MLB-SEMUP"] .am-estoque .am-estoque__btn');
      await waitFor(cdp, `document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-estoque__input')`,
        "o campo não abriu no anúncio individual");
      await cdp.evaluate(`(function(){
        var inp = document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-estoque__input');
        inp.value = '0';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await waitFor(cdp,
        `(function(){ var b = document.querySelector('.am-row[data-item="MLB-SEMUP"] .am-estoque__btn');
           return b && b.textContent.trim() === '0'; })()`,
        "o estoque 0 não apareceu na linha do anúncio individual");

      assert.strictEqual(escritasEstoque.length, 1);
      assert.strictEqual(escritasEstoque[0].corpo.estoque, 0, "zero tem de chegar ao servidor como 0");
      assert.strictEqual(contar(/^\/anuncios-meli\/MLB-SEMUP\/estoque/, antes), 1);

      // available_quantity = 0 pausa o anúncio no ML. O status na linha vem do
      // que o servidor reportou — deixá-la "Ativo" seria a tela mentindo.
      const depois = await cdp.evaluate(`(function(){
        var r = document.querySelector('.am-row[data-item="MLB-SEMUP"]');
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

    /* ── 28: nenhum erro de JS na página (sempre a última) ─────────────── */

    await check("28 — nenhum erro de JavaScript durante os fluxos", async () => {
      const jsErros = errosAteAqui.concat(await cdp.evaluate("window.__erros || []"));
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
