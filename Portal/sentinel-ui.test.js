/* Teste leve da lógica do Sentinel (sem navegador). */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const S = require("./sentinel.js");
require("./sentinel-mock.js");

(async () => {
  // escape / formatação
  assert.strictEqual(S.esc('<a "x">'), "&lt;a &quot;x&quot;&gt;");
  assert.strictEqual(S.brl(null), "—");
  assert.strictEqual(S.duracao(30 * 60000), "30 min");
  assert.strictEqual(S.duracao(5 * 3600000), "5 h");
  assert.strictEqual(S.duracao(72 * 3600000), "3 d");

  // links: central-margem (cliente+conta) e bases (cliente)
  const inc = { clienteSlug: "a b", contaId: 7 };
  assert.strictEqual(S.linkCentral(inc), "central-margem.html?cliente=a%20b&conta=7");
  assert.strictEqual(S.linkBases(inc), "bases.html?cliente=a%20b");
  // MLB só quando o incidente é de um anúncio; nunca "conta", chave composta ou valor estranho
  assert.strictEqual(S.linkCentral({ clienteSlug: "x", contaId: 1, chave: "MLB123" }), "central-margem.html?cliente=x&conta=1&mlb=MLB123");
  assert.strictEqual(S.linkCentral({ clienteSlug: "x", contaId: 1, chave: "conta" }), "central-margem.html?cliente=x&conta=1");
  assert.strictEqual(S.linkCentral({ clienteSlug: "x", contaId: 1, chave: "MLB1+MLB2" }), "central-margem.html?cliente=x&conta=1");
  assert.strictEqual(S.linkCentral({ clienteSlug: "x", contaId: 1, chave: "<b>" }), "central-margem.html?cliente=x&conta=1");

  // período → desde
  assert.strictEqual(S.periodoParaDesde("todos"), null);
  assert.strictEqual(S.periodoParaDesde("24h", Date.parse("2026-10-28T12:00:00Z")), "2026-10-27T12:00:00.000Z");

  // regras de produto nos rótulos
  assert(!/confirmad/i.test(S.CONF.calculado[0] + S.CONF.calculado[1]), "calculado nunca é 'confirmado'");
  assert(/não é prejuízo/i.test(S.IMPACTO.receita_sem_custo[1]));
  assert(/claims/i.test(S.CONF.calculado[1]));

  // prioridade explicável
  const expl = S.prioridadeExplicada({ severidade: "critica", impacto: { tipo: "perda_contribuicao", valor: 100 }, pedidosAfetados: 3, vezesReaberto: 2, status: "aberto" });
  assert(/crítica/.test(expl) && /3 pedido/.test(expl) && /reaberto 2×/.test(expl) && /R\$/.test(expl));

  // estados da tela
  const agora = Date.parse("2026-10-28T12:00:00Z");
  const ok = { contas: [{ situacao: "ok" }], resumo: { monitoramentoAtivo: true, ultimaAtualizacao: "2026-10-28T11:50:00Z" }, incidentes: { total: 2 } };
  assert.strictEqual(S.estadoDaTela({ erro: "x" }, agora).tela, "erro");
  assert.strictEqual(S.estadoDaTela({ carregando: true }, agora).tela, "carregando");
  assert.strictEqual(S.estadoDaTela({ contas: [] }, agora).tela, "sem_dados");
  assert.strictEqual(S.estadoDaTela({ ...ok, resumo: { monitoramentoAtivo: false } }, agora).tela, "desativado");
  assert.strictEqual(S.estadoDaTela({ ...ok, incidentes: { total: 0 } }, agora).tela, "sem_incidentes");
  assert.strictEqual(S.estadoDaTela(ok, agora).desatualizado, false);
  assert.strictEqual(S.estadoDaTela({ ...ok, resumo: { monitoramentoAtivo: true, ultimaAtualizacao: "2026-10-28T09:00:00Z" } }, agora).desatualizado, true);
  assert.strictEqual(S.estadoDaTela({ ...ok, contas: [{ situacao: "erro" }] }, agora).contasComProblema, 1);

  // cliente HTTP: token no header, query sem vazios, erros tipados
  const chamadas = [];
  const fake = (resp) => async (url, init) => { chamadas.push({ url, init }); return { ok: resp.status < 400, status: resp.status, json: async () => resp.body }; };
  let api = S.criarApi({ base: "http://x", getToken: () => "TKN", fetchImpl: fake({ status: 200, body: { ok: true, itens: [], total: 0 } }) });
  await api.incidentes({ tipo: "sem_custo", status: "", squad: 2 });
  assert.strictEqual(chamadas[0].url, "http://x/sentinel/incidentes?tipo=sem_custo&squad=2");
  assert.strictEqual(chamadas[0].init.headers.Authorization, "Bearer TKN");
  api = S.criarApi({ base: "http://x", getToken: () => "T", fetchImpl: fake({ status: 409, body: { erro: "nope", code: "TRANSICAO_INVALIDA" } }) });
  await assert.rejects(() => api.reconhecer(5), (e) => e.status === 409 && e.code === "TRANSICAO_INVALIDA");
  api = S.criarApi({ base: "http://x", getToken: () => "T", fetchImpl: fake({ status: 200, body: { incidente: { id: 1 } } }) });
  await api.resolver(1, { motivo: "ok" });
  const ult = chamadas[chamadas.length - 1];
  assert.strictEqual(ult.init.method, "POST");
  assert.strictEqual(JSON.parse(ult.init.body).motivo, "ok");

  // mock implementa o mesmo contrato: resolver exige motivo; nenhum campo sensível
  const m = global.SENTINEL_MOCK.api;
  await assert.rejects(() => m.resolver(1, { motivo: " " }), (e) => e.code === "MOTIVO_OBRIGATORIO");
  const lista = await m.incidentes({ squad: 1 });
  assert(lista.itens.length > 0 && lista.itens.every((i) => i.squad.id === 1));
  assert(!/token|secret/i.test(JSON.stringify(await m.incidente(1))));
  const r = await m.resumo({});
  assert(r.perdaContribuicaoObservada > 0 && r.receitaCustoPendente > 0, "perda e receita sem custo são números separados");

  // saúde: agrupamento por nível, "sem pedidos" é info (nunca vira banner/falha), mock cumpre o contrato
  const g = S.agruparAlertas([{ nivel: "critico" }, { nivel: "aviso" }, { nivel: "info" }, { nivel: "info" }]);
  assert.deepStrictEqual([g.critico.length, g.aviso.length, g.info.length], [1, 1, 2]);
  assert.strictEqual(S.idadeTxt(null), "—");
  assert(/Ativo/.test(S.WORKER.ativo[1]) && /Parado/.test(S.WORKER.parado[1]) && /Sem dados/.test(S.WORKER.sem_dados[1]));
  chamadas.length = 0;
  api = S.criarApi({ base: "http://x", getToken: () => "T", fetchImpl: fake({ status: 200, body: { ok: true, saude: { worker: { estado: "ativo" } } } }) });
  assert.strictEqual((await api.saude({ squad: 1 })).worker.estado, "ativo");
  assert.strictEqual(chamadas[0].url, "http://x/sentinel/saude?squad=1");
  const sd = await global.SENTINEL_MOCK.api.saude({});
  assert(sd.worker.estado && sd.contas.monitoradas > 0 && sd.alertas.some((a) => a.nivel === "info" && /não é falha/.test(a.mensagem)));
  assert(!sd.alertas.some((a) => a.nivel !== "info" && a.codigo === "SEM_PEDIDOS_RECENTES"));

  // conta desativada: não conta como "com problema"; mock marca contaAtiva:false e a conta ativo:false
  assert.strictEqual(S.estadoDaTela({ ...ok, contas: [{ situacao: "atrasada", ativo: false }] }, agora).contasComProblema, 0);
  assert.strictEqual(S.estadoDaTela({ ...ok, contas: [{ situacao: "atrasada", ativo: true }] }, agora).contasComProblema, 1);
  assert(/desativada/.test(S.OFF_TXT) && /não monitorada/.test(S.OFF_TXT));
  const off = (await m.incidente(8));
  assert.strictEqual(off.contaAtiva, false);
  assert.strictEqual((await m.incidente(1)).contaAtiva, true);
  const cs = await m.contas({});
  assert.strictEqual(cs.find((c) => c.contaId === 9006).ativo, false);
  assert.strictEqual((await m.resumo({})).contasAtrasadas, 2, "conta desativada fora de 'atrasadas'");

  // Menu: o item só aparece p/ os papéis que o BACKEND aceita (admin + internos de rolesInternas.js)
  const fonte = fs.readFileSync(path.join(__dirname, "vf-shell.js"), "utf8");
  const papeis = JSON.parse(/PAPEIS_SENTINEL = Object\.freeze\((\[[^\]]*\])\)/.exec(fonte)[1]);
  const { ROLES_COBRADAS_NA_AUDITORIA } = require("../server/services/squads/rolesInternas");
  assert.deepStrictEqual([...papeis].sort(), ["admin", ...ROLES_COBRADAS_NA_AUDITORIA.set].sort(), "menu espelha authorizationService.ehAdmin/ehInterno");
  assert(/id: "sentinel"[^}]*papeis: PAPEIS_SENTINEL/.test(fonte));
  assert(/mod\.papeis \|\| mod\.papeis\.includes|!mod\.papeis \|\| mod\.papeis\.includes\(papelAtual\)/.test(fonte));

  // HTML: sem mock/shell no caminho com backend; selo só por demo
  const html = fs.readFileSync(path.join(__dirname, "sentinel.html"), "utf8");
  assert(!html.includes('src="sentinel-mock.js"') && !html.includes('src="vf-shell.js"'));
  assert(html.includes("DADOS DE EXEMPLO") && /id="sn-demo-seal"[^>]*hidden/.test(html));
  console.log("sentinel-ui.test.js OK");
})().catch((e) => { console.error(e); process.exit(1); });
