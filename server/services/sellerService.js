// server/services/sellerService.js
// Área Seller — Fase 1. Seller loga, vê SOMENTE os produtos sem base do
// cliente vinculado a ele (seller_clientes) e envia custos para revisão
// (seller_custos_submissoes, status 'pendente'). NUNCA grava direto na
// tabela custos. NUNCA seleciona api_key/access_token/refresh_token.
//
// Origem dos produtos: último relatório do cliente (relatorio_itens com
// tem_base = false), enriquecido com meli_anuncios (foto/preço) e com o
// faturamento por produto do snapshot da Cliente 360
// (cliente_360_resumos_mensais.payload_json.topProdutos) — leitura pura,
// nenhuma chamada ao Mercado Livre aqui.

const pool = require("../config/database");
const { registrarLog } = require("./activityLogService");
const { competenciaAtual, parseCompetencia } = require("../utils/periodoUtils");

const LIMIT_PADRAO = 30;
const LIMIT_MAX = 100;
const OBS_MAX = 1000;

function criarErroHttp(statusCode, mensagem, codigo = null) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  if (codigo) err.codigo = codigo;
  return err;
}

const numOrNull = (v) => (v === null || v === undefined ? null : Number(v));

// Aceita "45,90" e "45.90". Vazio/inválido → null.
function parseNumero(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

// Competência imediatamente anterior (YYYY-MM).
function competenciaAnteriorDe(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Schema (idempotente, roda uma vez por processo) ──────────────────────

let _schemaGarantido = false;

async function ensureSellerTables() {
  if (_schemaGarantido) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seller_clientes (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cliente_id  INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      marketplace TEXT NOT NULL DEFAULT 'mercadolivre',
      ativo       BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, cliente_id, marketplace)
    );
    CREATE INDEX IF NOT EXISTS idx_seller_clientes_user
      ON seller_clientes (user_id) WHERE ativo = true;

    CREATE TABLE IF NOT EXISTS seller_custos_submissoes (
      id                 SERIAL PRIMARY KEY,
      cliente_id         INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      user_id            INTEGER NOT NULL REFERENCES users(id),
      base_id            INTEGER REFERENCES bases(id),
      item_id            TEXT NOT NULL,
      sku                TEXT,
      titulo             TEXT,
      custo_produto      NUMERIC(12,2),
      imposto_percentual NUMERIC(6,2),
      taxa_fixa          NUMERIC(12,2),
      observacao         TEXT,
      status             TEXT NOT NULL DEFAULT 'pendente',
      revisado_por       INTEGER REFERENCES users(id),
      revisado_em        TIMESTAMPTZ,
      motivo_rejeicao    TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_seller_subs_cliente_status
      ON seller_custos_submissoes (cliente_id, status);
    CREATE INDEX IF NOT EXISTS idx_seller_subs_cliente_item
      ON seller_custos_submissoes (cliente_id, item_id);
  `);
  _schemaGarantido = true;
}

// ─── Vínculo seller ↔ cliente ──────────────────────────────────────────────

// Clientes vinculados ao usuário (sem api_key, sempre colunas explícitas).
async function findClientesDoSeller(userId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.nome, c.slug, sc.marketplace
       FROM seller_clientes sc
       JOIN clientes c ON c.id = sc.cliente_id
      WHERE sc.user_id = $1 AND sc.ativo = true AND c.ativo = true
      ORDER BY c.nome ASC`,
    [userId]
  );
  return rows;
}

async function findClienteBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT id, nome, slug FROM clientes WHERE slug = $1 AND ativo = true LIMIT 1`,
    [slug]
  );
  return rows[0] || null;
}

// Resolve qual cliente o request pode ver. REGRA CENTRAL DE SEGURANÇA:
// o cliente_slug vindo do front NUNCA é confiado sozinho — para seller,
// ele precisa bater com um vínculo ativo em seller_clientes do user logado.
// Admin pode inspecionar qualquer cliente (já tem acesso total no portal).
async function resolverClienteAutorizado(user, clienteSlugRaw) {
  const slug = String(clienteSlugRaw || "").trim();
  const role = String(user?.role || "").toLowerCase();

  if (role === "admin") {
    if (slug) {
      const cliente = await findClienteBySlug(slug);
      if (!cliente) throw criarErroHttp(404, "Cliente não encontrado.");
      return cliente;
    }
    const vinculados = await findClientesDoSeller(user.id);
    if (vinculados.length) return vinculados[0];
    throw criarErroHttp(400, "Informe cliente_slug para visualizar como admin.", "admin_sem_slug");
  }

  const vinculados = await findClientesDoSeller(user.id);
  if (!vinculados.length) {
    throw criarErroHttp(403, "Seu usuário ainda não está vinculado a nenhuma loja.", "sem_vinculo");
  }
  if (!slug) return vinculados[0];
  const autorizado = vinculados.find((c) => c.slug === slug);
  if (!autorizado) {
    throw criarErroHttp(403, "Você não tem acesso a este cliente.", "cliente_nao_vinculado");
  }
  return autorizado;
}

// ─── /seller/me ────────────────────────────────────────────────────────────

async function getMe(user) {
  await ensureSellerTables();
  const clientes = await findClientesDoSeller(user.id);
  return {
    ok: true,
    user: { id: user.id, nome: user.nome, email: user.email, role: user.role },
    clientes: clientes.map((c) => ({ id: c.id, nome: c.nome, slug: c.slug, marketplace: c.marketplace })),
  };
}

// ─── Fontes de dados dos produtos ──────────────────────────────────────────

async function findUltimoRelatorio(clienteSlug) {
  const { rows } = await pool.query(
    `SELECT id, base_slug, created_at
       FROM relatorios
      WHERE cliente_slug = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [clienteSlug]
  );
  return rows[0] || null;
}

