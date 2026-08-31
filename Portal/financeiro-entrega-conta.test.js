/* Portal/financeiro-entrega-conta.test.js
 *
 * CONVERGÊNCIA #2 — D1 ponta a ponta.
 *
 * O backend da Pessoa 2 (P2.6) passou a guardar a OPERAÇÃO na entrega:
 * `entregas_cliente.cliente_conta_id`, validada contra o cliente resolvido
 * (409 CONTA_NAO_PERTENCE_AO_CLIENTE) — server/services/entregasClienteService.js.
 * Mas D1 só vale quando o frontend MANDA a operação: uma coluna que ninguém
 * preenche continua deixando dois fechamentos do mesmo mês, de duas contas
 * MELI do mesmo cliente, indistinguíveis depois de salvos.
 *
 * "Salvar fechamento" não foi migrado para o V3 (F4.2 migrou listar/publicar/
 * despublicar/abrir/copiar — ver VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md). O
 * único caminho de ESCRITA continua sendo o Financeiro legado, então é aqui
 * que D1 se fecha ou não se fecha.
 *
 * Regra que este teste protege: a entrega registra EXATAMENTE a operação que
 * produziu o número — o mesmo `contaMercadoState.contaId` que o cálculo já
 * envia em `formData.append("clienteContaId", …)` (financeiro.js:2271).
 * Gravar uma conta diferente da que gerou o cálculo seria pior que gravar
 * nenhuma; e quando não há conta escolhida, `null` é a verdade (entrega
 * client-level), nunca "conta 0".
 *
 * Roda o arquivo REAL dentro de um vm.Context com DOM mínimo empalhado —
 * mesmo idioma de Portal/fechamentos-api.test.js, sem cópia nem
 * reimplementação da lógica de produção.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "financeiro.js"), "utf8");

// Registry memoizado: o mesmo id devolve SEMPRE o mesmo elemento, senão
// `#fin-cliente`.value setado pelo teste não sobreviveria à próxima leitura.
const elementos = new Map();
/* setStatus() é interna do arquivo real e escreve no DOM
   (financeiro.js:54-65): a única forma honesta de observá-la é observar o
   elemento. `#fin-status` grava a sequência de (mensagem, variante) em vez de
   descartá-la. */
const statusRegistrados = [];
function fakeEl(id) {
  if (elementos.has(id)) return elementos.get(id);
  if (id === "fin-status") {
    let texto = "";
    const el = {
      id, hidden: true, dataset: {}, style: {},
      classList: {
        _v: null,
        add(c) { if (/^is-/.test(c)) { this._v = c.replace("is-", ""); registrar(); } },
        remove() {}, toggle() {}, contains() { return false; },
      },
      setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
      addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; },
      closest() { return null; }, focus() {}, append() {},
    };
    Object.defineProperty(el, "textContent", {
      get() { return texto; },
      set(v) { texto = v; },
    });
    function registrar() {
      const bruta = el.classList._v;
      const tipo = bruta === "warning" ? "warn" : bruta;
      statusRegistrados.push({ msg: texto, tipo });
    }
    elementos.set(id, el);
    return el;
  }
  const el = {
    id, hidden: true, innerHTML: "", textContent: "", value: "", disabled: false,
    dataset: {}, style: {}, checked: false, files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    querySelectorAll() { return []; }, querySelector() { return null; },
    closest() { return null; }, focus() {}, click() {}, append() {},
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, remove() {},
    scrollIntoView() {},
  };
  elementos.set(id, el);
  return el;
}
const fakeDocument = {
  getElementById(id) { return fakeEl(id); },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  addEventListener() {},
  createElement() { return fakeEl("tmp-" + Math.random()); },
  body: { classList: { add() {}, remove() {} }, appendChild() {}, removeChild() {}, dataset: {} },
  documentElement: { dataset: {}, classList: { add() {}, remove() {} } },
};

