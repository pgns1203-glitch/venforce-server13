// server/services/motorMargem/precificacao/precificacaoService.js
// Camada SEGURA de precificação da Central de Margem.
//
//   Central → simular (ao vivo, sem persistir)
//           → preview (recalcula no backend + gates, persiste a intenção)
//           → confirmação humana
//           → aplicar: rollout → idempotência → claim (1 por item) →
//             REAVALIA TUDO ao vivo → serviço de escrita já existente →
//             Mercado Livre → auditoria → activity log → refresh do snapshot
//
// Não chama o endpoint de /anuncios: usa os MESMOS serviços que ele usa
// (meliPrecoService / meliPromocoesEscritaService), com as proteções que
// faltavam lá (conta explícita, compare-and-set, gates financeiros,
// idempotência, concorrência e trilha auditável). /anuncios não muda.

const avaliacao = require("./precificacaoAvaliacao");
const { escritaHabilitada, resolvePricingConfig } = require("./precificacaoConfig");

const { erroHttp, validarPreco, mesmoPreco } = avaliacao;

// Códigos de recusa ANTES de qualquer escrita (bloqueios do próprio serviço
// de escrita ou da releitura) — viram `recusado`, não `falhou`.
const CODIGOS_RECUSA_SERVICO = new Set([
  "PRECO_ITEM_COM_VARIACAO",
  "PRECO_ITEM_COM_PROMOCAO",
  "PRECO_INVALIDO",
  "PRECO_AUSENTE",
  "TIPO_SEM_ESCRITA",
  "PROMOCAO_NAO_ENCONTRADA",
  "PROMOCAO_NAO_APLICADA",
]);

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,100}$/;

function defaults(deps = {}) {
  return {
    repo: deps.repo || require("./precificacaoRepository"),
    atualizarPreco: deps.atualizarPreco || require("../../meliAnuncios/meliPrecoService").atualizarPreco,
    aplicarPromocao: deps.aplicarPromocao || require("../../meliAnuncios/meliPromocoesEscritaService").aplicarPromocao,
    atualizarCamposConfirmados:
      deps.atualizarCamposConfirmados || require("../../meliAnuncios/meliAnunciosService").atualizarCamposConfirmados,
    registrarLog: deps.registrarLog || require("../../activityLogService").registrarLog,
    atualizarSnapshotDoItem: deps.atualizarSnapshotDoItem || require("./precificacaoSnapshotItem").atualizarSnapshotDoItem,
    resolverContaDoCliente: deps.resolverContaDoCliente || require("../marginSnapshotApiService").resolverContaDoCliente,
    listarPromocoesDoItem:
      deps.listarPromocoesDoItem || require("../../meliAnuncios/meliPromocoesService").listarPromocoesDoItem,
    agendar: deps.agendar || ((fn, ms) => setTimeout(fn, ms)),
    env: deps.env || process.env,
    now: deps.now || (() => new Date()),
  };
}

// ---------------------------------------------------------------------------
// Cache curto do contexto — SÓ para a simulação durante a digitação e para a
// lista de promoções. Preview e aplicar sempre releem ao vivo.
// ---------------------------------------------------------------------------
const cacheContexto = new Map();

function chaveCache(clienteSlug, clienteContaId, itemId) {
  return `${String(clienteSlug).toLowerCase()}::${clienteContaId}::${String(itemId).toUpperCase()}`;
}

function contextoComCache(params, deps, ttlMs) {
  if (!ttlMs) return avaliacao.carregarContexto(params, deps);
  const chave = chaveCache(params.clienteSlug, params.clienteContaId, params.itemId);
  const agora = Date.now();
  const hit = cacheContexto.get(chave);
  if (hit && hit.expira > agora) return hit.promessa;
  const promessa = avaliacao.carregarContexto(params, deps);
  cacheContexto.set(chave, { expira: agora + ttlMs, promessa });
  // Erro não fica em cache.
  promessa.catch(() => cacheContexto.delete(chave));
  return promessa;
}

function invalidarCache(clienteSlug, clienteContaId, itemId) {
  cacheContexto.delete(chaveCache(clienteSlug, clienteContaId, itemId));
}

// ---------------------------------------------------------------------------