async function findItensSemBase(relatorioId) {
  const { rows } = await pool.query(
    `SELECT item_id, sku, titulo, preco_efetivo
       FROM relatorio_itens
      WHERE relatorio_id = $1 AND tem_base = false`,
    [relatorioId]
  );
  return rows;
}

async function findBaseVinculada(clienteId) {
  const { rows } = await pool.query(
    `SELECT b.id, b.nome, b.slug
       FROM base_cliente_vinculos v
       JOIN bases b ON b.id = v.base_id
      WHERE v.cliente_id = $1 AND v.ativo = true AND b.ativo = true
      ORDER BY v.updated_at DESC
      LIMIT 1`,
    [clienteId]
  );
  return rows[0] || null;
}

// Fotos/preço dos anúncios já sincronizados (meli_anuncios). Nenhuma chamada
// ML aqui: se não tiver foto salva, o front mostra placeholder.
async function findAnunciosPorItemIds(clienteSlug, itemIds) {
  if (!itemIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT item_id, sku, titulo, preco, thumbnail, permalink, status
       FROM meli_anuncios
      WHERE cliente_slug = $1 AND item_id = ANY($2)`,
    [clienteSlug, itemIds]
  ).catch(() => ({ rows: [] })); // tabela pode não existir ainda
  const map = new Map();
  for (const r of rows) map.set(String(r.item_id).toUpperCase(), r);
  return map;
}

// Faturamento por produto do snapshot da Cliente 360 — prefere mês anterior
// fechado; cai no mês corrente; null quando nenhum snapshot tem o detalhe.
async function buscarFaturamentoPorProduto(clienteId) {
  const atual = competenciaAtual();
  const anterior = competenciaAnteriorDe(atual.competencia);
  const competencias = [anterior, atual.competencia].filter(Boolean);
  const { rows } = await pool.query(
    `SELECT competencia, payload_json
       FROM cliente_360_resumos_mensais
      WHERE cliente_id = $1 AND competencia = ANY($2)`,
    [clienteId, competencias]
  ).catch(() => ({ rows: [] }));

  const porCompetencia = new Map(rows.map((r) => [r.competencia, r]));
  for (const comp of competencias) {
    const snap = porCompetencia.get(comp);
    const top = snap?.payload_json?.topProdutos;
    if (!Array.isArray(top)) continue;
    const porMlb = new Map();
    for (const p of top) {
      const mlb = String(p.mlb || p.itemId || "").trim().toUpperCase();
      if (!mlb) continue;
      porMlb.set(mlb, {
        faturamento: Number(p.faturamento) || 0,
        unidades: Number(p.unidades) || 0,
      });
    }
    const periodo = parseCompetencia(comp);
    return {
      porMlb,
      competencia: comp,
      label: periodo?.label || comp,
      tipo: comp === anterior ? "mes_anterior" : "mes_atual",
    };
  }
  return null;
}

// Submissão mais recente por item do cliente (qualquer seller vinculado),
// para o front mostrar o status da fila.
async function findSubmissoesPorItem(clienteId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (item_id)
            id, item_id, user_id, custo_produto, imposto_percentual, taxa_fixa,
            observacao, status, motivo_rejeicao, created_at, updated_at
       FROM seller_custos_submissoes
      WHERE cliente_id = $1
      ORDER BY item_id, created_at DESC`,
    [clienteId]
  );
  const map = new Map();
  for (const r of rows) map.set(String(r.item_id).toUpperCase(), r);
  return map;
}

