// server/controllers/meliAnunciosController.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — controller.
//
// Orquestra os services e responde os endpoints. Padrão de resposta:
//   - sucesso .................. { ok: true, ... }
//   - erro de validação ........ HTTP 400/404 + { ok: false, motivo }
//   - falha "esperada" de sync . HTTP 200 + { ok: false, codigo, motivo }
//
// Sincronização, detalhe e otimizador são read-only no Mercado Livre.
// As escritas intencionais no ML são três, e cada uma tem o seu service:
// criação de anúncio (meliCriacaoService), conteúdo do anúncio
// (meliConteudoService) e estoque (meliEstoqueService).
// -----------------------------------------------------------------------------

const anunciosService = require("../services/meliAnuncios/meliAnunciosService");
const familiaService = require("../services/meliAnuncios/meliFamiliaService");
const syncService = require("../services/meliAnuncios/meliSyncService");
const otimizadorService = require("../services/meliAnuncios/otimizadorMeliService");
const criacaoService = require("../services/meliAnuncios/meliCriacaoService");
const conteudoService = require("../services/meliAnuncios/meliConteudoService");
const estoqueService = require("../services/meliAnuncios/meliEstoqueService");
const precoService = require("../services/meliAnuncios/meliPrecoService");
const metricas7dService = require("../services/meliAnuncios/meliMetricas7dService");
const motorMargemService = require("../services/motorMargem/motorMargemService");
const marginEngine = require("../services/motorMargem/core/marginEngine");
const { mlFetch } = require("../utils/mlClient");

function extrairClienteContaId(valor) {
  return /^\d+$/.test(String(valor || "")) ? Number(valor) : null;
}

// Resposta padrão para o erro estrutural de ambiguidade de conta — mesmo
// formato já usado em adsController/metricasController.
function responderAmbiguidade(res, err) {
  return res.status(409).json({ ok: false, code: err.code, motivo: err.message, contas: err.contas });
}

// ----------------------------------------------------------------------------
// GET /anuncios-meli/clientes
// ----------------------------------------------------------------------------
async function listarClientes(req, res) {
  try {
    const clientes = await anunciosService.listarClientes();
    return res.json({ ok: true, clientes });
  } catch (err) {
    console.error("[anuncios-meli] listarClientes:", err.message);
    return res
      .status(500)
      .json({ ok: false, motivo: "Erro ao carregar a lista de clientes." });
  }
}

// ----------------------------------------------------------------------------
// POST /anuncios-meli/sync   body: { clienteSlug, modo }
// ----------------------------------------------------------------------------
async function sincronizar(req, res) {
  try {
    const { clienteSlug, modo } = req.body || {};
    const clienteContaId = extrairClienteContaId(req.body && req.body.clienteContaId);

    if (!clienteSlug) {
      return res
        .status(400)
        .json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res.status(404).json({
        ok: false,
        codigo: "NO_CLIENT",
        motivo: "Cliente não encontrado.",
      });
    }

    const resultado = await syncService.sincronizar({
      clienteId: cliente.id,
      clienteSlug: cliente.slug,
      modo,
      clienteContaId,
    });

    // Falhas esperadas (sem token, erro de API) voltam como 200 + ok:false
    // para o frontend tratar com mensagem amigável.
    return res.json(resultado);
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] sincronizar:", err.message);
    return res.status(500).json({
      ok: false,
      codigo: "ERRO_INTERNO",
      motivo: "Erro interno ao sincronizar os anúncios.",
    });
  }
}

// ----------------------------------------------------------------------------
// GET /anuncios-meli/resumo?clienteSlug=
// ----------------------------------------------------------------------------
async function resumo(req, res) {
  try {
    const { clienteSlug } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);
    if (!clienteSlug) {
      return res
        .status(400)
        .json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res
        .status(404)
        .json({ ok: false, motivo: "Cliente não encontrado." });
    }

    let contaId = null;
    let includeLegacy = true;
    if (clienteContaId != null) {
      const contexto = await anunciosService.resolverContextoConta({
        clienteId: cliente.id, clienteContaId, requireUsableGrant: false,
      });
      contaId = contexto.contaId;
      includeLegacy = contexto.includeLegacy;
    }

    const dados = await anunciosService.obterResumo(cliente.id, contaId, includeLegacy);
    return res.json({
      ok: true,
      cliente: { slug: cliente.slug, nome: cliente.nome },
      resumo: dados,
    });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] resumo:", err.message);
    return res
      .status(500)
      .json({ ok: false, motivo: "Erro ao montar o resumo." });
  }
}

// ----------------------------------------------------------------------------
// GET /anuncios-meli?clienteSlug=&q=&status=&filtro=&page=&limit=
// ----------------------------------------------------------------------------
async function listar(req, res) {
  try {
    const { clienteSlug, q, status, filtro, page, limit } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);
    if (!clienteSlug) {
      return res
        .status(400)
        .json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res
        .status(404)
        .json({ ok: false, motivo: "Cliente não encontrado." });
    }

    let contaId = null;
    let includeLegacy = true;
    if (clienteContaId != null) {
      const contexto = await anunciosService.resolverContextoConta({
        clienteId: cliente.id, clienteContaId, requireUsableGrant: false,
      });
      contaId = contexto.contaId;
      includeLegacy = contexto.includeLegacy;
    }

    const resultado = await anunciosService.listarAnuncios({
      clienteId: cliente.id,
      clienteContaId: contaId,
      includeLegacy,
      q,
      status,
      filtro,
      page,
      limit,
    });

    return res.json({
      ok: true,
      cliente: { slug: cliente.slug, nome: cliente.nome },
      anuncios: resultado.anuncios,
      paginacao: resultado.paginacao,
    });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] listar:", err.message);
    return res
      .status(500)
      .json({ ok: false, motivo: "Erro ao listar os anúncios." });
  }
}