function tipoValido(tipo) {
  const t = String(tipo || "PRICE").toUpperCase();
  if (t !== "PRICE" && t !== "PROMOTION") throw erroHttp(400, "TIPO_INVALIDO", "tipo deve ser PRICE ou PROMOTION.");
  return t;
}

async function promocaoAoVivo(base, promotionId, d) {
  const lista = await d.listarPromocoesDoItem({
    clienteId: base.cliente.id,
    itemId: base.anuncio.itemId,
    mlUserId: base.conta.mlUserId,
  });
  const promo = (lista || []).find((p) => String(p.id) === String(promotionId)) || null;
  return { promo, lista: lista || [] };
}

/** Avaliação completa (contexto + promoção + recotação + gates). */
async function avaliarCompleto({ base, tipo, novoPreco, precoVisto, promotionId }, deps, d) {
  let promo = null;
  let encontrada = true;
  if (tipo === "PROMOTION") {
    if (!promotionId) throw erroHttp(400, "PROMOTION_ID_AUSENTE", "Informe a promoção.");
    if (base.contaCorreta && base.motor) {
      const r = await promocaoAoVivo(base, promotionId, d);
      promo = r.promo;
      encontrada = Boolean(promo);
    }
  }
  let preco = novoPreco;
  if (tipo === "PROMOTION" && preco === null && promo && promo.precoFinal !== null && promo.precoFinal !== undefined) {
    preco = Math.round((Number(promo.precoFinal) + Number.EPSILON) * 100) / 100;
  }
  const recote = base.contaCorreta && base.motor && preco !== null
    ? await avaliacao.recotar(base, preco, deps)
    : { comissao: null, comissaoFonte: "indisponivel", frete: null, freteFonte: "indisponivel" };
  const resultado = avaliacao.avaliar(
    { base, tipo, novoPreco: preco, precoVisto, recote, promocao: promo, promocaoEncontrada: encontrada },
    deps
  );
  return { resultado, preco, promo };
}

function publicoAvaliacao(base, resultado, { tipo, clienteSlug, env }) {
  return {
    ok: true,
    tipo,
    item: {
      itemId: base.anuncio.itemId,
      titulo: base.anuncio.titulo,
      sku: base.anuncio.sku,
      statusAnuncio: base.anuncio.status,
    },
    conta: { id: base.conta.id, nome: base.conta.nome, mlUserId: base.conta.mlUserId },
    atual: resultado.atual,
    proposta: resultado.proposta,
    insumos: resultado.insumos || null,
    vendas: resultado.vendas || null,
    promocao: resultado.promocao,
    gates: resultado.gates,
    bloqueado: resultado.bloqueado,
    escrita: escritaHabilitada({ clienteSlug }, env)
      ? { habilitada: true, motivo: null }
      : { habilitada: false, motivo: "Escrita no Mercado Livre desligada para este cliente (rollout). Simulação e preview seguem disponíveis." },
  };
}

/** Simulação AO VIVO para a digitação: nada é persistido, nada é escrito. */
async function simular(params = {}, deps = {}) {
  const d = defaults(deps);
  const config = resolvePricingConfig(d.env);
  const tipo = tipoValido(params.tipo);
  const v = validarPreco(params.novoPreco, { obrigatorio: tipo === "PRICE" });
  if (!v.ok) throw erroHttp(400, v.codigo, v.motivo);
  const visto = validarPreco(params.precoVisto, { campo: "precoVisto", obrigatorio: false });
  const base = await contextoComCache(
    { clienteSlug: params.clienteSlug, clienteContaId: params.clienteContaId, itemId: params.itemId },
    deps,
    config.simulacaoCacheMs
  );
  const { resultado } = await avaliarCompleto(
    { base, tipo, novoPreco: v.valor, precoVisto: visto.ok ? visto.valor : null, promotionId: params.promotionId },
    deps,
    d
  );
  return { ...publicoAvaliacao(base, resultado, { tipo, clienteSlug: base.cliente.slug, env: d.env }), simulado: true };
}