// Captura de rede: nenhuma chamada real sai daqui.
const chamadas = [];
const respostas = [];
const formDatasCriadas = [];
// Confirmação programável — o legado já usa window.confirm (financeiro.js:2556).
let confirmRespondeSim = true;
const confirmacoes = [];
const sandbox = {
  window: {
    location: { replace() {}, href: "", hash: "", search: "" }, initLayout: undefined, VF: undefined,
    confirm: (msg) => { confirmacoes.push(String(msg)); return confirmRespondeSim; },
  },
  document: fakeDocument,
  localStorage: {
    _store: { "vf-token": "TEST_TOKEN" },
    getItem(k) { return this._store[k] ?? null; },
    setItem(k, v) { this._store[k] = v; },
    removeItem(k) { delete this._store[k]; },
  },
  sessionStorage: {
    _store: {},
    getItem(k) { return this._store[k] ?? null; },
    setItem(k, v) { this._store[k] = v; },
    removeItem(k) { delete this._store[k]; },
  },
  // Fila de respostas programáveis: cada item vale para a próxima chamada.
  // Vazia = 200 com entrega criada.
  fetch: async (url, opts = {}) => {
    chamadas.push({ url: String(url), metodo: opts.method || "GET", corpo: opts.body });
    const proxima = respostas.shift();
    if (proxima) {
      return {
        ok: proxima.status >= 200 && proxima.status < 300,
        status: proxima.status,
        json: async () => proxima.corpo,
        text: async () => JSON.stringify(proxima.corpo),
      };
    }
    return {
      ok: true, status: 200,
      json: async () => ({ ok: true, entrega: { id: 4242, token_publico: null } }),
      text: async () => "",
    };
  },
  history: { replaceState() {}, pushState() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  CSS: { escape: (s) => s },
  AbortController: function () { this.signal = {}; this.abort = () => {}; },
  requestAnimationFrame: (fn) => fn(),
  URL, Blob: function () {},
  // FormData que REGISTRA o que foi anexado — D2 se prova no que sai no corpo.
  FormData: function () {
    this._campos = [];
    formDatasCriadas.push(this);
    this.append = (k, v) => { this._campos.push([k, v]); };
    this.get = (k) => { const p = this._campos.find(([n]) => n === k); return p ? p[1] : null; };
    this.has = (k) => this._campos.some(([n]) => n === k);
  },
  Intl, console, setTimeout, clearTimeout, setInterval, clearInterval,
  initLayout: () => {},
};
sandbox.globalThis = sandbox;

/* Top-level `let`/`const`/`function` de um script de página não viram
   propriedades do contexto — expõe só o que este teste precisa tocar, sem
   alterar o arquivo real. `_setUltimo` existe porque
   `ultimoFechamentoFinanceiro` é `let` de módulo, alimentado normalmente pelo
   fluxo de "Processar fechamento" (upload de planilha), que não é o que este
   teste mede. */
const epilogo = `
;(function () {
  globalThis.__T__ = {
    salvar: salvarFechamentoFinanceiro,
    processar: processarFechamentoFinanceiro,
    contaMercadoState: contaMercadoState,
    _setUltimo: (v) => { ultimoFechamentoFinanceiro = v; },
    _setEntregaId: (v) => { _entregaIdSalvo = v; },
  };
})();`;

vm.createContext(sandbox);
vm.runInContext(`${src}\n${epilogo}`, sandbox, { filename: "financeiro.js" });
const T = sandbox.__T__;

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ✓ ${label}`);
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected,
    `FALHOU: ${label} — recebido ${JSON.stringify(actual)}, esperado ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ✓ ${label}`);
}

// Fixture mínima de um fechamento já processado. O conteúdo financeiro não é
// o que se mede aqui — o que se mede é O QUE VAI NO CORPO DO POST.
function fecharComoProcessado() {
  T._setUltimo({
    data: {
      summary: { grossRevenueTotal: 1000, paidRevenueTotal: 900, contributionProfitTotal: 100 },
      _vf_meta: { marketplace: "meli" },
    },
  });
}

function prepararTela({ clienteSlug, periodo, marketplace = "meli" }) {
  fakeEl("fin-cliente").value = clienteSlug;
  fakeEl("fin-periodo").value = periodo;
  fakeEl("fin-marketplace").value = marketplace;
  fecharComoProcessado();
  T._setEntregaId(null);
  chamadas.length = 0;
  respostas.length = 0;
  confirmacoes.length = 0;
  confirmRespondeSim = true;
}

// 409 do backend quando a competência já tem entrega
// (server/services/entregasClienteService.js:268-280).
function resposta409({ entregaId = 777, publicado = false } = {}) {
  return {
    status: 409,
    corpo: {
      ok: false, code: "ENTREGA_JA_EXISTE", entregaId, publicado,
      erro: "Ja existe uma entrega desta competencia para este cliente/operacao. Use substituir=true para atualizar a existente.",
    },
  };
}
function postsDeEntrega() {
  return chamadas.filter((c) => c.metodo === "POST" && /\/entregas-cliente$/.test(c.url));
}

function corpoDoPost() {
  const post = chamadas.find((c) => c.metodo === "POST" && /\/entregas-cliente$/.test(c.url));
  assert.ok(post, `nenhum POST /entregas-cliente foi disparado (chamadas: ${JSON.stringify(chamadas.map((c) => c.metodo + " " + c.url))})`);
  return JSON.parse(post.corpo);
}

async function main() {
  console.log("\n▸ D1 — a entrega registra a operação que produziu o número\n");

  // ── 1. Conta escolhida explicitamente: a entrega tem que registrá-la ──
  prepararTela({ clienteSlug: "n97", periodo: "2026-07" });
  T.contaMercadoState.contaId = "43";
  await T.salvar();
  const corpo1 = corpoDoPost();
  eq("1. POST /entregas-cliente envia cliente_conta_id da conta escolhida", corpo1.cliente_conta_id, 43);
  eq("1b. o resto do contrato legado não mudou (tipo)", corpo1.tipo, "fechamento_mensal");
  eq("1c. o resto do contrato legado não mudou (cliente_slug)", corpo1.cliente_slug, "n97");
  eq("1d. o resto do contrato legado não mudou (periodo)", corpo1.periodo, "2026-07");
  eq("1e. o resto do contrato legado não mudou (origem_tipo)", corpo1.origem_tipo, "fechamento_financeiro");

  // ── 2. Conta 2 do MESMO cliente, MESMA competência: não pode virar a mesma
  //       entrega indistinguível da conta 1 (é o risco de auditoria do D1) ──
  prepararTela({ clienteSlug: "n97", periodo: "2026-07" });
  T.contaMercadoState.contaId = "42";
  await T.salvar();
  eq("2. mesma competência, outra conta do mesmo cliente → cliente_conta_id diferente",
    corpoDoPost().cliente_conta_id, 42);

  // ── 3. Sem conta escolhida: null é a verdade, nunca "conta 0" (R7) ──
  prepararTela({ clienteSlug: "n97", periodo: "2026-07" });
  T.contaMercadoState.contaId = "";
  await T.salvar();
  const corpo3 = corpoDoPost();
  ok("3. sem conta escolhida → cliente_conta_id null (ausência não é zero)", corpo3.cliente_conta_id === null);
  ok("3b. e nunca 0", corpo3.cliente_conta_id !== 0);

  // ── 4. PATCH (re-salvar) também carrega a operação, senão a entrega
  //       nasce com conta e perde a conta ao ser atualizada ──
  prepararTela({ clienteSlug: "n97", periodo: "2026-07" });
  T.contaMercadoState.contaId = "43";
  T._setEntregaId(4242);
  await T.salvar();
  const patch = chamadas.find((c) => c.metodo === "PATCH");
  assert.ok(patch, "nenhum PATCH foi disparado ao re-salvar");
  eq("4. PATCH também envia cliente_conta_id", JSON.parse(patch.corpo).cliente_conta_id, 43);

  console.log("\n▸ D4 — reprocessar a mesma competência tem saída, e ela é honesta\n");

  /* Antes do P2.6 um segundo "Salvar" da mesma competência criava uma SEGUNDA
     entrega em silêncio — duas linhas do mesmo mês, e se ambas fossem
     publicadas, dois links públicos com números diferentes circulando. Agora
     o backend recusa com 409 ENTREGA_JA_EXISTE e devolve o id existente. Se o
     frontend só repassasse a mensagem crua, reprocessar um mês viraria um beco
     sem saída falando de um `substituir=true` que o usuário não tem como
     acionar. O mínimo seguro: perguntar e, com o sim, substituir. */

  // ── 5. 409 + confirmação → repete o POST com substituir:true ──
  prepararTela({ clienteSlug: "n97", periodo: "2026-07" });
  T.contaMercadoState.contaId = "43";
  respostas.push(resposta409({ entregaId: 777, publicado: false }));
  confirmRespondeSim = true;
  await T.salvar();
  const posts = postsDeEntrega();
  eq("5. houve exatamente 2 POSTs (o recusado + a substituição)", posts.length, 2);
  const substituicao = JSON.parse(posts[1].corpo);
  eq("5b. o segundo POST manda substituir:true", substituicao.substituir, true);
  eq("5c. e preserva a operação (cliente_conta_id)", substituicao.cliente_conta_id, 43);
  eq("5d. e a mesma competência", substituicao.periodo, "2026-07");
  ok("5e. o usuário foi consultado antes", confirmacoes.length === 1);
  ok("5f. a pergunta nomeia a competência, não fala de flag técnica",
    /2026-07/.test(confirmacoes[0]) && !/substituir=true/.test(confirmacoes[0]));

  // ── 6. 409 + recusa → nada é sobrescrito ──
  prepararTela({ clienteSlug: "n97", periodo: "2026-07" });
  T.contaMercadoState.contaId = "43";
  respostas.push(resposta409({ entregaId: 777 }));
  confirmRespondeSim = false;
  await T.salvar();
  eq("6. recusando a substituição, nenhum segundo POST sai", postsDeEntrega().length, 1);

  // ── 7. A entrega já está PUBLICADA: o aviso tem que dizer isso ──
  //       Substituir aqui troca o número por trás de um link que o cliente
  //       já pode ter aberto. Não é o mesmo risco de um rascunho.
  prepararTela({ clienteSlug: "n97", periodo: "2026-07" });
  T.contaMercadoState.contaId = "43";
  respostas.push(resposta409({ entregaId: 777, publicado: true }));
  confirmRespondeSim = false;
  await T.salvar();
  ok("7. entrega publicada → o aviso avisa que já está publicada",
    /public/i.test(confirmacoes[0] || ""));

  console.log("\n▸ D2 — a competência processada é declarada, e a tela não promete o mês errado\n");

  /* O backend não rejeita divergência (escolha deliberada da via declarativa):
     ele DECLARA `competencia { periodoSolicitado, periodoDetectado, divergente,
     motivo, … }` e deixa a decisão para a tela. Ficar em silêncio sobre isso é
     o pior dos mundos — o usuário digita "Julho 2026", manda uma planilha de
     agosto e vê "✓ Fechamento processado", achando que fechou julho. */

  function prepararProcessamento({ periodo, marketplace = "meli" }) {
    fakeEl("fin-cliente").value = "n97";
    fakeEl("fin-periodo").value = periodo;
    fakeEl("fin-marketplace").value = marketplace;
    fakeEl("fin-sales").files = [{ name: "vendas.xlsx" }];
    fakeEl("fin-costs").files = [{ name: "custos.xlsx" }];
    fakeEl("fin-ads").value = "0";
    fakeEl("fin-venforce").value = "0";
    fakeEl("fin-affiliates").value = "0";
    fakeEl("fin-full-cost").value = "0";
    fakeEl("fin-additional-costs").value = "0";
    chamadas.length = 0; respostas.length = 0; formDatasCriadas.length = 0;
    statusRegistrados.length = 0;
  }
  const fechamentoOk = (competencia) => ({
    status: 200,
    corpo: { ok: true, summary: { grossRevenueTotal: 10 }, rows: [], competencia },
  });

  // ── 8. O período pedido viaja junto: sem ele o backend não tem o que comparar ──
  prepararProcessamento({ periodo: "Julho 2026" });
  respostas.push(fechamentoOk({
    periodoSolicitado: "2026-07", periodoDetectado: "2026-07", divergente: false, motivo: null,
    competencias: ["2026-07"], multiplasCompetencias: false, linhasComData: 10, linhasTotal: 10,
  }));
  await T.processar();
  const fd = formDatasCriadas[0];
  ok("8. POST /fechamentos/financeiro anexa o período pedido", !!fd && fd.has("periodo"));
  eq("8b. e anexa exatamente o que está na tela", fd.get("periodo"), "Julho 2026");
  ok("8c. competência batendo → nenhum alarme falso",
    !statusRegistrados.some((s) => s.tipo === "warn"));

  // ── 9. Divergência: julho pedido, agosto detectado ──
  prepararProcessamento({ periodo: "Julho 2026" });
  respostas.push(fechamentoOk({
    periodoSolicitado: "2026-07", periodoDetectado: "2026-08", divergente: true,
    motivo: "A planilha e majoritariamente de 2026-08, mas o periodo pedido foi 2026-07.",
    competencias: ["2026-08"], multiplasCompetencias: false, linhasComData: 10, linhasTotal: 10,
  }));
  await T.processar();
  const alerta = statusRegistrados.filter((s) => s.tipo === "warn").pop();
  ok("9. divergência vira aviso visível, não sucesso silencioso", !!alerta);
  ok("9b. o aviso nomeia o mês DETECTADO (2026-08)", /2026-08/.test(alerta?.msg || ""));
  ok("9c. o aviso nomeia o mês PEDIDO (2026-07)", /2026-07/.test(alerta?.msg || ""));
  ok("9d. e a tela não afirma que o mês pedido foi processado",
    !statusRegistrados.some((s) => s.tipo === "success"));

  // ── 10. Planilha atravessando dois meses ──
  prepararProcessamento({ periodo: "Julho 2026" });
  respostas.push(fechamentoOk({
    periodoSolicitado: "2026-07", periodoDetectado: "2026-07", divergente: true,
    motivo: "A planilha atravessa mais de uma competencia.",
    competencias: ["2026-07", "2026-08"], multiplasCompetencias: true, linhasComData: 10, linhasTotal: 10,
  }));
  await T.processar();
  ok("10. duas competências no mesmo arquivo também avisam",
    statusRegistrados.some((s) => s.tipo === "warn"));

  // ── 11. Sem data detectável: ausência declarada, nunca inventada ──
  prepararProcessamento({ periodo: "Julho 2026" });
  respostas.push(fechamentoOk({
    periodoSolicitado: "2026-07", periodoDetectado: null, divergente: false,
    motivo: "Nao foi possivel determinar a competencia dos dados enviados.",
    competencias: [], multiplasCompetencias: false, linhasComData: 0, linhasTotal: 10,
  }));
  await T.processar();
  ok("11. competência indeterminada é dita, não silenciada",
    statusRegistrados.some((s) => s.tipo === "warn"));

  // ── 12. Backend legado (sem bloco competencia) continua funcionando ──
  prepararProcessamento({ periodo: "Julho 2026" });
  respostas.push({ status: 200, corpo: { ok: true, summary: { grossRevenueTotal: 10 }, rows: [] } });
  await T.processar();
  ok("12. resposta sem `competencia` (compat) não inventa aviso",
    !statusRegistrados.some((s) => s.tipo === "warn"));

  console.log(`\n✓ ${checks} verificações — D1, D2 e D4 fechados no Financeiro legado\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
