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
const variacoesLegadoService = require("../services/meliAnuncios/meliVariacoesLegadoService");
const variacoesLegadoEstoqueService = require("../services/meliAnuncios/meliVariacoesLegadoEstoqueService");
const precoService = require("../services/meliAnuncios/meliPrecoService");
const promocoesService = require("../services/meliAnuncios/meliPromocoesService");
const promocoesEscritaService = require("../services/meliAnuncios/meliPromocoesEscritaService");
const metricas7dService = require("../services/meliAnuncios/meliMetricas7dService");
const motorMargemService = require("../services/motorMargem/motorMargemService");
const cliente360ProdutosEngine = require("../services/cliente360/cliente360ProdutosEngine");
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

// Critérios com ranking GLOBAL (contra o catálogo filtrado inteiro, via
// Motor de Margem) — margem_*/unidades_* NÃO entram aqui de propósito:
// continuam ordenação local de página no frontend (aplicarOrdenacaoPerformance
// em Portal/anuncios-meli.js), decisão explícita da auditoria "ordenação
// global limitada à página atual" — margem/unidades exigiriam recalcular o
// Motor pro catálogo inteiro a cada ordenação, sem cache, custo não aceito.
const ORDENACOES_GLOBAIS = {
  faturamento_asc: { campo: "faturamento", direcao: "asc" },
  faturamento_desc: { campo: "faturamento", direcao: "desc" },
  curvaAbc_asc: { campo: "curvaAbc", direcao: "asc" },
  curvaAbc_desc: { campo: "curvaAbc", direcao: "desc" },
};
const CURVA_ABC_ORDEM = { A: 1, B: 2, C: 3 };

