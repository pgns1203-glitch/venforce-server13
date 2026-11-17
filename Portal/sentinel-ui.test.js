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
  assert(/devoluç/i.test(S.IMPACTO.perda_contribuicao[1]), "perda é sempre 'sujeita a devoluções'");

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
  await api.resolver(1, { motivo: "ok", observacao: "feito" });
  const ult = chamadas[chamadas.length - 1];
  assert.strictEqual(ult.init.method, "POST");
  assert.deepStrictEqual(JSON.parse(ult.init.body), { motivo: "ok", observacao: "feito" });

  // mock implementa o mesmo contrato: resolver exige motivo; nenhum campo sensível
  const m = global.SENTINEL_MOCK.api;
  await assert.rejects(() => m.resolver(1, { motivo: " " }), (e) => e.code === "MOTIVO_OBRIGATORIO");
  const lista = await m.incidentes({ squad: 1 });
  assert(lista.itens.length > 0 && lista.itens.every((i) => i.squad.id === 1));
  assert(!/token|secret/i.test(JSON.stringify(await m.incidente(1))));
  const r = await m.resumo({});
  assert(r.perdaContribuicaoObservada > 0 && r.receitaCustoPendente > 0, "perda e receita sem custo são números separados");

  // saúde: agrupamento por nível; "sem pedidos" só pode ser info (nunca falha)
  const g = S.agruparAlertas([{ nivel: "critico" }, { nivel: "aviso" }, { nivel: "info" }, { nivel: "info" }]);
  assert.deepStrictEqual([g.critico.length, g.aviso.length, g.info.length], [1, 1, 2]);
  assert.strictEqual(S.idadeTxt(null), "—");
  assert(/Ativo/.test(S.WORKER.ativo[1]) && /Parado/.test(S.WORKER.parado[1]) && /Sem dados/.test(S.WORKER.sem_dados[1]));
  chamadas.length = 0;
  api = S.criarApi({ base: "http://x", getToken: () => "T", fetchImpl: fake({ status: 200, body: { ok: true, saude: { worker: { estado: "ativo" } } } }) });
  assert.strictEqual((await api.saude({ squad: 1 })).worker.estado, "ativo");
  assert.strictEqual(chamadas[0].url, "http://x/sentinel/saude?squad=1");
  const sd = await m.saude({});
  assert(sd.worker.estado === "ativo" && sd.contas.monitoradas > 0 && sd.alertas.some((a) => a.nivel === "info" && /claims/i.test(a.mensagem)));
  assert(!sd.alertas.some((a) => a.nivel !== "info" && a.codigo === "SEM_PEDIDOS_RECENTES"));

  // conta desativada: não conta como "com problema"; mock marca contaAtiva:false e a conta ativo:false
  assert.strictEqual(S.estadoDaTela({ ...ok, contas: [{ situacao: "atrasada", ativo: false }] }, agora).contasComProblema, 0);
  assert.strictEqual(S.estadoDaTela({ ...ok, contas: [{ situacao: "atrasada", ativo: true }] }, agora).contasComProblema, 1);
  assert(/desativada/.test(S.OFF_TXT) && /não monitorada/.test(S.OFF_TXT));
  assert.strictEqual((await m.incidente(8)).contaAtiva, false);
  assert.strictEqual((await m.incidente(1)).contaAtiva, true);
  const cs = await m.contas({});
  assert.strictEqual(cs.find((c) => c.contaId === 9006).ativo, false);
  assert.strictEqual((await m.resumo({})).contasAtrasadas, 2, "conta desativada fora de 'atrasadas'");

  /* ── Central de ações ─────────────────────────────────────────────── */
  // estado do motor: vazio só é "confiável" com worker ativo e todas as contas lidas
  const conta = (o) => Object.assign({ ativo: true, monitorada: true, situacao: "ok" }, o);
  const wk = (estado, idade) => ({ worker: { estado, idadeSegundos: idade } });
  const mOk = S.estadoMotor({ contas: [conta(), conta()], resumo: { monitoramentoAtivo: true }, saude: wk("ativo", 300) });
  assert.deepStrictEqual([mOk.nivel, mOk.confiavel], ["ok", true]);
  const mRes = S.estadoMotor({ contas: [conta(), conta({ situacao: "erro" }), conta({ monitorada: false }), conta({ ativo: false, situacao: "atrasada" })], resumo: { monitoramentoAtivo: true }, saude: wk("ativo", 300) });
  assert.deepStrictEqual([mRes.nivel, mRes.confiavel, mRes.semLeitura, mRes.fora, mRes.monitoradas], ["warn", false, 1, 1, 2], "desativada não entra; não monitorada conta como fora");
  assert.strictEqual(S.estadoMotor({ contas: [conta()], resumo: { monitoramentoAtivo: true }, saude: wk("parado", 20000) }).nivel, "danger");
  assert.strictEqual(S.estadoMotor({ contas: [conta()], resumo: { monitoramentoAtivo: true }, saude: wk("atrasado", 1500) }).nivel, "warn");
  const mDesc = S.estadoMotor({ contas: [conta()], resumo: { monitoramentoAtivo: true }, saude: null, saudeErro: true });
  assert(mDesc.nivel === "unknown" && !mDesc.confiavel && /não comprova/.test(mDesc.detalhe), "saúde indisponível nunca vira 'tudo bem'");
  const mOff = S.estadoMotor({ contas: [conta({ monitorada: false })], resumo: { monitoramentoAtivo: false }, saude: wk("sem_dados", null) });
  assert(mOff.nivel === "off" && !mOff.confiavel && /não significa/.test(mOff.detalhe));

  // partição nas três visões + honestidade quando a página corta
  const it = (id, status, severidade, valor, extra) => Object.assign({ id, status, severidade, impacto: { tipo: "perda_contribuicao", valor }, condicaoAtiva: true, ultimaOcorrencia: "2026-10-28T10:00:00Z" }, extra);
  const P = S.particionar([it(1, "reaberto", "media", 10), it(2, "aberto", "critica", 5), it(3, "aberto", "critica", 50), it(4, "reconhecido", "alta", 1), it(5, "resolvido", "alta", 1, { resolvido: { em: "2026-10-20T00:00:00Z" } }), it(6, "resolvido", "baixa", 1, { resolvido: { em: "2026-10-27T00:00:00Z" } })], 6);
  assert.deepStrictEqual(P.acao.map((i) => i.id), [3, 2, 1], "ação: severidade, depois impacto (reaberto não fura a fila)");
  assert.deepStrictEqual(P.tratamento.map((i) => i.id), [4]);
  assert.deepStrictEqual(P.resolvidos.map((i) => i.id), [6, 5], "resolvidos: mais recentes primeiro");
  assert.deepStrictEqual([P.faltam, P.abertosParciais, P.totalResolvidos], [0, false, 2]);
  const Pcorte = S.particionar([it(1, "aberto", "alta", 1), it(2, "resolvido", "alta", 1)], 9);
  assert.deepStrictEqual([Pcorte.faltam, Pcorte.abertosParciais, Pcorte.totalResolvidos], [7, false, 8], "corte no fim (resolvidos): abertos completos");
  const Pparc = S.particionar([it(1, "aberto", "alta", 1), it(2, "aberto", "alta", 1)], 300);
  assert.deepStrictEqual([Pparc.abertosParciais, Pparc.totalResolvidos], [true, null], "corte antes dos resolvidos: lista de abertos é parcial");
  const Pinativo = S.particionar([it(1, "aberto", "alta", 900, { condicaoAtiva: false }), it(2, "aberto", "alta", 5)], 2);
  assert.deepStrictEqual(Pinativo.acao.map((i) => i.id), [2, 1], "na mesma severidade, condição ativa vem antes");

  // por cliente: perda e receita sem custo nunca somadas no mesmo número
  const gr = S.agruparPorConta([
    Object.assign(it(1, "aberto", "alta", 100), { contaId: 1, clienteNome: "B" }),
    Object.assign(it(2, "aberto", "media", 30), { contaId: 1, clienteNome: "B", impacto: { tipo: "receita_sem_custo", valor: 30 } }),
    Object.assign(it(3, "aberto", "critica", 1), { contaId: 2, clienteNome: "A" }),
    Object.assign(it(4, "aberto", "alta", 70, { condicaoAtiva: false }), { contaId: 1, clienteNome: "B" }),
  ]);
  assert.deepStrictEqual(gr.map((x) => x.contaId), [2, 1], "pior severidade primeiro");
  assert.deepStrictEqual([gr[1].perda, gr[1].semCusto, gr[1].itens.length], [100, 30, 3], "condição encerrada não entra na soma");

  // "continua acontecendo?" só com condicaoAtiva + datas
  const t0 = Date.parse("2026-10-28T12:00:00Z");
  assert.strictEqual(S.atividade({ tipo: "margem_negativa", status: "aberto", condicaoAtiva: true, ultimaOcorrencia: "2026-10-28T10:00:00Z" }, t0).nivel, "ativo");
  assert.strictEqual(S.atividade({ tipo: "margem_negativa", status: "aberto", condicaoAtiva: true, ultimaOcorrencia: "2026-10-20T10:00:00Z" }, t0).nivel, "parado");
  assert.strictEqual(S.atividade({ tipo: "margem_negativa", status: "aberto", condicaoAtiva: false, ultimaOcorrencia: "2026-10-28T10:00:00Z" }, t0).nivel, "encerrado");
  assert.strictEqual(S.atividade({ tipo: "leitura_atrasada", status: "aberto", condicaoAtiva: true }, t0).nivel, "ativo");
  const inc48 = S.atividade({ tipo: "margem_negativa", status: "aberto", condicaoAtiva: true, ultimaOcorrencia: "2026-10-28T10:00:00Z" }, t0, true);
  assert(inc48.nivel === "incerto" && !/continua/i.test(inc48.texto), "sem leitura em dia não se afirma que o problema continua");

  // valor em destaque: perda provisória não aparece como perda; sem custo não é prejuízo
  const prov = S.impactoVisivel({ impacto: { tipo: "perda_contribuicao", valor: 0 }, detalhes: { perdaPendente: 4.78 } });
  assert(/provisória/.test(prov.natureza) && prov.tom === "muted" && /4,78/.test(prov.valor));
  assert.strictEqual(S.impactoVisivel({ impacto: { tipo: "perda_contribuicao", valor: 12 } }).tom, "danger");
  assert(/não é prejuízo/.test(S.impactoVisivel({ impacto: { tipo: "receita_sem_custo", valor: 12 } }).natureza));
  assert.strictEqual(S.impactoVisivel({ impacto: { tipo: null, valor: null } }).valor, null);

  // cobertura: denominador são as vendas lidas; sem `vendas` (API antiga) soma as classes
  const cb = S.coberturaInfo({ pedidos: 214, vendas: 186, porConfiabilidade: { calculado: 150, pendente: 9, confirmado: 0, inconclusivo: 27 }, excluidos: { cancelado: 22, aguardando_pagamento: 6 } });
  assert.deepStrictEqual([cb.vendas, cb.calculadas, cb.provisorias, cb.inconclusivas, cb.excluidos, cb.pctCalculadas], [186, 150, 9, 27, 28, 81]);
  assert.strictEqual(S.coberturaInfo({ porConfiabilidade: { calculado: 3, pendente: 1 } }).vendas, 4);
  assert.strictEqual(S.coberturaInfo(null).pctCalculadas, null);

  // composição: ausência nunca vira zero; diferença para o motor fica explícita
  const p = (o) => Object.assign({ faturamento: 100, comissao: 15, frete: 10, custo: 70, imposto: 4, margemValor: 1, itens: [] }, o);
  const c1 = S.composicao([p(), p({ margemValor: 1 })]);
  assert.deepStrictEqual(c1.linhas.map((x) => x.valor), [200, 30, 20, 140, 8]);
  assert.deepStrictEqual([c1.contribuicao, c1.outros, c1.linhas[3].pctReceita], [2, null, 70]);
  const c2 = S.composicao([p(), p({ custo: null, imposto: null, margemValor: null })]);
  assert.deepStrictEqual([c2.linhas[3].valor, c2.linhas[3].ausentes, c2.contribuicao, c2.contribuicaoAusentes, c2.outros], [null, 1, null, 1, null], "custo ausente em 1 pedido ⇒ sem total");
  assert.strictEqual(S.composicao([p({ margemValor: 6 })]).outros, 5, "contribuição do motor ≠ soma exibida ⇒ linha 'outros componentes'");
  assert.strictEqual(S.composicao([]), null);

  // sinais: fatos e hipóteses separados; sem variação não há hipótese
  const base = p({ margemValor: -5, itens: [{ itemId: "MLB1", preco: 100, custoUnitario: 70 }] });
  const s0 = S.sinais([base, base]);
  assert(s0.length === 1 && s0[0].tipo === "fato" && /custo dos produtos/.test(s0[0].texto), "só o maior peso sobre a receita");
  const s1 = S.sinais([base, p({ faturamento: 80, frete: 40, itens: [{ itemId: "MLB1", preco: 80, custoUnitario: 85 }] }), p({ frete: null, itens: [] })]);
  const areas = (tipo) => s1.filter((x) => x.tipo === tipo).map((x) => x.area).sort();
  assert.deepStrictEqual(areas("hipotese"), ["custo", "frete", "preco"]);
  assert(s1.some((x) => x.tipo === "fato" && /sem valor de frete/.test(x.texto)) && s1.every((x) => x.tipo === "fato" || x.tipo === "hipotese"));
  assert(!/rebate|subs[ií]dio/i.test(JSON.stringify(s1)), "o Sentinel não afirma rebate nem subsídio");
  assert.deepStrictEqual(S.sinais([]), []);

  // histórico legível + "meus casos" pelo ator gravado pelo backend ("Nome (#id)")
  assert.strictEqual(S.nomeAtor("Ana Exemplo (#2)"), "Ana Exemplo");
  assert.strictEqual(S.eventoTxt({ evento: "reconhecido", ator: "Ana (#2)", dados: {} }).titulo, "Reconhecido por Ana");
  assert(/Motivo: Preço ajustado/.test(S.eventoTxt({ evento: "resolvido", ator: "Bia (#3)", dados: { motivo: "Preço ajustado" } }).nota));
  assert(/Alta → Crítica/.test(S.eventoTxt({ evento: "atualizado", ator: "sentinel", dados: { severidadeAntes: "alta", severidadeDepois: "critica" } }).nota));
  assert(/3 pedidos novos/.test(S.eventoTxt({ evento: "reaberto", ator: "sentinel", dados: { novaOcorrencia: { pedidosNovos: ["1", "2", "3"] } } }).nota));
  assert.strictEqual(S.ehMeu({ reconhecido: { por: "Ana (#2)" } }, { id: 2 }), true);
  assert.strictEqual(S.ehMeu({ reconhecido: { por: "Ana (#22)" } }, { id: 2 }), false);
  assert.strictEqual(S.ehMeu({ reconhecido: null }, { id: 2 }), false);
  assert.strictEqual(S.ehMeu({ reconhecido: { por: "Ana (#2)" } }, {}), false);
  assert(Object.keys(S.TIPOS).every((t) => Array.isArray(S.MOTIVOS[t]) && S.MOTIVOS[t].length >= 3), "atalhos de motivo para todo tipo");

  // demo = mesmo contrato e mesma ordem do backend; números do caso batem com os pedidos
  const todos = await m.incidentes({ limit: 200 });
  const rank = { reaberto: 0, aberto: 1, reconhecido: 2, resolvido: 3 };
  assert(todos.itens.every((x, k) => k === 0 || rank[todos.itens[k - 1].status] <= rank[x.status]), "ordem por status como o backend");
  for (const tipo of ["margem_negativa", "custo_pendente", "leitura_atrasada"]) assert(todos.itens.some((x) => x.tipo === tipo), "demo cobre " + tipo);
  for (const st of ["aberto", "reaberto", "reconhecido", "resolvido"]) assert(todos.itens.some((x) => x.status === st), "demo cobre status " + st);
  const d1 = await m.incidente(1);
  assert.strictEqual(d1.pedidos.length, d1.pedidosAfetados);
  assert.strictEqual(d1.impacto.valor, Math.round(d1.pedidos.reduce((s, x) => s - x.margemValor, 0) * 100) / 100, "perda do caso = soma das margens negativas dos pedidos");
  assert(d1.pedidos.every((x) => ["comissao", "frete", "custo", "imposto"].every((k) => typeof x[k] === "number")));
  const d3 = await m.incidente(3);
  assert(d3.confiabilidade === "inconclusivo" && d3.pedidos.every((x) => x.custo === null && x.margemValor === null), "sem custo: custo e margem null, nunca 0");
  assert(d3.eventos.some((e) => e.evento === "reaberto") && d3.status === "reaberto");
  const d9 = await m.incidente(9);
  assert(d9.impacto.valor === 0 && d9.detalhes.perdaPendente > 0 && d9.confiabilidade === "pendente", "cálculo provisório não entra como perda observada");
  // ações na demo: reconhecer assume em nome do usuário da demo; resolver guarda motivo e observação
  const rec = await m.reconhecer(4);
  assert(rec.status === "reconhecido" && S.ehMeu(rec, { id: 0 }));
  const res = await m.resolver(4, { motivo: "Custo desambiguado (variação/SKU)", observacao: "ok" });
  assert(res.status === "resolvido" && res.resolvido.observacao === "ok");
  await assert.rejects(() => m.reconhecer(4), (e) => e.code === "TRANSICAO_INVALIDA");

  // Menu: o item só aparece p/ os papéis que o BACKEND aceita (admin + internos de rolesInternas.js)
  const fonte = fs.readFileSync(path.join(__dirname, "vf-shell.js"), "utf8");
  const papeis = JSON.parse(/PAPEIS_SENTINEL = Object\.freeze\((\[[^\]]*\])\)/.exec(fonte)[1]);
  const { ROLES_COBRADAS_NA_AUDITORIA } = require("../server/services/squads/rolesInternas");
  assert.deepStrictEqual([...papeis].sort(), ["admin", ...ROLES_COBRADAS_NA_AUDITORIA.set].sort(), "menu espelha authorizationService.ehAdmin/ehInterno");
  assert(/id: "sentinel"[^}]*papeis: PAPEIS_SENTINEL/.test(fonte));
  assert(/mod\.papeis \|\| mod\.papeis\.includes|!mod\.papeis \|\| mod\.papeis\.includes\(papelAtual\)/.test(fonte));

  // HTML: sem mock/shell no caminho com backend; selo só por demo; âncoras que o JS usa existem
  const html = fs.readFileSync(path.join(__dirname, "sentinel.html"), "utf8");
  assert(!html.includes('src="sentinel-mock.js"') && !html.includes('src="vf-shell.js"'));
  assert(html.includes("DADOS DE EXEMPLO") && /id="sn-demo-seal"[^>]*hidden/.test(html));
  const js = fs.readFileSync(path.join(__dirname, "sentinel.js"), "utf8");
  const ids = new Set([...js.matchAll(/\$\("#(sn-[a-z-]+)"\)/g)].map((x) => x[1]));
  const dinamicos = new Set(["sn-motivo", "sn-obs", "sn-banners", "sn-so-meus"]); // criados pelo próprio JS
  for (const id of ids) if (!dinamicos.has(id)) assert(html.includes('id="' + id + '"'), "sentinel.html sem #" + id);
  // a tela não promete o que o backend não entrega: nada de destinatário/entrega/leitura de aviso
  assert(!/notifica|destinat|entregue|lido por/i.test(js.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "UI não simula notificação individual");
  console.log("sentinel-ui.test.js OK");
})().catch((e) => { console.error(e); process.exit(1); });