/** Preview confirmável: tudo relido ao vivo + intenção persistida (status preview). */
async function preview(params = {}, deps = {}) {
  const d = defaults(deps);
  const config = resolvePricingConfig(d.env);
  const tipo = tipoValido(params.tipo);
  const v = validarPreco(params.novoPreco, { obrigatorio: tipo === "PRICE" });
  if (!v.ok) throw erroHttp(400, v.codigo, v.motivo);
  const visto = validarPreco(params.precoVisto, { campo: "precoVisto", obrigatorio: true });
  if (!visto.ok) throw erroHttp(400, visto.codigo === "PRECO_AUSENTE" ? "PRECO_VISTO_AUSENTE" : visto.codigo, "Informe o preço que a tela mostrou (precoVisto).");

  const base = await avaliacao.carregarContexto(
    { clienteSlug: params.clienteSlug, clienteContaId: params.clienteContaId, itemId: params.itemId },
    deps
  );
  const { resultado, preco, promo } = await avaliarCompleto(
    { base, tipo, novoPreco: v.valor, precoVisto: visto.valor, promotionId: params.promotionId },
    deps,
    d
  );
  const publico = publicoAvaliacao(base, resultado, { tipo, clienteSlug: base.cliente.slug, env: d.env });
  if (preco === null) return { ...publico, preview: null };

  const user = params.user || {};
  const linha = await d.repo.inserirPreview(
    {
      clienteId: base.cliente.id,
      clienteSlug: base.cliente.slug,
      clienteContaId: base.conta.id,
      itemId: base.anuncio.itemId,
      titulo: base.anuncio.titulo,
      userId: user.id ?? null,
      userNome: user.nome || null,
      userEmail: user.email || null,
      tipoAcao: tipo,
      promotionId: tipo === "PROMOTION" ? String(params.promotionId) : null,
      promotionType: promo ? promo.tipo : null,
      promotionNome: promo ? promo.nome || promo.tipoLabel || null : null,
      promotionAcao: resultado.promocao && resultado.promocao.escrita ? resultado.promocao.escrita.acao : null,
      precoVisto: visto.valor,
      precoAnterior: resultado.atual ? resultado.atual.preco : null,
      precoSolicitado: preco,
      margemAntes: resultado.atual ? resultado.atual.margem : null,
      margemDepois: resultado.proposta ? resultado.proposta.margem : null,
      lucroAntes: resultado.atual ? resultado.atual.lucro : null,
      lucroDepois: resultado.proposta ? resultado.proposta.lucro : null,
      gates: resultado.gates,
      calculo: { atual: resultado.atual, proposta: resultado.proposta, insumos: resultado.insumos, promocao: resultado.promocao },
      ttlMinutes: config.previewTtlMinutes,
    },
    deps.db
  );
  return { ...publico, preview: { id: linha.id, expiraEm: linha.expiraEm } };
}

function aplicacaoPublica(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemId: row.itemId,
    titulo: row.titulo,
    tipoAcao: row.tipoAcao,
    promotionId: row.promotionId,
    promotionType: row.promotionType,
    promotionNome: row.promotionNome,
    promotionAcao: row.promotionAcao,
    status: row.status,
    precoVisto: row.precoVisto,
    precoAnterior: row.precoAnterior,
    precoSolicitado: row.precoSolicitado,
    precoConfirmado: row.precoConfirmado,
    margemAntes: row.margemAntes,
    margemDepois: row.margemDepois,
    lucroAntes: row.lucroAntes,
    lucroDepois: row.lucroDepois,
    gates: row.gates,
    erroCodigo: row.erroCodigo,
    erroMensagem: row.erroMensagem,
    mlStatus: row.mlStatus,
    snapshotStatus: row.snapshotStatus,
    snapshotAtualizadoEm: row.snapshotAtualizadoEm,
    usuario: { id: row.userId, nome: row.userNome, email: row.userEmail },
    criadoEm: row.criadoEm,
    aplicadoEm: row.aplicadoEm,
  };
}

function statusHttpDeCodigo(codigo) {
  const m = /^ML_HTTP_(\d{3})$/.exec(String(codigo || ""));
  return m ? Number(m[1]) : null;
}

function ehRateLimit(codigo) {
  return /too_many|rate_limit|ML_HTTP_429|ML_RATE_LIMIT/i.test(String(codigo || ""));
}