// Ranking GLOBAL contra o catálogo FILTRADO inteiro (q/status/filtro/conta),
// não só a página pedida — corrige o bug em que ordenar por %Faturamento ou
// Curva ABC só valia dentro da página atual (auditoria "ordenação global
// limitada à página atual"). Só entra aqui quando `ordenarPor` bate um dos
// ORDENACOES_GLOBAIS; caminho de sempre (listarAgrupado do service) fica
// intocado para qualquer outro valor.
//
// Custo: uma query leve (só chaves, sem os agregados pesados) sobre o
// catálogo inteiro filtrado + UMA chamada ao Motor com itemIds:[] — o Motor
// monta `porMlb` (receita por MLB) pro PERÍODO INTEIRO independente de
// itemIds, via `prepareWorkspaceContext` (já completo ANTES de enrichBatch
// rodar, e intocado por esta injeção). O que torna a chamada barata NÃO é
// `itemIds: []` sozinho — em `enrichBatch`, `itemIds: []` cai no `else`
// (array vazio falha `Array.isArray(itemIds) && itemIds.length`) e dispara
// `buscarItensAtivos` + `buscarDetalhesItens` (3 chamadas AO VIVO ao Mercado
// Livre) e o pipeline de enriquecimento inteiro — tudo descartado, porque
// esta função só lê `porMlb`/`periodo` de `prepared`. Por isso o `enrichBatch`
// é substituído por um no-op via injeção de dependência (`montarItens` já
// repassa `deps` para `enrichBatch` — ver motorMargemService.js): só a página
// final (após ordenar e cortar) é hidratada com detalhe completo
// (título/preço/capa), nunca aqui.
async function listarAgrupadoOrdenadoPorMotor({ cliente, clienteContaId, includeLegacy, q, status, filtro, page, limit, config }) {
  const chaves = await familiaService.listarChavesFiltradas({
    clienteId: cliente.id, clienteContaId, includeLegacy, q, status, filtro,
  });

  const familyIds = Array.from(new Set(chaves.filter((c) => c.family_id != null).map((c) => c.family_id)));
  const itemIdsIndividuais = chaves.filter((c) => c.family_id == null).map((c) => c.item_id);

  let porFamiliaItens = new Map();
  if (familyIds.length) {
    porFamiliaItens = await familiaService.resolverItensDeFamilias({
      clienteId: cliente.id, clienteContaId, includeLegacy, familyIds,
    });
  }

  let motorResultado;
  try {
    motorResultado = await motorMargemService.montarItens(
      { clienteSlug: cliente.slug, clienteContaId, itemIds: [] },
      // No-op: esta função só precisa de `porMlb`/`periodo`, montados pelo
      // `prepareWorkspaceContext` que roda ANTES de `enrichBatch` — dispensar
      // o enriquecimento por item evita 3 chamadas AO VIVO ao Mercado Livre
      // que este caminho nunca usaria (ver comentário acima).
      { enrichBatch: async () => ({ totalItensMl: 0, itens: [] }) }
    );
  } catch (err) {
    // Qualquer falha aqui — típica (Base não vinculada etc., com
    // err.payload.codigo) ou inesperada (timeout, erro de rede, bug) — cai
    // pro SQL padrão em vez de virar 500: Restrição Global #5 do plano
    // ("Motor indisponível nunca pode virar erro 500"). A distinção só muda
    // o LOG e a mensagem exposta, nunca o comportamento de fallback.
    const tipada = err.statusCode && err.payload && err.payload.codigo;
    if (!tipada) {
      console.error(
        "[anuncios-meli] listarAgrupadoOrdenadoPorMotor: erro inesperado do Motor, caindo para ordem padrão:",
        err.message
      );
    }
    const fallback = await familiaService.listarAgrupado({
      clienteId: cliente.id, clienteContaId, includeLegacy, q, status, filtro, page, limit,
    });
    return {
      ...fallback,
      ordenacaoAplicada: false,
      ordenacaoIndisponivel: tipada
        ? { codigo: err.payload.codigo, mensagem: err.payload.erro }
        : { codigo: "ERRO_INESPERADO", mensagem: "Não foi possível ordenar globalmente no momento." },
    };
  }

  const { porMlb, periodo } = motorResultado;
  const uniao = new Set(itemIdsIndividuais);
  for (const filhos of porFamiliaItens.values()) for (const id of filhos) uniao.add(id);
  const todosItemIds = Array.from(uniao);

  const ranking = config.campo === "faturamento"
    ? montarFaturamento(porMlb, todosItemIds, periodo, porFamiliaItens)
    : montarCurvaAbc(porMlb, todosItemIds, periodo, porFamiliaItens);
  const campoResposta = config.campo === "faturamento" ? "faturamentoPercentual" : "curvaAbc";

  const comValor = chaves.map((c) => {
    const valorBruto = c.family_id != null ? ranking.porFamilia[c.family_id] : ranking.porItem[c.item_id];
    const valorOrdenacao = config.campo === "curvaAbc"
      ? (valorBruto != null ? CURVA_ABC_ORDEM[valorBruto] : null)
      : valorBruto;
    return { chave: c, valorBruto, valorOrdenacao };
  });

  // Tie-break por grupo_key: sem isso, dois grupos empatados (ex.: mesma
  // Curva ABC, ou ambos sem faturamento no período) dependem da ordem que
  // `listarChavesFiltradas` devolveu — e essa query é um `GROUP BY` SEM
  // `ORDER BY` (ver LISTAR_CHAVES_FILTRADAS em meliFamiliaService.js), então
  // o Postgres não garante a mesma ordem entre a chamada da página 1 e a da
  // página 2 (cada uma roda a query de novo). Um reshuffle na zona de empate
  // reproduz o bug exato que este plano existe para corrigir (item duplicado
  // ou sumido entre páginas). Mesmo desempate (`grupo_key ASC`) que
  // LISTAR_AGRUPADO_PAGINA já usa como estabilizador final.
  comValor.sort((x, y) => {
    let cmp;
    if (x.valorOrdenacao == null && y.valorOrdenacao == null) cmp = 0;
    else if (x.valorOrdenacao == null) cmp = 1;
    else if (y.valorOrdenacao == null) cmp = -1;
    else cmp = config.direcao === "asc" ? x.valorOrdenacao - y.valorOrdenacao : y.valorOrdenacao - x.valorOrdenacao;
    if (cmp !== 0) return cmp;
    return x.chave.grupo_key < y.chave.grupo_key ? -1 : (x.chave.grupo_key > y.chave.grupo_key ? 1 : 0);
  });

  const total = comValor.length;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const pag = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pag - 1) * lim;
  const paginaComValor = comValor.slice(offset, offset + lim);

  const grupoKeysDaPagina = paginaComValor.map((x) => x.chave.grupo_key);
  const rows = await familiaService.listarAgrupadoPorChaves({
    clienteId: cliente.id, clienteContaId, includeLegacy, grupoKeys: grupoKeysDaPagina,
  });
  const rowsPorChave = new Map(rows.map((r) => [r.grupo_key, r]));
  const rowsOrdenadas = grupoKeysDaPagina.map((k) => rowsPorChave.get(k)).filter(Boolean);

  const anuncios = await familiaService.montarAnunciosDeRows(rowsOrdenadas, {
    clienteId: cliente.id, clienteContaId, includeLegacy, termo: String(q || "").trim(),
  });

  const valorPorChave = new Map(paginaComValor.map((x) => [x.chave.grupo_key, x.valorBruto]));
  for (const anuncio of anuncios) {
    const chave = anuncio.tipo === "familia" ? `fam:${anuncio.family_id}` : `item:${anuncio.item_id}`;
    anuncio[campoResposta] = valorPorChave.has(chave) ? valorPorChave.get(chave) : null;
  }
  // Valor absoluto (R$) junto do percentual que decidiu a posição — mesma
  // fonte (ranking.porItemValor/porFamiliaValor), nunca um recálculo. Só
  // existe quando o critério é faturamento (Curva ABC não tem "valor").
  if (config.campo === "faturamento") {
    for (const anuncio of anuncios) {
      anuncio.faturamentoValor = anuncio.tipo === "familia"
        ? (ranking.porFamiliaValor[anuncio.family_id] != null ? ranking.porFamiliaValor[anuncio.family_id] : null)
        : (ranking.porItemValor[anuncio.item_id] != null ? ranking.porItemValor[anuncio.item_id] : null);
    }
  }

  return {
    anuncios,
    paginacao: { page: pag, limit: lim, total, totalPaginas: Math.max(Math.ceil(total / lim), 1) },
    ordenacaoAplicada: true,
    ordenacaoIndisponivel: null,
  };
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
    const { clienteSlug, q, status, filtro, page, limit, ordenarPor } = req.query || {};
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

    const configGlobal = ORDENACOES_GLOBAIS[ordenarPor];
    const resultado = configGlobal
      ? await listarAgrupadoOrdenadoPorMotor({
          cliente, clienteContaId: contaId, includeLegacy, q, status, filtro, page, limit, config: configGlobal,
        })
      : await familiaService.listarAgrupado({
          clienteId: cliente.id, clienteContaId: contaId, includeLegacy, q, status, filtro, page, limit,
        });

    const resposta = {
      ok: true,
      cliente: { slug: cliente.slug, nome: cliente.nome },
      anuncios: resultado.anuncios,
      paginacao: resultado.paginacao,
    };
    if (configGlobal) {
      resposta.ordenacaoAplicada = resultado.ordenacaoAplicada;
      resposta.ordenacaoIndisponivel = resultado.ordenacaoIndisponivel;
    }
    return res.json(resposta);
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
// Motor, `item.pricing.current`), `precoOriginal` (preço cheio/regular AO
// VIVO quando há promoção, `item.pricing.list` — mesma evidência
// sale_price.regular_amount via resolverPrecosItem que a composição usa
// para `precoPromocionalAtivo`) e `precoAlvo` (preço CALCULADO pelo Motor
// para a margem-alvo, `item.margin.target`) — ver montarMapaMargem. Os três
// são `null` quando o Motor não tem o dado, nunca 0: o front mantém o
// snapshot sincronizado da listagem (`a.preco`/`a.preco_original`) como
// fallback nesse caso.
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
function montarComposicaoDoItem(item, origem, rebate = null) {
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

  // `venda` (item.pricing.current) é o preço EFETIVO — com promoção ativa no
  // Mercado Livre, é o preço PROMOCIONAL, não o standard (ver
  // meliApiEvidenceAdapter/marketplaceCurrentQuoteService). O front usa este
  // flag só para BLOQUEAR a edição de preço nesse caso — hoje não existe
  // endpoint de escrita para o preço promocional (ver meliPrecoService), e
  // editar sem bloquear faria a tela mostrar um valor e gravar outro.
  const precoPromocionalAtivo = valorEvidencia(item.pricing.promo) != null;

  // `rebate` (retorno ML da promoção ATIVA, ver performance() §subsidioMl):
  // null quando não há promoção ativa (ou o front não pediu) — a linha
  // "Taxa de rebate" some sozinha na composição nesse caso, mesmo padrão de
  // `taxaFixa`. Nunca calculado aqui — só repassado por quem já recalculou
  // `margem[itemId]` com este mesmo valor (ver montarMapaMargem).
  return {
    venda, custoProduto, comissaoMl, frete, taxaFixa, impostoPercentual, impostoValor,
    precoPromocionalAtivo, rebate,
  };
}