// ----------------------------------------------------------------------------
// GET /anuncios-meli/familias?clienteSlug=&q=&status=&filtro=&page=&limit=
//
// LISTAGEM UNIFICADA de anúncios, como a listagem do Mercado Livre: uma lista
// só, em que cada linha é um agrupador (quando existe family_id) ou o próprio
// anúncio (quando não existe). Ver
// docs/AUDITORIA_ANUNCIOS_ML_LISTAGEM_UNIFICADA.md.
//
// Somente leitura, não chama a API do Mercado Livre (dados já persistidos em
// meli_anuncios / meli_user_products).
//
// Responde `{ ok, cliente, anuncios, paginacao }`. Cada linha de `anuncios` é
// um GRUPO, e `tipo` é o único campo que distingue as duas formas:
// "familia" (tem user_products/items abaixo, expansível por
// /familias/:familyId) e "item" (anúncio individual sem agrupamento, com o
// registro inteiro de meli_anuncios). O bloco `sem_user_product` saiu: existia
// só para rotular a aba "Sem agrupamento", que deixou de existir.
//
// O caminho da rota (/familias) ficou vencido: ela lista anúncios, não
// famílias. Dívida registrada e NÃO paga — renomear exige migrar os
// consumidores, não um alias. Histórico completo e caminho de migração no
// call site (server/routes/meliAnunciosRoutes.js) e na auditoria §4.5.1.
// ----------------------------------------------------------------------------
async function listarAgrupado(req, res) {
  try {
    const { clienteSlug, q, status, filtro, page, limit } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);
    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    let contaId = null;
    let includeLegacy = true;
    if (clienteContaId != null) {
      const contexto = await anunciosService.resolverContextoConta({
        clienteId: cliente.id, clienteContaId, requireUsableGrant: false,
      });
      contaId = contexto.contaId;
      includeLegacy = contexto.includeLegacy;
    }

    const resultado = await familiaService.listarAgrupado({
      clienteId: cliente.id, clienteContaId: contaId, includeLegacy,
      q, status, filtro, page, limit,
    });

    return res.json({
      ok: true,
      cliente: { slug: cliente.slug, nome: cliente.nome },
      anuncios: resultado.anuncios,
      paginacao: resultado.paginacao,
    });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] listarAgrupado:", err.message);
    return res.status(500).json({ ok: false, motivo: "Erro ao listar os anúncios." });
  }
}

// ----------------------------------------------------------------------------
// GET /anuncios-meli/familias/:familyId?clienteSlug=
//
// Detalhe de 1 família: User Products -> Itens MLB completos. Responde 404
// tanto para family_id inexistente quanto para família que só existe em
// outra ClienteConta do mesmo cliente — os dois casos são indistinguíveis de
// propósito, para nunca revelar a existência de dados de outra conta.
// ----------------------------------------------------------------------------
async function detalheFamilia(req, res) {
  try {
    const { familyId } = req.params;
    const { clienteSlug } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);
    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    let contaId = null;
    let includeLegacy = true;
    if (clienteContaId != null) {
      const contexto = await anunciosService.resolverContextoConta({
        clienteId: cliente.id, clienteContaId, requireUsableGrant: false,
      });
      contaId = contexto.contaId;
      includeLegacy = contexto.includeLegacy;
    }

    const familia = await familiaService.obterFamiliaDetalhe({
      clienteId: cliente.id, familyId, clienteContaId: contaId, includeLegacy,
    });
    if (!familia) {
      return res.status(404).json({ ok: false, motivo: "Família não encontrada." });
    }

    return res.json({
      ok: true,
      cliente: { slug: cliente.slug, nome: cliente.nome },
      familia,
    });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] detalheFamilia:", err.message);
    return res.status(500).json({ ok: false, motivo: "Erro ao carregar o detalhe da família." });
  }
}

// ----------------------------------------------------------------------------
// GET /anuncios-meli/performance?clienteSlug=&itemIds=A,B,C&clienteContaId=
//                                &incluirMetricas=&incluirMargem=&incluirComposicao=
//
// Enriquecimento AO VIVO desta tela: métricas dos últimos 7 dias
// (meliMetricas7dService — views/vendas/conversão) e margem por MLB
// (motorMargemService, o Motor de Margem já existente — nunca recalculado
// aqui). Chamado pelo FRONTEND depois que a lista já pintou na tela: nunca
// bloqueia /familias nem /familias/:familyId, que continuam DB-only. A lista
// de `itemIds` vem do cliente — este endpoint nunca decide sozinho o que
// buscar, e é isso que torna "zero chamada para item oculto" auditável.
//
// `incluirMetricas`/`incluirMargem` (default "1", os dois): o frontend liga
// cada bloco só quando falta — item que já tem métricas em cache não pede
// métricas de novo ao expandir a família (só a margem, que fica reservada
// para quando o agrupador é realmente aberto — nunca gasta o Motor de
// Margem para preencher a soma automática de um agrupador ainda fechado).
// "0"/"false" desliga o bloco: o serviço de baixo nem é chamado.
//
// `incluirComposicao` (default **"0"**, ao contrário dos outros dois —
// opt-in): só o modal de detalhe do MLB pede, ao abrir a seção "Composição
// da margem". Exige `incluirMargem=1` junto (senão fica sempre vazio) e só
// monta composição para o item cuja margem exibida for `computable` — nos
// outros casos (contexto indisponível, item não-computável) a chave nem
// aparece em `composicao`, e o front reaproveita a MESMA mensagem/rótulo
// que já usa para a margem da lista (`margem[itemId]`/`margemIndisponivel`).
//
// Métricas, margem e composição são blocos INDEPENDENTES: falha de um nunca
// derruba o outro (Promise.allSettled). Base de Custos não vinculada (ou
// qualquer outro motivo de contexto do Motor de Margem não estar pronto)
// vira `margemIndisponivel` com o MESMO texto que
// contextoPrecificacaoService.js já usa — nunca um erro genérico, nunca 500.
//
// `margem[itemId]` também carrega `precoAtual` (preço OBTIDO ao vivo pelo
// Motor, `item.pricing.current`) e `precoAlvo` (preço CALCULADO pelo Motor
// para a margem-alvo, `item.margin.target`) — ver montarMapaMargem. Os dois
// são `null` quando o Motor não tem o dado, nunca 0: o front mantém o preço
// sincronizado da listagem (`a.preco`) como fallback nesse caso.
// ----------------------------------------------------------------------------
const PERFORMANCE_MAX_ITENS = 24; // teto de abuso da rota — independente da paginação da tela, não é a mesma coisa

function flagLigada(valor) {
  return valor === undefined || valor === null || (valor !== "0" && valor !== "false");
}

// Ao contrário de flagLigada() (default ligado), composição é OPT-IN —
// ausente/qualquer coisa que não seja "1"/"true" significa desligado.
function flagOptIn(valor) {
  return valor === "1" || valor === "true";
}

// Um termo da evidência bruta do Motor (`{value, source, quality,
// observedAt}` ou `null` quando a variável não tem fonte nenhuma) — o
// mesmo formato usado em `pricing.current/sold` e
// `marketplaceCosts.commission*/freight*`.
function valorEvidencia(entrada) {
  return entrada && entrada.value != null ? entrada.value : null;
}

