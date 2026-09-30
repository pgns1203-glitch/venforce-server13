// server/tests/helpers/margemPrecificacaoFakes.js
// Fakes da camada segura de precificação da Central de Margem: conta,
// Mercado Livre (item + cotação + promoções + escrita), Motor e um
// repositório em memória que reproduz a semântica do SQL real (índice único
// de idempotência, 1 'aplicando' por item, claim_token/lease/fencing,
// reconciliação de lease vencido, "escrita enviada depois do preview", fila
// durável do refresh). O SQL de verdade é provado em
// scripts/margemPrecificacaoSqlCheck.js (PGlite).
//
// Os escritores fake seguem o CONTRATO dos reais (meliPrecoService /
// meliPromocoesEscritaService com os parâmetros opt-in): precoEsperado é
// comparado com o preço vivo, antesDeEscrever roda antes do envio e pode
// barrá-lo, e só então o "envio ao ML" é registrado em chamadas.enviosMl.

function motorItem(o = {}) {
  const itemId = o.itemId || "MLB100";
  return {
    identity: { itemId, titulo: o.titulo || "Produto X", sku: o.sku || "SKU-1" },
    pricing: {
      current: { value: o.preco ?? 110.48 },
      list: { value: o.lista ?? null },
      promo: { value: o.promo ?? null },
    },
    costs: {
      cost: { projected: o.custo === null ? null : { value: o.custo ?? 50 } },
      taxRate: { projected: o.imposto === null ? null : { value: o.imposto ?? 0.1 } },
      fixedFee: { projected: { value: o.taxaFixa ?? 0 } },
    },
    marketplaceCosts: {
      commissionProjected: o.comissao === null ? null : { value: o.comissao ?? 13.26 },
      commissionRate: o.taxa === null ? null : { value: o.taxa ?? 0.12 },
      freightProjected: o.frete === null ? null : { value: o.frete ?? 20 },
    },
    margin: { target: { marginTarget: o.meta ?? 0.1, breakEvenPrice: o.breakEven ?? 89.66, price: o.precoAlvo ?? 102.56 } },
    quality: { status: o.status || "HEALTHY", confidence: o.confianca || "HIGH", hasConflict: o.conflito === true },
    sales: { unidades: 21, pedidos: 20, receita: 2333 },
  };
}

function promo(o = {}) {
  return {
    id: o.id || "P-DEAL-1",
    tipo: o.tipo || "DEAL",
    tipoLabel: o.tipoLabel || "Campanha tradicional",
    nome: o.nome || "Oferta X",
    status: o.status || "candidate",
    statusExibicao: o.statusExibicao || "ELEGÍVEL",
    inicio: o.inicio || "2026-10-01T00:00:00Z",
    fim: o.fim || "2026-10-10T00:00:00Z",
    precoOriginal: o.precoOriginal ?? 149.9,
    precoFinal: o.precoFinal === undefined ? 129.9 : o.precoFinal,
    descontoReais: o.descontoReais ?? 20,
    descontoPercentual: o.descontoPercentual ?? 13.34,
    meliPercentage: o.meliPercentage === undefined ? 3.47 : o.meliPercentage,
    sellerPercentage: o.sellerPercentage === undefined ? 9.87 : o.sellerPercentage,
    subsidioMl: o.subsidioMl === undefined ? 5.2 : o.subsidioMl,
    editavelPrecoFinal: true,
  };
}

const TIPOS_COM_ESCRITA = new Set(["DEAL", "SELLER_CAMPAIGN"]);

/**
 * Cenário configurável. `estado` é mutável pelo teste entre preview e
 * aplicar (ex.: o preço muda no ML, a promoção some).
 *   estado.mlAplica       true → um envio aceito muda o preço vivo (ML real)
 *   estado.aoEnviar(p)    substitui a resposta do "ML" no momento do envio
 *   estado.antesDoEnvio   hook de teste chamado antes do gancho da Central
 *   estado.antesDaReleituraDoEscritor  muda o "ML" entre a reavaliação do
 *                         service e a releitura feita pelo próprio escritor
 */
