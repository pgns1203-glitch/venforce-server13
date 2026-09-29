// server/services/painelContas/painelContasService.js
// Orquestrador do Painel de Contas (Auditoria §13) — versão operacional.
//
// `resolvePortfolioClientes`/`assertClienteNaCarteira` são SEMPRE o primeiro
// passo — squad/busca/status/marketplace/legado são filtros aplicados DEPOIS,
// sobre o conjunto já autorizado pelo servidor. Filtro enviado pelo frontend é
// preferência de exibição, nunca fonte de autorização (Auditoria §15).
//
// ── Contrato da competência ────────────────────────────────────────────────
// A lista representa EXATAMENTE uma competência (YYYY-MM; padrão = mês
// corrente em America/Sao_Paulo). Cliente sem dado nela aparece como "sem
// dados" — nunca com o último mês disponível no lugar. O último mês com
// snapshot só sai como informação explícita (`ultimaCompetenciaComDado`).
//
// ── Performance ────────────────────────────────────────────────────────────
// Número FIXO de queries em lote, independente do número de clientes; nenhuma
// chamada a API externa (Orders/Ads) — só dado persistido.

const pool = require("../../config/database");
const { resolvePortfolioClientes, assertClienteNaCarteira } = require("../squads/authorizationService");
const squadsRepo = require("../squads/squadsRepository");
const cliente360Repo = require("../cliente360/cliente360Repository");
const { selecionarMelhorImportPorCompetencia } = require("../centralVendas/centralVendasRepository");
const repo = require("./painelContasRepository");
const { deriveResumo } = require("./painelContasMetricas");
const { variacaoResumo, sanitizarParaJson } = require("./painelContasVariacao");
const { DEFINICAO: DEFINICAO_SEMANA, agruparEmSemanas } = require("./painelContasSemanas");
const { resolverContas, consolidarCliente, ehSquadLegado, rotuloMarketplace } = require("./painelContasOperacional");
const { validarLancamento, competenciaValida } = require("./painelContasManual");
const atualizacao = require("./painelContasAtualizacao");

const TIMEZONE = "America/Sao_Paulo";
const FILTROS_STATUS = new Set(["todos", "com_dados", "sem_dados", "parcial", "manual", "automatico", "atencao"]);
// Mesmo conjunto de requireAutomacoesAccess — o gate das rotas deste painel e
// de PUT /ads/resumo-mensal (o outro lançamento gerencial manual do projeto).
const PAPEIS_LANCAMENTO_MANUAL = new Set(["admin", "user", "membro"]);

function erro(statusCode, code, mensagem) {
  const e = new Error(mensagem);
  e.statusCode = statusCode;
  e.code = code;
  return e;
}

function anoAtualUTC() {
  return new Date().getUTCFullYear();
}

function anoValido(ano) {
  const n = Number(ano);
  return Number.isInteger(n) && n > 2000 && n < 2100 ? n : null;
}

function normalizarBusca(valor) {
  return String(valor || "").trim().toLowerCase();
}

function flag(valor) {
  return valor === true || valor === "true" || valor === "1";
}

function competenciaAtual(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit" }).formatToParts(agora);
  const ano = partes.find((p) => p.type === "year").value;
  const mes = partes.find((p) => p.type === "month").value;
  return `${ano}-${mes}`;
}

function limitesDaCompetencia(competencia) {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { inicio: `${competencia}-01`, fim: `${competencia}-${String(ultimo).padStart(2, "0")}` };
}

