/* Sentinel — DADOS DE EXEMPLO (fictícios), carregados SÓ com ?demo=1.
   Implementa em memória o MESMO contrato da API /sentinel (resumo, incidentes,
   incidentes/:id, contas, reconhecer, resolver), para a UI não ter caminho
   separado. Sem backend, sem rede, nenhum dado real. */
(function (root) {
  "use strict";
  const H = 3600 * 1000;
  const now = () => Date.now();
  const iso = (hAtras) => new Date(now() - hAtras * H).toISOString();

  const SQ = { a: { id: 1, nome: "Squad Aurora" }, b: { id: 2, nome: "Squad Boreal" } };
  const contas = [
    { contaId: 9001, clienteId: 1, clienteNome: "Loja Modelo Alfa", clienteSlug: "loja-modelo-alfa", contaNome: "Alfa Oficial", squad: SQ.a, monitorada: true, ultimaExecucaoEm: iso(0.4), atrasoSegundos: 40, ultimoErro: null, situacao: "ok" },
    { contaId: 9002, clienteId: 2, clienteNome: "Emporio Ficticio Beta", clienteSlug: "emporio-ficticio-beta", contaNome: "Beta Principal", squad: SQ.a, monitorada: true, ultimaExecucaoEm: iso(0.8), atrasoSegundos: 60, ultimoErro: null, situacao: "ok" },
    { contaId: 9003, clienteId: 3, clienteNome: "Casa Exemplo Gama", clienteSlug: "casa-exemplo-gama", contaNome: "Gama ML", squad: SQ.b, monitorada: true, ultimaExecucaoEm: iso(52), atrasoSegundos: 187200, ultimoErro: "Token expirado (401)", situacao: "erro" },
    { contaId: 9004, clienteId: 4, clienteNome: "Mercado Teste Delta", clienteSlug: "mercado-teste-delta", contaNome: "Delta ML", squad: SQ.b, monitorada: true, ultimaExecucaoEm: iso(9), atrasoSegundos: 32400, ultimoErro: null, situacao: "atrasada" },
    { contaId: 9005, clienteId: 5, clienteNome: "Oficina Demo Epsilon", clienteSlug: "oficina-demo-epsilon", contaNome: "Epsilon ML", squad: SQ.b, monitorada: false, ultimaExecucaoEm: null, atrasoSegundos: null, ultimoErro: null, situacao: "nunca_lida" },
    { contaId: 9006, clienteId: 1, clienteNome: "Loja Modelo Alfa", clienteSlug: "loja-modelo-alfa", contaNome: "Alfa Antiga", squad: SQ.a, ativo: false, monitorada: false, ultimaExecucaoEm: iso(400), atrasoSegundos: 1440000, ultimoErro: null, situacao: "atrasada" },
  ];
  const porConta = (id) => contas.find((c) => c.contaId === id);

  const base = (o) => {
    const c = porConta(o.contaId);
    return Object.assign({ clienteId: c.clienteId, clienteNome: c.clienteNome, clienteSlug: c.clienteSlug, contaNome: c.contaNome, squad: c.squad, status: "aberto", condicaoAtiva: true, reconhecido: null, resolvido: null, vezesReaberto: 0, detalhes: {}, avaliadoEm: iso(0.1) }, o);
  };
  const pedido = (id, h, fat, mv, mp, conf, n) => ({ pedidoId: id, dataPedido: iso(h), statusMl: "paid", faturamento: fat, margemValor: mv, margemPct: mp, confiabilidade: conf, elegibilidade: "elegivel", itens: n });

  const incidentes = [
    base({ id: 1, contaId: 9002, tipo: "margem_negativa", chave: "MLB-EXEMPLO-0001", severidade: "critica", confiabilidade: "calculado",
      titulo: "Kit Organizador 12 peças vendendo abaixo do custo", motivo: "3 pedidos nas últimas 24 h com margem de contribuição negativa (−18,4%). Preço R$ 59,90; custo + comissão + frete = R$ 70,92.",
      proximaAcao: "Revisar preço ou promoção do anúncio na Central de Margem.", impacto: { tipo: "perda_contribuicao", valor: 184.05 }, pedidosAfetados: 3,
      primeiraOcorrencia: iso(20), ultimaOcorrencia: iso(2), abertoEm: iso(20), detalhes: { margemMediaPct: -18.4, precoMedio: 59.9, custoUnitario: 41.5 },
      _pedidos: [pedido("2000011111", 2, 59.9, -11.02, -18.4, "calculado", 1), pedido("2000011112", 9, 59.9, -10.8, -18.0, "calculado", 1), pedido("2000011113", 20, 119.8, -21.9, -18.3, "calculado", 2)] }),
    base({ id: 2, contaId: 9001, tipo: "margem_negativa", chave: "MLB-EXEMPLO-0002", severidade: "alta", confiabilidade: "calculado",
      titulo: "Garrafa Térmica 1L com margem −6,1%", motivo: "Promoção ativa levou o preço abaixo do ponto de equilíbrio em 7 pedidos.", proximaAcao: "Conferir a promoção em Central de Margem › Promoções.",
      impacto: { tipo: "perda_contribuicao", valor: 61.2 }, pedidosAfetados: 7, primeiraOcorrencia: iso(30), ultimaOcorrencia: iso(5), abertoEm: iso(30),
      status: "reconhecido", reconhecido: { em: iso(4), por: "Ana Exemplo (#2)" },
      _pedidos: [pedido("2000022221", 5, 89.9, -5.5, -6.1, "calculado", 1)] }),
    base({ id: 3, contaId: 9002, tipo: "custo_pendente", chave: "MLB-EXEMPLO-0003", severidade: "alta", confiabilidade: "pendente",
      titulo: "Cafeteira Italiana vendendo sem custo cadastrado", motivo: "5 pedidos sem custo confiável: a margem não pode ser calculada. Receita sem custo NÃO é prejuízo.",
      proximaAcao: "Cadastrar o custo do SKU em Bases.", impacto: { tipo: "receita_sem_custo", valor: 1480.5 }, pedidosAfetados: 5,
      primeiraOcorrencia: iso(48), ultimaOcorrencia: iso(3), abertoEm: iso(48), vezesReaberto: 1,
      _pedidos: [pedido("2000033331", 3, 296.1, null, null, "pendente", 1)] }),
    base({ id: 4, contaId: 9004, tipo: "custo_pendente", chave: "MLB-EXEMPLO-0004", severidade: "media", confiabilidade: "pendente",
      titulo: "Luminária de Mesa sem custo", motivo: "2 pedidos sem custo cadastrado.", proximaAcao: "Cadastrar o custo do SKU em Bases.",
      impacto: { tipo: "receita_sem_custo", valor: 310 }, pedidosAfetados: 2, primeiraOcorrencia: iso(70), ultimaOcorrencia: iso(30), abertoEm: iso(70), _pedidos: [] }),
    base({ id: 5, contaId: 9003, tipo: "leitura_atrasada", chave: "conta", severidade: "critica", confiabilidade: "operacional",
      titulo: "Gama ML sem leitura há 52 h", motivo: "Última leitura há 52 h (limite 6 h). Erro: token expirado. Margens desta conta podem estar desatualizadas.",
      proximaAcao: "Reconectar a conta do Mercado Livre em Clientes.", impacto: { tipo: null, valor: null }, pedidosAfetados: 0,
      primeiraOcorrencia: iso(46), ultimaOcorrencia: iso(0.2), abertoEm: iso(46), detalhes: { atrasoHoras: 52, limiteHoras: 6 }, _pedidos: [] }),
    base({ id: 6, contaId: 9004, tipo: "leitura_atrasada", chave: "conta", severidade: "media", confiabilidade: "operacional",
      titulo: "Delta ML com leitura há 9 h", motivo: "Acima do limite de 6 h; conta de baixo volume.", proximaAcao: "Acompanhar; sem erro registrado.",
      impacto: { tipo: null, valor: null }, pedidosAfetados: 0, primeiraOcorrencia: iso(3), ultimaOcorrencia: iso(0.2), abertoEm: iso(3), detalhes: { atrasoHoras: 9, limiteHoras: 6 }, _pedidos: [] }),
    base({ id: 7, contaId: 9001, tipo: "margem_negativa", chave: "MLB-EXEMPLO-0007", severidade: "baixa", confiabilidade: "calculado",
      titulo: "Capa de Almofada com margem −0,4%", motivo: "Variação pontual de comissão em 2 pedidos.", proximaAcao: "Sem ação imediata; monitorar.",
      impacto: { tipo: "perda_contribuicao", valor: 2.9 }, pedidosAfetados: 2, primeiraOcorrencia: iso(100), ultimaOcorrencia: iso(60), abertoEm: iso(100),
      status: "resolvido", condicaoAtiva: false, resolvido: { em: iso(55), por: "Bia Exemplo (#3)", motivo: "Preço ajustado", observacao: null }, _pedidos: [] }),
    base({ id: 8, contaId: 9006, tipo: "custo_pendente", chave: "MLB-EXEMPLO-0008", severidade: "media", confiabilidade: "pendente",
      titulo: "Panela Antiaderente sem custo (conta desativada)", motivo: "3 pedidos antigos sem custo; a conta foi desativada.", proximaAcao: "Decidir se o incidente ainda importa.",
      impacto: { tipo: "receita_sem_custo", valor: 240 }, pedidosAfetados: 3, primeiraOcorrencia: iso(120), ultimaOcorrencia: iso(100), abertoEm: iso(120), _pedidos: [] }),
  ];
  const eventos = {};
  incidentes.forEach((i) => { eventos[i.id] = [{ id: i.id * 10, evento: "aberto", ator: "sentinel", statusAntes: null, statusDepois: "aberto", dados: {}, criadoEm: i.abertoEm }]; });

  const copia = (o) => JSON.parse(JSON.stringify(o));
  const publico = (i) => { const o = copia(i); delete o._pedidos; o.contaAtiva = porConta(i.contaId).ativo !== false; return o; };
  const ordem = { critica: 0, alta: 1, media: 2, baixa: 3 };

  function contasDoFiltro(q) {
    return contas.filter((c) => (!q.squad || String(c.squad.id) === String(q.squad)) && (!q.conta || String(c.contaId) === String(q.conta)));
  }
  const err = (status, code, erro) => Object.assign(new Error(erro), { status, code });

  const api = {
    async resumo(q = {}) {
      const cs = contasDoFiltro(q), ids = cs.map((c) => c.contaId);
      const abertos = incidentes.filter((i) => ids.includes(i.contaId) && i.status !== "resolvido");
      const soma = (t) => abertos.filter((i) => i.impacto.tipo === t).reduce((s, i) => s + i.impacto.valor, 0);
      return { contasMonitoradas: cs.filter((c) => c.monitorada).length, contasAtrasadas: cs.filter((c) => c.ativo !== false && (c.situacao === "atrasada" || c.situacao === "erro")).length,
        incidentesAbertos: abertos.length, incidentesCriticos: abertos.filter((i) => i.severidade === "critica").length,
        perdaContribuicaoObservada: soma("perda_contribuicao"), receitaCustoPendente: soma("receita_sem_custo"), ultimaAtualizacao: iso(0.2),
        cobertura: { pedidos: 214, porConfiabilidade: { calculado: 150, pendente: 31, confirmado: 0, inconclusivo: 5 }, excluidos: { cancelado: 28 } }, monitoramentoAtivo: true };
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
      if (cs.some((c) => c.contaId === 9001)) alertas.push({ nivel: "info", codigo: "SEM_PEDIDOS_RECENTES", mensagem: "Loja Modelo Alfa · Alfa Oficial: nenhum pedido nas últimas 24 h (leitura em dia — não é falha).", contaId: 9001 });
      if (sev.critica) alertas.push({ nivel: "aviso", codigo: "INCIDENTES_CRITICOS", mensagem: sev.critica + " incidente(s) crítico(s) em aberto.", contaId: null });
      const ult = Math.max(0, ...cs.filter((c) => c.ultimaExecucaoEm).map((c) => new Date(c.ultimaExecucaoEm).getTime()));
      return { worker: { estado: ult ? "ativo" : "sem_dados", ultimaExecucaoEm: ult ? new Date(ult).toISOString() : null, idadeSegundos: ult ? Math.round((now() - ult) / 1000) : null },
        contas: { monitoradas: cs.length, ok: cs.filter((c) => c.situacao === "ok").length, atrasadas: cs.filter((c) => c.situacao === "atrasada" || c.situacao === "erro").length, erroToken: cs.filter((c) => c.situacao === "erro").length, erroApi: 0, nuncaLidas: 0, semPedidosRecentes: cs.some((c) => c.contaId === 9001) ? 1 : 0 },
        checkpointIdadeMaxSegundos: Math.max(0, ...cs.map((c) => c.atrasoSegundos || 0)), ultimaColetaOkEm: iso(0.4), incidentesAbertosPorSeveridade: sev,
        cobertura: { pedidos: 214, porConfiabilidade: { calculado: 150, pendente: 31, confirmado: 0, inconclusivo: 5 }, excluidos: { cancelado: 28 } }, alertas };
    },
    async contas(q = {}) { return copia(contasDoFiltro(q)).map((c) => Object.assign({ ativo: true }, c)); },
    async incidentes(q = {}) {
      const ids = contasDoFiltro(q).map((c) => c.contaId);
      const desde = q.desde ? new Date(q.desde).getTime() : null;
      let l = incidentes.filter((i) => ids.includes(i.contaId) && (!q.tipo || i.tipo === q.tipo) && (!q.status || i.status === q.status) && (!q.severidade || i.severidade === q.severidade)
        && (!desde || new Date(i.ultimaOcorrencia).getTime() >= desde)
        && (!q.busca || (i.chave + " " + i.titulo).toLowerCase().includes(String(q.busca).toLowerCase())));
      l = l.sort((a, b) => ordem[a.severidade] - ordem[b.severidade] || (b.impacto.valor || 0) - (a.impacto.valor || 0));
      const limit = Number(q.limit) || 50, offset = Number(q.offset) || 0;
      return { itens: l.slice(offset, offset + limit).map(publico), total: l.length, limit, offset };
    },
    async incidente(id) {
      const i = incidentes.find((x) => x.id === Number(id));
      if (!i) throw err(404, "INCIDENTE_NAO_ENCONTRADO", "Incidente não encontrado.");
      return Object.assign(publico(i), { eventos: copia(eventos[i.id]), pedidos: copia(i._pedidos) });
    },
    async reconhecer(id) {
      const i = incidentes.find((x) => x.id === Number(id));
      if (!i) throw err(404, "INCIDENTE_NAO_ENCONTRADO", "Incidente não encontrado.");
      if (i.status === "resolvido") throw err(409, "TRANSICAO_INVALIDA", "Incidente resolvido não pode ser reconhecido.");
      const antes = i.status; i.status = "reconhecido"; i.reconhecido = { em: iso(0), por: "Você (demo)" };
      eventos[i.id].push({ id: Date.now(), evento: "reconhecido", ator: "Você (demo)", statusAntes: antes, statusDepois: "reconhecido", dados: {}, criadoEm: iso(0) });
      return publico(i);
    },
    async resolver(id, body) {
      const i = incidentes.find((x) => x.id === Number(id));
      if (!i) throw err(404, "INCIDENTE_NAO_ENCONTRADO", "Incidente não encontrado.");
      if (!body || !String(body.motivo || "").trim()) throw err(400, "MOTIVO_OBRIGATORIO", "Informe o motivo da resolução.");
      if (i.status === "resolvido") throw err(409, "TRANSICAO_INVALIDA", "Incidente já resolvido.");
      const antes = i.status; i.status = "resolvido"; i.resolvido = { em: iso(0), por: "Você (demo)", motivo: body.motivo, observacao: body.observacao || null };
      eventos[i.id].push({ id: Date.now(), evento: "resolvido", ator: "Você (demo)", statusAntes: antes, statusDepois: "resolvido", dados: { motivo: body.motivo }, criadoEm: iso(0) });
      return publico(i);
    },
  };

  root.SENTINEL_MOCK = { api };
})(typeof window !== "undefined" ? window : globalThis);
