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
 *   · um user_product com 2 MLBs aparece UMA vez, com os dois anúncios dentro;
 *   · clicar numa linha MLB do agrupador abre o MESMO modal da lista;
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
  }, extra || {});
}

const DETALHE_CONTA_42 = {
  "FAM-1": {
    family_id: "FAM-1", family_name: "Camiseta Dry Fit Masculina",
    user_products: [
      // MLB-A1 tem imagem PRÓPRIA, diferente da capa: se o front voltar a
      // deduzir a capa pelo primeiro item, é esta que apareceria na linha.
      { user_product_id: "MLBU-100", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 2,
        itens: [item("MLB-A1", "Camiseta Dry Fit Azul P", "MLBU-100", { thumbnail: IMAGEM_DO_PRIMEIRO_ITEM }),
                item("MLB-A2", "Camiseta Dry Fit Azul P (12x)", "MLBU-100")] },
      { user_product_id: "MLBU-200", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 1,
        itens: [item("MLB-A3", "Camiseta Dry Fit Azul M", "MLBU-200")] },
      { user_product_id: "MLBU-300", site_id: "MLB", domain_id: "MLB-T_SHIRTS", total_itens: 1,
        itens: [item("MLB-A4", "Camiseta Dry Fit Azul G", "MLBU-300")] },
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
        }; })()`);
      assert.strictEqual(estado.listas, 1, "existe mais de uma tabela na tela");
      assert.strictEqual(estado.linhas, 3, "3 linhas: 2 agrupadores + 1 anúncio individual");
      assert.strictEqual(estado.grupos, 2);
      assert.strictEqual(estado.itens, 1);
      assert.strictEqual(estado.todasNaMesmaLista, true);
      assert.strictEqual(estado.seletorDeModo, null, "o seletor de aba continua no DOM");
      assert.strictEqual(estado.containerDeFamilias, null, "o segundo container continua no DOM");
      assert.strictEqual(estado.arvore, 0, "a árvore separada continua sendo montada");
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
    await check("8 — expandir o agrupador busca o detalhe e monta User Product -> MLB", async () => {
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-up')`, "o painel do agrupador não carregou");
      const estado = await cdp.evaluate(`(function(){
        var r = document.querySelector('${linhaFam("FAM-1")}');
        var p = r.nextElementSibling;
        return {
          expandido: r.getAttribute('aria-expanded'),
          painelVisivel: !p.hidden,
          ups: p.querySelectorAll('.am-up').length,
          mlbs: p.querySelectorAll('.am-mlb').length,
        }; })()`);
      assert.strictEqual(estado.expandido, "true");
      assert.strictEqual(estado.painelVisivel, true);
      assert.strictEqual(estado.ups, 3, "o agrupador tem 3 user products");
      assert.strictEqual(estado.mlbs, 4, "o agrupador tem 4 anúncios no total");
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

    await check("9 — o user product com 2 MLBs aparece UMA vez, com os dois dentro", async () => {
      const up = await cdp.evaluate(`(function(){
        var blocos = Array.from(document.querySelectorAll('${painelFam("FAM-1")} .am-up'));
        var alvo = blocos.filter(function(b){ return b.querySelector('.am-up__id').textContent === 'MLBU-100'; });
        return {
          ocorrencias: alvo.length,
          itens: alvo.length ? Array.from(alvo[0].querySelectorAll('.am-mlb')).map(function(r){ return r.getAttribute('data-item'); }) : [],
        }; })()`);
      assert.strictEqual(up.ocorrencias, 1, "o user product foi duplicado na tela");
      assert.deepStrictEqual(up.itens, ["MLB-A1", "MLB-A2"]);
    });

    await check("10 — o user product não é clicável (é só agrupamento visual)", async () => {
      const interativo = await cdp.evaluate(`(function(){
        var head = document.querySelector('.am-up__head');
        return { tag: head.tagName, temRole: head.hasAttribute('role'), temTabindex: head.hasAttribute('tabindex') }; })()`);
      assert.strictEqual(interativo.tag, "DIV");
      assert.strictEqual(interativo.temRole, false);
      assert.strictEqual(interativo.temTabindex, false);
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
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-2")} .am-up')`, "o agrupador B não carregou");

      const b = await cdp.evaluate(`(function(){
        return Array.from(document.querySelectorAll('${painelFam("FAM-2")} .am-mlb'))
          .map(function(r){ return r.getAttribute('data-item'); }); })()`);
      assert.deepStrictEqual(b, ["MLB-B9"], "o painel do agrupador B recebeu dados de outro agrupador");

      // Espera a resposta atrasada de A chegar e confirma que ela foi para o
      // painel de A, sem contaminar o de B.
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-up')`, "o agrupador A não carregou depois do atraso");
      const depois = await cdp.evaluate(`(function(){
        return Array.from(document.querySelectorAll('${painelFam("FAM-2")} .am-mlb'))
          .map(function(r){ return r.getAttribute('data-item'); }); })()`);
      assert.deepStrictEqual(depois, ["MLB-B9"], "a resposta atrasada de A sobrescreveu o painel de B");
      atrasoDetalheFamilia = {};
    });

    /* ── 13: troca de conta invalida o cache ───────────────────────────── */

    await check("13 — trocar de conta limpa o cache: o agrupador não volta com dados da conta anterior", async () => {
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-up')`, "FAM-1 precisa estar carregada antes da troca");
      const antesTroca = await cdp.evaluate(`document.querySelector('${painelFam("FAM-1")} .am-up__id').textContent`);
      assert.strictEqual(antesTroca, "MLBU-100");

      await cdp.evaluate("window.VF.context.setConta('43')");
      await waitFor(cdp, `(function(){ var t = document.querySelector('.am-row--grupo .am-row__titulo');
        return t && t.textContent === 'FAMÍLIA DA LOJA B'; })()`,
        "a lista não trocou junto com a conta");

      const abertas = await cdp.evaluate("document.querySelectorAll('.am-row--grupo[aria-expanded=\"true\"]').length");
      assert.strictEqual(abertas, 0, "o agrupador continuou expandido depois da troca de conta");

      const antes = pedidos.length;
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-up')`, "o agrupador da nova conta não carregou");
      const up = await cdp.evaluate(`document.querySelector('${painelFam("FAM-1")} .am-up__id').textContent`);
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

    await check("16 — clicar numa linha MLB do agrupador abre o modal de sempre", async () => {
      await clicar(cdp, linhaFam("FAM-1"));
      await waitFor(cdp, "document.querySelector('.am-mlb')", "o agrupador não trouxe linhas MLB");
      await clicar(cdp, ".am-mlb");
      await waitFor(cdp, "document.querySelector('.am-det-modal')", "o modal não abriu pela linha do agrupador");
      await waitFor(cdp, "document.getElementById('am-det-titulo')", "o modal não terminou de carregar");
      const m = await cdp.evaluate(`(function(){
        var e = document.querySelector('.am-det-modal');
        return { role: e.getAttribute('role'), modal: e.getAttribute('aria-modal') }; })()`);
      assert.strictEqual(m.role, "dialog");
      assert.strictEqual(m.modal, "true");
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
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-1")} .am-up')`, "FAM-1 não abriu");
      const fam1 = await cdp.evaluate(capaDe("FAM-1"));
      assert.strictEqual(fam1.src, CAPA_FAM1,
        `a expansão trocou a capa pela imagem de um item (${fam1.src})`);

      // FAM-2 é o caso decisivo: o item TEM imagem e a API disse que o
      // agrupador não tem capa. Se o front voltar a deduzir, se entrega aqui.
      await clicar(cdp, linhaFam("FAM-2"));
      await waitFor(cdp, `document.querySelector('${painelFam("FAM-2")} .am-up')`, "FAM-2 não abriu");
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

    /* ── 22: nenhum erro de JS na página ───────────────────────────────── */

    await check("22 — nenhum erro de JavaScript durante os fluxos", async () => {
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