// Mesma leitura de campos por origem que montarComposicaoDoItem usa para
// exibição — aqui em nome de variável cru (price/cost/taxRate/fixedFee/
// commission/freight), o vocabulário que marginEngine.computeMargin espera.
function extrairValoresBaseParaSimulacao(item, origem) {
  const custosOrigem = origem === "realized" ? "realized" : "projected";
  return {
    price: valorEvidencia(origem === "realized" ? item.pricing.sold : item.pricing.current),
    cost: valorEvidencia(item.costs.cost[custosOrigem]),
    taxRate: valorEvidencia(item.costs.taxRate[custosOrigem]),
    fixedFee: valorEvidencia(item.costs.fixedFee[custosOrigem]),
    commission: valorEvidencia(
      origem === "realized" ? item.marketplaceCosts.commissionRealized : item.marketplaceCosts.commissionProjected
    ),
    freight: valorEvidencia(
      origem === "realized" ? item.marketplaceCosts.freightRealized : item.marketplaceCosts.freightProjected
    ),
  };
}

// ----------------------------------------------------------------------------
// Composição da margem — SÓ para o modal de detalhe (§ incluirComposicao).
//
// Não é um segundo cálculo de margem: é a decomposição dos MESMOS insumos
// que `motorMargemService`/`marginEngine.computeMargin` já usou para chegar
// no número de `item.margin.<origem>` (ver core/marginItem.js e
// core/marginEngine.js). Fórmula real, para referência (nunca reimplementada
// aqui): lucro = venda − (venda × imposto%) − comissão − frete − taxaFixa
// − custo. Não existe um "outros custos" no Motor — só estes 5 descontos.
//
// A ÚNICA conta feita aqui é `impostoValor = venda × impostoPercentual`:
// o Motor guarda imposto como PERCENTUAL (nunca em R$ pronto), então essa
// multiplicação é só para a linha "Imposto" da composição ficar em R$ como
// as demais — a margem final exibida (`margin`/`marginPercent`, abaixo)
// continua sendo, sempre e só, o valor que o Motor já calculou. Nenhuma
// linha é ajustada para a soma "fechar" contra esse número.
function montarComposicaoDoItem(item, origem) {
  const custosOrigem = origem === "realized" ? "realized" : "projected";
  const venda = valorEvidencia(
    origem === "realized" ? item.pricing.sold : item.pricing.current
  );
  const custoProduto = valorEvidencia(item.costs.cost[custosOrigem]);
  const taxaFixa = valorEvidencia(item.costs.fixedFee[custosOrigem]); // realizada: sempre null (sem histórico) — linha some sozinha no front
  const impostoPercentual = valorEvidencia(item.costs.taxRate[custosOrigem]);
  const comissaoMl = valorEvidencia(
    origem === "realized" ? item.marketplaceCosts.commissionRealized : item.marketplaceCosts.commissionProjected
  );
  const frete = valorEvidencia(
    origem === "realized" ? item.marketplaceCosts.freightRealized : item.marketplaceCosts.freightProjected
  );
  const impostoValor =
    venda != null && impostoPercentual != null
      ? Math.round(venda * impostoPercentual * 100) / 100
      : null;

  return { venda, custoProduto, comissaoMl, frete, taxaFixa, impostoPercentual, impostoValor };
}

function montarMapaMargem(itens, incluirComposicao) {
  const margem = {};
  const composicao = {};
  for (const item of itens || []) {
    const realized = item.margin && item.margin.realized;
    const projected = item.margin && item.margin.projected;
    const usaRealizada = !!(realized && realized.computable);
    const exibida = usaRealizada ? realized : projected;
    const origem = usaRealizada ? "realized" : "projected";
    const itemId = item.identity.itemId;

    margem[itemId] = {
      origem,
      margin: exibida ? exibida.margin : null,
      marginPercent: exibida ? exibida.marginPercent : null,
      // Lucro em R$ (o Motor já calcula — `margin`/`marginPercent` acima são
      // só a RAZÃO/percentual). Aditivo: a lista nunca leu este campo, só a
      // seção "Composição da margem" do modal precisa dele para a linha
      // final "= Margem" em moeda.
      profit: exibida ? exibida.profit : null,
      status: item.quality.status,
      statusLabel: item.quality.statusLabel,
      statusReasons: item.quality.statusReasons,
      // Preço OBTIDO pelo Motor ao vivo (sale_price no momento desta chamada,
      // mesmo `item.pricing.current` que a composição já usa como `venda`) —
      // independe de origem realizada/projetada, é sempre "o que o anúncio
      // vale agora". `null` quando o Motor não trouxe evidência de preço
      // (nunca 0): o front mantém o preço sincronizado (`a.preco`) nesse caso.
      precoAtual: valorEvidencia(item.pricing && item.pricing.current),
      // Preço CALCULADO pelo Motor para bater a margem alvo da Central
      // (`item.margin.target`, mesma fórmula de `computeTargetPrice`). Só
      // vem preenchido quando o próprio Motor considera o cálculo possível
      // (custo/frete/imposto/comissão% disponíveis) — nunca um palpite.
      precoAlvo:
        item.margin.target && item.margin.target.computable
          ? item.margin.target.price
          : null,
    };

    // Só monta composição quando a margem exibida É computável — item sem
    // margem (Base ausente, UNVALIDATED etc.) não tem nada pra decompor, e
    // o front reaproveita o mesmo statusLabel/statusReasons acima, nunca
    // uma composição parcial.
    if (incluirComposicao && exibida && exibida.computable) {
      composicao[itemId] = montarComposicaoDoItem(item, origem);
    }
  }
  return { margem, composicao };
}