function competenciaAnterior(competencia) {
  const [ano, mes] = String(competencia).split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function podeLancar(user) {
  return PAPEIS_LANCAMENTO_MANUAL.has(String(user?.role || "").toLowerCase());
}

function agruparPor(lista, chave) {
  const mapa = new Map();
  for (const item of lista) {
    const k = Number(item[chave]);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(item);
  }
  return mapa;
}

// Um import por conta com a MESMA regra M4 da Central de Vendas
// (published com cobertura > legacy). O segmento exigido é o dia 1 da
// competência: a Central publica o mês corrente até ontem, e "dados até" deixa
// claro onde a cobertura termina.
function escolherImportPorConta(importRows, competencia) {
  const { inicio } = limitesDaCompetencia(competencia);
  const escolhido = new Map();
  for (const [contaId, rows] of agruparPor(importRows, "cliente_conta_id")) {
    const imp = selecionarMelhorImportPorCompetencia(rows, { segmentStart: inicio, segmentEnd: inicio });
    if (imp) escolhido.set(contaId, imp);
  }
  return escolhido;
}

function contaPublica(conta, permitido) {
  const { baseMc, ...resto } = conta;
  return { ...resto, podeLancarManual: permitido && conta.podeLancarManual };
}

function passaFiltroStatus(cliente, status) {
  if (!status || status === "todos") return true;
  const codigo = cliente.status.codigo;
  const fonte = cliente.fonte?.tipo || null;
  if (status === "com_dados") return codigo === "sincronizado" || codigo === "manual";
  if (status === "sem_dados") return codigo === "sem_dados" || codigo === "sem_conta";
  if (status === "parcial") return codigo === "parcial";
  if (status === "manual") return fonte === "manual" || fonte === "misto";
  if (status === "automatico") return Boolean(cliente.resumo) && fonte === "api";
  if (status === "atencao") return cliente.status.precisaAtencao === true;
  return true;
}

function resumirCarteira(clientes, legadoOcultos) {
  const conta = (fn) => clientes.filter(fn).length;
  return {
    operacionais: clientes.length,
    comDados: conta((c) => passaFiltroStatus(c, "com_dados")),
    semDados: conta((c) => passaFiltroStatus(c, "sem_dados")),
    parciais: conta((c) => passaFiltroStatus(c, "parcial")),
    manuais: conta((c) => passaFiltroStatus(c, "manual")),
    automaticos: conta((c) => passaFiltroStatus(c, "automatico")),
    atencao: conta((c) => passaFiltroStatus(c, "atencao")),
    legadoOcultos,
  };
}

// GET /painel-contas?competencia=&squadId=&busca=&status=&marketplace=&mostrarLegado=
async function listar(user, filtros = {}, { agora = new Date() } = {}) {
  const atual = competenciaAtual(agora);
  const competencia = filtros.competencia ? String(filtros.competencia) : atual;
  if (!competenciaValida(competencia)) throw erro(400, "COMPETENCIA_INVALIDA", "competencia inválida (esperado YYYY-MM).");
  const status = filtros.status ? String(filtros.status) : "todos";
  if (!FILTROS_STATUS.has(status)) throw erro(400, "STATUS_INVALIDO", "Filtro de status inválido.");
  const mostrarLegado = flag(filtros.mostrarLegado);
  const squadIdNum = filtros.squadId != null && filtros.squadId !== "" ? Number(filtros.squadId) : null;
  const buscaNorm = normalizarBusca(filtros.busca);
  const marketplace = filtros.marketplace ? String(filtros.marketplace).toLowerCase() : null;
  const permitido = podeLancar(user);
  const podeAtualizar = atualizacao.ehAdmin(user);

  const autorizados = await resolvePortfolioClientes(user, pool);
  await squadsRepo.ensureSquadsTables();
  const [squadsUsuario, squadPorCliente] = await Promise.all([
    squadsRepo.membershipsDoUsuario(user.id),
    squadsRepo.squadsAtivosDeClientes(autorizados.map((c) => c.id)),
  ]);
  const squadDoCliente = new Map(squadPorCliente.map((r) => [r.cliente_id, {
    id: r.squad_id, nome: r.squad_nome, slug: r.squad_slug,
  }]));

  const casaBusca = (c) => !buscaNorm || `${c.nome || ""} ${c.slug || ""}`.toLowerCase().includes(buscaNorm);
  const casaSquad = (c) => squadIdNum == null || squadDoCliente.get(c.id)?.id === squadIdNum;
  const ehLegado = (c) => ehSquadLegado(squadDoCliente.get(c.id));

  // Legado fica fora por padrão (lista, contagens e opções de squad), mas a
  // quantidade escondida é informada — nada some sem aviso.
  const visiveisPorLegado = autorizados.filter((c) => mostrarLegado || !ehLegado(c));
  const legadoOcultos = mostrarLegado ? 0 : autorizados.filter((c) => ehLegado(c) && casaSquad(c) && casaBusca(c)).length;
  const escopo = visiveisPorLegado.filter((c) => casaSquad(c) && casaBusca(c));
  const ids = escopo.map((c) => c.id);

  const squadsDisponiveis = [...new Map(
    visiveisPorLegado.map((c) => squadDoCliente.get(c.id)).filter(Boolean).map((s) => [s.id, s])
  ).values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR", { numeric: true }));

  await repo.ensurePainelContasTables();
  const [contasRows, snapshots, ultimas, adsRows] = await Promise.all([
    repo.listarContasDeClientes(ids),
    repo.listarResumosDaCompetencia(ids, competencia),
    repo.listarUltimaCompetenciaComDado(ids),
    repo.listarAdsDaCompetencia(escopo.map((c) => c.slug), competencia),
  ]);
  const contaIds = contasRows.map((r) => Number(r.id));
  const [importRows, runRows, manualRows] = await Promise.all([
    repo.listarImportsDaCompetencia(contaIds, competencia),
    repo.listarUltimoRunPorConta(contaIds, limitesDaCompetencia(competencia)),
    repo.listarManuaisDaCompetencia(contaIds, competencia),
  ]);

  const contasPorCliente = agruparPor(contasRows, "cliente_id");
  const snapshotPorCliente = new Map(snapshots.map((s) => [s.clienteId, s]));
  const ultimaPorCliente = new Map(ultimas.map((u) => [u.clienteId, u.competencia]));
  const adsPorSlug = new Map(adsRows.map((a) => [a.cliente_slug, {
    investimentoAds: a.investimento_ads, gmvAds: a.gmv_ads,
    atualizadoEm: a.updated_at instanceof Date ? a.updated_at.toISOString() : a.updated_at,
  }]));
  const fontes = {
    importPorConta: escolherImportPorConta(importRows, competencia),
    manualPorConta: new Map(manualRows.map((m) => [Number(m.cliente_conta_id), m])),
    runPorConta: new Map(runRows.map((r) => [Number(r.cliente_conta_id), r])),
  };

  const marketplacesDisponiveis = [...new Set(contasRows.filter((r) => r.ativo !== false).map((r) => String(r.marketplace).toLowerCase()))]
    .sort()
    .map((codigo) => ({ codigo, rotulo: rotuloMarketplace(codigo) }));

  const todos = escopo.map((c) => {
    const contas = resolverContas(contasPorCliente.get(c.id) || [], fontes);
    const consolidado = consolidarCliente({
      contas,
      snapshot: snapshotPorCliente.get(c.id) || null,
      adsCliente: adsPorSlug.get(c.slug) || null,
    });
    const squad = squadDoCliente.get(c.id) || null;
    return {
      id: c.id,
      slug: c.slug,
      nome: c.nome,
      squad,
      legado: ehSquadLegado(squad),
      competencia,
      ...consolidado,
      ultimaCompetenciaComDado: ultimaPorCliente.get(c.id) || null,
      contas: contas.map((conta) => contaPublica(conta, permitido)),
      podeLancarManual: permitido && contas.some((conta) => conta.podeLancarManual),
      // Atualização sob demanda em curso (ou recém-terminada) deste cliente
      // nesta competência — lida do registro em memória, sem query. Deixa a
      // tela retomar o progresso depois de um F5.
      atualizacao: podeAtualizar ? atualizacao.atualizacaoDoCliente(c.id, competencia, { agoraMs: agora.getTime() }) : null,
    };
  });

  const noMarketplace = marketplace
    ? todos.filter((c) => c.contas.some((conta) => conta.ativa && conta.marketplace === marketplace))
    : todos;

  return sanitizarParaJson({
    ok: true,
    competencia,
    competenciaAtual: atual,
    squadsDoUsuario: squadsUsuario.map((s) => ({
      id: s.squad_id, nome: s.squad_nome, slug: s.squad_slug, principal: s.is_primary === true,
    })),
    squadsDisponiveis,
    marketplacesDisponiveis,
    // atualizarDados = mesmo gate do sync manual da Central (admin).
    permissoes: { lancarManual: permitido, atualizarDados: podeAtualizar },
    resumoCarteira: resumirCarteira(noMarketplace, legadoOcultos),
    clientes: noMarketplace.filter((c) => passaFiltroStatus(c, status)),
  });
}

// GET /painel-contas/:clienteId/meses?ano= (§13/§25) — histórico CONSOLIDADO
// do cliente (snapshot mensal), aberto sob demanda.
async function listarMeses(user, clienteRef, { ano } = {}) {
  const cliente = await assertClienteNaCarteira(user, clienteRef, pool);
  const anoNum = anoValido(ano) || anoAtualUTC();
  const linhas = await repo.listarResumosDoAno(cliente.id, cliente.slug, anoNum);

  const meses = linhas.map((row, idx) => {
    const atual = deriveResumo(row);
    const anteriorRow = linhas[idx - 1];
    // Variação só contra o mês CALENDÁRIO imediatamente anterior, e só se ele
    // estiver presente no conjunto retornado — nunca contra uma competência
    // não-adjacente nem inventada.
    const anteriorEsperado = competenciaAnterior(row.competencia);
    const anterior = anteriorRow && anteriorRow.competencia === anteriorEsperado
      ? deriveResumo(anteriorRow)
      : null;
    return {
      competencia: row.competencia,
      sincronizadoEm: row.sincronizadoEm,
      resumo: atual,
      variacaoVsMesAnterior: variacaoResumo(anterior, atual),
    };
  });

  return sanitizarParaJson({
    ok: true,
    cliente: { id: cliente.id, slug: cliente.slug, nome: cliente.nome },
    meses,
  });
}

// GET /painel-contas/:clienteId/meses/:competencia/semanas (§11/§13/§25).
async function listarSemanas(user, clienteRef, competencia) {
  const cliente = await assertClienteNaCarteira(user, clienteRef, pool);
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
    throw erro(400, "COMPETENCIA_INVALIDA", "competencia inválida (esperado YYYY-MM).");
  }
  const row = await cliente360Repo.findResumoMensal(cliente.id, competencia);
  const porDia = row?.payload_json?.porDia || null;
  const semanas = agruparEmSemanas(competencia, porDia);

  return sanitizarParaJson({
    ok: true,
    competencia,
    definicaoSemana: DEFINICAO_SEMANA,
    semanas,
  });
}

// ─── Lançamento manual ────────────────────────────────────────────────────────

// Guardas comuns a salvar/remover: papel → competência → carteira → a conta
// pertence ao cliente do path. A conta NUNCA é resolvida sem o cliente — um
// contaId de outro cliente no path vira 404, não um lançamento no lugar errado.
async function resolverContaParaLancamento(user, clienteRef, contaIdRaw, competencia, agora) {
  if (!podeLancar(user)) throw erro(403, "SEM_PERMISSAO", "Seu papel não permite lançar dados manuais.");
  if (!competenciaValida(competencia)) throw erro(400, "COMPETENCIA_INVALIDA", "competencia inválida (esperado YYYY-MM).");
  if (competencia > competenciaAtual(agora)) throw erro(400, "COMPETENCIA_FUTURA", "Não é possível lançar dados de uma competência futura.");
  const cliente = await assertClienteNaCarteira(user, clienteRef, pool);
  const contaId = Number(contaIdRaw);
  const conta = Number.isInteger(contaId) && contaId > 0 ? await repo.obterContaDoCliente(contaId, cliente.id) : null;
  if (!conta) throw erro(404, "CONTA_NAO_ENCONTRADA", "Conta não encontrada neste cliente.");
  return { cliente, conta };
}

// PUT /painel-contas/:clienteId/contas/:contaId/manual/:competencia
async function salvarLancamentoManual(user, clienteRef, contaIdRaw, competencia, body = {}, { agora = new Date() } = {}) {
  const { cliente, conta } = await resolverContaParaLancamento(user, clienteRef, contaIdRaw, competencia, agora);
  if (conta.ativo === false) throw erro(409, "CONTA_INATIVA", "Conta inativa: reative a conta antes de lançar dados.");

  const validacao = validarLancamento(body);
  if (!validacao.ok) throw erro(422, validacao.codigo, validacao.mensagem);

  // Automático disponível vence: gravar um manual que nunca seria exibido só
  // esconderia a divergência. Mesma seleção de import da lista.
  const imports = await repo.listarImportsDaCompetencia([Number(conta.id)], competencia);
  if (escolherImportPorConta(imports, competencia).size > 0) {
    throw erro(409, "AUTOMATICO_DISPONIVEL", "Esta conta já tem dado automático publicado nesta competência.");
  }

  await repo.ensurePainelContasTables();
  const row = await repo.salvarLancamentoManual({
    clienteId: cliente.id,
    contaId: Number(conta.id),
    competencia,
    valores: validacao.valores,
    userId: user.id ?? null,
  });
  const [view] = resolverContas([conta], {
    manualPorConta: new Map([[Number(conta.id), { ...row, updated_by_nome: user.nome || null }]]),
  });
  return sanitizarParaJson({ ok: true, competencia, derivados: validacao.derivados, conta: contaPublica(view, true) });
}

// DELETE /painel-contas/:clienteId/contas/:contaId/manual/:competencia
async function removerLancamentoManual(user, clienteRef, contaIdRaw, competencia, { agora = new Date() } = {}) {
  const { cliente, conta } = await resolverContaParaLancamento(user, clienteRef, contaIdRaw, competencia, agora);
  await repo.ensurePainelContasTables();
  const removido = await repo.removerLancamentoManual({
    clienteId: cliente.id, contaId: Number(conta.id), competencia, userId: user.id ?? null,
  });
  if (!removido) throw erro(404, "LANCAMENTO_NAO_ENCONTRADO", "Não há lançamento manual desta conta nesta competência.");
  const [view] = resolverContas([conta]);
  return sanitizarParaJson({ ok: true, competencia, removido: true, conta: contaPublica(view, true) });
}

module.exports = {
  listar,
  listarMeses,
  listarSemanas,
  salvarLancamentoManual,
  removerLancamentoManual,
  competenciaAtual,
};