function criarCenario(overrides = {}) {
  const estado = {
    contaId: 7,
    clienteId: 3,
    clienteSlug: "loja-a",
    mlUserId: "555",
    sellerIdDoItem: "555",
    temVariacao: false,
    itemHttpStatus: 200,
    motor: motorItem(),
    promocoes: [promo()],
    cotacao: (preco) => ({ comissaoValor: Math.round(preco * 0.12 * 100) / 100, fretePrevisto: preco >= 79 ? 20 : 6.5 }),
    grantOk: true,
    mlAplica: false,
    ...overrides,
  };
  const chamadas = {
    mlFetch: [], montarItens: 0, cotacao: [], promocoes: 0, atualizarPreco: [], aplicarPromocao: [],
    enviosMl: [], leiturasPreco: 0, logs: [], camposConfirmados: [], snapshot: [],
  };
  let tokens = 0;

  const precoVivo = () => (estado.precoVivo !== undefined ? estado.precoVivo : estado.motor.pricing.current.value);

  const deps = {
    resolverContaDoCliente: async ({ clienteSlug, clienteContaId }) => {
      if (String(clienteContaId) !== String(estado.contaId)) {
        const err = new Error("Esta conta não pertence ao cliente informado.");
        err.statusCode = 403;
        err.payload = { ok: false, codigo: "CONTA_NAO_PERTENCE_AO_CLIENTE", erro: err.message };
        throw err;
      }
      return { cliente: { id: estado.clienteId, slug: clienteSlug, nome: "Loja A" }, conta: { id: estado.contaId, nome: "Conta A" } };
    },
    resolveAccountContext: async () => {
      if (!estado.grantOk) {
        const err = new Error("grant");
        err.code = "ML_GRANT_UNUSABLE";
        throw err;
      }
      return { mlUserId: estado.mlUserId };
    },
    mlFetch: async (clienteId, path, opts = {}) => {
      chamadas.mlFetch.push({ clienteId, path, mlUserId: opts.mlUserId, method: opts.method || "GET", timeoutMs: opts.timeoutMs ?? null });
      if (estado.itemHttpStatus !== 200) return { ok: false, status: estado.itemHttpStatus, data: null, retryAfter: 3 };
      return {
        ok: true,
        status: 200,
        data: {
          id: estado.motor.identity.itemId,
          title: "Produto X",
          seller_id: Number(estado.sellerIdDoItem),
          status: "active",
          variations: estado.temVariacao ? [{ id: 1 }] : [],
          listing_type_id: "gold_special",
          category_id: "MLB1234",
          shipping: { logistic_type: estado.logistica ?? "cross_docking" },
          seller_custom_field: "SKU-1",
        },
      };
    },
    montarItens: async () => {
      chamadas.montarItens += 1;
      if (estado.montarItensHook) await estado.montarItensHook();
      return { itens: [estado.motor] };
    },
    buscarComissaoEFrete: async (p) => {
      chamadas.cotacao.push(p);
      return estado.cotacao(p.precoEfetivo);
    },
    listarPromocoesDoItem: async () => {
      chamadas.promocoes += 1;
      return estado.promocoes;
    },
    lerPrecoAtual: async () => {
      chamadas.leiturasPreco += 1;
      return { precoEfetivo: precoVivo(), precoPromocional: null, fonte: "sale_price" };
    },
    tiposComEscrita: TIPOS_COM_ESCRITA,
    atualizarPreco: async (p) => {
      chamadas.atualizarPreco.push(p);
      if (estado.antesDaReleituraDoEscritor) await estado.antesDaReleituraDoEscritor(p);
      if (p.precoEsperado !== null && p.precoEsperado !== undefined) {
        const atual = precoVivo();
        if (Math.abs(atual - Number(p.precoEsperado)) >= 0.005) {
          return { ok: false, codigo: "PRECO_ALTERADO", motivo: "Preço alterado desde o preview. Atualize e tente novamente.", precoAtual: atual };
        }
      }
      if (estado.antesDoEnvio) await estado.antesDoEnvio(p);
      let deadlineAt = null;
      if (p.antesDeEscrever) {
        const lib = await p.antesDeEscrever({ itemId: p.itemId });
        if (!lib || lib.ok !== true) return { ok: false, codigo: lib && lib.codigo, motivo: lib && lib.motivo };
        deadlineAt = lib.deadlineAt ?? null;
      }
      chamadas.enviosMl.push({ tipo: "PRICE", preco: p.novoPreco, deadlineAt, timeoutMs: p.timeoutMs ?? null });
      if (estado.aoEnviar) return estado.aoEnviar(p);
      const resposta = estado.respostaPreco ? await estado.respostaPreco(p) : { ok: true, preco: p.novoPreco, moeda: "BRL" };
      if (resposta && resposta.ok && estado.mlAplica) estado.motor.pricing.current.value = resposta.preco;
      return resposta;
    },
    aplicarPromocao: async (p) => {
      chamadas.aplicarPromocao.push(p);
      if (estado.antesDaReleituraDoEscritor) await estado.antesDaReleituraDoEscritor(p);
      const promoViva = (estado.promocoes || []).find((x) => String(x.id) === String(p.promotionId));
      if (!promoViva) return { ok: false, codigo: "PROMOCAO_NAO_ENCONTRADA", motivo: "sumiu" };
      if (!TIPOS_COM_ESCRITA.has(promoViva.tipo)) return { ok: false, codigo: "TIPO_SEM_ESCRITA", motivo: "x" };
      const podeAlterar = ["started", "active"].includes(promoViva.status) && promoViva.statusExibicao === "ATIVA";
      const podeParticipar = promoViva.status === "candidate";
      if (!podeAlterar && !podeParticipar) return { ok: false, codigo: "PROMOCAO_NAO_APLICADA", motivo: "x" };
      const metodo = podeAlterar ? "PUT" : "POST";
      if (estado.antesDoEnvio) await estado.antesDoEnvio(p);
      let deadlineAt = null;
      if (p.antesDeEscrever) {
        const lib = await p.antesDeEscrever({ promo: promoViva, metodo, acao: podeAlterar ? "ALTERAR" : "PARTICIPAR" });
        if (!lib || lib.ok !== true) return { ok: false, codigo: lib && lib.codigo, motivo: lib && lib.motivo };
        deadlineAt = lib.deadlineAt ?? null;
      }
      chamadas.enviosMl.push({ tipo: "PROMOTION", metodo, preco: p.precoNovo, deadlineAt, timeoutMs: p.timeoutMs ?? null });
      if (estado.aoEnviar) return estado.aoEnviar(p);
      return estado.respostaPromocao
        ? estado.respostaPromocao(p)
        : { ok: true, metodo, promotionId: p.promotionId, tipo: promoViva.tipo, precoConfirmado: p.precoNovo, precoOriginal: 149.9 };
    },
    atualizarCamposConfirmados: async (...args) => { chamadas.camposConfirmados.push(args); },
    registrarLog: async (l) => { chamadas.logs.push(l); },
    atualizarSnapshotDoItem: async (p) => {
      chamadas.snapshot.push(p);
      if (estado.respostaSnapshot) return estado.respostaSnapshot(p);
      const preco = precoVivo();
      if (p.precoEsperado !== null && p.precoEsperado !== undefined && Math.abs(preco - p.precoEsperado) >= 0.005) {
        return { ok: false, motivo: "PRECO_NAO_PROPAGADO", preco };
      }
      return { ok: true, preco };
    },
    agendar: (fn) => fn(),
    leituraSnapshotHabilitada: () => estado.snapshotLigado !== false,
    novoToken: () => `tok-${++tokens}`,
    env: { MARGIN_PRICING_SIMULACAO_CACHE_MS: "0", ...(overrides.env || {}) },
  };
  return { estado, chamadas, deps };
}