// Recalcula margem/composição de UM item somando o rebate ML da promoção
// ATIVA — reaproveita EXATAMENTE `extrairValoresBaseParaSimulacao` +
// `marginEngine.computeMargin` (mesmo par usado por `anexarVoceRecebe`),
// nunca uma fórmula paralela. `null` quando não há rebate para aplicar (sem
// `rebateAlvo` para este item, ou item não-computável) — quem chama usa a
// margem original do Motor nesse caso.
function calcularMargemComRebate(item, origem, exibida, rebateAlvo) {
  if (!exibida || !exibida.computable || !rebateAlvo) return null;
  if (String(item.identity.itemId) !== String(rebateAlvo.itemId)) return null;
  const base = extrairValoresBaseParaSimulacao(item, origem);
  const resultado = marginEngine.computeMargin({ ...base, rebate: rebateAlvo.valor });
  return resultado.computable ? resultado : null;
}

// ----------------------------------------------------------------------------
// Filtros de performance (% faturamento / unidades vendidas / Curva ABC) —
// ver auditoria "Anúncios ML — análise de viabilidade de novos filtros de
// performance". Escopo desta etapa: ORDENAÇÃO, sem filtro de faixa/período.
//
// Os três campos abaixo carregam `periodoDias` (contexto de período) no
// próprio corpo, em vez de embutir o número no nome do campo/flag
// (`unidadesVendidas7d`, `curvaAbc30d`) — o período pode virar configurável
// no futuro sem exigir um contrato novo.
// ----------------------------------------------------------------------------

function diasNoPeriodo(periodo) {
  if (!periodo || !periodo.dateFrom || !periodo.dateTo) return null;
  const de = new Date(periodo.dateFrom + "T00:00:00Z");
  const ate = new Date(periodo.dateTo + "T00:00:00Z");
  const dias = Math.round((ate.getTime() - de.getTime()) / 86400000) + 1;
  return Number.isFinite(dias) && dias > 0 ? dias : null;
}

