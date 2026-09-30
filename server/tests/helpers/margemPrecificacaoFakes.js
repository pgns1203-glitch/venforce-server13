// server/tests/helpers/margemPrecificacaoFakes.js
// Fakes da camada segura de precificação da Central de Margem: conta,
// Mercado Livre (item + cotação + promoções + escrita), Motor e um
// repositório em memória que reproduz a semântica do SQL real
// (índice único de idempotência, 1 'aplicando' por item, guardas de status).

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

/**
 * Cenário configurável. `estado` é mutável pelo teste entre preview e
 * aplicar (ex.: o preço muda no ML, a promoção some).
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
    ...overrides,
  };
  const chamadas = { mlFetch: [], montarItens: 0, cotacao: [], promocoes: 0, atualizarPreco: [], aplicarPromocao: [], logs: [], camposConfirmados: [], snapshot: [] };

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
      chamadas.mlFetch.push({ clienteId, path, mlUserId: opts.mlUserId, method: opts.method || "GET" });
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
    tiposComEscrita: new Set(["DEAL", "SELLER_CAMPAIGN"]),
    atualizarPreco: async (p) => {
      chamadas.atualizarPreco.push(p);
      return estado.respostaPreco ? estado.respostaPreco(p) : { ok: true, preco: p.novoPreco, moeda: "BRL" };
    },
    aplicarPromocao: async (p) => {
      chamadas.aplicarPromocao.push(p);
      return estado.respostaPromocao
        ? estado.respostaPromocao(p)
        : { ok: true, metodo: "POST", promotionId: p.promotionId, tipo: "DEAL", precoConfirmado: p.precoNovo, precoOriginal: 149.9 };
    },
    atualizarCamposConfirmados: async (...args) => { chamadas.camposConfirmados.push(args); },
    registrarLog: async (l) => { chamadas.logs.push(l); },
    atualizarSnapshotDoItem: async (p) => { chamadas.snapshot.push(p); return { ok: true }; },
    agendar: (fn) => fn(),
    leituraSnapshotHabilitada: () => estado.snapshotLigado !== false,
    env: { MARGIN_PRICING_SIMULACAO_CACHE_MS: "0", ...(overrides.env || {}) },
  };
  return { estado, chamadas, deps };
}

/** Repositório em memória com a mesma semântica do SQL (índices únicos + guardas). */
function criarRepoMemoria({ agora = () => Date.now() } = {}) {
  const linhas = [];
  let seq = 0;
  const clone = (r) => (r ? JSON.parse(JSON.stringify(r)) : null);
  function conflito(code, message) {
    const err = new Error(message);
    err.name = "PrecificacaoConflitoError";
    err.code = code;
    return err;
  }
  const repo = {
    linhas,
    async inserirPreview(d) {
      seq += 1;
      const row = {
        id: seq, clienteId: d.clienteId, clienteSlug: d.clienteSlug, clienteContaId: d.clienteContaId, marketplace: "meli",
        itemId: d.itemId, titulo: d.titulo, userId: d.userId, userNome: d.userNome, userEmail: d.userEmail,
        tipoAcao: d.tipoAcao, promotionId: d.promotionId, promotionType: d.promotionType, promotionNome: d.promotionNome,
        promotionAcao: d.promotionAcao, idempotencyKey: null, precoVisto: d.precoVisto, precoAnterior: d.precoAnterior,
        precoSolicitado: d.precoSolicitado, precoConfirmado: null, margemAntes: d.margemAntes, margemDepois: d.margemDepois,
        lucroAntes: d.lucroAntes, lucroDepois: d.lucroDepois, gates: d.gates, calculo: d.calculo, status: "preview",
        mlStatus: null, erroCodigo: null, erroMensagem: null, respostaMl: null, snapshotStatus: null, snapshotAtualizadoEm: null,
        expiraEm: new Date(agora() + d.ttlMinutes * 60000).toISOString(), criadoEm: new Date(agora()).toISOString(),
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
    async liberarAplicandoTravados() { return 0; },
    async reivindicar({ id, clienteContaId, idempotencyKey }) {
      const row = linhas.find((r) => r.id === Number(id) && r.clienteContaId === Number(clienteContaId));
      if (!row || row.status !== "preview" || new Date(row.expiraEm).getTime() <= agora()) return null;
      if (linhas.some((r) => r.idempotencyKey === idempotencyKey && r.id !== row.id)) throw conflito("IDEMPOTENCY_KEY_EM_USO", "chave em uso");
      if (linhas.some((r) => r.status === "aplicando" && r.clienteContaId === row.clienteContaId && r.itemId === row.itemId)) {
        throw conflito("APLICACAO_EM_ANDAMENTO", "Outra alteração deste anúncio está sendo aplicada agora.");
      }
      row.status = "aplicando";
      row.idempotencyKey = idempotencyKey;
      row.aplicandoEm = new Date(agora()).toISOString();
      return clone(row);
    },
    async recusarPreview({ id, clienteContaId, erroCodigo, erroMensagem }) {
      const row = linhas.find((r) => r.id === Number(id) && r.clienteContaId === Number(clienteContaId) && r.status === "preview");
      if (!row) return null;
      Object.assign(row, { status: "recusado", erroCodigo, erroMensagem });
      return clone(row);
    },
    async finalizar(p) {
      const row = linhas.find((r) => r.id === p.id && r.status === "aplicando");
      if (!row) return null;
      row.status = p.status;
      row.precoConfirmado = p.precoConfirmado ?? null;
      if (p.precoAnterior != null) row.precoAnterior = p.precoAnterior;
      if (p.margemDepois != null) row.margemDepois = p.margemDepois;
      if (p.lucroDepois != null) row.lucroDepois = p.lucroDepois;
      row.mlStatus = p.mlStatus ?? null;
      row.erroCodigo = p.erroCodigo ?? null;
      row.erroMensagem = p.erroMensagem ?? null;
      row.respostaMl = p.respostaMl ?? null;
      if (p.gates) row.gates = p.gates;
      if (p.calculo) row.calculo = p.calculo;
      if (p.status === "aplicado") { row.aplicadoEm = new Date(agora()).toISOString(); row.snapshotStatus = "pendente"; }
      return clone(row);
    },
    async atualizarSnapshotStatus({ id, status }) {
      const row = linhas.find((r) => r.id === id);
      if (row) row.snapshotStatus = status;
    },
    async listarHistorico({ clienteContaId, itemId }) {
      return linhas.filter((r) => r.clienteContaId === Number(clienteContaId) && r.itemId === itemId && r.status !== "preview").reverse().map(clone);
    },
  };
  return repo;
}

module.exports = { motorItem, promo, criarCenario, criarRepoMemoria };
