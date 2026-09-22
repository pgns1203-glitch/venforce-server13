/*
 * Detalhe do anúncio (Anúncios ML) — o drawer lateral com 5 abas virou um
 * MODAL CENTRAL de superfície única, e Título/Modelo/Descrição passaram a ser
 * editáveis DE VERDADE (escrita no Mercado Livre via PATCH /:itemId/conteudo).
 *
 * O que só um navegador comprova, e por isso está aqui:
 *
 *   · clicar numa linha abre o modal novo — e o drawer/tabs sumiram do DOM,
 *     não ficaram escondidos por baixo;
 *   · alteração pendente é DETECTADA, aparece na barra e some ao descartar;
 *   · salvar leva o clienteSlug + clienteContaId do contexto, e só vira
 *     "salvo" o campo que o backend confirmou — erro não produz falso sucesso;
 *   · fechar com alteração pendente não perde dado em silêncio;
 *   · resposta atrasada da Conta A não pinta a tela da Conta B, e o estado do
 *     anúncio A (inclusive sugestões de IA) não vaza para o anúncio B;
 *   · usuário sem IA (403) usa o modal inteiro — a região de IA se explica em
 *     vez de ficar muda (achado F-02 da auditoria);
 *   · "descrição ausente" e "erro ao carregar descrição" são estados
 *     diferentes na tela (achado F-06).
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

const TITULO_A = "Fone Bluetooth TWS Prime X200 ANC 30h Bateria Original";
const TITULO_B = "Cafeteira Expressa B300 Inox 220V Compacta";
const DESC_A = "Fone Bluetooth TWS Prime X200 com cancelamento ativo de ruído (ANC) e bateria de até 30 horas.";
const SUG_DESC_A = "Fone Bluetooth TWS Prime X200 com ANC, 30h de bateria, Bluetooth 5.3 e estojo USB-C.";
const SUG_TITULO_A = "Fone Bluetooth TWS Prime X200 Cancelamento Ruído 30h";

function anuncio(conta) {
  const a = conta === "43"
    ? { item_id: "MLB-B1", titulo: TITULO_B, sku: "CF-B300", marca: "BrewCo", modelo: "B300", preco: 399.9, cliente_conta_id: 43, ml_user_id: "9002" }
    : { item_id: "MLB-A1", titulo: TITULO_A, sku: "FN-X200-PRT", marca: "Prime Audio", modelo: "X200", preco: 189.9, cliente_conta_id: 42, ml_user_id: "9001" };
  return {
    id: 1, cliente_id: 87, cliente_slug: "n97",
    item_id: a.item_id, titulo: a.titulo, sku: a.sku, marca: a.marca, modelo: a.modelo,
    preco: a.preco, preco_original: precoOriginalAtivo ? 249.9 : null, moeda: "BRL", estoque: 42, vendidos: 187,
    status: "active", sub_status: null,
    listing_type_id: "gold_special", category_id: "MLB1055",
    permalink: "https://produto.mercadolivre.com.br/" + a.item_id,
    thumbnail: null, pictures_count: 2,
    pictures_json: ["https://img.example/1.jpg", "https://img.example/2.jpg"],
    logistic_type: "fulfillment", is_full: true,
    attributes_json: [
      { id: "BRAND", name: "Marca", value: a.marca },
      { id: "MODEL", name: "Modelo", value: a.modelo },
      { id: "COLOR", name: "Cor", value: "Preto" },
      { id: "WEIGHT", name: "Peso", value: null },
      { id: "WARRANTY_TIME", name: "Garantia do fabricante", value: null },
    ],
    health: 0.82, score_venforce: 61, score_motivo: "Menos de 3 fotos",
    revisado: false, cliente_conta_id: a.cliente_conta_id, ml_user_id: a.ml_user_id,
    last_synced_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    catalog_listing: catalogoModo === "catalog_listing" || catalogoModo === "ambos",
    family_name: (catalogoModo === "family_name" || catalogoModo === "ambos") ? "Serum Ácido Salicílico" : null,
  };
}

const OTIMIZACOES_A = [
  {
    id: 501, tipo: "seo", status: "rascunho", ai_model: "claude",
    titulo_sugerido: SUG_TITULO_A, titulo_sugerido_chars: SUG_TITULO_A.length,
    modelo_sugerido: "X200 Pro",
    melhorias_json: { titulos_alternativos: ["Fone TWS Prime X200 ANC Bluetooth 5.3 30h", "Fone Bluetooth Prime X200 ANC Preto 30 Horas"] },
    alertas_json: ["Falta menção à cor"],
    score_seo: 78, motivo: "boas palavras-chave, falta menção à cor",
    aprovado_at: null,
  },
  {
    id: 502, tipo: "descricao", status: "rascunho", ai_model: "claude",
    descricao_sugerida: SUG_DESC_A,
    melhorias_json: { itens: ["Inclui benefícios concretos (ANC, autonomia)"] },
    alertas_json: ["Ainda não menciona a cor disponível"],
    aprovado_at: null,
  },
  {
    id: 503, tipo: "ficha_tecnica", status: "rascunho", ai_model: "claude",
    ficha_tecnica_sugerida_json: [
      { campo: "Peso", valor_atual: "", valor_sugerido: "38 g", confianca: "alta", precisa_revisao: false },
      { campo: "Garantia do fabricante", valor_atual: "", valor_sugerido: "12 meses", confianca: "media", precisa_revisao: true },
    ],
    alertas_json: [],
    aprovado_at: null,
  },
];

// ── interruptores do cenário, ligados por cada verificação ──────────────────
let iaProibida = false;
let descricaoEstado = "ok";          // ok | sem_descricao | erro
let categoriaNomeResposta = "Celulares e Smartphones"; // null = simula falha de resolução
let precoOriginalAtivo = true;       // false = anúncio sem promoção (preco_original nulo)
let variationsCountAtivo = 0;        // > 0 = item legado com variations[] reais no ML (ver anuncio.variations_count)
// "nenhum" | "catalog_listing" | "family_name" | "ambos" — os dois sinais são
// testados em separado porque a causa raiz da tag divergente era exatamente
// um lugar olhar só catalog_listing e o outro olhar catalog_listing||family_name.
let catalogoModo = "nenhum";
let detalheAtrasoPorItem = {};       // itemId -> ms
let conteudoResultado = null;        // resposta forçada do PATCH /conteudo
let precoResultado = null;           // resposta forçada do PATCH /preco
const precoChamadas = [];            // { itemId, body } de todo PATCH /preco
let simularMargemHandler = null;     // (itemId, body) => resposta do POST /simular-margem
const simularMargemChamadas = [];    // { itemId, body } de todo POST /simular-margem
const pedidos = [];                  // toda URL de API disparada
const corpos = [];                   // { url, body } de toda escrita

// GET /anuncios-meli/performance — só a seção "Composição da margem" do
// modal chama isto (a lista tem arquivo de teste próprio). `performanceHandler`,
// quando setado, substitui a resposta padrão inteira; `chamadasPerformance`
// registra cada chamada com os flags exatos que vieram na query string.
let performanceHandler = null;
const chamadasPerformance = [];
// MLB-A1 (item padrão desta suíte, conta 42): margem REALIZADA saudável,
// com ladder completo — taxa fixa ausente de propósito (realizada nunca
// tem, por desenho do Motor).
const MARGEM_MLA1 = { origem: "realized", margin: 0.35, marginPercent: 35, profit: 70, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [] };
const COMPOSICAO_MLA1 = { venda: 200, custoProduto: 80, comissaoMl: 25, frete: 15, taxaFixa: null, impostoPercentual: 0.05, impostoValor: 10 };

const SEMENTE = `
  try {
    localStorage.setItem("vf-token", "detalhe-modal-token");
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

async function esperarPedido(padrao, desde, mensagem) {
  for (let i = 0; i < 200; i++) {
    if (pedidos.slice(desde).some((u) => padrao.test(u))) return pedidos.slice(desde).filter((u) => padrao.test(u));
    await sleep(50);
  }
  throw new Error(mensagem || `Nenhuma requisição casou ${padrao}. Vistas: ${JSON.stringify(pedidos.slice(desde))}`);
}

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

function textoModal(cdp) {
  return cdp.evaluate("document.querySelector('.am-det-modal') ? document.querySelector('.am-det-modal').innerText : ''");
}

async function clicar(cdp, seletor, mensagem) {
  const ok = await cdp.evaluate(`(function(){ var e = document.querySelector(${JSON.stringify(seletor)}); if(!e) return false; e.click(); return true; })()`);
  assert.ok(ok, mensagem || `não achei ${seletor} para clicar`);
}

async function digitar(cdp, seletor, valor) {
  await cdp.evaluate(`(function(){
    var e = document.querySelector(${JSON.stringify(seletor)});
    e.value = ${JSON.stringify(valor)};
    e.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

// Custo do produto/Custos adicionais (simulação) só confirmam no Enter —
// sair do campo CANCELA (mesma regra do estoque da lista). `digitar` sozinho
// não basta: precisa do keydown real. Preço NÃO usa mais esse caminho —
// tem botão próprio, ver salvarPreco/abrirEdicaoPreco abaixo.
async function digitarEConfirmar(cdp, seletor, valor) {
  await cdp.evaluate(`(function(){
    var e = document.querySelector(${JSON.stringify(seletor)});
    e.value = ${JSON.stringify(valor)};
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);
}

async function abrirEdicaoMargem(cdp, campo) {
  await clicar(cdp, `#am-det-margem-body [data-margem-campo="${campo}"] .am-margem-edit__btn`,
    `botão de editar "${campo}" não encontrado na composição`);
  await waitFor(cdp, `document.querySelector('#am-det-margem-body [data-margem-campo="${campo}"] .am-margem-edit__input')`,
    `o input de edição de "${campo}" não apareceu`);
}

async function confirmarEdicaoMargem(cdp, campo, valor) {
  await abrirEdicaoMargem(cdp, campo);
  await digitarEConfirmar(cdp, `#am-det-margem-body [data-margem-campo="${campo}"] .am-margem-edit__input`, valor);
}

// Preço: fluxo próprio, sem Enter-submit — abrir o editor, digitar, clicar
// em "Salvar no Mercado Livre" (ou "Cancelar"). Célula é `.am-margem-preco`,
// não `[data-margem-campo]` (esse atributo só existe nos campos de simulação).
async function abrirEdicaoPreco(cdp) {
  await clicar(cdp, "#am-det-margem-body .am-margem-preco .am-margem-edit__btn",
    "botão de editar preço não encontrado na composição");
  await waitFor(cdp, "document.querySelector('#am-det-margem-body .am-margem-preco .am-margem-edit__input')",
    "o input de edição de preço não apareceu");
}

async function salvarPreco(cdp, valor) {
  await abrirEdicaoPreco(cdp);
  await digitar(cdp, "#am-det-margem-body .am-margem-preco .am-margem-edit__input", valor);
  await clicar(cdp, '#am-det-margem-body .am-margem-preco [data-acao="salvar-preco"]',
    "botão \"Salvar no Mercado Livre\" não encontrado");
}

async function cancelarEdicaoPreco(cdp) {
  await clicar(cdp, '#am-det-margem-body .am-margem-preco [data-acao="cancelar-preco"]',
    "botão \"Cancelar\" não encontrado");
}

// A tela tem UMA lista: anúncio agrupado e anúncio individual são linhas da
// mesma listagem, sem aba. Havia aqui um passo extra para trocar da aba
// "Famílias" para a aba "Sem agrupamento" antes de achar uma linha; o
// seletor de modo não existe mais. O modal aberto pela linha de MLB dentro
// de um agrupador é o mesmo e está em anuncios-meli-listagem-unificada-ui.test.js.
async function esperarLista(cdp) {
  // Esperar o Shell liberar a tela: logo depois de um Page.navigate a
  // consulta cairia no documento anterior.
  await waitFor(cdp, "document.querySelector('.vf-shell__sidebar')", "Shell V3 não montou");
  await waitFor(cdp, "document.getElementById('vf-shell-main').hidden === false", "gating de conta não liberou a tela");
  await waitFor(cdp, "document.querySelector('.am-row')", "a lista não renderizou nenhuma linha");
}

async function abrirPrimeiroAnuncio(cdp) {
  await esperarLista(cdp);
  await clicar(cdp, ".am-row");
  await waitFor(cdp, "document.querySelector('.am-det-modal')", "o modal de detalhe não abriu");
  await waitFor(cdp, "document.getElementById('am-det-titulo')", "o modal não terminou de carregar o detalhe");
}

// Texto de cada linha da composição, SEM o tooltip do vf-info-dot (a linha
// do Imposto tem um selo de explicação cujo texto vive num <span> sempre no
// DOM — só escondido por CSS até o hover; ler .textContent puro contaminaria
// a asserção com esse texto). Clona antes de remover, então a página real
// não perde o tooltip.
async function lerLinhasComposicao(cdp) {
  return cdp.evaluate(`Array.from(document.querySelectorAll('#am-det-margem-body .am-margem-comp__linha')).map(function(e){
    var rotulo = e.querySelector('.am-margem-comp__rotulo').cloneNode(true);
    rotulo.querySelectorAll('.vf-info__tip').forEach(function(t){ t.remove(); });
    var valor = e.querySelector('.am-margem-comp__valor').textContent.trim();
    return rotulo.textContent.replace(/\\s+/g, ' ').trim() + ' ' + valor;
  })`);
}

async function fecharModal(cdp) {
  await cdp.evaluate(`(function(){
    var b = document.querySelector('.am-det-modal [data-acao="descartar-e-fechar"]');
    if (b) { b.click(); return; }
    var f = document.querySelector('.am-det-close'); if (f) f.click();
    var d = document.querySelector('.am-det-modal [data-acao="descartar-e-fechar"]'); if (d) d.click();
  })()`);
  await waitFor(cdp, "!document.querySelector('.am-det-modal')", "o modal não fechou");
}

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
    let body = null;
    if (params.request.postData) {
      try { body = JSON.parse(params.request.postData); } catch (_) { body = params.request.postData; }
      corpos.push({ url: caminho, metodo: params.request.method, body });
    }

    if (url.includes("/me/context")) { await corpo(ME_CONTEXT); return; }
    if (url.includes("/operacao/cliente-360/clientes")) { await corpo({ ok: true, clientes: [N97] }); return; }
    if (/\/clientes\/[^/?]+\/contas/.test(url)) { await corpo({ ok: true, cliente: N97, contas: N97_CONTAS }); return; }

    if (url.includes("/anuncios-meli/clientes")) {
      await corpo({ ok: true, clientes: [{ id: 87, nome: "N97 Comercial", slug: "n97", mlConectado: true, totalAnuncios: 2 }] });
      return;
    }
    if (url.includes("/anuncios-meli/resumo")) {
      await corpo({ ok: true, resumo: { total: 2, ativos: 2, ultimaSync: new Date().toISOString() } });
      return;
    }

    // A LISTA da tela. GET /anuncios-meli/familias devolve a listagem
    // unificada: cada linha é um agrupador (tipo "familia") ou o próprio
    // anúncio (tipo "item"). Aqui só interessa o anúncio individual — o
    // agrupador tem arquivo próprio (anuncios-meli-listagem-unificada-ui.test.js).
    // Precisa vir ANTES do matcher genérico de detalhe, senão /familias
    // receberia um anúncio como resposta.
    if (caminho.startsWith("/anuncios-meli/familias")) {
      const conta = new URL(url).searchParams.get("clienteContaId") || "42";
      const a = anuncio(conta);
      await corpo({
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" },
        anuncios: [Object.assign({}, a, {
          tipo: "item", key: "item:" + a.item_id, family_id: null,
          total_itens: 1, total_user_products: 0,
          estoque_total: a.estoque, vendidos_total: a.vendidos,
        })],
        paginacao: { page: 1, limit: 20, total: 1, totalPaginas: 1 },
      });
      return;
    }

    // GET /anuncios-meli/performance — precisa vir ANTES do matcher genérico
    // de detalhe (mDetalhe, abaixo), senão "performance" seria lido como um
    // itemId. Só a seção "Composição da margem" do modal chama isto.
    if (caminho.startsWith("/anuncios-meli/performance")) {
      const qs = new URL(url).searchParams;
      const idsPedidos = (qs.get("itemIds") || "").split(",").filter(Boolean);
      const incluirMetricas = qs.get("incluirMetricas") !== "0";
      const incluirMargem = qs.get("incluirMargem") !== "0";
      const incluirComposicao = qs.get("incluirComposicao") === "1";
      chamadasPerformance.push({ itemIds: idsPedidos, incluirMetricas, incluirMargem, incluirComposicao });
      if (performanceHandler) { await corpo(performanceHandler(idsPedidos, { incluirMetricas, incluirMargem, incluirComposicao })); return; }

      const metricas7d = {};
      const margem = {};
      const composicao = {};
      idsPedidos.forEach((id) => {
        if (incluirMetricas) metricas7d[id] = { views: 10, vendas: 1, conversao: 10 };
        // precoOriginal segue o MESMO toggle do corpo do item (precoOriginalAtivo)
        // — sem isso, o preço cheio ao vivo (agora a mesma fonte do cabeçalho,
        // ver Portal/anuncios-meli.js precoDetalheHtml) ficaria dessincronizado
        // do snapshot que o mock do item devolve.
        if (incluirMargem) margem[id] = id === "MLB-A1"
          ? Object.assign({}, MARGEM_MLA1, { precoOriginal: precoOriginalAtivo ? 249.9 : null })
          : { origem: "projected", margin: 0.2, marginPercent: 20, profit: 30, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [] };
        if (incluirComposicao) composicao[id] = id === "MLB-A1" ? COMPOSICAO_MLA1 : { venda: 150, custoProduto: 60, comissaoMl: 18, frete: 12, taxaFixa: 3, impostoPercentual: 0.04, impostoValor: 6 };
      });
      await corpo({ ok: true, metricas7d, margem, margemIndisponivel: null, composicao });
      return;
    }

    // PATCH /anuncios-meli/:itemId/conteudo — a escrita real no ML
    const mConteudo = caminho.match(/\/anuncios-meli\/([^/?]+)\/conteudo/);
    if (mConteudo) {
      if (conteudoResultado) { await corpo(conteudoResultado.corpo, conteudoResultado.status); return; }
      const conta = String((body && body.clienteContaId) || "42");
      const base = anuncio(conta);
      const resultados = {};
      ["titulo", "modelo", "descricao"].forEach((c) => {
        if (body && body[c] !== undefined) { resultados[c] = { ok: true }; if (c !== "descricao") base[c] = body[c]; }
      });
      // Espelha o contrato real: a descrição só volta quando ela mudou.
      const resposta = { ok: true, resultados, anuncio: base };
      if (body && body.descricao !== undefined) {
        resposta.descricao = body.descricao;
        resposta.descricaoEstado = "ok";
        resposta.descricaoErro = null;
      }
      await corpo(resposta);
      return;
    }

    if (/\/anuncios-meli\/[^/?]+\/revisao/.test(caminho)) { await corpo({ ok: true, revisado: !!(body && body.revisado) }); return; }

    if (/\/anuncios-meli\/[^/?]+\/otimizacoes/.test(caminho)) {
      if (iaProibida) { await corpo({ ok: false, motivo: "Acesso restrito." }, 403); return; }
      const itemId = caminho.match(/\/anuncios-meli\/([^/?]+)\/otimizacoes/)[1];
      await corpo({ ok: true, otimizacoes: itemId === "MLB-A1" ? OTIMIZACOES_A : [] });
      return;
    }

    if (/\/anuncios-meli\/[^/?]+\/otimizar/.test(caminho)) {
      if (iaProibida) { await corpo({ ok: false, motivo: "Acesso restrito." }, 403); return; }
      const tipo = (body && body.tipo) || "seo";
      await corpo({ ok: true, tipo, otimizacao: OTIMIZACOES_A.find((o) => o.tipo === tipo) });
      return;
    }

    if (/\/anuncios-meli\/otimizacoes\/\d+\/aprovar/.test(caminho)) {
      const id = Number(caminho.match(/otimizacoes\/(\d+)\/aprovar/)[1]);
      const base = OTIMIZACOES_A.find((o) => o.id === id) || OTIMIZACOES_A[0];
      await corpo({ ok: true, otimizacao: { ...base, status: "aprovado", aprovado_at: "2026-09-12T09:14:00Z" } });
      return;
    }

    // PATCH /anuncios-meli/:itemId/preco — escrita REAL de preço (API dedicada
    // de Preços do ML por baixo, ver meliPrecoService). O resultado devolvido
    // aqui NUNCA precisa ser o valor enviado — o service real relê do ML antes
    // de responder, e é isso que `precoResultado` simula quando setado.
    const mPreco = caminho.match(/\/anuncios-meli\/([^/?]+)\/preco$/);
    if (mPreco) {
      precoChamadas.push({ itemId: mPreco[1], body });
      if (precoResultado) { await corpo(precoResultado.corpo, precoResultado.status); return; }
      await corpo({ ok: true, preco: (body && body.preco) || 0, moeda: "BRL" });
      return;
    }

    // POST /anuncios-meli/:itemId/simular-margem — simulação pura de
    // custo/custos adicionais (nunca escreve no ML, nunca grava na Base).
    const mSimular = caminho.match(/\/anuncios-meli\/([^/?]+)\/simular-margem$/);
    if (mSimular) {
      simularMargemChamadas.push({ itemId: mSimular[1], body });
      if (simularMargemHandler) { await corpo(simularMargemHandler(mSimular[1], body)); return; }
      await corpo({
        ok: true, simulado: true, origem: "realized",
        resultado: { computable: true, profit: 99, margin: 0.33, marginPercent: 33, missing: [], assumed: [] },
      });
      return;
    }

    // GET /anuncios-meli/:itemId (detalhe)
    const mDetalhe = caminho.match(/^\/anuncios-meli\/([^/?]+)(\?|$)/);
    if (mDetalhe && mDetalhe[1] !== "") {
      const itemId = mDetalhe[1];
      const atraso = detalheAtrasoPorItem[itemId];
      if (atraso) await sleep(atraso);
      const conta = new URL(url).searchParams.get("clienteContaId") || "42";
      const base = anuncio(conta);
      base.item_id = itemId;
      base.titulo = itemId === "MLB-B1" ? TITULO_B : TITULO_A;
      base.variations_count = variationsCountAtivo;
      const resposta = {
        ok: true, cliente: { slug: "n97", nome: "N97 Comercial" }, anuncio: base,
        descricao: descricaoEstado === "ok" ? DESC_A : null,
        descricaoEstado,
        descricaoErro: descricaoEstado === "erro" ? "O Mercado Livre não devolveu a descrição (HTTP 500)." : null,
        categoriaNome: categoriaNomeResposta,
      };
      await corpo(resposta);
      return;
    }

    if (url.includes("/anuncios-meli")) {
      const conta = new URL(url).searchParams.get("clienteContaId") || "42";
      const a = anuncio(conta);
      await corpo({ ok: true, anuncios: [a], paginacao: { page: 1, limit: 24, total: 1, totalPaginas: 1 } });
      return;
    }

    await respond("Fetch.failRequest", { requestId: params.requestId, errorReason: "ConnectionRefused" });
  };
  return excecoes;
}

async function run() {
  const server = await startServer();
  const porta = server.address().port;
  const debugPort = 22000 + Math.floor(Math.random() * 900);
  const chrome = childProcess.spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--window-size=1440,900",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/vf-det-modal-${process.pid}`, "about:blank",
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
    // Runtime.exceptionThrown não vê promise rejeitada dentro de um .then() —
    // e é exatamente ali que o render do modal vive. Sem esta rede, um erro
    // de JS aparece só como "o modal não carregou".
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

    /* ── 1 a 4: a estrutura nova substituiu a antiga ───────────────────── */

    await check("1 — clicar numa linha do catálogo abre o NOVO modal central", async () => {
      await abrirPrimeiroAnuncio(cdp);
      const m = await cdp.evaluate(`(function(){
        var e = document.querySelector('.am-det-modal'); var r = e.getBoundingClientRect();
        return { role: e.getAttribute('role'), modal: e.getAttribute('aria-modal'),
                 largura: Math.round(r.width), esquerda: Math.round(r.left), direita: Math.round(window.innerWidth - r.right) }; })()`);
      assert.strictEqual(m.role, "dialog");
      assert.strictEqual(m.modal, "true");
      // Centralizado: a folga à esquerda e à direita é a mesma (é modal, não drawer ancorado).
      assert.ok(Math.abs(m.esquerda - m.direita) <= 2, `modal não está centralizado: ${m.esquerda} vs ${m.direita}`);
    });

    await check("2 — o drawer antigo não é usado (nem escondido por baixo)", async () => {
      const n = await cdp.evaluate("document.querySelectorAll('.am-drawer, #am-drawer, .vf-drawer, #am-drawer-body, #am-modal-overlay').length");
      assert.strictEqual(n, 0, "sobrou estrutura do drawer no DOM");
    });

    await check("3 — as cinco abas antigas não existem", async () => {
      const n = await cdp.evaluate("document.querySelectorAll('.am-tab, .am-tabs, .am-tab-panel, [role=\"tablist\"], #am-tab-ia, #am-tab-geral, #am-tab-ficha, #am-tab-fotos, #am-tab-desc').length");
      assert.strictEqual(n, 0, "sobrou estrutura de abas no DOM");
      const rolagem = await cdp.evaluate(`(function(){ var s = document.getElementById('am-det-scroll');
        return { overflow: getComputedStyle(s).overflowY, rolavel: s.scrollHeight > s.clientHeight }; })()`);
      assert.strictEqual(rolagem.overflow, "auto", "a superfície única precisa rolar verticalmente");
      assert.ok(rolagem.rolavel, "o conteúdo deveria exceder a altura do modal e rolar");
    });

    await check("4 — o conteúdo essencial das 5 abas antigas está na mesma superfície", async () => {
      const t = await textoModal(cdp);
      const esperado = [
        TITULO_A, "MLB-A1", "FN-X200-PRT", "Ativo",           // identidade
        "R$ 189,90", "R$ 249,90", "42", "187",                 // comercial
        "Prime Audio", "X200", "Celulares e Smartphones", "Clássico · Full", // catálogo
        "Score VenForce", "61", "Principal ponto",             // qualidade
        "Fotos", "Recomendado ter pelo menos 3 fotos",         // fotos
        "Descrição", "Ficha técnica", "Garantia do fabricante", "Vazio",
        "Sugestão da IA", "Score SEO 78/100",                  // otimização IA
        "Abrir no Mercado Livre", "Marcar como revisado",      // ações
      ];
      // innerText já vem com o text-transform aplicado (os rótulos do canva
      // são caixa alta), então a comparação ignora caixa.
      const alvo = t.toLowerCase();
      esperado.forEach((frag) => assert.ok(alvo.includes(frag.toLowerCase()), `sumiu do detalhe: "${frag}"`));
    });

    await check("4a — preço original aparece riscado quando há promoção; some quando não há", async () => {
      const comPromo = await cdp.evaluate("document.querySelector('.am-det-price small')");
      assert.ok(comPromo, "com preco_original truthy, o preço original deveria aparecer riscado");
      const textoComPromo = await cdp.evaluate("document.querySelector('.am-det-price').innerText");
      assert.ok(/249,90/.test(textoComPromo), `preço original ausente: ${textoComPromo}`);
      assert.strictEqual(
        await cdp.evaluate("getComputedStyle(document.querySelector('.am-det-price small')).textDecorationLine"),
        "line-through", "o preço original precisa aparecer riscado"
      );

      // Mesmo anúncio, agora sem promoção — a linha não deve aparecer. Recarrega
      // a página (não só fecha/reabre o modal): o preço cheio do cabeçalho
      // agora também é cacheado ao vivo por item_id (mesma fonte da lista,
      // ver Portal/anuncios-meli.js precoDetalheHtml/AM.state.performanceCache)
      // — sem reload, o valor da chamada anterior continuaria em cache.
      await fecharModal(cdp);
      precoOriginalAtivo = false;
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
      await abrirPrimeiroAnuncio(cdp);
      const semPromoElemento = await cdp.evaluate("document.querySelector('.am-det-price small')");
      assert.strictEqual(semPromoElemento, null, "sem preco_original, nada de preço riscado deveria aparecer");
      const textoSemPromo = await cdp.evaluate("document.querySelector('.am-det-price').innerText");
      assert.strictEqual(textoSemPromo, "R$ 189,90", `sobrou algo do preço original: ${textoSemPromo}`);
      precoOriginalAtivo = true;
    });

    await check("4c — preço original ao vivo IGUAL ao atual não é promoção: cabeçalho mostra só o preço atual", async () => {
      // Bug reportado após a auditoria de preço cheio: sale_price.regular_amount
      // pode voltar igual a amount (sem ser mais um desconto) — o código antigo
      // só checava `precoOriginal != null`, então riscava "R$ 189,90" sobre o
      // próprio "R$ 189,90" atual. Precisa existir DIFERENÇA real (cheio > atual).
      performanceHandler = (ids) => {
        const margem = {};
        ids.forEach((id) => {
          margem[id] = id === "MLB-A1"
            ? Object.assign({}, MARGEM_MLA1, { precoAtual: 189.9, precoOriginal: 189.9 })
            : { origem: "projected", margin: 0.2, marginPercent: 20, profit: 30, status: "HEALTHY", statusLabel: "Saudável", statusReasons: [] };
        });
        return { ok: true, metricas7d: {}, margem, margemIndisponivel: null, composicao: {} };
      };
      try {
        await fecharModal(cdp);
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await abrirPrimeiroAnuncio(cdp);
        const semPromoElemento = await cdp.evaluate("document.querySelector('.am-det-price small')");
        assert.strictEqual(semPromoElemento, null, "precoOriginal igual ao precoAtual não é promoção — não pode riscar");
        const texto = await cdp.evaluate("document.querySelector('.am-det-price').innerText");
        assert.strictEqual(texto, "R$ 189,90", `sobrou algo do preço original: ${texto}`);
      } finally {
        performanceHandler = null;
      }
    });

    await check("4b — categoria mostra o nome legível resolvido pelo backend, não o category_id cru", async () => {
      const texto = await cdp.evaluate("document.getElementById('am-det-modelo').closest('.am-det-top2__col').innerText");
      assert.ok(texto.includes("Celulares e Smartphones"), `nome da categoria ausente: ${texto}`);
      assert.ok(!texto.includes("MLB1055"), `o category_id cru vazou para a tela: ${texto}`);

      // Falha na resolução (categoriaNome null): cai para o category_id, sem quebrar o modal.
      await fecharModal(cdp);
      categoriaNomeResposta = null;
      await abrirPrimeiroAnuncio(cdp);
      const fallback = await cdp.evaluate("document.getElementById('am-det-modelo').closest('.am-det-top2__col').innerText");
      assert.ok(fallback.includes("MLB1055"), `sem nome resolvido, deveria cair para o category_id: ${fallback}`);
      categoriaNomeResposta = "Celulares e Smartphones";
    });

    /* ── 5 a 9: edição, pendência e descarte ──────────────────────────── */

    await check("5 — Título é editável no modal", async () => {
      const info = await cdp.evaluate(`(function(){ var e = document.getElementById('am-det-titulo');
        return { tag: e.tagName, readonly: e.readOnly, disabled: e.disabled, max: e.getAttribute('maxlength'), valor: e.value }; })()`);
      assert.strictEqual(info.tag, "INPUT");
      assert.ok(!info.readonly && !info.disabled, "o título deveria ser editável");
      assert.strictEqual(info.max, "60", "o título precisa respeitar o limite do Mercado Livre");
      assert.strictEqual(info.valor, TITULO_A);
    });

    await check("6 — Modelo é editável no modal", async () => {
      const info = await cdp.evaluate(`(function(){ var e = document.getElementById('am-det-modelo');
        return { tag: e.tagName, readonly: e.readOnly, valor: e.value }; })()`);
      assert.strictEqual(info.tag, "INPUT");
      assert.ok(!info.readonly, "o modelo deveria ser editável");
      assert.strictEqual(info.valor, "X200");
    });

    await check("7 — Descrição é editável no modal", async () => {
      const info = await cdp.evaluate(`(function(){ var e = document.getElementById('am-det-descricao');
        return { tag: e.tagName, readonly: e.readOnly, valor: e.value }; })()`);
      assert.strictEqual(info.tag, "TEXTAREA");
      assert.ok(!info.readonly, "a descrição deveria ser editável");
      assert.strictEqual(info.valor, DESC_A);
    });

    // A doc do ML separa os dois conceitos: catalog_listing identifica a
    // publicação de catálogo (é o único sinal que acende a tag visual);
    // family_name é outro conceito (família/User Products) — não deve ligar
    // a tag, mas o Mercado Livre já demonstrou travar o título por causa dele
    // mesmo assim, então o bloqueio de edição continua olhando os dois.
    async function abrirComModo(modo) {
      await fecharModal(cdp);
      catalogoModo = modo;
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
      await esperarLista(cdp);
    }

    await check("7a — catalog_listing=true: tag Catálogo aparece (lista e detalhe) e título fica travado", async () => {
      await abrirComModo("catalog_listing");
      const tagLista = await cdp.evaluate("(document.querySelector('.am-row .vf-tag') || {}).textContent || ''");
      assert.ok(/Catálogo/.test(tagLista), `catalog_listing=true deveria mostrar a tag na lista: "${tagLista}"`);

      await abrirPrimeiroAnuncio(cdp);
      const tituloInfo = await cdp.evaluate(`(function(){ var e = document.getElementById('am-det-titulo');
        return { readonly: e.readOnly, disabled: e.disabled }; })()`);
      assert.ok(tituloInfo.readonly, "título deveria ficar readonly com catalog_listing=true");
      assert.ok(!tituloInfo.disabled, "readonly (não disabled) para continuar selecionável/copiável");

      const texto = await textoModal(cdp);
      assert.ok(/Catálogo/.test(texto), `a tag de catálogo não apareceu no detalhe: ${texto}`);
      assert.ok(/Gerenciado pelo Mercado Livre/.test(texto), `o aviso explicando o motivo não apareceu: ${texto}`);

      const modeloInfo = await cdp.evaluate("document.getElementById('am-det-modelo').readOnly");
      assert.ok(!modeloInfo, "modelo deveria continuar editável");
    });

    await check("7b — family_name sem catalog_listing: NÃO mostra tag Catálogo, mas título continua protegido", async () => {
      await abrirComModo("family_name");
      const semTagLista = await cdp.evaluate("document.querySelector('.am-row .vf-tag.is-primary')");
      assert.strictEqual(semTagLista, null, "family_name sozinho não deveria acender a tag na lista (não é catalog_listing)");

      await abrirPrimeiroAnuncio(cdp);
      const tituloInfo = await cdp.evaluate("document.getElementById('am-det-titulo').readOnly");
      assert.ok(tituloInfo, "título deveria continuar travado por family_name, mesmo sem catalog_listing");

      const texto = await textoModal(cdp);
      assert.ok(!/Catálogo/.test(texto), `a tag "Catálogo" não deveria aparecer no detalhe só com family_name: ${texto}`);
      assert.ok(/Gerenciado pelo Mercado Livre/.test(texto), `o aviso de bloqueio do título deveria continuar aparecendo: ${texto}`);

      const modeloInfo = await cdp.evaluate("document.getElementById('am-det-modelo').readOnly");
      assert.ok(!modeloInfo, "modelo deveria continuar editável");
    });

    await check("7c — sem catalog_listing e sem family_name: anúncio tradicional, nada travado", async () => {
      await abrirComModo("nenhum");
      const semTagLista = await cdp.evaluate("document.querySelector('.am-row .vf-tag.is-primary')");
      assert.strictEqual(semTagLista, null, "sem os dois sinais, a tag não deveria aparecer");

      await abrirPrimeiroAnuncio(cdp);
      const tituloNormal = await cdp.evaluate("document.getElementById('am-det-titulo').readOnly");
      assert.ok(!tituloNormal, "anúncio tradicional não deveria ter o título travado");
      const texto = await textoModal(cdp);
      assert.ok(!/Catálogo/.test(texto), `não deveria sobrar menção a catálogo: ${texto}`);
    });

    await check("8 — alterações pendentes são detectadas e nomeadas", async () => {
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#am-det-savebar').length"), 0,
        "não deveria haver barra de alterações sem alteração nenhuma");
      await digitar(cdp, "#am-det-titulo", "Fone TWS Prime X200 ANC 30h — Edição Manual");
      await digitar(cdp, "#am-det-descricao", DESC_A + " Editado.");
      await waitFor(cdp, "document.getElementById('am-det-savebar')", "a barra de alterações não apareceu");
      const barra = await cdp.evaluate("document.getElementById('am-det-savebar').innerText");
      assert.ok(/2 altera/.test(barra), `a barra deveria contar 2 alterações: ${barra}`);
      assert.ok(/Título/.test(barra) && /Descrição/.test(barra), `a barra deveria nomear os campos: ${barra}`);
      const chips = await cdp.evaluate("document.querySelectorAll('.am-det-dirty:not([hidden])').length");
      assert.ok(chips >= 2, `os campos alterados deveriam marcar "Alteração não salva" (achei ${chips})`);
    });

    await check("9 — descartar restaura os valores originais", async () => {
      await clicar(cdp, '.am-det-modal [data-acao="descartar"]');
      await waitFor(cdp, "!document.getElementById('am-det-savebar')", "a barra de alterações não sumiu ao descartar");
      assert.strictEqual(await cdp.evaluate("document.getElementById('am-det-titulo').value"), TITULO_A);
      assert.strictEqual(await cdp.evaluate("document.getElementById('am-det-descricao').value"), DESC_A);
    });

    /* ── 10 a 12: salvar de verdade ───────────────────────────────────── */

    await check("10 — salvar usa o clienteSlug e a ClienteConta do contexto", async () => {
      corpos.length = 0;
      await digitar(cdp, "#am-det-titulo", "Fone TWS Prime X200 ANC 30h Bateria Preto");
      await digitar(cdp, "#am-det-modelo", "X200 Pro");
      await waitFor(cdp, "document.getElementById('am-det-savebar')", "a barra não apareceu");
      await clicar(cdp, '.am-det-modal [data-acao="salvar"]');
      await esperarPedido(/\/anuncios-meli\/MLB-A1\/conteudo/, 0, "não saiu PATCH de conteúdo");
      const envio = corpos.find((c) => /\/conteudo/.test(c.url));
      assert.ok(envio, "o corpo do PATCH não foi capturado");
      assert.strictEqual(envio.metodo, "PATCH");
      assert.strictEqual(envio.body.clienteSlug, "n97");
      assert.strictEqual(String(envio.body.clienteContaId), "42", "a escrita precisa carregar a ClienteConta da operação");
      assert.strictEqual(envio.body.titulo, "Fone TWS Prime X200 ANC 30h Bateria Preto");
      assert.strictEqual(envio.body.modelo, "X200 Pro");
      assert.strictEqual(envio.body.descricao, undefined, "campo não alterado não deveria ser enviado");
    });

    await check("11 — sucesso real atualiza a UI e limpa a pendência", async () => {
      await waitFor(cdp, "!document.getElementById('am-det-savebar')", "a barra continuou após o salvamento confirmado");
      const t = await textoModal(cdp);
      assert.ok(t.includes("X200 Pro"), `o modelo salvo deveria aparecer no detalhe: ${t.slice(0, 400)}`);
      assert.strictEqual(await cdp.evaluate("document.getElementById('am-det-titulo').value"),
        "Fone TWS Prime X200 ANC 30h Bateria Preto");
      const espelho = await cdp.evaluate("document.getElementById('am-det-espelho-titulo').innerText");
      assert.strictEqual(espelho, "Fone TWS Prime X200 ANC 30h Bateria Preto",
        "a coluna 'Atual' da comparação com a IA precisa refletir o título salvo");
    });

    await check("12 — erro do Mercado Livre NÃO produz falso sucesso", async () => {
      conteudoResultado = {
        status: 200,
        corpo: {
          ok: false,
          resultados: { titulo: { ok: false, codigo: "item_has_sales", motivo: "Não é possível alterar o título de um item com vendas." } },
          anuncio: anuncio("42"), descricao: DESC_A, descricaoEstado: "ok", descricaoErro: null,
        },
      };
      await digitar(cdp, "#am-det-titulo", "Título que o ML vai recusar");
      await clicar(cdp, '.am-det-modal [data-acao="salvar"]');
      await waitFor(cdp, "document.querySelector('#am-det-savebar.is-perigo')", "a barra não entrou em estado de erro");
      const barra = await cdp.evaluate("document.getElementById('am-det-savebar').innerText");
      assert.ok(/não foi salvo/i.test(barra), `a barra deveria dizer que não salvou: ${barra}`);
      assert.ok(/item com vendas/i.test(barra), `o motivo real do ML deveria aparecer: ${barra}`);
      assert.strictEqual(await cdp.evaluate("document.getElementById('am-det-titulo').value"), "Título que o ML vai recusar",
        "o texto do usuário não pode ser jogado fora por causa da recusa");
      const t = await textoModal(cdp);
      assert.ok(!/salvas no anúncio/i.test(t), "não pode haver mensagem de sucesso depois de uma recusa");
      conteudoResultado = null;
    });

    /* ── 13: fechar com alteração pendente ────────────────────────────── */

    await check("13 — fechar com alteração pendente não perde dado em silêncio", async () => {
      await clicar(cdp, ".am-det-close");
      await sleep(150);
      assert.ok(await cdp.evaluate("Boolean(document.querySelector('.am-det-modal'))"),
        "o modal fechou e levou a alteração pendente junto");
      const barra = await cdp.evaluate("document.getElementById('am-det-savebar').innerText");
      assert.ok(/descartar/i.test(barra), `deveria pedir confirmação explícita: ${barra}`);
      await clicar(cdp, '.am-det-modal [data-acao="cancelar-saida"]');
      await sleep(100);
      assert.strictEqual(await cdp.evaluate("document.getElementById('am-det-titulo').value"), "Título que o ML vai recusar",
        "cancelar a saída precisa devolver o texto intacto");
      await clicar(cdp, '.am-det-modal [data-acao="descartar"]');
      await waitFor(cdp, "!document.getElementById('am-det-savebar')", "descartar não limpou a pendência");
    });

    /* ── 14 a 20: capacidades que precisavam sobreviver ───────────────── */

    await check("14 — revisão continua funcionando", async () => {
      const desde = pedidos.length;
      await clicar(cdp, "#am-det-revisar");
      await esperarPedido(/\/anuncios-meli\/MLB-A1\/revisao/, desde, "a revisão não chamou o backend");
      await waitFor(cdp, "document.getElementById('am-det-revisado-chip').innerText.indexOf('Revisado') >= 0",
        "o estado de revisão não apareceu no modal");
      const rotulo = await cdp.evaluate("document.getElementById('am-det-revisar').innerText");
      assert.ok(/Desmarcar revisão/.test(rotulo), `o botão deveria inverter: ${rotulo}`);
    });

    await check("15 — 'Abrir no Mercado Livre' continua funcionando", async () => {
      const link = await cdp.evaluate(`(function(){ var a = document.getElementById('am-det-abrir-ml');
        return a ? { href: a.getAttribute('href'), target: a.getAttribute('target') } : null; })()`);
      assert.ok(link, "o link para o Mercado Livre sumiu");
      assert.ok(/MLB-A1/.test(link.href), `href errado: ${link.href}`);
      assert.strictEqual(link.target, "_blank");
    });

    await check("16 — gerar SEO continua funcionando", async () => {
      const desde = pedidos.length;
      await clicar(cdp, '.am-det-modal [data-acao="gerar"][data-tipo="seo"]');
      await esperarPedido(/\/anuncios-meli\/MLB-A1\/otimizar/, desde, "o Gerar SEO não chamou o backend");
      const envio = corpos.filter((c) => /\/otimizar/.test(c.url)).pop();
      assert.strictEqual(envio.body.tipo, "seo");
      assert.strictEqual(envio.body.clienteSlug, "n97");
    });

    await check("17 — gerar descrição continua funcionando", async () => {
      const desde = pedidos.length;
      await clicar(cdp, '.am-det-modal [data-acao="gerar"][data-tipo="descricao"]');
      await esperarPedido(/\/anuncios-meli\/MLB-A1\/otimizar/, desde, "o Gerar descrição não chamou o backend");
      assert.strictEqual(corpos.filter((c) => /\/otimizar/.test(c.url)).pop().body.tipo, "descricao");
    });

    await check("18 — sugerir ficha técnica continua funcionando", async () => {
      const desde = pedidos.length;
      await clicar(cdp, '.am-det-modal [data-acao="gerar"][data-tipo="ficha_tecnica"]');
      await esperarPedido(/\/anuncios-meli\/MLB-A1\/otimizar/, desde, "o Sugerir ficha não chamou o backend");
      assert.strictEqual(corpos.filter((c) => /\/otimizar/.test(c.url)).pop().body.tipo, "ficha_tecnica");
    });

    await check("19 — as 4 aprovações internas continuam funcionando (e não publicam no ML)", async () => {
      const antesConteudo = pedidos.filter((u) => /\/conteudo/.test(u)).length;
      for (const acao of ["aprovar-titulo", "aprovar-modelo", "aprovar-descricao", "aprovar-ficha"]) {
        const desde = pedidos.length;
        await clicar(cdp, `.am-det-modal [data-acao="${acao}"]`, `botão ${acao} não existe`);
        await esperarPedido(/\/anuncios-meli\/otimizacoes\/\d+\/aprovar/, desde, `${acao} não chamou o endpoint de aprovação`);
      }
      const corpoTitulo = corpos.filter((c) => /\/aprovar/.test(c.url))[0];
      assert.strictEqual(corpoTitulo.body.tituloAprovado, SUG_TITULO_A, "aprovar título precisa enviar o título sugerido");
      assert.strictEqual(pedidos.filter((u) => /\/conteudo/.test(u)).length, antesConteudo,
        "APROVAR é decisão interna — não pode virar escrita no Mercado Livre");
    });

    await check("20 — copiar continua funcionando nos vários pontos", async () => {
      await cdp.evaluate(`(function(){ window.__copiado = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true,
          value: { writeText: function (t) { window.__copiado.push(t); return Promise.resolve(); } } }); })()`);
      const alvos = await cdp.evaluate("document.querySelectorAll('.am-det-modal [data-acao=\"copiar\"], .am-det-modal [data-acao=\"copiar-ficha\"]').length");
      assert.ok(alvos >= 4, `esperava vários pontos de cópia, achei ${alvos}`);
      await cdp.evaluate(`(function(){ document.querySelectorAll('.am-det-modal [data-acao="copiar"], .am-det-modal [data-acao="copiar-ficha"]')
        .forEach(function (b) { b.click(); }); })()`);
      await sleep(200);
      const copiado = await cdp.evaluate("window.__copiado");
      assert.ok(copiado.length >= 4, `nenhuma cópia registrada: ${JSON.stringify(copiado)}`);
      assert.ok(copiado.some((t) => t && t.includes(SUG_TITULO_A)), "copiar o título sugerido parou de funcionar");
      assert.ok(copiado.some((t) => t && /Peso: 38 g/.test(t)), "copiar a ficha como lista parou de funcionar");
    });

    /* ── 24: descrição ausente × erro de descrição ────────────────────── */

    await check("24 — 'sem descrição' e 'erro ao carregar a descrição' são estados diferentes", async () => {
      await fecharModal(cdp);
      descricaoEstado = "sem_descricao";
      await abrirPrimeiroAnuncio(cdp);
      let t = await textoModal(cdp);
      assert.ok(/não tem descrição/i.test(t), `estado 'sem descrição' não apareceu: ${t.slice(0, 600)}`);
      assert.ok(!/não foi possível carregar a descrição/i.test(t), "sem descrição não pode se apresentar como erro");
      assert.ok(await cdp.evaluate("Boolean(document.getElementById('am-det-descricao'))"),
        "sem descrição o campo continua editável — é assim que se escreve a primeira");

      await fecharModal(cdp);
      descricaoEstado = "erro";
      await abrirPrimeiroAnuncio(cdp);
      t = await textoModal(cdp);
      assert.ok(/não foi possível carregar a descrição/i.test(t), `estado de erro não apareceu: ${t.slice(0, 600)}`);
      assert.ok(!/não tem descrição/i.test(t), "erro de carregamento não pode afirmar que o anúncio não tem descrição");
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#am-det-descricao').length"), 0,
        "com erro de leitura o campo precisa ficar bloqueado — editar sobrescreveria o que não conhecemos");
      descricaoEstado = "ok";
    });

    /* ── 21: usuário sem permissão de IA ──────────────────────────────── */

    await check("21 — usuário sem permissão de IA usa o modal inteiro, e a região de IA se explica", async () => {
      await fecharModal(cdp);
      iaProibida = true;
      await abrirPrimeiroAnuncio(cdp);
      await waitFor(cdp, "document.querySelector('.am-det-modal').innerText.indexOf('administradores') >= 0",
        "a região de IA não explicou o gate");
      const t = await textoModal(cdp);
      // O resto do detalhe continua inteiro.
      [TITULO_A, "MLB-A1", "Score VenForce", "Ficha técnica", "Abrir no Mercado Livre"].forEach((frag) => {
        assert.ok(t.includes(frag), `403 de IA quebrou o resto do detalhe: sumiu "${frag}"`);
      });
      assert.ok(!/erro/i.test(await cdp.evaluate("document.getElementById('am-det-scroll').innerText").then((s) => s.slice(0, 200))),
        "o modal não pode parecer quebrado por causa do 403");
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('.am-det-modal [data-acao=\"gerar\"]').length"), 0,
        "sem permissão de IA não faz sentido oferecer os botões de gerar");
      // E o que é editável continua editável.
      await digitar(cdp, "#am-det-titulo", TITULO_A + " X");
      await waitFor(cdp, "document.getElementById('am-det-savebar')", "a edição parou de funcionar para quem não tem IA");
      await clicar(cdp, '.am-det-modal [data-acao="descartar"]');
      iaProibida = false;
    });

    /* ── 22 e 23: isolamento de estado ────────────────────────────────── */

    await check("22 — resposta atrasada da Conta A não vaza para a Conta B", async () => {
      await fecharModal(cdp);
      // A abre com resposta LENTA; troca de operação; B abre e responde rápido.
      detalheAtrasoPorItem["MLB-A1"] = 700;
      await clicar(cdp, ".am-row");
      await sleep(80); // a requisição de A já saiu
      await cdp.evaluate("window.VF.context.setConta(43)");
      await waitFor(cdp, "!document.querySelector('.am-det-modal')",
        "trocar de operação deveria tirar da tela o detalhe da conta anterior");
      await waitFor(cdp, "document.querySelector('.am-row')", "o catálogo da conta nova não carregou");
      delete detalheAtrasoPorItem["MLB-A1"];
      await abrirPrimeiroAnuncio(cdp);
      assert.strictEqual(await cdp.evaluate("document.getElementById('am-det-titulo').value"), TITULO_B,
        "o modal deveria estar no anúncio da Conta B");
      await sleep(900); // tempo de a resposta atrasada da Conta A chegar
      const valor = await cdp.evaluate("document.getElementById('am-det-titulo') ? document.getElementById('am-det-titulo').value : ''");
      assert.strictEqual(valor, TITULO_B, `a resposta atrasada da Conta A sobrescreveu a Conta B: ${valor}`);
      const detalhes = pedidos.filter((u) => /^\/anuncios-meli\/MLB-B1\?/.test(u));
      assert.ok(detalhes.some((u) => u.includes("clienteContaId=43")),
        `o detalhe de B precisa sair com a conta 43: ${JSON.stringify(detalhes)}`);
    });

    await check("23 — estado do anúncio A não vaza para o anúncio B", async () => {
      // B (conta 43) não tem otimizações; A tem. Voltar para A, ver sugestão,
      // fechar, abrir B: nada de A pode sobreviver.
      let t = await textoModal(cdp);
      assert.ok(!t.includes(SUG_TITULO_A), `a sugestão do anúncio A apareceu no anúncio B: ${t.slice(0, 500)}`);
      assert.ok(!t.includes(TITULO_A), "o título do anúncio A apareceu no anúncio B");

      await fecharModal(cdp);
      await cdp.evaluate("window.VF.context.setConta(42)");
      await waitFor(cdp, "document.querySelector('.am-row')", "o catálogo da conta 42 não voltou");
      await abrirPrimeiroAnuncio(cdp);
      await waitFor(cdp, `document.querySelector('.am-det-modal').innerText.indexOf(${JSON.stringify(SUG_TITULO_A)}) >= 0`,
        "as sugestões do anúncio A não carregaram");
      await digitar(cdp, "#am-det-modelo", "RASCUNHO-A");
      await waitFor(cdp, "document.getElementById('am-det-savebar')", "a alteração pendente em A não foi detectada");
      await fecharModal(cdp); // descarta explicitamente

      await cdp.evaluate("window.VF.context.setConta(43)");
      await waitFor(cdp, "document.querySelector('.am-row')", "o catálogo da conta 43 não voltou");
      await abrirPrimeiroAnuncio(cdp);
      t = await textoModal(cdp);
      assert.ok(!t.includes(SUG_TITULO_A), "a sugestão de IA de A sobreviveu à troca de anúncio");
      assert.strictEqual(await cdp.evaluate("document.getElementById('am-det-modelo').value"), "B300",
        "o rascunho de modelo do anúncio A vazou para o anúncio B");
      assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#am-det-savebar').length"), 0,
        "o anúncio B abriu já 'sujo' com a pendência do anúncio A");
    });

    /* ── 25 a 31: "Composição da margem" — seção secundária do modal ────── */

    await check("25 — a seção 'Composição da margem' nasce fechada, sem chamada de rede", async () => {
      await fecharModal(cdp);
      await cdp.evaluate("window.VF.context.setConta(42)");
      await waitFor(cdp, "document.querySelector('.am-row')", "o catálogo da conta 42 não voltou");
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      await abrirPrimeiroAnuncio(cdp);
      const estado = await cdp.evaluate(`(function(){
        var d = document.getElementById('am-det-margem');
        return { existe: Boolean(d), aberta: d ? d.open : null,
                 texto: d ? d.querySelector('.am-margem-comp__body').textContent.trim() : null }; })()`);
      assert.ok(estado.existe, "a seção de composição da margem não foi renderizada");
      assert.strictEqual(estado.aberta, false, "a seção não pode nascer aberta");
      assert.match(estado.texto || "", /Toque para ver/, "o corpo fechado devia mostrar a dica, não carregar nada sozinho");
      assert.strictEqual(chamadasPerformance.length, 0, "abrir o modal não pode gastar chamada de /performance");
    });

    await check("26 — abrir a seção busca a composição (1 chamada) e mostra o ladder certo (margem realizada)", async () => {
      await clicar(cdp, "#am-det-margem summary");
      await waitFor(cdp, `(function(){
        var b = document.querySelector('#am-det-margem-body');
        return b && /Custo do produto/.test(b.textContent); })()`, "o ladder não carregou depois de abrir a seção");

      assert.strictEqual(chamadasPerformance.length, 1, "abrir a seção devia disparar exatamente 1 chamada");
      assert.deepStrictEqual(chamadasPerformance[0].itemIds, ["MLB-A1"]);
      assert.strictEqual(chamadasPerformance[0].incluirComposicao, true);
      assert.strictEqual(chamadasPerformance[0].incluirMargem, true, "composição sempre pede margem junto");

      const linhas = await lerLinhasComposicao(cdp);
      assert.deepStrictEqual(linhas, [
        "Preço Altera no Mercado Livre R$ 200,00",
        "Custo do produto R$ 80,00",
        "Comissão Mercado Livre R$ 25,00",
        "Frete R$ 15,00",
        "Custos adicionais —",
        "Imposto (5,0%) R$ 10,00",
        "Margem R$ 70,00 (35,0%)",
      ], JSON.stringify(linhas));

      const badge = await cdp.evaluate("document.querySelector('#am-det-margem-body .am-margem-comp__badge').textContent");
      assert.match(badge, /Realizada/, `o badge tem de dizer que é margem realizada: ${badge}`);
    });

    await check("27 — colapsar e reabrir a MESMA seção reaproveita o cache (0 chamada nova)", async () => {
      const antes = chamadasPerformance.length;
      await clicar(cdp, "#am-det-margem summary"); // colapsa
      await waitFor(cdp, "document.getElementById('am-det-margem').open === false", "não colapsou");
      await clicar(cdp, "#am-det-margem summary"); // reabre
      await waitFor(cdp, "document.getElementById('am-det-margem').open === true", "não reabriu");
      const temLadder = await cdp.evaluate("/Custo do produto/.test(document.getElementById('am-det-margem-body').textContent)");
      assert.strictEqual(temLadder, true, "reabrir devia mostrar o ladder na hora, sem 'carregando'");
      assert.strictEqual(chamadasPerformance.length, antes, "colapsar/reabrir a mesma seção gastou uma chamada nova — cache não funcionou");
    });

    await check("28 — fechar o modal e reabrir o do MESMO MLB reaproveita o cache (0 chamada nova, mesmo sem clicar)", async () => {
      const antes = chamadasPerformance.length;
      await fecharModal(cdp);
      await abrirPrimeiroAnuncio(cdp); // ainda conta 42 -> MLB-A1
      const corpoAntesDeClicar = await cdp.evaluate(`(function(){
        var b = document.getElementById('am-det-margem-body');
        return b ? b.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
      assert.match(corpoAntesDeClicar || "", /Custo do produtoR\$ 80,00/,
        "reabrir o modal do MESMO item_id devia mostrar o ladder JÁ PRONTO (cache), mesmo com a seção ainda fechada");
      assert.strictEqual(chamadasPerformance.length, antes,
        "reabrir o modal do mesmo MLB gastou uma chamada nova de /performance — o cache não é por item_id");
    });

    await check("29 — fechar e abrir o modal de OUTRO MLB NÃO herda a composição anterior (cache é por item_id)", async () => {
      await fecharModal(cdp);
      await cdp.evaluate("window.VF.context.setConta(43)");
      await waitFor(cdp, "document.querySelector('.am-row')", "o catálogo da conta 43 não voltou");
      const antes = chamadasPerformance.length;
      await abrirPrimeiroAnuncio(cdp); // MLB-B1
      assert.strictEqual(await cdp.evaluate("document.getElementById('am-det-titulo').value"), TITULO_B);

      const corpoFechado = await cdp.evaluate(`(function(){
        var b = document.getElementById('am-det-margem-body');
        return b ? b.textContent.trim() : null; })()`);
      assert.match(corpoFechado || "", /Toque para ver/,
        "o modal de OUTRO MLB não pode abrir já mostrando uma composição — a de MLB-A1 vazou");

      await clicar(cdp, "#am-det-margem summary");
      await waitFor(cdp, `(function(){
        var b = document.querySelector('#am-det-margem-body');
        return b && /Custo do produto/.test(b.textContent); })()`, "o ladder de MLB-B1 não carregou");

      assert.strictEqual(chamadasPerformance.length, antes + 1, "MLB-B1 precisa de 1 chamada própria — não pode reaproveitar a de MLB-A1");
      assert.deepStrictEqual(chamadasPerformance[chamadasPerformance.length - 1].itemIds, ["MLB-B1"]);

      const linhas = await lerLinhasComposicao(cdp);
      assert.deepStrictEqual(linhas, [
        "Preço Altera no Mercado Livre R$ 150,00",
        "Custo do produto R$ 60,00",
        "Comissão Mercado Livre R$ 18,00",
        "Frete R$ 12,00",
        "Custos adicionais R$ 3,00",
        "Imposto (4,0%) R$ 6,00",
        "Margem R$ 30,00 (20,0%)",
      ], `MLB-B1 mostrou dados de outro item: ${JSON.stringify(linhas)}`);
    });

    await check("29b — voltar para o MLB-A1 continua com a composição DELE (as duas entradas de cache coexistem, por item_id)", async () => {
      const antes = chamadasPerformance.length;
      await fecharModal(cdp);
      await cdp.evaluate("window.VF.context.setConta(42)");
      await waitFor(cdp, "document.querySelector('.am-row')", "o catálogo da conta 42 não voltou");
      await abrirPrimeiroAnuncio(cdp); // MLB-A1 de novo
      const corpo = await cdp.evaluate(`(function(){
        var b = document.getElementById('am-det-margem-body');
        return b ? b.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
      assert.match(corpo || "", /Custo do produtoR\$ 80,00/,
        "MLB-A1 devia continuar com a própria composição (R$ 80,00 de custo) — não a de MLB-B1 (R$ 60,00)");
      assert.ok(!/R\$ 60,00/.test(corpo || ""), "a composição de MLB-B1 vazou para MLB-A1");
      assert.strictEqual(chamadasPerformance.length, antes,
        "MLB-A1 já tinha sido carregado antes — abrir os dois em sequência não pode custar chamada nova para nenhum dos dois");
    });

    await check("30 — margem indisponível no nível de CONTEXTO: mensagem real do backend, sem ladder", async () => {
      performanceHandler = (ids) => ({
        ok: true, metricas7d: {}, margem: {}, composicao: {},
        margemIndisponivel: { codigo: "BASE_MELI_NAO_VINCULADA", mensagem: "Base de custos MELI não vinculada para esta operação." },
      });
      try {
        pedidos.length = 0;
        chamadasPerformance.length = 0;
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await esperarLista(cdp);
        await abrirPrimeiroAnuncio(cdp);
        await clicar(cdp, "#am-det-margem summary");
        await waitFor(cdp, `(function(){
          var b = document.querySelector('#am-det-margem-body');
          return b && /Base de custos MELI não vinculada/.test(b.textContent); })()`, "a mensagem de contexto não apareceu");
        const semLadder = await cdp.evaluate("document.querySelectorAll('#am-det-margem-body .am-margem-comp__linha').length");
        assert.strictEqual(semLadder, 0, "contexto indisponível não pode mostrar nenhuma linha de composição, nem parcial");
      } finally {
        performanceHandler = null;
      }
    });

    await check("31 — item não-computável (UNVALIDADO): rótulo real do Motor, sem ladder", async () => {
      performanceHandler = (ids) => {
        const margem = {};
        ids.forEach((id) => { margem[id] = { origem: "projected", margin: null, marginPercent: null, profit: null, status: "UNVALIDATED", statusLabel: "Não validado", statusReasons: ["Variáveis obrigatórias ausentes: custo."] }; });
        return { ok: true, metricas7d: {}, margem, composicao: {}, margemIndisponivel: null };
      };
      try {
        pedidos.length = 0;
        chamadasPerformance.length = 0;
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await esperarLista(cdp);
        await abrirPrimeiroAnuncio(cdp);
        await clicar(cdp, "#am-det-margem summary");
        await waitFor(cdp, `(function(){
          var b = document.querySelector('#am-det-margem-body');
          return b && /Não validado/.test(b.textContent); })()`, "o rótulo real do Motor não apareceu");
        const semLadder = await cdp.evaluate("document.querySelectorAll('#am-det-margem-body .am-margem-comp__linha').length");
        assert.strictEqual(semLadder, 0, "item não-computável não pode mostrar nenhuma linha de composição, nem parcial");
      } finally {
        performanceHandler = null;
      }
    });

    await check("32 — prejuízo (LOSS): o ladder aparece COMPLETO, a margem final destaca a cor de risco", async () => {
      performanceHandler = (ids) => {
        const margem = {};
        const composicao = {};
        ids.forEach((id) => {
          margem[id] = { origem: "realized", margin: -0.05, marginPercent: -5, profit: -10, status: "LOSS", statusLabel: "Prejuízo", statusReasons: ["Margem negativa (-5.00%)."] };
          composicao[id] = { venda: 200, custoProduto: 150, comissaoMl: 30, frete: 20, taxaFixa: null, impostoPercentual: 0.05, impostoValor: 10 };
        });
        return { ok: true, metricas7d: {}, margem, composicao, margemIndisponivel: null };
      };
      try {
        pedidos.length = 0;
        chamadasPerformance.length = 0;
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await esperarLista(cdp);
        await abrirPrimeiroAnuncio(cdp);
        await clicar(cdp, "#am-det-margem summary");
        await waitFor(cdp, `(function(){
          var b = document.querySelector('#am-det-margem-body');
          return b && /Custo do produto/.test(b.textContent); })()`, "o ladder do prejuízo não carregou");

        const linhas = await lerLinhasComposicao(cdp);
        assert.deepStrictEqual(linhas, [
          "Preço Altera no Mercado Livre R$ 200,00",
          "Custo do produto R$ 150,00",
          "Comissão Mercado Livre R$ 30,00",
          "Frete R$ 20,00",
          "Custos adicionais —",
          "Imposto (5,0%) R$ 10,00",
          "Margem R$ -10,00 (-5,0%)",
        ], `o prejuízo escondeu o ladder em vez de mostrá-lo completo: ${JSON.stringify(linhas)}`);

        const badgeClasse = await cdp.evaluate("document.querySelector('#am-det-margem-body .am-margem__valor, #am-det-margem-body .am-margem__estado').className");
        assert.match(badgeClasse, /is-danger/, `prejuízo tem de usar a cor de risco no badge: ${badgeClasse}`);
      } finally {
        performanceHandler = null;
      }
    });

    /* ── 33 a 37: evolução da composição — Preço real, Custo/Custos
       adicionais como simulação ──────────────────────────────────────── */

    await check("33 — Preço é editável: sucesso grava no ML e a tela mostra o preço CONFIRMADO, não o digitado", async () => {
      let precoConfirmado = false;
      performanceHandler = (ids) => {
        const margem = {}; const composicao = {};
        ids.forEach((id) => {
          margem[id] = MARGEM_MLA1;
          composicao[id] = precoConfirmado ? Object.assign({}, COMPOSICAO_MLA1, { venda: 205 }) : COMPOSICAO_MLA1;
        });
        return { ok: true, metricas7d: {}, margem, composicao, margemIndisponivel: null };
      };
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      precoChamadas.length = 0;
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
      await esperarLista(cdp);
      await abrirPrimeiroAnuncio(cdp);
      await clicar(cdp, "#am-det-margem summary");
      await waitFor(cdp, `(function(){
        var b = document.querySelector('#am-det-margem-body');
        return b && /Custo do produto/.test(b.textContent); })()`, "o ladder inicial não carregou");

      precoResultado = { status: 200, corpo: { ok: true, preco: 205, moeda: "BRL" } };
      precoConfirmado = true;
      await salvarPreco(cdp, "210");

      await esperarPedido(/\/anuncios-meli\/MLB-A1\/preco$/, 0, "o PATCH de preço não saiu");
      const envio = precoChamadas[precoChamadas.length - 1];
      assert.strictEqual(envio.body.clienteSlug, "n97");
      assert.strictEqual(String(envio.body.clienteContaId), "42");
      assert.strictEqual(envio.body.preco, 210, "o valor digitado precisa ir no PATCH");

      await waitFor(cdp, `(function(){
        var b = document.querySelector('#am-det-margem-body .am-margem-preco .am-margem-edit__btn');
        return b && /205/.test(b.textContent); })()`,
        "a tela deveria mostrar o preço CONFIRMADO pelo ML (205), não o digitado (210)");
      const botaoPreco = await cdp.evaluate(`document.querySelector('#am-det-margem-body .am-margem-preco .am-margem-edit__btn').textContent`);
      assert.ok(!/210/.test(botaoPreco), `o valor digitado (210) não pode ficar exibido como se fosse o confirmado: ${botaoPreco}`);

      precoResultado = null;
      performanceHandler = null;
    });

    await check("33b — Enter no campo de preço NÃO salva mais sozinho; só o botão \"Salvar no Mercado Livre\" grava", async () => {
      pedidos.length = 0;
      precoChamadas.length = 0;
      await abrirEdicaoPreco(cdp);
      await digitarEConfirmar(cdp, "#am-det-margem-body .am-margem-preco .am-margem-edit__input", "777");
      // Um tick pra qualquer chamada indevida ter chance de sair antes da checagem.
      await new Promise((r) => setTimeout(r, 100));
      assert.strictEqual(precoChamadas.length, 0, "Enter não pode disparar PATCH de preço — só o clique em \"Salvar no Mercado Livre\"");
      const aindaEditando = await cdp.evaluate(
        "!!document.querySelector('#am-det-margem-body .am-margem-preco .am-margem-edit__input')"
      );
      assert.ok(aindaEditando, "o editor de preço deveria continuar aberto depois do Enter (Enter não confirma nem cancela)");
      await cancelarEdicaoPreco(cdp);
      await waitFor(cdp, "!document.querySelector('#am-det-margem-body .am-margem-preco .am-margem-edit__input')",
        "\"Cancelar\" deveria fechar o editor de preço sem salvar");
      assert.strictEqual(precoChamadas.length, 0, "cancelar não pode gerar PATCH de preço");
    });

    await check("34 — falha do Mercado Livre ao alterar preço mantém o valor anterior na tela", async () => {
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      precoChamadas.length = 0;
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
      await esperarLista(cdp);
      await abrirPrimeiroAnuncio(cdp);
      await clicar(cdp, "#am-det-margem summary");
      await waitFor(cdp, `(function(){
        var b = document.querySelector('#am-det-margem-body');
        return b && /Custo do produto/.test(b.textContent); })()`, "o ladder inicial não carregou");

      precoResultado = {
        status: 200,
        corpo: { ok: false, codigo: "item.price.not_modifiable", motivo: "Este anúncio tem automatização de preço ativa no Mercado Livre." },
      };
      await salvarPreco(cdp, "999");
      await esperarPedido(/\/anuncios-meli\/MLB-A1\/preco$/, 0, "o PATCH de preço não saiu");

      await waitFor(cdp, `(function(){
        var b = document.querySelector('#am-det-margem-body .am-margem-preco .am-margem-edit__btn');
        return b && /200/.test(b.textContent); })()`,
        "recusa do Mercado Livre deveria manter o preço anterior (200) na tela");
      const botaoPreco = await cdp.evaluate(`document.querySelector('#am-det-margem-body .am-margem-preco .am-margem-edit__btn').textContent`);
      assert.ok(!/999/.test(botaoPreco), "o valor recusado não pode ficar exibido como se tivesse sido salvo");

      precoResultado = null;
    });

    await check("35 — simular Custo do produto e Custos adicionais mostra 'Margem simulada', sem chamar o ML nem a Base", async () => {
      pedidos.length = 0;
      chamadasPerformance.length = 0;
      simularMargemChamadas.length = 0;
      precoChamadas.length = 0;
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
      await esperarLista(cdp);
      await abrirPrimeiroAnuncio(cdp);
      await clicar(cdp, "#am-det-margem summary");
      await waitFor(cdp, `(function(){
        var b = document.querySelector('#am-det-margem-body');
        return b && /Custo do produto/.test(b.textContent); })()`, "o ladder inicial não carregou");

      simularMargemHandler = () => ({
        ok: true, simulado: true, origem: "realized",
        resultado: { computable: true, profit: 55, margin: 0.275, marginPercent: 27.5, missing: [], assumed: [] },
      });

      await confirmarEdicaoMargem(cdp, "custoProduto", "50");
      await esperarPedido(/\/anuncios-meli\/MLB-A1\/simular-margem$/, 0, "a simulação de custo não chamou o backend");
      let envio = simularMargemChamadas[simularMargemChamadas.length - 1];
      assert.strictEqual(envio.body.custoProduto, 50);
      assert.strictEqual(envio.body.custosAdicionais, undefined, "sem override de custos adicionais, o campo não deveria ir no corpo");

      await waitFor(cdp, `/Margem simulada/.test(document.getElementById('am-det-margem-body').textContent)`,
        "o rótulo 'Margem simulada' não apareceu");
      let texto = await cdp.evaluate("document.getElementById('am-det-margem-body').textContent");
      assert.match(texto, /R\$\s*55,00/, `a margem simulada não apareceu: ${texto}`);
      assert.match(texto, /27,5%/, `o percentual simulado não apareceu: ${texto}`);

      // Combinar os dois overrides: a segunda chamada precisa levar AMBOS.
      const antesChamadas = simularMargemChamadas.length;
      await confirmarEdicaoMargem(cdp, "custosAdicionais", "8");
      for (let i = 0; i < 100 && simularMargemChamadas.length <= antesChamadas; i++) await sleep(50);
      assert.ok(simularMargemChamadas.length > antesChamadas, "a simulação de custos adicionais não disparou uma nova chamada");
      envio = simularMargemChamadas[simularMargemChamadas.length - 1];
      assert.strictEqual(envio.body.custoProduto, 50, "o override de custo já ativo precisa continuar indo junto");
      assert.strictEqual(envio.body.custosAdicionais, 8);

      assert.strictEqual(precoChamadas.length, 0, "simular custo/custos adicionais não pode chamar PATCH de preço");
      assert.ok(!pedidos.some((u) => /\/bases\//.test(u)), "simulação não pode gravar na Base de Custos");

      simularMargemHandler = null;
    });

    await check("36 — 'Restaurar' descarta a simulação e volta para a margem real do Motor", async () => {
      await clicar(cdp, '#am-det-margem-body [data-acao="restaurar-simulacao-margem"]', "botão de restaurar não encontrado");
      await waitFor(cdp, `!/Margem simulada/.test(document.getElementById('am-det-margem-body').textContent)`,
        "a simulação não foi descartada");
      const texto = await cdp.evaluate("document.getElementById('am-det-margem-body').textContent");
      assert.match(texto, /R\$\s*70,00/, `a margem real (do Motor) deveria voltar a aparecer: ${texto}`);
    });

    await check("37 — item legado com variações (sem promoção): preço vira SIMULAÇÃO, nunca tenta PUT", async () => {
      variationsCountAtivo = 3;
      try {
        pedidos.length = 0;
        chamadasPerformance.length = 0;
        precoChamadas.length = 0;
        simularMargemChamadas.length = 0;
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await esperarLista(cdp);
        await abrirPrimeiroAnuncio(cdp);
        await clicar(cdp, "#am-det-margem summary");
        await waitFor(cdp, `(function(){
          var b = document.querySelector('#am-det-margem-body');
          return b && /Custo do produto/.test(b.textContent); })()`, "o ladder não carregou");

        const estado = await cdp.evaluate(`(function(){
          return {
            temTagAltera: /Altera no Mercado Livre/.test(document.getElementById('am-det-margem-body').textContent),
            temCelulaPutReal: !!document.querySelector('#am-det-margem-body .am-margem-preco'),
            temCampoSimulacao: !!document.querySelector('#am-det-margem-body [data-margem-campo="preco"]'),
            motivo: (document.querySelector('#am-det-margem-body [data-margem-campo="preco"] .am-margem-edit__btn') || {}).title || "",
          };
        })()`);
        assert.strictEqual(estado.temTagAltera, false, "item com variações não pode anunciar que altera no Mercado Livre");
        assert.strictEqual(estado.temCelulaPutReal, false, "não pode sobrar a célula de PUT real (.am-margem-preco) para este item");
        assert.ok(estado.temCampoSimulacao, "a linha de preço precisa virar um campo de simulação ([data-margem-campo=\"preco\"])");
        assert.match(estado.motivo, /não grava no Mercado Livre/i, `o motivo não explica que é só simulação: ${estado.motivo}`);
        assert.match(estado.motivo, /variações/i, `o motivo não menciona variações: ${estado.motivo}`);

        await confirmarEdicaoMargem(cdp, "preco", "250");
        await esperarPedido(/\/anuncios-meli\/MLB-A1\/simular-margem$/, 0, "a simulação de preço não chamou o backend");
        const envio = simularMargemChamadas[simularMargemChamadas.length - 1];
        assert.strictEqual(envio.body.preco, 250, "o preço digitado precisa ir como override em /simular-margem");
        assert.strictEqual(precoChamadas.length, 0, "simular preço NUNCA pode chamar PATCH /:itemId/preco");

        await waitFor(cdp, `/Margem simulada/.test(document.getElementById('am-det-margem-body').textContent)`,
          "o rótulo 'Margem simulada' não apareceu depois de simular o preço");
      } finally {
        variationsCountAtivo = 0;
      }
    });

    await check("37b — item legado: combinar preço + custo + custos adicionais envia os TRÊS overrides", async () => {
      variationsCountAtivo = 3;
      try {
        pedidos.length = 0;
        chamadasPerformance.length = 0;
        simularMargemChamadas.length = 0;
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await esperarLista(cdp);
        await abrirPrimeiroAnuncio(cdp);
        await clicar(cdp, "#am-det-margem summary");
        await waitFor(cdp, `(function(){
          var b = document.querySelector('#am-det-margem-body');
          return b && /Custo do produto/.test(b.textContent); })()`, "o ladder não carregou");

        await confirmarEdicaoMargem(cdp, "preco", "250");
        await esperarPedido(/\/anuncios-meli\/MLB-A1\/simular-margem$/, 0, "a simulação de preço não chamou o backend");

        let antesChamadas = simularMargemChamadas.length;
        await confirmarEdicaoMargem(cdp, "custoProduto", "50");
        for (let i = 0; i < 100 && simularMargemChamadas.length <= antesChamadas; i++) await sleep(50);
        assert.ok(simularMargemChamadas.length > antesChamadas, "a simulação de custo não disparou uma nova chamada");

        antesChamadas = simularMargemChamadas.length;
        await confirmarEdicaoMargem(cdp, "custosAdicionais", "8");
        for (let i = 0; i < 100 && simularMargemChamadas.length <= antesChamadas; i++) await sleep(50);
        assert.ok(simularMargemChamadas.length > antesChamadas, "a simulação de custos adicionais não disparou uma nova chamada");

        const envio = simularMargemChamadas[simularMargemChamadas.length - 1];
        assert.strictEqual(envio.body.preco, 250, "o override de preço já ativo precisa continuar indo junto");
        assert.strictEqual(envio.body.custoProduto, 50, "o override de custo já ativo precisa continuar indo junto");
        assert.strictEqual(envio.body.custosAdicionais, 8);
        assert.strictEqual(precoChamadas.length, 0, "combinar overrides de simulação NUNCA pode chamar PATCH de preço");
      } finally {
        variationsCountAtivo = 0;
      }
    });

    await check("37c — item legado: 'Restaurar' descarta o override de preço junto com os demais", async () => {
      variationsCountAtivo = 3;
      try {
        pedidos.length = 0;
        chamadasPerformance.length = 0;
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await esperarLista(cdp);
        await abrirPrimeiroAnuncio(cdp);
        await clicar(cdp, "#am-det-margem summary");
        await waitFor(cdp, `(function(){
          var b = document.querySelector('#am-det-margem-body');
          return b && /Custo do produto/.test(b.textContent); })()`, "o ladder não carregou");

        await confirmarEdicaoMargem(cdp, "preco", "250");
        await esperarPedido(/\/anuncios-meli\/MLB-A1\/simular-margem$/, 0, "a simulação de preço não chamou o backend");
        await waitFor(cdp, `/Margem simulada/.test(document.getElementById('am-det-margem-body').textContent)`,
          "a simulação não ativou");

        await clicar(cdp, '#am-det-margem-body [data-acao="restaurar-simulacao-margem"]', "botão de restaurar não encontrado");
        await waitFor(cdp, `!/Margem simulada/.test(document.getElementById('am-det-margem-body').textContent)`,
          "restaurar não descartou a simulação");

        const valorCampo = await cdp.evaluate(
          `document.querySelector('#am-det-margem-body [data-margem-campo="preco"]').getAttribute('data-margem-valor')`
        );
        assert.strictEqual(valorCampo, "200", "depois de restaurar, o campo precisa voltar a mostrar o preço REAL (200), sem o override");
      } finally {
        variationsCountAtivo = 0;
      }
    });

    await check("38b — promoção ativa vence variações: mesmo com variations_count > 0, o preço fica só bloqueado (sem simulação)", async () => {
      variationsCountAtivo = 3;
      performanceHandler = (ids) => {
        const margem = {}; const composicao = {};
        ids.forEach((id) => {
          margem[id] = MARGEM_MLA1;
          composicao[id] = Object.assign({}, COMPOSICAO_MLA1, { precoPromocionalAtivo: true });
        });
        return { ok: true, metricas7d: {}, margem, composicao, margemIndisponivel: null };
      };
      try {
        pedidos.length = 0;
        chamadasPerformance.length = 0;
        precoChamadas.length = 0;
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await esperarLista(cdp);
        await abrirPrimeiroAnuncio(cdp);
        await clicar(cdp, "#am-det-margem summary");
        await waitFor(cdp, `(function(){
          var b = document.querySelector('#am-det-margem-body');
          return b && /Custo do produto/.test(b.textContent); })()`, "o ladder não carregou");

        const estado = await cdp.evaluate(`(function(){
          return {
            temCampoSimulacao: !!document.querySelector('#am-det-margem-body [data-margem-campo="preco"]'),
            temCelulaPutReal: !!document.querySelector('#am-det-margem-body .am-margem-preco'),
            valor: document.querySelector('#am-det-margem-body .am-margem-comp__valor--bloqueado').textContent.trim(),
          };
        })()`);
        assert.strictEqual(estado.temCampoSimulacao, false, "promoção ativa vence — não pode virar campo de simulação de preço");
        assert.strictEqual(estado.temCelulaPutReal, false, "promoção ativa vence — também não pode ser a célula de PUT real");
        assert.strictEqual(estado.valor, "R$ 200,00", "o valor bloqueado continua sendo o efetivo/promocional");
      } finally {
        variationsCountAtivo = 0;
        performanceHandler = null;
      }
    });

    await check("38 — item com promoção ativa: edição de preço vem BLOQUEADA de cara, sem tag \"Altera no Mercado Livre\", com motivo explicado", async () => {
      performanceHandler = (ids) => {
        const margem = {}; const composicao = {};
        ids.forEach((id) => {
          margem[id] = MARGEM_MLA1;
          composicao[id] = Object.assign({}, COMPOSICAO_MLA1, { precoPromocionalAtivo: true });
        });
        return { ok: true, metricas7d: {}, margem, composicao, margemIndisponivel: null };
      };
      try {
        pedidos.length = 0;
        chamadasPerformance.length = 0;
        precoChamadas.length = 0;
        await cdp.send("Page.navigate", { url: `http://127.0.0.1:${porta}/anuncios-meli.html?cliente=n97&conta=42` });
        await esperarLista(cdp);
        await abrirPrimeiroAnuncio(cdp);
        await clicar(cdp, "#am-det-margem summary");
        await waitFor(cdp, `(function(){
          var b = document.querySelector('#am-det-margem-body');
          return b && /Custo do produto/.test(b.textContent); })()`, "o ladder não carregou");

        const estado = await cdp.evaluate(`(function(){
          var linha = document.querySelector('#am-det-margem-body .am-margem-comp__linha--editavel');
          return {
            temBotaoEditar: !!document.querySelector('#am-det-margem-body .am-margem-preco .am-margem-edit__btn'),
            temTagAltera: /Altera no Mercado Livre/.test(document.getElementById('am-det-margem-body').textContent),
            temInfoDot: !!linha.querySelector('.vf-info-dot'),
            valor: document.querySelector('#am-det-margem-body .am-margem-comp__valor--bloqueado').textContent.trim(),
          };
        })()`);
        assert.strictEqual(estado.temBotaoEditar, false, "promoção ativa não pode oferecer botão de editar preço");
        assert.strictEqual(estado.temTagAltera, false, "a tag \"Altera no Mercado Livre\" não faz sentido num campo bloqueado");
        assert.ok(estado.temInfoDot, "o motivo do bloqueio precisa aparecer (ⓘ), não sumir em silêncio");
        assert.strictEqual(estado.valor, "R$ 200,00", "o valor exibido continua sendo o preço efetivo/promocional, só não editável");

        assert.strictEqual(precoChamadas.length, 0, "nenhuma tentativa de PATCH pode ter acontecido — nem foi oferecida a edição");
      } finally {
        performanceHandler = null;
      }
    });

    await check("— nenhuma exceção de JS não tratada durante todo o percurso", async () => {
      const relevantes = excecoes.filter((m) => !/Failed to fetch|NetworkError|ERR_/i.test(m));
      assert.deepStrictEqual(relevantes, [], `exceções: ${JSON.stringify(relevantes)}`);
      const jsErros = (await cdp.evaluate("window.__erros || []"))
        .filter((m) => !/Failed to fetch|NetworkError|ERR_/i.test(m));
      assert.deepStrictEqual(jsErros, [], `erros de JS na página: ${JSON.stringify(jsErros)}`);
    });

    console.log(`\n✓ ${checks} verificações do novo detalhe (modal central) de Anúncios ML`);
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