function mapSubmissao(s) {
  if (!s) return null;
  return {
    id: s.id,
    status: s.status,
    custoProduto: numOrNull(s.custo_produto),
    impostoPercentual: numOrNull(s.imposto_percentual),
    taxaFixa: numOrNull(s.taxa_fixa),
    observacao: s.observacao || null,
    motivoRejeicao: s.motivo_rejeicao || null,
    criadoEm: s.created_at,
    atualizadoEm: s.updated_at,
  };
}

// ─── GET /seller/produtos-sem-base ─────────────────────────────────────────

async function listarProdutosSemBase(user, opts = {}) {
  await ensureSellerTables();
  const cliente = await resolverClienteAutorizado(user, opts.clienteSlug);

  const relatorio = await findUltimoRelatorio(cliente.slug);
  const [itens, base, faturamento, submissoes] = await Promise.all([
    relatorio ? findItensSemBase(relatorio.id) : Promise.resolve([]),
    findBaseVinculada(cliente.id),
    buscarFaturamentoPorProduto(cliente.id),
    findSubmissoesPorItem(cliente.id),
  ]);

  const anuncios = await findAnunciosPorItemIds(cliente.slug, itens.map((i) => i.item_id));

  let produtos = itens.map((it) => {
    const chave = String(it.item_id || "").toUpperCase();
    const anuncio = anuncios.get(chave) || null;
    const venda = faturamento?.porMlb.get(chave) || null;
    const sub = submissoes.get(chave) || null;
    // Thumbnail do ML costuma vir http:// — força https para não quebrar em página segura.
    const thumbnail = anuncio?.thumbnail ? String(anuncio.thumbnail).replace(/^http:\/\//, "https://") : null;
    return {
      itemId: it.item_id,
      sku: anuncio?.sku || it.sku || null,
      titulo: anuncio?.titulo || it.titulo || null,
      thumbnail,
      permalink: anuncio?.permalink || null,
      precoAtual: numOrNull(anuncio?.preco) ?? numOrNull(it.preco_efetivo),
      // null = sem dado de venda por produto (nunca 0 inventado)
      faturamentoPeriodo: venda ? venda.faturamento : null,
      unidadesPeriodo: venda ? venda.unidades : null,
      prioridade: venda && venda.faturamento > 0 ? "alta" : "normal",
      statusBase: "sem_custo",
      statusFila: sub ? sub.status : "sem_envio",
      submissao: mapSubmissao(sub),
    };
  });

  // Prioridade: quem vendeu mais primeiro; sem dado de venda vai para o fim.
  produtos.sort((a, b) => {
    const fa = a.faturamentoPeriodo, fb = b.faturamentoPeriodo;
    if (fa !== null || fb !== null) {
      if (fa === null) return 1;
      if (fb === null) return -1;
      if (fb !== fa) return fb - fa;
    }
    return String(a.titulo || "").localeCompare(String(b.titulo || ""));
  });

  // Resumo calculado sobre a lista completa (antes de filtro/busca/paginação).
  const resumo = {
    totalSemBase: produtos.length,
    prioritarios: produtos.filter((p) => p.prioridade === "alta").length,
    enviadosPendentes: produtos.filter((p) => p.statusFila === "pendente").length,
    aprovados: produtos.filter((p) => p.statusFila === "aprovado" || p.statusFila === "aplicado").length,
    rejeitados: produtos.filter((p) => p.statusFila === "rejeitado").length,
  };

  // Filtro por status da fila
  const status = String(opts.status || "").trim().toLowerCase();
  if (status === "sem_envio" || status === "pendente" || status === "rejeitado") {
    produtos = produtos.filter((p) => p.statusFila === status);
  } else if (status === "aprovado") {
    produtos = produtos.filter((p) => p.statusFila === "aprovado" || p.statusFila === "aplicado");
  }

  // Busca por título, MLB ou SKU
  const busca = String(opts.busca || "").trim().toLowerCase();
  if (busca) {
    produtos = produtos.filter((p) =>
      String(p.titulo || "").toLowerCase().includes(busca) ||
      String(p.itemId || "").toLowerCase().includes(busca) ||
      String(p.sku || "").toLowerCase().includes(busca)
    );
  }

  // Paginação em memória (lista limitada aos itens sem base do relatório)
  const limit = Math.min(LIMIT_MAX, Math.max(1, parseInt(opts.limit, 10) || LIMIT_PADRAO));
  const total = produtos.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(totalPages, Math.max(1, parseInt(opts.page, 10) || 1));
  const pagina = produtos.slice((page - 1) * limit, page * limit);

  return {
    ok: true,
    cliente: { id: cliente.id, nome: cliente.nome, slug: cliente.slug },
    baseVinculada: base ? { id: base.id, nome: base.nome, slug: base.slug } : null,
    relatorio: relatorio ? { id: relatorio.id, criadoEm: relatorio.created_at } : null,
    // null = ainda não há faturamento por produto para priorizar
    periodoFaturamento: faturamento
      ? { competencia: faturamento.competencia, label: faturamento.label, tipo: faturamento.tipo }
      : null,
    resumo,
    produtos: pagina,
    paging: { page, limit, total, totalPages },
  };
}

// ─── POST /seller/custos ───────────────────────────────────────────────────

async function salvarSubmissaoCusto(user, body = {}, ip = null) {
  await ensureSellerTables();
  const cliente = await resolverClienteAutorizado(user, body.cliente_slug);

  const itemId = String(body.item_id || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,80}$/.test(itemId)) {
    throw criarErroHttp(400, "item_id inválido.");
  }

  const custo = parseNumero(body.custo_produto);
  if (custo === null || Number.isNaN(custo) || custo <= 0) {
    throw criarErroHttp(400, "Informe um custo de produto maior que zero.");
  }
  const imposto = parseNumero(body.imposto_percentual);
  if (Number.isNaN(imposto) || (imposto !== null && (imposto < 0 || imposto > 100))) {
    throw criarErroHttp(400, "Imposto % deve estar entre 0 e 100.");
  }
  const taxaFixa = parseNumero(body.taxa_fixa);
  if (Number.isNaN(taxaFixa) || (taxaFixa !== null && taxaFixa < 0)) {
    throw criarErroHttp(400, "Taxa fixa não pode ser negativa.");
  }
  const observacao = String(body.observacao || "").trim().slice(0, OBS_MAX) || null;
  const sku = String(body.sku || "").trim().slice(0, 120) || null;
  const titulo = String(body.titulo || "").trim().slice(0, 500) || null;

  const base = await findBaseVinculada(cliente.id);

  // Envio pendente do mesmo usuário para o mesmo item é EDITADO, não duplicado.
  const { rows: pendentes } = await pool.query(
    `SELECT id FROM seller_custos_submissoes
      WHERE cliente_id = $1 AND item_id = $2 AND user_id = $3 AND status = 'pendente'
      ORDER BY created_at DESC
      LIMIT 1`,
    [cliente.id, itemId, user.id]
  );

  let submissao;
  if (pendentes.length) {
    const { rows } = await pool.query(
      `UPDATE seller_custos_submissoes
          SET custo_produto = $2, imposto_percentual = $3, taxa_fixa = $4,
              observacao = $5, sku = COALESCE($6, sku), titulo = COALESCE($7, titulo),
              base_id = $8, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [pendentes[0].id, custo, imposto, taxaFixa, observacao, sku, titulo, base?.id || null]
    );
    submissao = rows[0];
  } else {
    const { rows } = await pool.query(
      `INSERT INTO seller_custos_submissoes
         (cliente_id, user_id, base_id, item_id, sku, titulo,
          custo_produto, imposto_percentual, taxa_fixa, observacao, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendente')
       RETURNING *`,
      [cliente.id, user.id, base?.id || null, itemId, sku, titulo, custo, imposto, taxaFixa, observacao]
    );
    submissao = rows[0];
  }

  registrarLog({
    userId: user.id,
    userEmail: user.email,
    userNome: user.nome,
    acao: pendentes.length ? "seller.custo_editado" : "seller.custo_enviado",
    detalhes: { cliente_slug: cliente.slug, item_id: itemId, submissao_id: submissao.id },
    ip,
    status: "sucesso",
  });

  return {
    ok: true,
    mensagem: "Custo enviado. Aguardando revisão da operação.",
    submissao: { ...mapSubmissao(submissao), itemId: submissao.item_id },
  };
}

// ─── GET /seller/custos-submissoes ─────────────────────────────────────────

async function listarSubmissoes(user, opts = {}) {
  await ensureSellerTables();

  // Restringe aos clientes que o usuário pode ver (mesma regra central).
  let clienteIds;
  if (opts.clienteSlug) {
    const cliente = await resolverClienteAutorizado(user, opts.clienteSlug);
    clienteIds = [cliente.id];
  } else if (String(user.role || "").toLowerCase() === "admin") {
    clienteIds = null; // admin sem filtro vê todas
  } else {
    const vinculados = await findClientesDoSeller(user.id);
    if (!vinculados.length) {
      throw criarErroHttp(403, "Seu usuário ainda não está vinculado a nenhuma loja.", "sem_vinculo");
    }
    clienteIds = vinculados.map((c) => c.id);
  }

  const params = [];
  const where = [];
  if (clienteIds) { params.push(clienteIds); where.push(`s.cliente_id = ANY($${params.length})`); }
  const status = String(opts.status || "").trim().toLowerCase();
  if (status) { params.push(status); where.push(`s.status = $${params.length}`); }

  const { rows } = await pool.query(
    `SELECT s.id, s.item_id, s.sku, s.titulo, s.custo_produto, s.imposto_percentual,
            s.taxa_fixa, s.observacao, s.status, s.motivo_rejeicao,
            s.created_at, s.updated_at,
            c.nome AS cliente_nome, c.slug AS cliente_slug,
            u.nome AS enviado_por_nome
       FROM seller_custos_submissoes s
       JOIN clientes c ON c.id = s.cliente_id
       LEFT JOIN users u ON u.id = s.user_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY s.created_at DESC
      LIMIT 200`,
    params
  );

  return {
    ok: true,
    submissoes: rows.map((s) => ({
      ...mapSubmissao(s),
      itemId: s.item_id,
      sku: s.sku || null,
      titulo: s.titulo || null,
      cliente: { nome: s.cliente_nome, slug: s.cliente_slug },
      enviadoPor: s.enviado_por_nome || null,
    })),
  };
}

// ─── Gestão de vínculos (ADMIN ONLY — exposto com requireAdmin nas rotas) ──

async function listarVinculos() {
  await ensureSellerTables();
  const { rows } = await pool.query(
    `SELECT sc.id, sc.marketplace, sc.ativo, sc.created_at,
            u.id AS user_id, u.email AS user_email, u.nome AS user_nome, u.role AS user_role,
            c.id AS cliente_id, c.nome AS cliente_nome, c.slug AS cliente_slug
       FROM seller_clientes sc
       JOIN users u ON u.id = sc.user_id
       JOIN clientes c ON c.id = sc.cliente_id
      ORDER BY sc.created_at DESC`
  );
  return {
    ok: true,
    vinculos: rows.map((v) => ({
      id: v.id,
      marketplace: v.marketplace,
      ativo: v.ativo,
      criadoEm: v.created_at,
      user: { id: v.user_id, email: v.user_email, nome: v.user_nome, role: v.user_role },
      cliente: { id: v.cliente_id, nome: v.cliente_nome, slug: v.cliente_slug },
    })),
  };
}

async function criarVinculo(admin, body = {}, ip = null) {
  await ensureSellerTables();

  const clienteSlug = String(body.cliente_slug || "").trim();
  if (!clienteSlug) throw criarErroHttp(400, "cliente_slug é obrigatório.");
  const cliente = await findClienteBySlug(clienteSlug);
  if (!cliente) throw criarErroHttp(404, "Cliente não encontrado.");

  let userRow = null;
  if (body.user_id) {
    const { rows } = await pool.query(
      `SELECT id, email, nome, role, ativo FROM users WHERE id = $1`,
      [parseInt(body.user_id, 10)]
    );
    userRow = rows[0] || null;
  } else if (body.user_email) {
    const { rows } = await pool.query(
      `SELECT id, email, nome, role, ativo FROM users WHERE email = $1`,
      [String(body.user_email).trim().toLowerCase()]
    );
    userRow = rows[0] || null;
  }
  if (!userRow) throw criarErroHttp(404, "Usuário não encontrado (informe user_id ou user_email).");
  if (!userRow.ativo) throw criarErroHttp(400, "Usuário inativo.");

  const marketplace = String(body.marketplace || "mercadolivre").trim().toLowerCase();

  const { rows } = await pool.query(
    `INSERT INTO seller_clientes (user_id, cliente_id, marketplace, ativo)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (user_id, cliente_id, marketplace)
     DO UPDATE SET ativo = true, updated_at = NOW()
     RETURNING id, marketplace, ativo, created_at`,
    [userRow.id, cliente.id, marketplace]
  );

  registrarLog({
    userId: admin.id,
    userEmail: admin.email,
    userNome: admin.nome,
    acao: "seller.vinculo_criado",
    detalhes: { vinculo_id: rows[0].id, user_id: userRow.id, cliente_slug: cliente.slug, marketplace },
    ip,
    status: "sucesso",
  });

  return {
    ok: true,
    vinculo: {
      id: rows[0].id,
      marketplace: rows[0].marketplace,
      ativo: rows[0].ativo,
      criadoEm: rows[0].created_at,
      user: { id: userRow.id, email: userRow.email, nome: userRow.nome, role: userRow.role },
      cliente: { id: cliente.id, nome: cliente.nome, slug: cliente.slug },
    },
  };
}

async function desativarVinculo(admin, vinculoId, ip = null) {
  await ensureSellerTables();
  const id = parseInt(vinculoId, 10);
  if (!Number.isFinite(id)) throw criarErroHttp(400, "Vínculo inválido.");
  const { rows } = await pool.query(
    `UPDATE seller_clientes SET ativo = false, updated_at = NOW()
      WHERE id = $1
      RETURNING id`,
    [id]
  );
  if (!rows.length) throw criarErroHttp(404, "Vínculo não encontrado.");

  registrarLog({
    userId: admin.id,
    userEmail: admin.email,
    userNome: admin.nome,
    acao: "seller.vinculo_desativado",
    detalhes: { vinculo_id: id },
    ip,
    status: "sucesso",
  });

  return { ok: true };
}

module.exports = {
  ensureSellerTables,
  getMe,
  listarProdutosSemBase,
  salvarSubmissaoCusto,
  listarSubmissoes,
  listarVinculos,
  criarVinculo,
  desativarVinculo,
  // exposto para testes/reuso
  resolverClienteAutorizado,
  findClientesDoSeller,
};