/** Aplica UM preview. Idempotente pela chave; nunca escreve com gate bloqueado. */
async function aplicar(params = {}, deps = {}) {
  const d = defaults(deps);
  const config = resolvePricingConfig(d.env);
  const idempotencyKey = String(params.idempotencyKey || "").trim();
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    throw erroHttp(400, "IDEMPOTENCY_KEY_INVALIDA", "Informe uma chave de idempotência (8 a 100 caracteres).");
  }
  const previewId = Number(params.previewId);
  if (!Number.isInteger(previewId) || previewId <= 0) throw erroHttp(400, "PREVIEW_ID_INVALIDO", "Informe o preview a aplicar.");

  const { cliente, conta } = await d.resolverContaDoCliente(
    { clienteSlug: params.clienteSlug, clienteContaId: params.clienteContaId },
    deps
  );

  // Replay: mesma chave → mesma resposta, nunca uma 2ª escrita.
  const existente = await d.repo.obterPorIdempotencia(idempotencyKey, deps.db);
  if (existente) {
    if (existente.id !== previewId || existente.clienteContaId !== Number(conta.id)) {
      throw erroHttp(409, "IDEMPOTENCY_KEY_EM_USO", "Esta chave de idempotência já foi usada em outra aplicação.");
    }
    return { ok: existente.status === "aplicado", replay: true, aplicacao: aplicacaoPublica(existente), codigo: existente.erroCodigo, motivo: existente.erroMensagem };
  }

  const linha = await d.repo.obterPorId({ id: previewId, clienteContaId: conta.id }, deps.db);
  if (!linha || linha.clienteId !== Number(cliente.id)) throw erroHttp(404, "PREVIEW_NAO_ENCONTRADO", "Preview não encontrado para esta conta.");
  // Rota por promoção (/promocoes/:promotionId/aplicar): o preview tem de ser
  // DESTA promoção — nunca aplicar a intenção de outra linha.
  if (params.promotionId !== undefined && params.promotionId !== null && String(linha.promotionId) !== String(params.promotionId)) {
    throw erroHttp(409, "PREVIEW_DE_OUTRA_PROMOCAO", "Este preview não pertence a esta promoção.");
  }
  if (linha.status !== "preview") {
    throw erroHttp(409, "PREVIEW_JA_UTILIZADO", "Este preview já foi usado. Gere um novo preview.", { aplicacao: aplicacaoPublica(linha) });
  }

  // Rollout: com a escrita desligada nada é tocado — nem a linha, nem o ML.
  if (!escritaHabilitada({ clienteSlug: cliente.slug }, d.env)) {
    throw erroHttp(403, "ESCRITA_DESABILITADA", "Escrita no Mercado Livre desligada para este cliente (rollout). Nenhuma alteração foi enviada.");
  }

  if (new Date(linha.expiraEm).getTime() <= d.now().getTime()) {
    const recusada = await d.repo.recusarPreview({ id: linha.id, clienteContaId: conta.id, erroCodigo: "PREVIEW_EXPIRADO", erroMensagem: "O preview expirou. Gere um novo preview." }, deps.db);
    throw erroHttp(409, "PREVIEW_EXPIRADO", "O preview expirou. Gere um novo preview.", { aplicacao: aplicacaoPublica(recusada) });
  }

  await d.repo.liberarAplicandoTravados({ clienteContaId: conta.id, itemId: linha.itemId, staleMinutes: config.aplicandoStaleMinutes }, deps.db);

  let claim;
  try {
    claim = await d.repo.reivindicar({ id: linha.id, clienteContaId: conta.id, idempotencyKey }, deps.db);
  } catch (err) {
    if (err && err.name === "PrecificacaoConflitoError") throw erroHttp(409, err.code, err.message);
    throw err;
  }
  if (!claim) {
    // Corrida: outro request com a MESMA chave pode ter vencido o claim.
    const venceu = await d.repo.obterPorIdempotencia(idempotencyKey, deps.db);
    if (venceu && venceu.id === linha.id) {
      return { ok: venceu.status === "aplicado", replay: true, aplicacao: aplicacaoPublica(venceu), codigo: venceu.erroCodigo, motivo: venceu.erroMensagem };
    }
    throw erroHttp(409, "PREVIEW_JA_UTILIZADO", "Este preview já foi usado ou expirou. Gere um novo preview.");
  }

  const user = params.user || {};
  const logBase = {
    userId: user.id ?? null,
    userEmail: user.email || null,
    userNome: user.nome || null,
    ip: params.ip || null,
    acao: claim.tipoAcao === "PROMOTION" ? "central_margem_promocao_aplicar" : "central_margem_preco_aplicar",
  };

  async function finalizar(status, extra) {
    const final = await d.repo.finalizar({ id: claim.id, status, ...extra }, deps.db);
    const row = final || claim;
    await d.registrarLog({
      ...logBase,
      status: status === "aplicado" ? "sucesso" : "erro",
      detalhes: {
        aplicacaoId: claim.id,
        cliente: cliente.slug,
        clienteContaId: Number(conta.id),
        itemId: claim.itemId,
        tipo: claim.tipoAcao,
        promotionId: claim.promotionId,
        status,
        precoVisto: claim.precoVisto,
        precoSolicitado: claim.precoSolicitado,
        precoConfirmado: extra.precoConfirmado ?? null,
        margemAntes: claim.margemAntes,
        margemDepois: extra.margemDepois ?? claim.margemDepois,
        erroCodigo: extra.erroCodigo || null,
      },
    });
    return row;
  }

  // ── Reavaliação AO VIVO: a UI não é autoridade ───────────────────────────
  let reavaliacao;
  try {
    const base = await avaliacao.carregarContexto(
      { clienteSlug: cliente.slug, clienteContaId: conta.id, itemId: claim.itemId },
      deps
    );
    const r = await avaliarCompleto(
      { base, tipo: claim.tipoAcao, novoPreco: claim.precoSolicitado, precoVisto: claim.precoVisto, promotionId: claim.promotionId },
      deps,
      d
    );
    reavaliacao = { base, ...r };
  } catch (err) {
    const codigo = err && err.code ? String(err.code) : "REAVALIACAO_FALHOU";
    const row = await finalizar(ehRateLimit(codigo) || (err && err.statusCode && err.statusCode < 500) ? "recusado" : "falhou", {
      erroCodigo: codigo,
      erroMensagem: (err && err.message) || "Não foi possível reavaliar a alteração ao vivo.",
      mlStatus: err && err.statusCode ? Number(err.statusCode) : null,
    });
    return { ok: false, codigo, motivo: row.erroMensagem, aplicacao: aplicacaoPublica(row) };
  }

  const { base, resultado } = reavaliacao;
  const calculo = { atual: resultado.atual, proposta: resultado.proposta, insumos: resultado.insumos, promocao: resultado.promocao };
  if (resultado.bloqueado) {
    const primeiro = resultado.gates.find((g) => g.tom === "block");
    const codigo = primeiro && primeiro.id === "preco_confirmado" ? "PRECO_ALTERADO" : `GATE_${String(primeiro ? primeiro.id : "BLOQUEADO").toUpperCase()}`;
    const row = await finalizar("recusado", {
      erroCodigo: codigo,
      erroMensagem: primeiro ? primeiro.titulo : "Alteração bloqueada pelos gates.",
      gates: resultado.gates,
      calculo,
    });
    return { ok: false, codigo, motivo: row.erroMensagem, gates: resultado.gates, aplicacao: aplicacaoPublica(row) };
  }

  // ── Escrita (serviços já existentes) ─────────────────────────────────────
  let escrita;
  try {
    escrita = claim.tipoAcao === "PROMOTION"
      ? await d.aplicarPromocao({
          clienteId: base.cliente.id,
          itemId: claim.itemId,
          mlUserId: base.conta.mlUserId,
          promotionId: claim.promotionId,
          precoNovo: claim.precoSolicitado,
        })
      : await d.atualizarPreco({
          clienteId: base.cliente.id,
          itemId: claim.itemId,
          novoPreco: claim.precoSolicitado,
          mlUserId: base.conta.mlUserId,
        });
  } catch (err) {
    // Exceção depois do claim: o ML pode ou não ter recebido — incerto.
    const row = await finalizar("falhou", {
      erroCodigo: "ESCRITA_EXCECAO",
      erroMensagem: "Falha inesperada durante a escrita. Confira o preço no anúncio antes de tentar de novo.",
      gates: resultado.gates,
      calculo,
    });
    return { ok: false, codigo: "ESCRITA_EXCECAO", motivo: row.erroMensagem, aplicacao: aplicacaoPublica(row) };
  }

  invalidarCache(cliente.slug, conta.id, claim.itemId);

  if (!escrita || !escrita.ok) {
    const codigo = (escrita && escrita.codigo) || "ESCRITA_FALHOU";
    const status = CODIGOS_RECUSA_SERVICO.has(codigo) || ehRateLimit(codigo) ? "recusado" : "falhou";
    const row = await finalizar(status, {
      erroCodigo: codigo,
      erroMensagem: (escrita && escrita.motivo) || "O Mercado Livre recusou a alteração.",
      mlStatus: statusHttpDeCodigo(codigo),
      respostaMl: { status: statusHttpDeCodigo(codigo), codigo, motivo: escrita && escrita.motivo },
      gates: resultado.gates,
      calculo,
    });
    return { ok: false, codigo, motivo: row.erroMensagem, aplicacao: aplicacaoPublica(row) };
  }

  const confirmado = claim.tipoAcao === "PROMOTION" ? escrita.precoConfirmado : escrita.preco;
  if (confirmado === null || confirmado === undefined || !Number.isFinite(Number(confirmado))) {
    // Nunca assumir o valor enviado: sem preço na resposta, o resultado é incerto.
    const row = await finalizar("falhou", {
      erroCodigo: claim.tipoAcao === "PROMOTION" ? "PROMOCAO_CONFIRMACAO_FALHOU" : "PRECO_CONFIRMACAO_FALHOU",
      erroMensagem: "O Mercado Livre respondeu sem o preço aplicado. A alteração pode ter ocorrido — confira o anúncio.",
      respostaMl: { status: 200, codigo: "SEM_PRECO_NA_RESPOSTA", metodo: escrita.metodo || null },
      gates: resultado.gates,
      calculo,
    });
    return { ok: false, codigo: row.erroCodigo, motivo: row.erroMensagem, aplicacao: aplicacaoPublica(row) };
  }

  const precoConfirmado = Math.round((Number(confirmado) + Number.EPSILON) * 100) / 100;
  const row = await finalizar("aplicado", {
    precoConfirmado,
    precoAnterior: resultado.atual.preco,
    margemDepois: resultado.proposta.margem,
    lucroDepois: resultado.proposta.lucro,
    mlStatus: 200,
    respostaMl: { status: 200, metodo: escrita.metodo || (claim.tipoAcao === "PRICE" ? "PUT" : null) },
    gates: resultado.gates,
    calculo,
  });

  // Mesmo espelho local que /anuncios mantém após o ML confirmar o preço base.
  if (claim.tipoAcao === "PRICE") {
    try {
      await d.atualizarCamposConfirmados(base.cliente.id, claim.itemId, { preco: precoConfirmado });
    } catch (_) {
      /* espelho local é best-effort: a verdade é o ML + a auditoria */
    }
  }

  // Pós-escrita: snapshot do ITEM (não do catálogo), em background.
  d.agendar(() => {
    Promise.resolve()
      .then(() => d.atualizarSnapshotDoItem(
        { clienteSlug: cliente.slug, clienteId: base.cliente.id, clienteContaId: base.conta.id, itemId: claim.itemId },
        deps
      ))
      .then((r) => d.repo.atualizarSnapshotStatus({ id: claim.id, status: r && r.ok ? "atualizado" : "falhou" }, deps.db))
      .catch(() => d.repo.atualizarSnapshotStatus({ id: claim.id, status: "falhou" }, deps.db).catch(() => {}));
  }, config.snapshotRefreshDelayMs);

  return {
    ok: true,
    aplicacao: aplicacaoPublica(row),
    divergente: !mesmoPreco(precoConfirmado, claim.precoSolicitado),
  };
}