async function performance(req, res) {
  try {
    const { clienteSlug } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);
    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const brutos = String((req.query && req.query.itemIds) || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const itemIds = brutos.slice(0, PERFORMANCE_MAX_ITENS);
    if (brutos.length > itemIds.length) {
      console.warn(
        `[anuncios-meli] performance: itemIds cortado de ${brutos.length} para ${itemIds.length} (teto PERFORMANCE_MAX_ITENS).`
      );
    }
    const incluirMetricas = flagLigada(req.query && req.query.incluirMetricas);
    const incluirMargem = flagLigada(req.query && req.query.incluirMargem);
    const incluirComposicao = flagOptIn(req.query && req.query.incluirComposicao);
    if (!itemIds.length || (!incluirMetricas && !incluirMargem)) {
      return res.json({ ok: true, metricas7d: {}, margem: {}, margemIndisponivel: null, composicao: {} });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    const contexto = await anunciosService.resolverContextoConta({
      clienteId: cliente.id,
      clienteContaId,
      requireUsableGrant: true,
    });

    const [metricasResultado, margemResultado] = await Promise.allSettled([
      incluirMetricas
        ? metricas7dService.montarMetricas7d({ clienteId: cliente.id, mlUserId: contexto.mlUserId, itemIds })
        : Promise.resolve(null),
      incluirMargem
        ? motorMargemService.montarItens({
            clienteSlug: cliente.slug,
            clienteContaId: contexto.contaId,
            itemIds,
          })
        : Promise.resolve(null),
    ]);

    let metricas7d = {};
    if (!incluirMetricas) {
      // desligado por pedido do frontend (item já tem métricas em cache) —
      // meliMetricas7dService nem chega a ser chamado.
    } else if (metricasResultado.status === "fulfilled") {
      metricas7d = metricasResultado.value;
    } else {
      console.error("[anuncios-meli] performance metricas7d:", metricasResultado.reason && metricasResultado.reason.message);
    }

    let margem = {};
    let composicao = {};
    let margemIndisponivel = null;
    if (!incluirMargem) {
      // desligado por pedido do frontend (soma automática do agrupador ainda
      // fechado — margem só é buscada quando o operador realmente expande).
    } else if (margemResultado.status === "fulfilled") {
      const resultado = montarMapaMargem(margemResultado.value.itens, incluirComposicao);
      margem = resultado.margem;
      composicao = resultado.composicao;
    } else {
      const err = margemResultado.reason;
      if (err && err.statusCode && err.payload && err.payload.codigo) {
        // Contexto do Motor não está pronto (Base não vinculada, múltiplas
        // bases, grant caído) — mensagem REAL do Motor, não tradução própria.
        // Composição some junto: sem contexto pronto não há item pra decompor.
        margemIndisponivel = { codigo: err.payload.codigo, mensagem: err.payload.erro };
      } else {
        console.error("[anuncios-meli] performance margem:", err && err.message);
      }
    }

    return res.json({ ok: true, metricas7d, margem, margemIndisponivel, composicao });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] performance:", err.message);
    return res.status(500).json({ ok: false, motivo: "Erro ao carregar métricas e margem." });
  }
}

// ----------------------------------------------------------------------------
// Descrição ao vivo do Mercado Livre.
//
// Achado F-06 da auditoria: `descricao: null` significava três coisas
// diferentes — "o anúncio não tem descrição", "a chamada ao ML falhou" e "não
// havia token" — e a tela afirmava categoricamente a primeira. Agora o estado
// vem junto e separado do conteúdo:
//
//   "ok"            → veio texto
//   "sem_descricao" → o ML respondeu, e o anúncio não tem descrição (o ML
//                     devolve 404 nesse caso)
//   "erro"          → não deu para saber (falha de rede, token, 5xx do ML)
// ----------------------------------------------------------------------------
async function carregarDescricao(clienteId, itemId, mlUserId) {
  try {
    const resp = await mlFetch(
      clienteId,
      `/items/${encodeURIComponent(itemId)}/description`,
      { mlUserId }
    );
    if (resp && resp.ok) {
      const texto = resp.data
        ? resp.data.plain_text || resp.data.text || null
        : null;
      if (texto && String(texto).trim()) {
        return { descricao: texto, estado: "ok", erro: null };
      }
      return { descricao: null, estado: "sem_descricao", erro: null };
    }
    if (resp && resp.status === 404) {
      return { descricao: null, estado: "sem_descricao", erro: null };
    }
    return {
      descricao: null,
      estado: "erro",
      erro: `O Mercado Livre não devolveu a descrição (HTTP ${
        (resp && resp.status) || "?"
      }).`,
    };
  } catch (e) {
    return {
      descricao: null,
      estado: "erro",
      erro: "Não foi possível consultar a descrição no Mercado Livre.",
    };
  }
}

// ----------------------------------------------------------------------------
// Nome legível da categoria.
//
// `meli_anuncios` só grava `category_id` (o código técnico do ML, ex.
// "MLB1055") — não existe coluna com o nome. O único service de categorias
// hoje em uso (meliCriacaoService.buscarCategorias, via domain_discovery)
// busca por TEXTO LIVRE para a tela de criação; não serve para traduzir um ID
// que já se tem. Nenhuma outra tela do Portal faz essa tradução. O que existe
// é o endpoint público do próprio ML, `GET /categories/:id`, que devolve
// `{ name, ... }` — chamado aqui como enriquecimento mínimo.
//
// Nome de categoria não muda: um cache em memória por processo evita bater
// na API do ML de novo a cada abertura do mesmo anúncio (ou de outro anúncio
// da mesma categoria).
// ----------------------------------------------------------------------------
const _cacheCategoria = new Map(); // category_id -> { nome, expiraEm }
const CATEGORIA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function carregarNomeCategoria(clienteId, categoryId, mlUserId) {
  if (!categoryId) return null;

  const emCache = _cacheCategoria.get(categoryId);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.nome;

  try {
    const resp = await mlFetch(
      clienteId,
      `/categories/${encodeURIComponent(categoryId)}`,
      { mlUserId }
    );
    if (resp && resp.ok && resp.data && resp.data.name) {
      const nome = String(resp.data.name);
      _cacheCategoria.set(categoryId, { nome, expiraEm: Date.now() + CATEGORIA_CACHE_TTL_MS });
      return nome;
    }
  } catch (e) {
    // categoria é cosmético — o front cai para o category_id cru, nunca quebra
  }
  return null;
}

// ----------------------------------------------------------------------------
// GET /anuncios-meli/:itemId?clienteSlug=
// Busca o anúncio no banco e enriquece com a descrição ao vivo da API ML.
// ----------------------------------------------------------------------------
async function detalhe(req, res) {
  try {
    const { itemId } = req.params;
    const { clienteSlug } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);

    if (!clienteSlug) {
      return res
        .status(400)
        .json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res
        .status(404)
        .json({ ok: false, motivo: "Cliente não encontrado." });
    }

    const anuncio = await anunciosService.obterAnuncio(cliente.id, itemId);
    if (!anuncio) {
      return res.status(404).json({
        ok: false,
        motivo:
          "Anúncio não encontrado no banco. Sincronize os anúncios deste cliente.",
      });
    }

    // O próprio anúncio já sabe de qual conta veio (gravado na sincronização);
    // só cai na resolução por clienteContaId/legado quando essa coluna ainda
    // não foi preenchida (linha sincronizada antes dela existir).
    let mlUserId = anuncio.ml_user_id || null;
    if (!mlUserId) {
      const contexto = await anunciosService.resolverContextoConta({
        clienteId: cliente.id, clienteContaId, requireUsableGrant: false,
      });
      mlUserId = contexto.mlUserId;
    }

    // Descrição e nome da categoria buscados sob demanda, em paralelo — nenhum
    // dos dois é salvo na sincronização em massa.
    const [desc, categoriaNome] = await Promise.all([
      carregarDescricao(cliente.id, itemId, mlUserId),
      carregarNomeCategoria(cliente.id, anuncio.category_id, mlUserId),
    ]);

    return res.json({
      ok: true,
      cliente: { slug: cliente.slug, nome: cliente.nome },
      anuncio,
      // `descricao` mantém exatamente o contrato antigo (string | null) para
      // não quebrar consumidor nenhum; quem precisa distinguir lê os campos
      // novos abaixo.
      descricao: desc.descricao,
      descricaoEstado: desc.estado,
      descricaoErro: desc.erro,
      // null quando a chamada ao ML falhou ou o anúncio não tem categoria —
      // o front cai para `anuncio.category_id` nesse caso, nunca quebra.
      categoriaNome,
    });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] detalhe:", err.message);
    return res
      .status(500)
      .json({ ok: false, motivo: "Erro ao carregar o detalhe do anúncio." });
  }
}