// % que a receita do item representa sobre a receita de TODO o período
// (porMlb inteiro, do Motor de Margem/Central de Vendas — mesma fonte que já
// alimenta `margem[itemId]`) — nunca só a receita do lote de itemIds pedido,
// que mudaria a cada página/rolagem sem o total do período mudar junto.
// null (nunca 0%) quando o item não tem receita no período: sem venda não há
// participação, é ausência de fato, não zero.
// `porFamiliaItens` (mesmo Map de montarCurvaAbc): o percentual da família é
// a receita SOMADA dos filhos sobre o MESMO receitaTotalPeriodo — nunca a
// soma dos percentuais prontos de cada filho (mesmo resultado matemático
// aqui, porque o denominador é o mesmo para todos, mas recalcular a partir
// da receita bruta não depende dessa coincidência se o denominador um dia
// mudar por item).
// `porItemValor`/`porFamiliaValor`: valor ABSOLUTO (R$) que já estava
// calculado aqui dentro (`receita`/`receitaFamilia`) e era descartado depois
// de virar percentual. Campos ADITIVOS — `porItem`/`porFamilia` continuam
// exatamente como estavam, e o valor absoluto nunca é derivado do percentual
// (que já chega arredondado a 4 casas) porque isso perderia centavos (ver
// auditoria "Curva ABC sempre visível + faturamento absoluto").
function montarFaturamento(porMlb, itemIds, periodo, porFamiliaItens) {
  let receitaTotalPeriodo = 0;
  for (const agregado of porMlb.values()) receitaTotalPeriodo += agregado.receita || 0;
  receitaTotalPeriodo = Math.round(receitaTotalPeriodo * 100) / 100;

  const porItem = {};
  const porItemValor = {};
  for (const itemId of itemIds) {
    const agregado = porMlb.get(String(itemId));
    const receita = agregado ? agregado.receita : null;
    porItem[itemId] =
      receita != null && receitaTotalPeriodo > 0
        ? Math.round((receita / receitaTotalPeriodo) * 10000) / 10000
        : null;
    porItemValor[itemId] = receita != null ? Math.round(receita * 100) / 100 : null;
  }

  const porFamilia = {};
  const porFamiliaValor = {};
  for (const [familyId, itensDaFamilia] of (porFamiliaItens || new Map())) {
    let receitaFamilia = 0;
    let teveReceita = false;
    for (const itemId of itensDaFamilia) {
      const agregado = porMlb.get(String(itemId));
      if (agregado && agregado.receita) { receitaFamilia += agregado.receita; teveReceita = true; }
    }
    porFamilia[familyId] =
      teveReceita && receitaTotalPeriodo > 0
        ? Math.round((receitaFamilia / receitaTotalPeriodo) * 10000) / 10000
        : null;
    porFamiliaValor[familyId] = teveReceita ? Math.round(receitaFamilia * 100) / 100 : null;
  }

  return { periodoDias: diasNoPeriodo(periodo), receitaTotalPeriodo, porItem, porFamilia, porItemValor, porFamiliaValor };
}

// Reaproveita cliente360ProdutosEngine.classificarCurvaAbc (mesmo critério de
// Pareto do Cliente 360, A=80%/B=95%/resto=C) — não duplica a fórmula, só
// adapta o Map que o Motor de Margem já monta (porMlb, chave `receita`) para
// o shape que a função espera (`perfil`, chave `rec`). Precisa do porMlb
// INTEIRO: classificar um item olhando só para o lote da tela o classificaria
// contra um catálogo errado (um item mediano pareceria "A" numa página cheia
// de itens fracos).
//
// `porFamiliaItens` (Map família -> [item_id filhos], de
// meliFamiliaService.resolverItensDeFamilias): quando presente, cada família
// colapsa em UMA entrada no Pareto (receita somada dos filhos) — a família
// nunca herda a classe do filho mais forte, ela É um produto próprio com
// receita própria. MLBs fora de qualquer família pedida mantêm sua entrada
// individual, sem nenhuma mudança de comportamento.
function montarCurvaAbc(porMlb, itemIds, periodo, porFamiliaItens) {
  const itemParaFamilia = new Map();
  for (const [familyId, itensDaFamilia] of (porFamiliaItens || new Map())) {
    for (const itemId of itensDaFamilia) itemParaFamilia.set(String(itemId), familyId);
  }

  const perfil = new Map();
  for (const [mlb, agregado] of porMlb) {
    const chave = itemParaFamilia.get(mlb) || mlb;
    if (!perfil.has(chave)) perfil.set(chave, { mlb: chave, rec: 0 });
    perfil.get(chave).rec += agregado.receita || 0;
  }
  const classe = cliente360ProdutosEngine.classificarCurvaAbc(perfil);

  const porItem = {};
  for (const itemId of itemIds) porItem[itemId] = classe.get(String(itemId)) || null;
  const porFamilia = {};
  for (const familyId of (porFamiliaItens || new Map()).keys()) porFamilia[familyId] = classe.get(familyId) || null;

  return { periodoDias: diasNoPeriodo(periodo), porItem, porFamilia };
}

// Soma o PROFIT (R$, absoluto — nunca a margem percentual, que não é
// somável) dos filhos já resolvidos de cada família. Lê de `margem`, o mapa
// PLANO que montarMapaMargem já construiu — os filhos só têm entrada ali
// porque entraram no MESMO lote pedido ao Motor (ver performance()).
function montarMargemPorFamilia(porFamiliaItens, margem) {
  const porFamilia = {};
  for (const [familyId, itensDaFamilia] of porFamiliaItens) {
    let soma = null;
    for (const itemId of itensDaFamilia) {
      const m = margem[itemId];
      if (!m || m.profit == null) continue;
      soma = (soma == null ? 0 : soma) + m.profit;
    }
    porFamilia[familyId] = soma != null ? Math.round(soma * 100) / 100 : null;
  }
  return porFamilia;
}

// `obterVendasDoItem(itemId)` decide a fonte (metricas7d.vendas reaproveitado
// ou buscarVendas7dPorItens direto) — esta função só monta o envelope com
// periodoDias, mesmo padrão de montarFaturamento/montarCurvaAbc.
function montarUnidadesVendidas(itemIds, obterVendasDoItem) {
  const porItem = {};
  for (const itemId of itemIds) porItem[itemId] = obterVendasDoItem(itemId);
  return { periodoDias: metricas7dService.JANELA_DIAS, porItem };
}