async function obterAplicacao(params = {}, deps = {}) {
  const d = defaults(deps);
  const { conta } = await d.resolverContaDoCliente({ clienteSlug: params.clienteSlug, clienteContaId: params.clienteContaId }, deps);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw erroHttp(400, "APLICACAO_ID_INVALIDO", "Aplicação inválida.");
  const row = await d.repo.obterPorId({ id, clienteContaId: conta.id }, deps.db);
  if (!row) throw erroHttp(404, "APLICACAO_NAO_ENCONTRADA", "Aplicação não encontrada para esta conta.");
  return { ok: true, aplicacao: aplicacaoPublica(row) };
}

async function historico(params = {}, deps = {}) {
  const d = defaults(deps);
  const { conta } = await d.resolverContaDoCliente({ clienteSlug: params.clienteSlug, clienteContaId: params.clienteContaId }, deps);
  const itemId = String(params.itemId || "").trim().toUpperCase();
  if (!/^MLB\d+$/.test(itemId)) throw erroHttp(400, "ITEM_ID_INVALIDO", "Informe um anúncio (MLB) válido.");
  const linhas = await d.repo.listarHistorico({ clienteContaId: conta.id, itemId, limit: params.limit }, deps.db);
  return { ok: true, itemId, historico: linhas.map(aplicacaoPublica) };
}