// ----------------------------------------------------------------------------
// PATCH /anuncios-meli/:itemId/conteudo
// body: { clienteSlug, clienteContaId?, titulo?, modelo?, descricao? }
//
// ESCRITA REAL no Mercado Livre. É a única rota do detalhe que altera o
// anúncio no marketplace — "Aprovar" (otimizações) continua sendo decisão
// interna e não toca no ML.
//
// A conta usada é a MESMA que o detalhe leu: `anuncio.ml_user_id` gravado na
// linha e, só quando ele é nulo (linha anterior à coluna existir), a resolução
// por `clienteContaId`. Nunca "a conta principal".
//
// Responde 200 com um resultado POR CAMPO. `ok` só é true quando todos os
// campos pedidos foram confirmados pelo ML — assim a UI não tem como dizer
// "salvo" para um campo que o ML recusou.
// ----------------------------------------------------------------------------
async function atualizarConteudo(req, res) {
  try {
    const { itemId } = req.params;
    const body = req.body || {};
    const { clienteSlug } = body;
    const clienteContaId = extrairClienteContaId(body.clienteContaId);

    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const campos = {};
    if (body.titulo !== undefined) campos.titulo = body.titulo;
    if (body.modelo !== undefined) campos.modelo = body.modelo;
    if (body.descricao !== undefined) campos.descricao = body.descricao;
    if (!Object.keys(campos).length) {
      return res.status(400).json({
        ok: false,
        motivo: "Informe ao menos um campo (titulo, modelo ou descricao).",
      });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    const anuncio = await anunciosService.obterAnuncio(cliente.id, itemId);
    if (!anuncio) {
      return res.status(404).json({
        ok: false,
        motivo:
          "Anúncio não encontrado no banco. Sincronize os anúncios deste cliente.",
      });
    }

    let mlUserId = anuncio.ml_user_id || null;
    if (!mlUserId) {
      const contexto = await anunciosService.resolverContextoConta({
        clienteId: cliente.id,
        clienteContaId,
        requireUsableGrant: true,
      });
      mlUserId = contexto.mlUserId;
    }

    const { resultados, aplicados } = await conteudoService.aplicarConteudo({
      clienteId: cliente.id,
      itemId,
      mlUserId,
      campos,
      anuncio,
    });

    // Snapshot local só do que o ML confirmou.
    const confirmados = {};
    if (aplicados.titulo !== undefined) confirmados.titulo = aplicados.titulo;
    if (aplicados.modelo !== undefined) {
      confirmados.modelo = aplicados.modelo;
      confirmados.attributesJson = comAtributoModelo(
        anuncio.attributes_json,
        aplicados.modelo
      );
    }
    let atualizado = anuncio;
    if (Object.keys(confirmados).length) {
      atualizado =
        (await anunciosService.atualizarCamposConfirmados(
          cliente.id,
          itemId,
          confirmados
        )) || anuncio;
    }

    const tudoOk = Object.keys(resultados).every((k) => resultados[k].ok);

    // A descrição só volta aqui quando ELA foi o que mudou — reler do ML a
    // cada salvamento de título gastaria uma chamada externa por nada.
    const resposta = { ok: tudoOk, resultados, anuncio: atualizado };
    if (aplicados.descricao !== undefined) {
      resposta.descricao = aplicados.descricao;
      resposta.descricaoEstado = "ok";
      resposta.descricaoErro = null;
    }
    return res.json(resposta);
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] atualizarConteudo:", err.message);
    return res.status(500).json({
      ok: false,
      motivo: "Erro interno ao salvar as alterações no anúncio.",
    });
  }
}

// ----------------------------------------------------------------------------
// PATCH /anuncios-meli/:itemId/estoque
//   body: { clienteSlug, clienteContaId?, estoque }
//
// A escrita é PUT /items/{id} { available_quantity } (ver meliEstoqueService);
// o PATCH aqui é do NOSSO endpoint, alinhado aos vizinhos /conteudo e /revisao.
//
// A resposta diz três coisas que a tela precisa distinguir:
//   estoque ............... o valor que o ML confirmou (não o digitado);
//   anuncio ............... a linha do item já atualizada;
//   itens_sincronizados ... os OUTROS MLBs do mesmo User Product que passam a
//                           valer o mesmo estoque. Vem vazio no anúncio sem
//                           agrupamento, e é o que permite à tela atualizar a
//                           variação inteira sem reconsultar nada.
// ----------------------------------------------------------------------------
async function atualizarEstoque(req, res) {
  try {
    const { itemId } = req.params;
    const body = req.body || {};
    const { clienteSlug } = body;
    const clienteContaId = extrairClienteContaId(body.clienteContaId);

    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    // Validação ANTES de resolver cliente/conta/token: um valor inválido não
    // merece uma consulta ao banco nem uma chamada externa.
    const quantidade = estoqueService.normalizarQuantidade(body.estoque);
    if (!quantidade.ok) {
      return res.status(400).json({ ok: false, codigo: quantidade.codigo, motivo: quantidade.motivo });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    const anuncio = await anunciosService.obterAnuncio(cliente.id, itemId);
    if (!anuncio) {
      return res.status(404).json({
        ok: false,
        motivo:
          "Anúncio não encontrado no banco. Sincronize os anúncios deste cliente.",
      });
    }

    // Mesma regra de conta de /conteudo: a linha sabe de qual conta veio, e é
    // essa. Sem isso, resolverContextoConta decide — e recusa (409) quando há
    // mais de uma conta e nenhuma indicação.
    let mlUserId = anuncio.ml_user_id || null;
    if (!mlUserId) {
      const contexto = await anunciosService.resolverContextoConta({
        clienteId: cliente.id,
        clienteContaId,
        requireUsableGrant: true,
      });
      mlUserId = contexto.mlUserId;
    }

    const r = await estoqueService.atualizarEstoque({
      clienteId: cliente.id,
      itemId,
      estoque: body.estoque,
      mlUserId,
    });

    // Recusa do ML: 200 com ok:false, como as outras falhas "esperadas" deste
    // controller — e o snapshot local NÃO é tocado.
    if (!r.ok) {
      return res.json({ ok: false, codigo: r.codigo, motivo: r.motivo });
    }

    const { anuncio: atualizado, sincronizados } =
      await anunciosService.aplicarEstoqueConfirmado(cliente.id, itemId, {
        estoque: r.estoque,
        status: r.status,
        subStatus: r.subStatus,
        definirSubStatus: r.temSubStatus,
        userProductId: anuncio.user_product_id || null,
      });

    return res.json({
      ok: true,
      estoque: r.estoque,
      anuncio: atualizado || anuncio,
      itens_sincronizados: sincronizados,
      user_product_id: anuncio.user_product_id || null,
    });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] atualizarEstoque:", err.message);
    return res.status(500).json({
      ok: false,
      motivo: "Erro interno ao salvar o estoque do anúncio.",
    });
  }
}