function montarMapaMargem(itens, incluirComposicao, rebateAlvo) {
  const margem = {};
  const composicao = {};
  for (const item of itens || []) {
    const realized = item.margin && item.margin.realized;
    const projected = item.margin && item.margin.projected;
    const usaRealizada = !!(realized && realized.computable);
    const exibida = usaRealizada ? realized : projected;
    const origem = usaRealizada ? "realized" : "projected";
    const itemId = item.identity.itemId;

    const comRebate = calcularMargemComRebate(item, origem, exibida, rebateAlvo);

    margem[itemId] = {
      origem,
      margin: comRebate ? comRebate.margin : (exibida ? exibida.margin : null),
      marginPercent: comRebate
        ? (comRebate.margin === null ? null : Math.round(comRebate.margin * 10000) / 100)
        : (exibida ? exibida.marginPercent : null),
      // Lucro em R$ (o Motor já calcula — `margin`/`marginPercent` acima são
      // só a RAZÃO/percentual). Aditivo: a lista nunca leu este campo, só a
      // seção "Composição da margem" do modal precisa dele para a linha
      // final "= Margem" em moeda.
      profit: comRebate ? comRebate.profit : (exibida ? exibida.profit : null),
      status: item.quality.status,
      statusLabel: item.quality.statusLabel,
      statusReasons: item.quality.statusReasons,
      // Preço OBTIDO pelo Motor ao vivo (sale_price no momento desta chamada,
      // mesmo `item.pricing.current` que a composição já usa como `venda`) —
      // independe de origem realizada/projetada, é sempre "o que o anúncio
      // vale agora". `null` quando o Motor não trouxe evidência de preço
      // (nunca 0): o front mantém o preço sincronizado (`a.preco`) nesse caso.
      precoAtual: valorEvidencia(item.pricing && item.pricing.current),
      // Preço CHEIO/regular AO VIVO (`item.pricing.list`, mesma evidência
      // sale_price.regular_amount via resolverPrecosItem que a composição já
      // usa) — só vem preenchido quando há promoção ativa no momento desta
      // chamada. `null` (nunca 0, nunca copiado de outro campo) quando não
      // há promoção ou o Motor não tem a evidência: a lista/modal mantêm o
      // `preco_original` sincronizado (snapshot) como fallback nesse caso —
      // ver Portal/anuncios-meli.js celulaPrecoHtml/precoDetalheHtml.
      precoOriginal: valorEvidencia(item.pricing && item.pricing.list),
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
      composicao[itemId] = montarComposicaoDoItem(item, origem, comRebate ? rebateAlvo.valor : null);
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
    // Opt-in, mesmo padrão de incluirComposicao — "Somente buscar/calcular
    // dados adicionais quando solicitado" (auditoria de filtros de performance).
    const incluirFaturamento = flagOptIn(req.query && req.query.incluirFaturamento);
    const incluirUnidades = flagOptIn(req.query && req.query.incluirUnidades);
    const incluirCurvaAbc = flagOptIn(req.query && req.query.incluirCurvaAbc);
    // Famílias a agregar (ordenação com família agregada) — o front manda só
    // o family_id, nunca os MLBs filhos: o backend resolve (ver
    // meliFamiliaService.resolverItensDeFamilias).
    const familiasBrutas = String((req.query && req.query.familias) || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);

    // subsidioMl/subsidioMlItemId: rebate ML da promoção ATIVA selecionada
    // no modal (mesmo campo `subsidioMl` de POST .../simular-margem) — o
    // front já tem esse valor em cache (garantirPromocoesDoItem roda ao
    // abrir o modal, antes da composição), então chega pronto aqui, sem
    // nenhuma chamada nova ao Mercado Livre. Opcional: ausente = comporta-
    // mento idêntico ao anterior. Só é aplicado ao item cujo itemId bate com
    // `subsidioMlItemId` (ver montarMapaMargem/calcularMargemComRebate) —
    // nunca contamina outros itens do mesmo lote.
    let rebateAlvo = null;
    if (req.query && req.query.subsidioMl !== undefined) {
      const n = Number(req.query.subsidioMl);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ ok: false, motivo: "O campo subsidioMl precisa ser um número maior ou igual a zero." });
      }
      const subsidioMlItemId = req.query.subsidioMlItemId;
      if (subsidioMlItemId != null && String(subsidioMlItemId).trim() !== "") {
        rebateAlvo = { itemId: String(subsidioMlItemId).trim(), valor: n };
      }
    }

    // % faturamento e Curva ABC precisam do porMlb (agregado do período
    // inteiro) que só `motorMargemService.montarItens` monta — então o Motor
    // roda mesmo com incluirMargem=0, se qualquer um dos dois foi pedido.
    // `margem`/`composicao` continuam obedecendo só a incluirMargem (nenhuma
    // mudança de comportamento nesse campo).
    const precisaMotor = incluirMargem || incluirFaturamento || incluirCurvaAbc;
    // incluirUnidades sem incluirMetricas busca só vendas (mais barato,
    // sem visitas) — nunca duplica a chamada quando os dois pedem o mesmo dado.
    const precisaVendasSo = incluirUnidades && !incluirMetricas;

    if ((!itemIds.length && !familiasBrutas.length) || (!incluirMetricas && !precisaMotor && !precisaVendasSo)) {
      return res.json({
        ok: true, metricas7d: {}, margem: {}, margemIndisponivel: null, composicao: {},
        faturamento: null, unidadesVendidas: null, curvaAbc: null, margemPorFamilia: null,
      });
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

    // Resolve família -> filhos ANTES do lote ir para os serviços de baixo:
    // os filhos entram no MESMO pedido ao Motor de Margem/vendas7d, nunca uma
    // segunda rodada de chamadas (ver auditoria "filtros de performance").
    let porFamiliaItens = new Map();
    if (familiasBrutas.length) {
      porFamiliaItens = await familiaService.resolverItensDeFamilias({
        clienteId: cliente.id,
        clienteContaId: contexto.contaId,
        includeLegacy: false,
        familyIds: familiasBrutas,
      });
    }

    // União itemIds + filhos resolvidos, com o MESMO teto de sempre — agora
    // aplicado ao conjunto inteiro (nunca só ao itemIds explícito), porque é
    // esse conjunto inteiro que vai para os serviços de baixo.
    let itemIdsCompletos = itemIds;
    if (porFamiliaItens.size) {
      const vistos = new Set(itemIds);
      const uniao = itemIds.slice();
      for (const filhos of porFamiliaItens.values()) {
        for (const id of filhos) {
          if (!vistos.has(id)) { vistos.add(id); uniao.push(id); }
        }
      }
      itemIdsCompletos = uniao.slice(0, PERFORMANCE_MAX_ITENS);
      if (uniao.length > itemIdsCompletos.length) {
        console.warn(
          `[anuncios-meli] performance: itemIds+filhos de família cortado de ${uniao.length} para ${itemIdsCompletos.length} (teto PERFORMANCE_MAX_ITENS).`
        );
      }
    }

    const [metricasResultado, vendasSoResultado, margemResultado] = await Promise.allSettled([
      incluirMetricas
        ? metricas7dService.montarMetricas7d({ clienteId: cliente.id, mlUserId: contexto.mlUserId, itemIds: itemIdsCompletos })
        : Promise.resolve(null),
      precisaVendasSo
        ? metricas7dService.buscarVendas7dPorItens({ clienteId: cliente.id, mlUserId: contexto.mlUserId, itemIds: itemIdsCompletos })
        : Promise.resolve(null),
      precisaMotor
        ? motorMargemService.montarItens({
            clienteSlug: cliente.slug,
            clienteContaId: contexto.contaId,
            itemIds: itemIdsCompletos,
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
    let faturamento = null;
    let curvaAbc = null;
    let margemPorFamilia = null;
    if (!precisaMotor) {
      // nenhum dos três campos que dependem do Motor foi pedido.
    } else if (margemResultado.status === "fulfilled") {
      const { porMlb } = margemResultado.value;
      if (incluirMargem) {
        const resultado = montarMapaMargem(margemResultado.value.itens, incluirComposicao, rebateAlvo);
        margem = resultado.margem;
        composicao = resultado.composicao;
        if (porFamiliaItens.size) margemPorFamilia = montarMargemPorFamilia(porFamiliaItens, margem);
      }
      if (incluirFaturamento) faturamento = montarFaturamento(porMlb, itemIdsCompletos, margemResultado.value.periodo, porFamiliaItens);
      if (incluirCurvaAbc) curvaAbc = montarCurvaAbc(porMlb, itemIdsCompletos, margemResultado.value.periodo, porFamiliaItens);
    } else {
      const err = margemResultado.reason;
      if (err && err.statusCode && err.payload && err.payload.codigo) {
        // Contexto do Motor não está pronto (Base não vinculada, múltiplas
        // bases, grant caído) — mensagem REAL do Motor, não tradução própria.
        // Composição/faturamento/Curva ABC somem junto: sem contexto pronto
        // não há porMlb nenhum pra decompor ou classificar.
        margemIndisponivel = { codigo: err.payload.codigo, mensagem: err.payload.erro };
      } else {
        console.error("[anuncios-meli] performance margem:", err && err.message);
      }
    }

    let unidadesVendidas = null;
    if (incluirUnidades && incluirMetricas) {
      // reaproveita metricas7d[itemId].vendas — já buscado acima, mesma régua
      // (0 = fato, null = não sabemos porque a busca falhou) de meliMetricas7dService.
      unidadesVendidas = montarUnidadesVendidas(itemIdsCompletos, (itemId) => {
        const m = metricas7d[itemId];
        return m ? m.vendas : null;
      });
    } else if (precisaVendasSo && vendasSoResultado.status === "fulfilled") {
      const r = vendasSoResultado.value;
      unidadesVendidas = montarUnidadesVendidas(itemIdsCompletos, (itemId) =>
        !r.ok ? null : (Object.prototype.hasOwnProperty.call(r.porItem, itemId) ? r.porItem[itemId] : 0)
      );
    } else if (precisaVendasSo) {
      console.error("[anuncios-meli] performance unidadesVendidas:", vendasSoResultado.reason && vendasSoResultado.reason.message);
    }

    return res.json({ ok: true, metricas7d, margem, margemIndisponivel, composicao, faturamento, unidadesVendidas, curvaAbc, margemPorFamilia });
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
// GET /anuncios-meli/:itemId/variacoes-legado?clienteSlug=&clienteContaId=
//
// Expansão do modelo LEGADO do ML (item_id -> variations[]), para um anúncio
// sem family_id que mesmo assim tem cor/tamanho reais (variations_count > 0,
// ver meliSyncService/meliFamiliaService). Read-only: só GET no Mercado
// Livre, nada persistido — ver meliVariacoesLegadoService para o porquê de a
// edição ficar de fora.
// ----------------------------------------------------------------------------
async function variacoesLegado(req, res) {
  try {
    const { itemId } = req.params;
    const { clienteSlug } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);

    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
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

    // Mesma regra de conta do vizinho GET /:itemId: a linha já sabe de qual
    // conta veio; só resolve de novo quando essa coluna ainda está vazia.
    let mlUserId = anuncio.ml_user_id || null;
    if (!mlUserId) {
      const contexto = await anunciosService.resolverContextoConta({
        clienteId: cliente.id, clienteContaId, requireUsableGrant: false,
      });
      mlUserId = contexto.mlUserId;
    }

    const r = await variacoesLegadoService.buscarVariacoesLegado({
      clienteId: cliente.id, itemId, mlUserId,
    });

    if (!r.ok) {
      return res.json({ ok: false, codigo: r.codigo, motivo: r.motivo });
    }

    return res.json({ ok: true, variacoes: r.variacoes });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] variacoesLegado:", err.message);
    return res.status(500).json({ ok: false, motivo: "Erro ao carregar as variações do anúncio." });
  }
}

// Coluna "Você recebe" pré-calculada por promoção, sem esperar o clique em
// "Simular" — reaproveita EXATAMENTE o mesmo Motor de POST .../simular-margem
// (motorMargemService.montarItens + marginEngine.computeMargin), nunca uma
// fórmula paralela: para cada promoção, price=precoFinal e rebate=subsidioMl
// (mesmo campo usado por simularMargem quando o operador seleciona a linha).
// custo/imposto/comissão/frete vêm sempre da origem "projected" do item, uma
// única chamada ao Motor pro item inteiro — nunca uma por promoção.
//
// Nunca bloqueia a listagem: se o Motor falhar (Base não vinculada, conta
// ambígua, item não encontrado) ou não houver precoFinal, a linha volta com
// voceRecebe: null — mesma postura de resiliência do enriquecimento de
// vigência (ver meliPromocoesService.enriquecerVigencia).
async function anexarVoceRecebe({ cliente, clienteContaId, itemId, promocoesItem }) {
  let base = null;
  try {
    const resultadoMotor = await motorMargemService.montarItens({
      clienteSlug: cliente.slug, clienteContaId, itemIds: [itemId],
    });
    const item = (resultadoMotor.itens || []).find((it) => it.identity.itemId === String(itemId));
    if (item) base = extrairValoresBaseParaSimulacao(item, "projected");
  } catch (_) {
    base = null;
  }

  return promocoesItem.map((p) => {
    if (!base || p.precoFinal == null) return { ...p, voceRecebe: null };
    const resultado = marginEngine.computeMargin({
      price: p.precoFinal,
      cost: base.cost,
      taxRate: base.taxRate,
      fixedFee: base.fixedFee,
      commission: base.commission,
      freight: base.freight,
      rebate: p.subsidioMl,
    });
    return {
      ...p,
      voceRecebe: {
        computable: resultado.computable,
        profit: resultado.profit,
        marginPercent: resultado.margin != null ? resultado.margin * 100 : null,
      },
    };
  });
}

// ----------------------------------------------------------------------------
// GET /anuncios-meli/:itemId/promocoes?clienteSlug=&clienteContaId=
//
// Promoções OFICIAIS do Mercado Livre para o item (GET /seller-promotions/
// items/{id}?app_version=v2, ver meliPromocoesService) — alimenta o bloco
// "Promoções disponíveis" do modal, ao lado da composição da margem. Cada
// linha já chega com "Você recebe" pré-calculado (ver anexarVoceRecebe) —
// "Simular" no frontend só serve pra alterações manuais do preço/custo.
// Read-only nos dois sentidos: só lê o Mercado Livre, nunca inscreve o item
// em promoção nenhuma nem grava preço nenhum.
// ----------------------------------------------------------------------------
async function promocoes(req, res) {
  try {
    const { itemId } = req.params;
    const { clienteSlug } = req.query || {};
    const clienteContaId = extrairClienteContaId(req.query && req.query.clienteContaId);

    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
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

    // Mesma regra de conta dos vizinhos GET /:itemId e /:itemId/variacoes-legado.
    let mlUserId = anuncio.ml_user_id || null;
    if (!mlUserId) {
      const contexto = await anunciosService.resolverContextoConta({
        clienteId: cliente.id, clienteContaId, requireUsableGrant: false,
      });
      mlUserId = contexto.mlUserId;
    }

    const promocoesItem = await promocoesService.listarPromocoesDoItem({
      clienteId: cliente.id, itemId, mlUserId,
    });

    const comMargem = await anexarVoceRecebe({ cliente, clienteContaId, itemId, promocoesItem });

    return res.json({ ok: true, itemId: String(itemId), promocoes: comMargem });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] promocoes:", err.message);
    return res.status(500).json({ ok: false, motivo: "Erro ao carregar as promoções do anúncio." });
  }
}

// ----------------------------------------------------------------------------
// POST /anuncios-meli/:itemId/promocoes/:promotionId/aplicar
//   body: { clienteSlug, clienteContaId?, precoNovo }
//
// ESCRITA REAL de participação (candidate -> POST) ou alteração
// (started/pending -> PUT) numa promoção — ver meliPromocoesEscritaService
// para o porquê do escopo ficar restrito a DEAL/SELLER_CAMPAIGN nesta v1.
// Nunca chamado sem clique explícito do operador no diálogo de confirmação
// (Preço atual / Novo preço / Impacto na margem) do frontend. Não toca
// meli_anuncios — só a API de promoções do Mercado Livre.
// ----------------------------------------------------------------------------
async function aplicarPromocao(req, res) {
  try {
    const { itemId, promotionId } = req.params;
    const body = req.body || {};
    const { clienteSlug } = body;
    const clienteContaId = extrairClienteContaId(body.clienteContaId);

    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    // Validação local ANTES de resolver cliente/conta/token — mesmo padrão
    // de PATCH /:itemId/preco.
    const precoCheck = promocoesEscritaService.normalizarPrecoPromocao(body.precoNovo);
    if (!precoCheck.ok) {
      return res.status(400).json({ ok: false, codigo: precoCheck.codigo, motivo: precoCheck.motivo });
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
        clienteId: cliente.id, clienteContaId, requireUsableGrant: true,
      });
      mlUserId = contexto.mlUserId;
    }

    const r = await promocoesEscritaService.aplicarPromocao({
      clienteId: cliente.id,
      itemId,
      mlUserId,
      promotionId,
      precoNovo: body.precoNovo,
    });

    if (!r.ok) {
      return res.json({ ok: false, codigo: r.codigo, motivo: r.motivo });
    }

    return res.json({
      ok: true,
      metodo: r.metodo,
      promotionId: r.promotionId,
      tipo: r.tipo,
      precoConfirmado: r.precoConfirmado,
      precoOriginal: r.precoOriginal,
    });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] aplicarPromocao:", err.message);
    return res.status(500).json({ ok: false, motivo: "Erro interno ao aplicar a promoção." });
  }
}