// Teto de recotações por abertura de lista (cada uma = até 2 chamadas ao ML
// só deste item). Preços repetidos compartilham a mesma recotação.
const MAX_RECOTACOES_PROMOCOES = 6;

/**
 * Promoções do ITEM ABERTO com margem/LC em cada uma, recotando comissão e
 * frete no preço promocional (limiar de frete grátis e faixas de tarifa).
 */
async function promocoes(params = {}, deps = {}) {
  const d = defaults(deps);
  const config = resolvePricingConfig(d.env);
  const base = await contextoComCache(
    { clienteSlug: params.clienteSlug, clienteContaId: params.clienteContaId, itemId: params.itemId },
    deps,
    config.simulacaoCacheMs
  );
  const escrita = escritaHabilitada({ clienteSlug: base.cliente.slug }, d.env);
  if (!base.contaCorreta || !base.motor) {
    const r = avaliacao.avaliar({ base, tipo: "PRICE", novoPreco: null, precoVisto: null, recote: {} }, deps);
    return { ok: true, itemId: base.anuncio.itemId, contaCorreta: false, gates: r.gates, promocoes: [], escritaHabilitada: escrita };
  }
  const { lista } = await promocaoAoVivo(base, null, d);
  const recotes = new Map();
  const saida = [];
  for (const promo of lista) {
    const preco = promo.precoFinal !== null && promo.precoFinal !== undefined
      ? Math.round((Number(promo.precoFinal) + Number.EPSILON) * 100) / 100
      : null;
    let recote = { comissao: null, comissaoFonte: "indisponivel", frete: null, freteFonte: "indisponivel" };
    if (preco !== null) {
      const chave = preco.toFixed(2);
      if (!recotes.has(chave)) {
        recotes.set(
          chave,
          recotes.size < MAX_RECOTACOES_PROMOCOES || avaliacao.mesmoPreco(preco, base.motor.precoAtual)
            ? await avaliacao.recotar(base, preco, deps)
            : await avaliacao.recotar(base, preco, { ...deps, buscarComissaoEFrete: async () => ({ comissaoValor: null, fretePrevisto: null }) })
        );
      }
      recote = recotes.get(chave);
    }
    const r = avaliacao.avaliar({ base, tipo: "PROMOTION", novoPreco: preco, precoVisto: null, recote, promocao: promo }, deps);
    saida.push({
      ...r.promocao,
      precoFinal: preco,
      margem: r.proposta ? r.proposta.margem : null,
      lucro: r.proposta ? r.proposta.lucro : null,
      comissao: recote.comissao,
      comissaoFonte: recote.comissaoFonte,
      frete: recote.frete,
      freteFonte: recote.freteFonte,
      bloqueios: r.gates.filter((g) => g.tom === "block" && g.id !== "preco_confirmado").map((g) => g.titulo),
    });
  }
  const atual = avaliacao.avaliar(
    { base, tipo: "PRICE", novoPreco: base.motor.precoAtual, precoVisto: base.motor.precoAtual, recote: { comissao: base.motor.comissao, comissaoFonte: "motor", frete: base.motor.frete, freteFonte: "motor" } },
    deps
  ).atual;
  return {
    ok: true,
    itemId: base.anuncio.itemId,
    contaCorreta: true,
    atual,
    vendas: base.motor.vendas,
    promocoes: saida,
    escritaHabilitada: escrita,
  };
}

module.exports = {
  simular,
  preview,
  aplicar,
  obterAplicacao,
  historico,
  promocoes,
  aplicacaoPublica,
  invalidarCache,
  CODIGOS_RECUSA_SERVICO,
  _cacheContexto: cacheContexto,
};