// ----------------------------------------------------------------------------
// PATCH /anuncios-meli/:itemId/preco
//   body: { clienteSlug, clienteContaId?, preco }
//
// A escrita é a API dedicada de Preços do ML (ver meliPrecoService): o preço
// devolvido é sempre o CONFIRMADO na releitura pós-escrita, nunca o valor
// enviado. O snapshot local (`meli_anuncios.preco`) só muda depois disso.
// ----------------------------------------------------------------------------
async function atualizarPreco(req, res) {
  try {
    const { itemId } = req.params;
    const body = req.body || {};
    const { clienteSlug } = body;
    const clienteContaId = extrairClienteContaId(body.clienteContaId);

    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    // Validação ANTES de resolver cliente/conta/token, mesmo padrão de /estoque.
    const preco = precoService.normalizarPreco(body.preco);
    if (!preco.ok) {
      return res.status(400).json({ ok: false, codigo: preco.codigo, motivo: preco.motivo });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    const anuncio = await anunciosService.obterAnuncio(cliente.id, itemId);
    if (!anuncio) {
      return res.status(404).json({
        ok: false,
        motivo: "Anúncio não encontrado no banco. Sincronize os anúncios deste cliente.",
      });
    }

    let mlUserId = anuncio.ml_user_id || null;
    if (!mlUserId) {
      const contexto = await anunciosService.resolverContextoConta({
        clienteId: cliente.id,
        clienteContaId,
        requireUsableGrant: true,
      });
      mlUserId = contexto.mlUserId;
    }

    const r = await precoService.atualizarPreco({
      clienteId: cliente.id,
      itemId,
      novoPreco: body.preco,
      mlUserId,
    });

    // Recusa (ou confirmação frustrada): 200 com ok:false, snapshot intacto.
    if (!r.ok) {
      return res.json({ ok: false, codigo: r.codigo, motivo: r.motivo });
    }

    const atualizado = await anunciosService.atualizarCamposConfirmados(cliente.id, itemId, {
      preco: r.preco,
    });

    return res.json({
      ok: true,
      preco: r.preco,
      moeda: r.moeda,
      anuncio: atualizado || anuncio,
    });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] atualizarPreco:", err.message);
    return res.status(500).json({
      ok: false,
      motivo: "Erro interno ao salvar o preço do anúncio.",
    });
  }
}

// ----------------------------------------------------------------------------
// POST /anuncios-meli/:itemId/simular-margem
//   body: { clienteSlug, clienteContaId?, origem?, preco?, custoProduto?, custosAdicionais? }
//
// Simulação PURA para a "Composição da margem" do modal: reaproveita o MESMO
// núcleo do Motor (marginEngine.computeMargin — nunca uma segunda fórmula)
// com os overrides informados. Nunca escreve no Mercado Livre, nunca grava
// na Base de Custos, nunca persiste nada — cada chamada é local ao pedido.
//
// Comissão, frete e imposto NÃO têm override: são sempre os do Motor. Só
// preço, custo (`cost`) e "custos adicionais" (contrato existente `fixedFee`
// do Motor, só renomeado na UI) podem ser simulados.
// ----------------------------------------------------------------------------
const SIMULACAO_CAMPOS = [
  ["preco", "price"],
  ["custoProduto", "cost"],
  ["custosAdicionais", "fixedFee"],
];