// ----------------------------------------------------------------------------
// PATCH /anuncios-meli/:itemId/variacoes-legado/:variationId/estoque
//   body: { clienteSlug, clienteContaId?, estoque }
//
// ESCRITA REAL no Mercado Livre de uma variação do modelo LEGADO. Não existe
// PUT dedicado a uma variação isolada — o service (meliVariacoesLegadoEstoqueService)
// faz GET fresco do item + variations, monta o PUT /items com a propriedade
// `variations` INTEIRA (só o alvo muda) e confirma com outro GET depois.
// Ver o cabeçalho do service para a razão de cada passo — aqui é só fiação:
// mesma regra de conta dos vizinhos /estoque e /conteudo (a linha manda; sem
// ela e com 2+ contas, 409 em vez de chute), e a resposta segue o mesmo
// contrato de falha "esperada" (200 + ok:false + codigo/motivo).
//
// `critico:true` (perda de variação detectada após o PUT) é repassado tal
// como veio do service, para a tela orientar conferência manual no ML —
// nunca é tratado como um erro comum recuperável com nova tentativa.
// ----------------------------------------------------------------------------
async function atualizarEstoqueVariacaoLegado(req, res) {
  try {
    const { itemId, variationId } = req.params;
    const body = req.body || {};
    const { clienteSlug } = body;
    const clienteContaId = extrairClienteContaId(body.clienteContaId);

    if (!clienteSlug) {
      return res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    }

    // Validação local ANTES de resolver cliente/conta/token — mesmo motivo
    // do vizinho /estoque: valor inválido não merece consulta ao banco nem
    // chamada externa.
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

    const r = await variacoesLegadoEstoqueService.atualizarEstoqueVariacaoLegado({
      clienteId: cliente.id,
      itemId,
      variationId,
      estoque: body.estoque,
      mlUserId,
    });

    if (!r.ok) {
      const resposta = { ok: false, codigo: r.codigo, motivo: r.motivo };
      if (r.critico) resposta.critico = true;
      return res.json(resposta);
    }

    return res.json({ ok: true, variacoes: r.variacoes });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] atualizarEstoqueVariacaoLegado:", err.message);
    return res.status(500).json({
      ok: false,
      motivo: "Erro interno ao salvar o estoque da variação.",
    });
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

    // Guard fail-closed: um item legado com variações reais no ML
    // (item_id -> variations[], sem User Product) não tem estoque próprio na
    // raiz — o ML trata available_quantity do item como agregado das
    // variações (documentacao_api_meli/variacoes.md, "Modificar estoque"), e
    // a única escrita documentada é por variação (ver
    // PATCH /:itemId/variacoes-legado/:variationId/estoque). Recusa aqui,
    // ANTES de resolver conta/token e chamar o ML — protege mesmo uma
    // chamada direta à API, sem depender do frontend não desenhar o botão.
    if ((anuncio.variations_count || 0) > 0) {
      return res.status(400).json({
        ok: false,
        codigo: "ESTOQUE_POR_VARIACAO",
        motivo: "Este anúncio tem variações no Mercado Livre — edite o estoque de cada variação, não o anúncio inteiro.",
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
// A escrita é PUT /items/{id} { price } (ver meliPrecoService — a API dedicada
// de Preços do ML ainda não está disponível, por doc). Bloqueia ANTES de
// escrever quando há variação ou promoção ativa. O preço devolvido é sempre o
// que veio na RESPOSTA do PUT, nunca o valor enviado. O snapshot local
// (`meli_anuncios.preco`) só muda depois da confirmação.
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

    // subsidioMl: retorno ML da promoção selecionada na linha (ver
    // meliPromocoesService.normalizarPromocao) — soma ao lucro via o campo
    // `rebate` do próprio marginEngine.computeMargin, nunca uma fórmula
    // paralela. Opcional: ausente = 0, comportamento idêntico ao anterior.
    let rebate = 0;
    if (body.subsidioMl !== undefined) {
      const n = Number(body.subsidioMl);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({
          ok: false,
          motivo: "O campo subsidioMl precisa ser um número maior ou igual a zero.",
        });
      }
      rebate = n;
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
      rebate,
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
  variacoesLegado,
  promocoes,
  aplicarPromocao,
  atualizarEstoqueVariacaoLegado,
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
  montarFaturamento,
  montarCurvaAbc,
};
