/* Sentinel — DADOS DE EXEMPLO (fictícios), carregados SÓ com ?demo=1.
   Implementa em memória o MESMO contrato da API /sentinel (resumo, saude, contas, incidentes,
   incidentes/:id, reconhecer, resolver), com os mesmos campos e os mesmos textos de motivo e
   próxima ação que o motor real grava — a demo mostra o que a produção mostraria.
   Sem backend, sem rede, nenhum dado real. Clientes, contas, anúncios e pessoas não existem.
   ?cenario=parado  → motor sem leitura (a tela não pode parecer saudável)
   ?cenario=limpo   → nenhum caso e leitura em dia (vazio que pode ser lido como "em ordem") */
(function (root) {
  "use strict";
  const H = 3600 * 1000;
  const now = () => Date.now();
  const iso = (hAtras) => new Date(now() - hAtras * H).toISOString();
  const r2 = (n) => Math.round(Number(n) * 100) / 100;
  const brl = (n) => "R$ " + r2(n).toFixed(2).replace(".", ",");
  const CEN = (() => { try { return new URLSearchParams(root.location.search).get("cenario") || ""; } catch (e) { return ""; } })();
  const EU = "Você — demo (#0)";

  const SQ = { a: { id: 1, nome: "Squad Aurora" }, b: { id: 2, nome: "Squad Boreal" } };
  const contas = [
    { contaId: 9001, clienteId: 1, clienteNome: "Loja Modelo Alfa", clienteSlug: "loja-modelo-alfa", contaNome: "Alfa Oficial", squad: SQ.a, monitorada: true, ultimaExecucaoEm: iso(0.07), checkpoint: iso(0.1), atrasoSegundos: 360, ultimoErro: null, situacao: "ok", limiteMin: 120 },
    { contaId: 9002, clienteId: 2, clienteNome: "Emporio Ficticio Beta", clienteSlug: "emporio-ficticio-beta", contaNome: "Beta Principal", squad: SQ.a, monitorada: true, ultimaExecucaoEm: iso(0.07), checkpoint: iso(0.1), atrasoSegundos: 360, ultimoErro: null, situacao: "ok", limiteMin: 120 },
    { contaId: 9003, clienteId: 3, clienteNome: "Casa Exemplo Gama", clienteSlug: "casa-exemplo-gama", contaNome: "Gama ML", squad: SQ.b, monitorada: true, ultimaExecucaoEm: iso(0.07), checkpoint: iso(52), atrasoSegundos: 187200, ultimoErro: "SENTINEL_TOKEN_INDISPONIVEL: token expirado", situacao: "erro", limiteMin: 120 },
    { contaId: 9004, clienteId: 4, clienteNome: "Mercado Teste Delta", clienteSlug: "mercado-teste-delta", contaNome: "Delta ML", squad: SQ.b, monitorada: true, ultimaExecucaoEm: iso(0.07), checkpoint: iso(9), atrasoSegundos: 32400, ultimoErro: null, situacao: "atrasada", limiteMin: 120 },
    { contaId: 9005, clienteId: 5, clienteNome: "Oficina Demo Epsilon", clienteSlug: "oficina-demo-epsilon", contaNome: "Epsilon ML", squad: SQ.b, monitorada: false, ultimaExecucaoEm: null, checkpoint: null, atrasoSegundos: null, ultimoErro: null, situacao: "nao_monitorada", limiteMin: 120 },
    { contaId: 9006, clienteId: 1, clienteNome: "Loja Modelo Alfa", clienteSlug: "loja-modelo-alfa", contaNome: "Alfa Antiga", squad: SQ.a, ativo: false, monitorada: false, ultimaExecucaoEm: iso(400), checkpoint: iso(400), atrasoSegundos: 1440000, ultimoErro: null, situacao: "atrasada", limiteMin: 120 },
  ];
  if (CEN === "parado") contas.forEach((c) => { if (c.monitorada) Object.assign(c, { ultimaExecucaoEm: iso(5), checkpoint: iso(Math.max(5, (c.atrasoSegundos || 0) / 3600)), atrasoSegundos: Math.max(18000, c.atrasoSegundos || 0), situacao: c.situacao === "erro" ? "erro" : "atrasada" }); });
  if (CEN === "limpo") contas.forEach((c) => { if (c.monitorada) Object.assign(c, { checkpoint: iso(0.1), atrasoSegundos: 360, ultimoErro: null, situacao: "ok" }); });
  const porConta = (id) => contas.find((c) => c.contaId === id);

  /* Pedido no formato do detalhe real: componentes ausentes são null (nunca 0). */
  let seq = 2000010000;
  function ped(h, itemId, sku, qtd, preco, o) {
    const fat = r2(preco * qtd);
    const comissao = r2(fat * o.com + (o.fixa || 0) * qtd);
    const frete = o.frete === undefined ? 0 : o.frete;
    const custo = o.custoUn == null ? null : r2(o.custoUn * qtd);
    const imposto = custo == null ? null : r2(fat * (o.imp == null ? 0.04 : o.imp));
    const margem = custo == null ? null : r2(fat - comissao - (frete || 0) - custo - imposto);
    const conf = custo == null ? "inconclusivo" : frete == null ? "pendente" : "calculado";
    return { pedidoId: String(++seq), dataPedido: iso(h), statusMl: "paid", faturamento: fat, comissao, frete, custo, imposto, margemValor: margem, margemPct: margem == null ? null : r2((margem / fat) * 100),
      elegibilidade: "venda", confiabilidade: conf, motivosConfiabilidade: conf === "calculado" ? ["claims_nao_verificados"] : conf === "pendente" ? ["sem_frete"] : [o.estado || "sem_custo"],
      itens: [{ itemId, sku, quantidade: qtd, preco, custoUnitario: o.custoUn == null ? null : o.custoUn, estadoCusto: custo == null ? o.estado || "sem_custo" : "ok" }] };
  }
  const semana = (isoStr) => { const d = new Date(isoStr); const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const dia = u.getUTCDay() || 7; u.setUTCDate(u.getUTCDate() + 4 - dia); const ini = new Date(Date.UTC(u.getUTCFullYear(), 0, 1)); return u.getUTCFullYear() + "-W" + String(Math.ceil(((u - ini) / 86400000 + 1) / 7)).padStart(2, "0"); };
  const datas = (ps) => ps.map((p) => new Date(p.dataPedido).getTime());

  const ctx = (o) => {
    const c = porConta(o.contaId);
    return Object.assign({ clienteId: c.clienteId, clienteNome: c.clienteNome, clienteSlug: c.clienteSlug, contaNome: c.contaNome, squad: c.squad, status: "aberto", condicaoAtiva: true, reconhecido: null, resolvido: null, reabertoEm: null, vezesReaberto: 0, detalhes: {}, avaliadoEm: iso(0.07) }, o);
  };
  // Mesmos textos de sentinelIncidentes.detectarMargemNegativa.
  function margemInc(o, ps, skus) {
    const obs = ps.filter((p) => p.confiabilidade === "calculado"), pend = ps.filter((p) => p.confiabilidade === "pendente");
    const perda = r2(obs.reduce((s, p) => s - p.margemValor, 0)), perdaPend = r2(pend.reduce((s, p) => s - p.margemValor, 0));
    const fat = r2(obs.reduce((s, p) => s + p.faturamento, 0)), mm = fat ? r2((-perda / fat) * 100) : null;
    const ev = new Map();
    ps.forEach((p) => { const k = semana(p.dataPedido), e = ev.get(k) || { semana: k, pedidos: 0, perda: 0 }; e.pedidos += 1; e.perda = r2(e.perda - p.margemValor); ev.set(k, e); });
    const t = datas(ps);
    return ctx(Object.assign({ tipo: "margem_negativa", confiabilidade: obs.length ? "calculado" : "pendente", titulo: "Margem negativa em " + o.chave,
      motivo: obs.length
        ? obs.length + " pedido(s) com lucro de contribuição negativo nos últimos 30 dias: perda observada " + brl(perda) + " (margem " + String(mm).replace(".", ",") + "% sobre " + brl(fat) + ")" + (pend.length ? "; mais " + pend.length + " pedido(s) com cálculo pendente (" + brl(perdaPend) + ", fora do impacto)" : "") + ". Claims/devoluções não verificadas."
        : pend.length + " pedido(s) com margem negativa, mas cálculo pendente (componente faltando): " + brl(perdaPend) + " não entra como perda observada.",
      proximaAcao: "Revisar preço, custo e frete do produto na Central de Margem.", impacto: { tipo: "perda_contribuicao", valor: perda }, pedidosAfetados: ps.length,
      primeiraOcorrencia: new Date(Math.min(...t)).toISOString(), ultimaOcorrencia: new Date(Math.max(...t)).toISOString(),
      detalhes: { janelaDias: 30, pedidosObservados: obs.length, pedidosPendentes: pend.length, perdaPendente: perdaPend, faturamentoObservado: fat, pedidosSemFaturamento: 0, margemMediaPct: mm, skus, evolucao: [...ev.values()].sort((a, b) => a.semana.localeCompare(b.semana)), pedidos: ps.map((p) => p.pedidoId) },
      _pedidos: ps }, o));
  }
  // Mesmos textos de sentinelIncidentes.detectarCustoPendente.
  function custoInc(o, ps, skus, estado) {
    const receita = r2(ps.reduce((s, p) => s + p.faturamento, 0)), t = datas(ps), amb = estado === "custo_ambiguo";
    return ctx(Object.assign({ tipo: "custo_pendente", confiabilidade: "inconclusivo", titulo: (amb ? "Custo ambíguo para " : "Produto sem custo: ") + o.chave,
      motivo: ps.length + " pedido(s) nos últimos 30 dias com " + brl(receita) + " de receita sem custo confiável (" + estado + ": " + ps.length + "). Margem não determinável — isto não é prejuízo comprovado.",
      proximaAcao: amb ? "Desambiguar o custo (variação/SKU) na Base de custos do cliente." : "Cadastrar o custo do produto na Base de custos do cliente.",
      impacto: { tipo: "receita_sem_custo", valor: receita }, pedidosAfetados: ps.length, primeiraOcorrencia: new Date(Math.min(...t)).toISOString(), ultimaOcorrencia: new Date(Math.max(...t)).toISOString(),
      detalhes: { janelaDias: 30, motivos: { [estado]: ps.length }, itensSemPreco: 0, skus, pedidos: ps.map((p) => p.pedidoId) }, _pedidos: ps }, o));
  }
  function leituraInc(o, c, categoria) {
    const token = categoria === "token";
    return ctx(Object.assign({ tipo: "leitura_atrasada", chave: "conta", confiabilidade: "operacional", titulo: "Leitura atrasada há " + String(Math.round(c.atrasoSegundos / 360) / 10).replace(".", ",") + " h",
      motivo: token ? "Token do Mercado Livre indisponível; o Sentinel não renova tokens." : "Checkpoint de leitura não avança.",
      proximaAcao: token ? "Renovar a conexão da conta pelo Portal (Clientes → Contas)." : "Investigar o log do worker do Sentinel.",
      impacto: { tipo: null, valor: null }, pedidosAfetados: 0, primeiraOcorrencia: iso(c.atrasoSegundos / 3600 - 2), ultimaOcorrencia: iso(c.atrasoSegundos / 3600 - 2),
      detalhes: { atrasoSegundos: c.atrasoSegundos, limiteMin: 120, categoria, ultimoErro: c.ultimoErro, ultimaExecucaoEm: c.ultimaExecucaoEm, checkpoint: c.checkpoint }, _pedidos: [] }, o));
  }

  const A = "MLB-EXEMPLO-0001", B = "MLB-EXEMPLO-0002", C = "MLB-EXEMPLO-0003", D = "MLB-EXEMPLO-0004", G = "MLB-EXEMPLO-0007", P = "MLB-EXEMPLO-0008", Q = "MLB-EXEMPLO-0009";
  const kit = { com: 0.12, fixa: 6.5, custoUn: 68, frete: 6.9 }, garrafa = { com: 0.11, fixa: 6.5, custoUn: 38 }, semCusto = { com: 0.13, fixa: 0, custoUn: null, frete: 18.9 };
  const incidentes = CEN === "limpo" ? [] : [
    // 1. Muitos pedidos negativos e o preço caiu nos mais recentes (variação de preço visível).
    margemInc({ id: 1, contaId: 9002, chave: A, severidade: "critica", abertoEm: iso(210) },
      [[2, 2, 79.9], [5, 1, 79.9], [11, 1, 79.9], [19, 2, 79.9], [27, 1, 79.9], [52, 1, 89.9], [70, 1, 89.9], [96, 1, 89.9], [121, 1, 89.9], [150, 1, 89.9], [178, 1, 89.9], [209, 1, 89.9]].map(([h, q, p]) => ped(h, A, "KIT-ORG-12", q, p, kit)), ["KIT-ORG-12"]),
    // 2. Já reconhecido: o frete pesa só em parte dos pedidos.
    Object.assign(margemInc({ id: 2, contaId: 9001, chave: B, severidade: "alta", abertoEm: iso(74) },
      [[6, 12.9], [15, 34.9], [29, 12.9], [47, 34.9], [73, 12.9]].map(([h, f]) => ped(h, B, "GARRAFA-1L-INOX", 1, 64.9, Object.assign({ frete: f }, garrafa))), ["GARRAFA-1L-INOX"]),
      { status: "reconhecido", reconhecido: { em: iso(4), por: "Ana Exemplo (#2)" } }),
    // 3. Resolvido e REABERTO: vendas novas continuam sem custo.
    Object.assign(custoInc({ id: 3, contaId: 9002, chave: C, severidade: "alta", abertoEm: iso(190) },
      [3, 8, 14, 33, 58, 90, 131, 160, 189].map((h) => ped(h, C, "CAFET-IT-6X", 1, 249.9, semCusto)), ["CAFET-IT-6X"], "sem_custo"),
      { status: "reaberto", reabertoEm: iso(14), vezesReaberto: 1 }),
    // 4. Custo ambíguo (duas variações com custos diferentes).
    custoInc({ id: 4, contaId: 9004, chave: D, severidade: "media", abertoEm: iso(80) },
      [30, 55, 79].map((h) => ped(h, D, h === 55 ? "LUM-MESA-PT" : "LUM-MESA-BR", 1, 189, Object.assign({}, semCusto, { estado: "custo_ambiguo" }))), ["LUM-MESA-BR", "LUM-MESA-PT"], "custo_ambiguo"),
    // 5 e 6. Falha de leitura: token indisponível (crítica) e checkpoint parado (alta).
    leituraInc({ id: 5, contaId: 9003, severidade: "critica", abertoEm: iso(50) }, porConta(9003), "token"),
    leituraInc({ id: 6, contaId: 9004, severidade: "alta", abertoEm: iso(7) }, porConta(9004), "sem_avanco"),
    // 7. Resolvido, com histórico completo; a condição deixou de ocorrer.
    Object.assign(margemInc({ id: 7, contaId: 9001, chave: G, severidade: "media", abertoEm: iso(230) },
      [[176, 1], [228, 1]].map(([h, q]) => ped(h, G, "CAPA-ALM-45", q, 39.9, { com: 0.14, fixa: 6.5, custoUn: 27.5, frete: 0 })), ["CAPA-ALM-45"]),
      { status: "resolvido", condicaoAtiva: false, reconhecido: { em: iso(170), por: "Bia Exemplo (#3)" }, resolvido: { em: iso(165), por: "Bia Exemplo (#3)", motivo: "Preço ajustado", observacao: "Preço voltou para R$ 46,90 depois do fim da campanha." } }),
    // 8. Conta desativada: só leitura e decisão humana.
    custoInc({ id: 8, contaId: 9006, chave: P, severidade: "baixa", abertoEm: iso(420) },
      [401, 410, 419].map((h) => ped(h, P, "PANELA-ANTI-24", 1, 80, semCusto)), ["PANELA-ANTI-24"], "sem_custo"),
    // 9. Margem negativa só com cálculo provisório (frete ausente): NÃO vira perda observada.
    margemInc({ id: 9, contaId: 9001, chave: Q, severidade: "baixa", abertoEm: iso(20) },
      [[9, 1], [19, 1]].map(([h, q]) => ped(h, Q, "TAPETE-YOGA-6", q, 54.9, { com: 0.12, fixa: 6.5, custoUn: 42, frete: null })), ["TAPETE-YOGA-6"]),
  ];

  const ev = (id, evento, ator, antes, depois, h, dados) => ({ id, evento, ator, statusAntes: antes, statusDepois: depois, dados: dados || {}, criadoEm: iso(h) });
  const eventos = {};
  incidentes.forEach((i) => { eventos[i.id] = [Object.assign(ev(i.id * 10, "aberto", "sentinel", null, "aberto", 0), { criadoEm: i.abertoEm })]; });
  if (eventos[1]) eventos[1].push(ev(11, "atualizado", "sentinel", "aberto", "aberto", 52, { severidadeAntes: "alta", severidadeDepois: "critica", pedidos: 10 }), ev(12, "atualizado", "sentinel", "aberto", "aberto", 2, { severidadeAntes: "critica", severidadeDepois: "critica", pedidos: 12 }));
  if (eventos[2]) eventos[2].push(ev(21, "reconhecido", "Ana Exemplo (#2)", "aberto", "reconhecido", 4, { observacao: "Vou conferir a faixa de frete do anúncio." }));
  if (eventos[3]) eventos[3].push(ev(31, "reconhecido", "Bia Exemplo (#3)", "aberto", "reconhecido", 150), ev(32, "resolvido", "Bia Exemplo (#3)", "reconhecido", "resolvido", 100, { motivo: "Custo cadastrado na base" }), ev(33, "reaberto", "sentinel", "resolvido", "reaberto", 14, { novaOcorrencia: { pedidosNovos: incidentes[2]._pedidos.slice(0, 3).map((p) => p.pedidoId) } }));
  if (eventos[7]) eventos[7].push(ev(71, "reconhecido", "Bia Exemplo (#3)", "aberto", "reconhecido", 170), ev(72, "resolvido", "Bia Exemplo (#3)", "reconhecido", "resolvido", 165, { motivo: "Preço ajustado", observacao: "Preço voltou para R$ 46,90 depois do fim da campanha." }), ev(73, "condicao_encerrada", "sentinel", "resolvido", "resolvido", 24));

  const copia = (o) => JSON.parse(JSON.stringify(o));
  const publico = (i) => { const o = copia(i); delete o._pedidos; o.contaAtiva = porConta(i.contaId).ativo !== false; return o; };
  const ordemSev = { critica: 0, alta: 1, media: 2, baixa: 3 }, ordemStatus = { reaberto: 0, aberto: 1, reconhecido: 2, resolvido: 3 };
  const cobertura = () => (CEN === "limpo"
    ? { pedidos: 131, vendas: 118, porConfiabilidade: { calculado: 118, pendente: 0, confirmado: 0, inconclusivo: 0 }, excluidos: { cancelado: 13 } }
    : { pedidos: 214, vendas: 186, porConfiabilidade: { calculado: 150, pendente: 9, confirmado: 0, inconclusivo: 27 }, excluidos: { cancelado: 22, aguardando_pagamento: 6 } });

  function contasDoFiltro(q) {
    return contas.filter((c) => (!q.squad || String(c.squad.id) === String(q.squad)) && (!q.conta || String(c.contaId) === String(q.conta)));
  }
  const err = (status, code, erro) => Object.assign(new Error(erro), { status, code });

  const api = {
    async resumo(q = {}) {
      const cs = contasDoFiltro(q), ids = cs.map((c) => c.contaId);
      const abertos = incidentes.filter((i) => ids.includes(i.contaId) && i.status !== "resolvido");
      const soma = (t) => r2(abertos.filter((i) => i.condicaoAtiva && i.impacto.tipo === t).reduce((s, i) => s + i.impacto.valor, 0));
      const monit = cs.filter((c) => c.monitorada);
      const ult = Math.max(0, ...monit.filter((c) => c.ultimaExecucaoEm).map((c) => new Date(c.ultimaExecucaoEm).getTime()));
      return { contasMonitoradas: monit.length, contasAtrasadas: cs.filter((c) => c.ativo !== false && c.monitorada && (c.situacao === "atrasada" || c.situacao === "erro")).length,
        incidentesAbertos: abertos.length, incidentesCriticos: abertos.filter((i) => i.severidade === "critica").length,
        perdaContribuicaoObservada: soma("perda_contribuicao"), receitaCustoPendente: soma("receita_sem_custo"), ultimaAtualizacao: ult ? new Date(ult).toISOString() : null,
        cobertura: cobertura(), monitoramentoAtivo: monit.length > 0, janelaDias: 30 };
    },
    async saude(q = {}) {
      const cs = contasDoFiltro(q).filter((c) => c.monitorada);
      const abertos = incidentes.filter((i) => cs.some((c) => c.contaId === i.contaId) && i.status !== "resolvido");
      const sev = { critica: 0, alta: 0, media: 0, baixa: 0 };
      abertos.forEach((i) => { sev[i.severidade] += 1; });
      const alertas = [];
      cs.forEach((c) => {
        const nome = c.clienteNome + " · " + c.contaNome;
        if (c.situacao === "erro") alertas.push({ nivel: "critico", codigo: "TOKEN_INDISPONIVEL", mensagem: nome + ": token ML indisponível — renovar pelo Portal (o Sentinel não renova).", contaId: c.contaId });
        if (c.situacao === "erro" || c.situacao === "atrasada") alertas.push({ nivel: c.situacao === "erro" ? "critico" : "aviso", codigo: "LEITURA_ATRASADA", mensagem: nome + ": leitura atrasada há " + Math.round(c.atrasoSegundos / 60) + " min.", contaId: c.contaId });
      });
      const ult = Math.max(0, ...cs.filter((c) => c.ultimaExecucaoEm).map((c) => new Date(c.ultimaExecucaoEm).getTime()));
      const idade = ult ? Math.round((now() - ult) / 1000) : null;
      const estado = !ult ? "sem_dados" : idade <= 960 ? "ativo" : idade <= 7200 ? "atrasado" : "parado";
      if (estado === "parado") alertas.push({ nivel: "critico", codigo: "WORKER_PARADO", mensagem: "Nenhuma execução do Sentinel há " + Math.round(idade / 60) + " min.", contaId: null });
      const semPedidos = CEN === "limpo" && cs.some((c) => c.contaId === 9004);
      if (semPedidos) alertas.push({ nivel: "info", codigo: "SEM_PEDIDOS_RECENTES", mensagem: "Mercado Teste Delta · Delta ML: nenhum pedido nas últimas 24 h (leitura em dia — não é falha).", contaId: 9004 });
      if (sev.critica) alertas.push({ nivel: "aviso", codigo: "INCIDENTES_CRITICOS", mensagem: sev.critica + " incidente(s) crítico(s) em aberto.", contaId: null });
      alertas.push({ nivel: "info", codigo: "CLAIMS_NAO_VERIFICADAS", mensagem: "Margens são 'calculadas': claims/devoluções não são consultadas pelo Sentinel.", contaId: null });
      const ord = { critico: 0, aviso: 1, info: 2 };
      alertas.sort((a, b) => ord[a.nivel] - ord[b.nivel]);
      const cps = cs.filter((c) => c.checkpoint).map((c) => new Date(c.checkpoint).getTime());
      return { worker: { estado, ultimaExecucaoEm: ult ? new Date(ult).toISOString() : null, idadeSegundos: idade, intervaloEsperadoSegundos: 480 },
        contas: { monitoradas: cs.length, ok: cs.filter((c) => c.situacao === "ok").length, atrasadas: cs.filter((c) => c.situacao === "atrasada" || c.situacao === "erro").length, erroToken: cs.filter((c) => c.situacao === "erro").length, erroApi: 0, nuncaLidas: 0, semPedidosRecentes: semPedidos ? 1 : 0 },
        checkpointIdadeMaxSegundos: Math.max(0, ...cs.map((c) => c.atrasoSegundos || 0)), ultimaColetaOkEm: cps.length ? new Date(Math.max(...cps)).toISOString() : null, incidentesAbertosPorSeveridade: sev,
        cobertura: cobertura(), alertas, limiteLeituraMin: 120 };
    },
    async contas(q = {}) { return copia(contasDoFiltro(q)).map((c) => Object.assign({ ativo: true }, c)); },
    async incidentes(q = {}) {
      const ids = contasDoFiltro(q).map((c) => c.contaId);
      const desde = q.desde ? new Date(q.desde).getTime() : null;
      let l = incidentes.filter((i) => ids.includes(i.contaId) && (!q.tipo || i.tipo === q.tipo) && (!q.status || i.status === q.status) && (!q.severidade || i.severidade === q.severidade)
        && (!desde || new Date(i.ultimaOcorrencia).getTime() >= desde)
        && (!q.busca || (i.chave + " " + i.titulo).toLowerCase().includes(String(q.busca).toLowerCase())));
      // Mesma ordem do backend: status (não resolvidos primeiro) → severidade → impacto.
      l = l.sort((a, b) => ordemStatus[a.status] - ordemStatus[b.status] || ordemSev[a.severidade] - ordemSev[b.severidade] || (b.impacto.valor || 0) - (a.impacto.valor || 0));
      const limit = Number(q.limit) || 50, offset = Number(q.offset) || 0;
      return { itens: l.slice(offset, offset + limit).map(publico), total: l.length, limit, offset };
    },
    async incidente(id) {
      const i = incidentes.find((x) => x.id === Number(id));
      if (!i) throw err(404, "INCIDENTE_NAO_ENCONTRADO", "Incidente não encontrado.");
      return Object.assign(publico(i), { eventos: copia(eventos[i.id]), pedidos: copia(i._pedidos) });
    },
    async reconhecer(id, body) {
      const i = incidentes.find((x) => x.id === Number(id));
      if (!i) throw err(404, "INCIDENTE_NAO_ENCONTRADO", "Incidente não encontrado.");
      if (i.status === "resolvido") throw err(409, "TRANSICAO_INVALIDA", "Incidente resolvido não pode ser reconhecido.");
      const antes = i.status; i.status = "reconhecido"; i.reconhecido = { em: iso(0), por: EU };
      eventos[i.id].push({ id: Date.now(), evento: "reconhecido", ator: EU, statusAntes: antes, statusDepois: "reconhecido", dados: body && body.observacao ? { observacao: body.observacao } : {}, criadoEm: iso(0) });
      return publico(i);
    },
    async resolver(id, body) {
      const i = incidentes.find((x) => x.id === Number(id));
      if (!i) throw err(404, "INCIDENTE_NAO_ENCONTRADO", "Incidente não encontrado.");
      if (!body || !String(body.motivo || "").trim()) throw err(400, "MOTIVO_OBRIGATORIO", "Informe o motivo da resolução.");
      if (i.status === "resolvido") throw err(409, "TRANSICAO_INVALIDA", "Incidente já resolvido.");
      const antes = i.status; i.status = "resolvido"; i.resolvido = { em: iso(0), por: EU, motivo: body.motivo, observacao: body.observacao || null };
      eventos[i.id].push({ id: Date.now(), evento: "resolvido", ator: EU, statusAntes: antes, statusDepois: "resolvido", dados: Object.assign({ motivo: body.motivo }, body.observacao ? { observacao: body.observacao } : {}), criadoEm: iso(0) });
      return publico(i);
    },
  };

  root.SENTINEL_MOCK = { api, cenario: CEN };
})(typeof window !== "undefined" ? window : globalThis);