async function simularMargem(req, res) {
  try {
    const { itemId } = req.params;
    const body = req.body || {};
    const { clienteSlug } = body;
    const clienteContaId = extrairClienteContaId(body.clienteContaId);

    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const overrides = {};
    for (const [campo, chave] of SIMULACAO_CAMPOS) {
      if (body[campo] === undefined) continue;
      const n = Number(body[campo]);
      const invalido = !Number.isFinite(n) || n < 0 || (campo === "preco" && n <= 0);
      if (invalido) {
        return res.status(400).json({
          ok: false,
          motivo: `O campo ${campo} precisa ser um número ${campo === "preco" ? "maior que" : "maior ou igual a"} zero.`,
        });
      }
      overrides[chave] = n;
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    let resultadoMotor;
    try {
      resultadoMotor = await motorMargemService.montarItens({
        clienteSlug: cliente.slug,
        clienteContaId,
        itemIds: [itemId],
      });
    } catch (err) {
      if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
      if (err.statusCode && err.payload && err.payload.codigo) {
        return res.status(err.statusCode).json({ ok: false, codigo: err.payload.codigo, motivo: err.payload.erro });
      }
      throw err;
    }

    const item = (resultadoMotor.itens || []).find((it) => it.identity.itemId === String(itemId));
    if (!item) {
      return res.status(404).json({ ok: false, motivo: "Item não encontrado no Motor de Margem." });
    }

    const origem = body.origem === "realized" ? "realized" : "projected";
    const base = extrairValoresBaseParaSimulacao(item, origem);
    const entrada = {
      price: overrides.price !== undefined ? overrides.price : base.price,
      cost: overrides.cost !== undefined ? overrides.cost : base.cost,
      taxRate: base.taxRate,
      fixedFee: overrides.fixedFee !== undefined ? overrides.fixedFee : base.fixedFee,
      commission: base.commission,
      freight: base.freight,
    };

    const resultado = marginEngine.computeMargin(entrada);

    return res.json({
      ok: true,
      simulado: true,
      origem,
      entradas: entrada,
      resultado: {
        computable: resultado.computable,
        profit: resultado.profit,
        margin: resultado.margin,
        marginPercent: resultado.margin != null ? resultado.margin * 100 : null,
        missing: resultado.missing,
        assumed: resultado.assumed,
      },
    });
  } catch (err) {
    console.error("[anuncios-meli] simularMargem:", err.message);
    return res.status(500).json({ ok: false, motivo: "Erro interno ao simular a margem." });
  }
}

// Reflete o MODEL confirmado dentro do attributes_json do snapshot — a ficha
// técnica da tela lê o modelo de lá, não da coluna.
function comAtributoModelo(attributesJson, modelo) {
  let attrs = attributesJson;
  if (typeof attrs === "string") {
    try { attrs = JSON.parse(attrs); } catch (e) { attrs = []; }
  }
  if (!Array.isArray(attrs)) attrs = [];
  const copia = attrs.map((a) =>
    a && a.id === "MODEL" ? { ...a, value: modelo, value_name: modelo } : a
  );
  if (!copia.some((a) => a && a.id === "MODEL")) {
    copia.push({ id: "MODEL", name: "Modelo", value: modelo, value_name: modelo });
  }
  return copia;
}

// ----------------------------------------------------------------------------
// PATCH /anuncios-meli/:itemId/revisao   body: { clienteSlug, revisado }
// ----------------------------------------------------------------------------
async function marcarRevisado(req, res) {
  try {
    const { itemId } = req.params;
    const { clienteSlug, revisado } = req.body || {};

    if (!clienteSlug) {
      return res
        .status(400)
        .json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res
        .status(404)
        .json({ ok: false, motivo: "Cliente não encontrado." });
    }

    await anunciosService.marcarRevisado(cliente.id, itemId, revisado);
    return res.json({ ok: true, revisado: !!revisado });
  } catch (err) {
    console.error("[anuncios-meli] marcarRevisado:", err.message);
    return res
      .status(500)
      .json({ ok: false, motivo: "Erro ao atualizar a revisão." });
  }
}

// ----------------------------------------------------------------------------
// POST /anuncios-meli/:itemId/otimizar
// body: { clienteSlug, tipo }   tipo = seo | descricao | ficha_tecnica
// Gera sugestão textual com IA e salva no banco. NÃO atualiza o Mercado Livre.
// ----------------------------------------------------------------------------
async function otimizar(req, res) {
  try {
    const { itemId } = req.params;
    const { clienteSlug, tipo } = req.body || {};

    const resultado = await otimizadorService.otimizar({
      clienteSlug: clienteSlug,
      itemId: itemId,
      tipo: tipo,
      userId: req.user && req.user.id,
    });

    // o service devolve o http status apropriado (400/404/200/500)
    const http = resultado.http || (resultado.ok ? 200 : 400);
    if (resultado.ok) {
      return res.json({
        ok: true,
        tipo: resultado.tipo,
        otimizacao: resultado.otimizacao,
      });
    }
    return res.status(http).json({
      ok: false,
      codigo: resultado.codigo,
      motivo: resultado.motivo,
    });
  } catch (err) {
    console.error("[anuncios-meli] otimizar:", err.message);
    return res.status(500).json({
      ok: false,
      codigo: "ERRO_INTERNO",
      motivo: "Erro interno ao gerar a otimização.",
    });
  }
}

// ----------------------------------------------------------------------------
// GET /anuncios-meli/:itemId/otimizacoes?clienteSlug=&tipo=
// Histórico de sugestões já geradas para um anúncio.
// ----------------------------------------------------------------------------
async function listarOtimizacoes(req, res) {
  try {
    const { itemId } = req.params;
    const { clienteSlug, tipo } = req.query || {};

    if (!clienteSlug) {
      return res
        .status(400)
        .json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const resultado = await otimizadorService.listarOtimizacoes({
      clienteSlug: clienteSlug,
      itemId: itemId,
      tipo: tipo,
    });

    if (!resultado.ok) {
      return res
        .status(resultado.http || 400)
        .json({ ok: false, motivo: resultado.motivo });
    }
    return res.json({ ok: true, otimizacoes: resultado.otimizacoes });
  } catch (err) {
    console.error("[anuncios-meli] listarOtimizacoes:", err.message);
    return res
      .status(500)
      .json({ ok: false, motivo: "Erro ao listar as otimizações." });
  }
}

// ----------------------------------------------------------------------------
// PATCH /anuncios-meli/otimizacoes/:id/aprovar
// body: { tituloAprovado?, modeloAprovado?, descricaoAprovada?,
//         fichaAprovadaJson?, observacao? }
// Registra escolha humana sobre a sugestão. NÃO envia nada ao Mercado Livre.
// ----------------------------------------------------------------------------
async function aprovarOtimizacao(req, res) {
  try {
    const { id } = req.params;
    const resultado = await otimizadorService.aprovar({
      id: parseInt(id, 10),
      dados: req.body || {},
      userId: req.user && req.user.id,
    });
    if (!resultado.ok) {
      return res
        .status(resultado.http || 400)
        .json({ ok: false, motivo: resultado.motivo });
    }
    return res.json({ ok: true, otimizacao: resultado.otimizacao });
  } catch (err) {
    console.error("[anuncios-meli] aprovarOtimizacao:", err.message);
    return res
      .status(500)
      .json({ ok: false, motivo: "Erro ao aprovar a otimização." });
  }
}

// ----------------------------------------------------------------------------
// Criação de Anúncios ML
// ----------------------------------------------------------------------------

async function criacaoStatus(req, res) {
  try {
    const { clienteSlug } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);
    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    const status = await criacaoService.obterStatusConta(cliente.id, clienteContaId);
    return res.json({
      ok: !!status.ok,
      cliente: { slug: cliente.slug, nome: cliente.nome },
      ...status,
    });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] criacaoStatus:", err.message);
    return res.status(500).json({
      ok: false,
      motivo: "Erro ao validar a conta Mercado Livre.",
    });
  }
}

// Resolve o cliente e o mlUserId da conta pedida (ou única/legada), para os
// endpoints de criação que consultam catálogo do ML (categorias, atributos,
// sale terms, tipos de anúncio). Lança MULTIPLE_MARKETPLACE_ACCOUNTS quando
// o cliente tem 2+ contas e nenhuma foi escolhida.
async function resolverClienteEContaCriacao(clienteSlug, clienteContaId) {
  const cliente = await anunciosService.resolverCliente(clienteSlug);
  if (!cliente) return { cliente: null };
  const contexto = await anunciosService.resolverContextoConta({
    clienteId: cliente.id, clienteContaId, requireUsableGrant: true,
  });
  return { cliente, mlUserId: contexto.mlUserId };
}