/**
 * Repositório em memória com a mesma semântica do SQL (índices únicos,
 * guardas de status, fencing por token, lease pelo relógio `agora`).
 */
function criarRepoMemoria({ agora = () => Date.now() } = {}) {
  const linhas = [];
  let seq = 0;
  const ms = (iso) => (iso ? new Date(iso).getTime() : null);
  const iso = (t) => new Date(t).toISOString();
  const clone = (r) => {
    if (!r) return null;
    const c = JSON.parse(JSON.stringify(r));
    c.leaseValida = r.leaseExpiraEm ? ms(r.leaseExpiraEm) > agora() : false;
    return c;
  };
  function conflito(code, message) {
    const err = new Error(message);
    err.name = "PrecificacaoConflitoError";
    err.code = code;
    return err;
  }
  function superado(row) {
    return linhas.some((o) => o.id !== row.id && o.clienteContaId === row.clienteContaId && o.itemId === row.itemId &&
      o.escritaEnviadaEm && ms(o.escritaEnviadaEm) >= ms(row.criadoEm));
  }
  const repo = {
    linhas,
    agora,
    async inserirPreview(d) {
      seq += 1;
      const row = {
        id: seq, clienteId: d.clienteId, clienteSlug: d.clienteSlug, clienteContaId: d.clienteContaId, marketplace: "meli",
        itemId: d.itemId, titulo: d.titulo, userId: d.userId ?? null, userNome: d.userNome, userEmail: d.userEmail,
        tipoAcao: d.tipoAcao, promotionId: d.promotionId, promotionType: d.promotionType, promotionNome: d.promotionNome,
        promotionAcao: d.promotionAcao, previewFingerprint: d.previewFingerprint || null, fingerprint: d.fingerprint || null,
        idempotencyKey: null, claimToken: null, leaseExpiraEm: null, heartbeatEm: null, escritaEnviadaEm: null, resultadoTardio: null,
        precoVisto: d.precoVisto, precoAnterior: d.precoAnterior,
        precoSolicitado: d.precoSolicitado, precoConfirmado: null, margemAntes: d.margemAntes, margemDepois: d.margemDepois,
        lucroAntes: d.lucroAntes, lucroDepois: d.lucroDepois, atencaoCodigo: null, gates: d.gates, calculo: d.calculo, status: "preview",
        mlStatus: null, erroCodigo: null, erroMensagem: null, respostaMl: null,
        snapshotStatus: null, snapshotAtualizadoEm: null, snapshotTentativas: 0, snapshotProximaEm: null, snapshotPrazoEm: null, snapshotPrecoObservado: null,
        expiraEm: iso(agora() + d.ttlMinutes * 60000), criadoEm: iso(agora()),
        aplicandoEm: null, aplicadoEm: null,
      };
      linhas.push(row);
      return clone(row);
    },
    async obterPorId({ id, clienteContaId }) {
      return clone(linhas.find((r) => r.id === Number(id) && r.clienteContaId === Number(clienteContaId)));
    },
    async obterPorIdempotencia(key) {
      return clone(linhas.find((r) => r.idempotencyKey === key));
    },
    async reconciliarLeasesVencidos({ clienteContaId = null, itemId = null, id = null, graceSeconds }) {
      const saida = [];
      for (const r of linhas) {
        if (r.status !== "aplicando" || !r.leaseExpiraEm) continue;
        if (!(ms(r.leaseExpiraEm) < agora() - graceSeconds * 1000)) continue;
        if (id !== null && r.id !== Number(id)) continue;
        if (clienteContaId !== null && r.clienteContaId !== Number(clienteContaId)) continue;
        if (itemId !== null && r.itemId !== String(itemId)) continue;
        const enviado = Boolean(r.escritaEnviadaEm);
        r.status = enviado ? "resultado_desconhecido" : "falhou";
        r.erroCodigo = enviado ? "RESULTADO_DESCONHECIDO" : "APLICACAO_INTERROMPIDA_SEM_ESCRITA";
        r.erroMensagem = enviado ? "interrompida depois do envio" : "interrompida antes do envio";
        saida.push(clone(r));
      }
      return saida;
    },
    async reivindicar({ id, clienteContaId, idempotencyKey, claimToken, leaseSeconds }) {
      const row = linhas.find((r) => r.id === Number(id) && r.clienteContaId === Number(clienteContaId));
      if (!row || row.status !== "preview" || ms(row.expiraEm) <= agora()) return null;
      if (superado(row)) throw conflito("PREVIEW_SUPERADO", "Outra alteração deste anúncio foi enviada depois deste preview.");
      if (linhas.some((r) => r.idempotencyKey === idempotencyKey && r.id !== row.id)) throw conflito("IDEMPOTENCY_KEY_EM_USO", "chave em uso");
      if (linhas.some((r) => r.status === "aplicando" && r.clienteContaId === row.clienteContaId && r.itemId === row.itemId)) {
        throw conflito("APLICACAO_EM_ANDAMENTO", "Outra alteração deste anúncio está sendo aplicada agora.");
      }
      Object.assign(row, {
        status: "aplicando", idempotencyKey, claimToken, leaseExpiraEm: iso(agora() + leaseSeconds * 1000),
        heartbeatEm: iso(agora()), aplicandoEm: iso(agora()),
      });
      return clone(row);
    },
    async renovarLease({ id, claimToken, leaseSeconds, marcarEnvio = false }) {
      const row = linhas.find((r) => r.id === id && r.claimToken === claimToken && r.status === "aplicando" && ms(r.leaseExpiraEm) > agora());
      if (!row) return null;
      row.leaseExpiraEm = iso(agora() + leaseSeconds * 1000);
      row.heartbeatEm = iso(agora());
      if (marcarEnvio) row.escritaEnviadaEm = iso(agora());
      return clone(row);
    },
    async recusarPreview({ id, clienteContaId, erroCodigo, erroMensagem }) {
      const row = linhas.find((r) => r.id === Number(id) && r.clienteContaId === Number(clienteContaId) && r.status === "preview");
      if (!row) return null;
      Object.assign(row, { status: "recusado", erroCodigo, erroMensagem });
      return clone(row);
    },
    async finalizar(p) {
      const row = linhas.find((r) => r.id === p.id && r.claimToken === p.claimToken && r.status === "aplicando");
      if (!row) return null;
      row.status = p.status;
      row.precoConfirmado = p.precoConfirmado ?? null;
      if (p.precoAnterior != null) row.precoAnterior = p.precoAnterior;
      if (p.financeiro) {
        row.margemDepois = p.financeiro.margemDepois ?? null;
        row.lucroDepois = p.financeiro.lucroDepois ?? null;
      }
      row.atencaoCodigo = p.atencaoCodigo ?? null;
      row.mlStatus = p.mlStatus ?? null;
      row.erroCodigo = p.erroCodigo ?? null;
      row.erroMensagem = p.erroMensagem ?? null;
      row.respostaMl = p.respostaMl ?? null;
      if (p.gates) row.gates = p.gates;
      if (p.calculo) row.calculo = p.calculo;
      if (p.status === "aplicado" || p.status === "divergente") {
        row.aplicadoEm = iso(agora());
        row.snapshotStatus = p.snapshotStatus || "pendente";
        row.snapshotTentativas = 0;
        if (row.snapshotStatus === "pendente") {
          row.snapshotProximaEm = iso(agora() + (p.snapshotDelaySeconds || 0) * 1000);
          row.snapshotPrazoEm = iso(agora() + (p.snapshotJanelaMinutos || 10) * 60000);
        }
      }
      return clone(row);
    },
    async registrarResultadoTardio({ id, claimToken, resultado }) {
      const row = linhas.find((r) => r.id === id && r.claimToken === claimToken && r.status !== "aplicando");
      if (!row) return null;
      row.resultadoTardio = { ...resultado };
      return clone(row);
    },
    async atualizarFinanceiroConfirmado({ id, margemDepois, lucroDepois, atencaoCodigo, calculo }) {
      const row = linhas.find((r) => r.id === id && (r.status === "aplicado" || r.status === "divergente"));
      if (!row) return null;
      Object.assign(row, { margemDepois: margemDepois ?? null, lucroDepois: lucroDepois ?? null, atencaoCodigo: atencaoCodigo || null });
      if (calculo) row.calculo = calculo;
      return clone(row);
    },
    async reivindicarRefresh({ id = null, limit = 5, lockSeconds = 60 }) {
      const alvo = linhas
        .filter((r) => ["pendente", "aguardando_propagacao"].includes(r.snapshotStatus) && ms(r.snapshotProximaEm) <= agora() && (id === null || r.id === Number(id)))
        .slice(0, limit);
      for (const r of alvo) {
        r.snapshotProximaEm = iso(agora() + lockSeconds * 1000);
        r.snapshotTentativas += 1;
      }
      return alvo.map(clone);
    },
    async registrarRefresh({ id, status, precoObservado = null, proximaEmSeconds = null }) {
      const row = linhas.find((r) => r.id === id && ["pendente", "aguardando_propagacao"].includes(r.snapshotStatus));
      if (!row) return null;
      const venceu = row.snapshotPrazoEm && ms(row.snapshotPrazoEm) <= agora();
      if (status === "aguardando_propagacao" && venceu) row.snapshotStatus = "propagacao_pendente";
      else if (status === "pendente" && venceu) row.snapshotStatus = "falhou";
      else row.snapshotStatus = status;
      if (precoObservado !== null) row.snapshotPrecoObservado = precoObservado;
      row.snapshotProximaEm = proximaEmSeconds === null ? null : iso(agora() + proximaEmSeconds * 1000);
      if (row.snapshotStatus === "atualizado") row.snapshotAtualizadoEm = iso(agora());
      return clone(row);
    },
    async listarHistorico({ clienteContaId, itemId }) {
      return linhas.filter((r) => r.clienteContaId === Number(clienteContaId) && r.itemId === itemId && r.status !== "preview").reverse().map(clone);
    },
  };
  return repo;
}

module.exports = { motorItem, promo, criarCenario, criarRepoMemoria };