async function criacaoCategorias(req, res) {
  try {
    const { clienteSlug, q } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);
    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const { cliente, mlUserId } = await resolverClienteEContaCriacao(clienteSlug, clienteContaId);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    const resultado = await criacaoService.buscarCategorias(cliente.id, q, mlUserId);
    if (!resultado.ok) {
      return res.status(resultado.statusMl || 400).json(resultado);
    }
    return res.json(resultado);
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] criacaoCategorias:", err.message);
    return res.status(500).json({
      ok: false,
      motivo: "Erro ao buscar categorias no Mercado Livre.",
    });
  }
}

async function criacaoAtributos(req, res) {
  try {
    const { categoryId } = req.params;
    const { clienteSlug } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);
    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const { cliente, mlUserId } = await resolverClienteEContaCriacao(clienteSlug, clienteContaId);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    const resultado = await criacaoService.obterAtributosCategoria(
      cliente.id,
      categoryId,
      mlUserId
    );
    if (!resultado.ok) {
      return res.status(resultado.statusMl || 400).json(resultado);
    }
    return res.json(resultado);
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] criacaoAtributos:", err.message);
    return res.status(500).json({
      ok: false,
      motivo: "Erro ao carregar atributos da categoria.",
    });
  }
}

async function criacaoSaleTerms(req, res) {
  try {
    const { categoryId } = req.params;
    const { clienteSlug } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);
    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const { cliente, mlUserId } = await resolverClienteEContaCriacao(clienteSlug, clienteContaId);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    const resultado = await criacaoService.obterSaleTermsCategoria(
      cliente.id,
      categoryId,
      mlUserId
    );
    if (!resultado.ok) {
      return res.status(resultado.statusMl || 400).json(resultado);
    }
    return res.json(resultado);
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] criacaoSaleTerms:", err.message);
    return res.status(500).json({
      ok: false,
      motivo: "Erro ao carregar termos comerciais da categoria.",
    });
  }
}

async function criacaoListingTypes(req, res) {
  try {
    const { clienteSlug } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);
    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const { cliente, mlUserId } = await resolverClienteEContaCriacao(clienteSlug, clienteContaId);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    const resultado = await criacaoService.obterTiposAnuncio(cliente.id, mlUserId);
    if (!resultado.ok) {
      return res.status(resultado.statusMl || 400).json(resultado);
    }
    return res.json(resultado);
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] criacaoListingTypes:", err.message);
    return res.status(500).json({
      ok: false,
      motivo: "Erro ao carregar tipos de anúncio.",
    });
  }
}

async function publicarAnuncio(req, res) {
  try {
    const body = req.body || {};
    const { clienteSlug } = body;
    const clienteContaId = extrairClienteContaId(body.clienteContaId);

    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    const resultado = await criacaoService.createMercadoLivreItem({
      clienteId: cliente.id,
      clienteSlug: cliente.slug,
      clienteContaId,
      dados: body,
      createdBy: req.user && req.user.id,
    });

    if (!resultado.ok) {
      return res.status(resultado.http || 400).json({
        ok: false,
        codigo: resultado.codigo,
        motivo: resultado.motivo,
        erros: resultado.erros || [],
        statusMl: resultado.statusMl || null,
      });
    }

    return res.status(201).json({
      ok: true,
      item_id: resultado.item_id,
      permalink: resultado.permalink,
      status: resultado.status,
      listing_type_id: resultado.listing_type_id,
      category_id: resultado.category_id,
      descricaoSalva: resultado.descricaoSalva,
      descricaoErro: resultado.descricaoErro,
      precoAtacadoSolicitado: resultado.precoAtacadoSolicitado,
      precoAtacadoSalvo: resultado.precoAtacadoSalvo,
      precoAtacadoErro: resultado.precoAtacadoErro,
      precoAtacadoFaixas: resultado.precoAtacadoFaixas,
      publicacaoId: resultado.publicacaoId,
      cliente: { slug: cliente.slug, nome: cliente.nome },
    });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] publicarAnuncio:", err.message);
    return res.status(500).json({
      ok: false,
      codigo: "ERRO_INTERNO",
      motivo: "Erro interno ao publicar o anúncio.",
    });
  }
}

async function retryPrecosAtacado(req, res) {
  try {
    const { itemId } = req.params;
    const body = req.body || {};
    const { clienteSlug } = body;
    const clienteContaId = extrairClienteContaId(body.clienteContaId);

    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    const cliente = await anunciosService.resolverCliente(clienteSlug);
    if (!cliente) {
      return res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    }

    const resultado = await criacaoService.retryPrecosAtacado({
      clienteId: cliente.id,
      itemId,
      dados: body,
      clienteContaId,
    });

    if (!resultado.ok) {
      return res.status(resultado.http || 400).json({
        ok: false,
        codigo: resultado.codigo,
        motivo: resultado.motivo,
        erros: resultado.erros || [],
        statusMl: resultado.statusMl || null,
        item_id: resultado.item_id || String(itemId),
        precoAtacadoSolicitado: true,
        precoAtacadoSalvo: false,
        precoAtacadoErro: {
          codigo: resultado.codigo,
          motivo: resultado.motivo,
          erros: resultado.erros || [],
          statusMl: resultado.statusMl || null,
        },
        precoAtacadoFaixas: resultado.precoAtacadoFaixas || [],
      });
    }

    return res.json({
      ok: true,
      item_id: resultado.item_id,
      precoAtacadoSolicitado: true,
      precoAtacadoSalvo: true,
      precoAtacadoErro: null,
      precoAtacadoFaixas: resultado.precoAtacadoFaixas,
      cliente: { slug: cliente.slug, nome: cliente.nome },
    });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] retryPrecosAtacado:", err.message);
    return res.status(500).json({
      ok: false,
      codigo: "ERRO_INTERNO",
      motivo: "Erro interno ao cadastrar os preços de atacado.",
    });
  }
}

module.exports = {
  listarClientes,
  sincronizar,
  resumo,
  listar,
  listarAgrupado,
  detalheFamilia,
  performance,
  detalhe,
  atualizarConteudo,
  atualizarEstoque,
  atualizarPreco,
  simularMargem,
  marcarRevisado,
  otimizar,
  listarOtimizacoes,
  aprovarOtimizacao,
  criacaoStatus,
  criacaoCategorias,
  criacaoAtributos,
  criacaoSaleTerms,
  criacaoListingTypes,
  publicarAnuncio,
  retryPrecosAtacado,
};
