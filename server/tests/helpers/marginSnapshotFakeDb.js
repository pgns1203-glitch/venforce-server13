// server/tests/helpers/marginSnapshotFakeDb.js
// Fake db em memória para exercitar marginSnapshotRepository/
// marginSnapshotRunRepository (M1) e marginSnapshotRunService/
// marginSnapshotWorker (M2) sem Postgres real — mesmo espírito de
// tests/helpers/mpSettlementFakeDb.js, mas implementando de verdade a
// semântica de UNIQUE INDEX/UPSERT/transição de estado/claim atômico que os
// testes precisam provar (idempotência, isolamento de conta, dedupe de run
// ativo, claim exclusivo).
//
// Não é executado como teste (run-all.js só roda *.test.js na raiz de
// tests/, não em subpastas).

// ── Avaliador das condições geradas por marginSnapshotRepository.
// montarFiltroSnapshots (M5/M6). O builder SÓ produz estes formatos; o fake
// os interpreta com a mesma semântica do Postgres (NULL nunca casa em
// comparação, ILIKE com escape por barra invertida, NULLS LAST).
function likeParaRegex(padrao) {
  let re = "";
  for (let i = 0; i < padrao.length; i += 1) {
    const ch = padrao[i];
    if (ch === "\\" && i + 1 < padrao.length) { re += padrao[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); i += 1; }
    else if (ch === "%") re += ".*";
    else if (ch === "_") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is");
}

function avaliarCondicao(cond, row, params) {
  let m;
  const p = (n) => params[Number(n) - 1];
  if ((m = cond.match(/^(\w+) = \$(\d+)$/))) return row[m[1]] === p(m[2]);
  if ((m = cond.match(/^(\w+) IS NULL$/))) return row[m[1]] === null || row[m[1]] === undefined;
  if ((m = cond.match(/^(\w+) IS NOT NULL$/))) return row[m[1]] !== null && row[m[1]] !== undefined;
  if ((m = cond.match(/^(\w+) = ANY\(\$(\d+)::text\[\]\)$/))) return p(m[2]).includes(row[m[1]]);
  if ((m = cond.match(/^(\w+) (>=|<=|<|>) \$(\d+)$/))) {
    const v = row[m[1]];
    if (v === null || v === undefined) return false;
    const alvo = Number(p(m[3]));
    return m[2] === ">=" ? v >= alvo : m[2] === "<=" ? v <= alvo : m[2] === "<" ? v < alvo : v > alvo;
  }
  if ((m = cond.match(/^\((.+)\)$/)) && / ILIKE \$\d+/.test(cond)) {
    return m[1].split(" OR ").some((parte) => {
      const mm = parte.trim().match(/^(\w+) ILIKE \$(\d+)$/);
      if (!mm) throw new Error(`marginSnapshotFakeDb: ILIKE não suportado -> ${parte}`);
      const v = row[mm[1]];
      return v !== null && v !== undefined && likeParaRegex(p(mm[2])).test(String(v));
    });
  }
  throw new Error(`marginSnapshotFakeDb: condição não suportada -> ${cond}`);
}

function filtrarPorWhere(sql, linhas, params) {
  // O WHERE principal é o que vem depois do FROM (os `FILTER (WHERE …)` dos
  // KPIs ficam antes dele).
  const where = sql.match(/FROM margin_projection_snapshots\s+WHERE ([\s\S]+?)(?:\s+ORDER BY|\s+GROUP BY|\s+LIMIT|$)/);
  if (!where) return linhas;
  const condicoes = where[1].split(/\s+AND\s+/).map((c) => c.trim());
  return linhas.filter((row) => condicoes.every((c) => avaliarCondicao(c, row, params)));
}

// Divide por vírgula fora de parênteses/colchetes (ARRAY[...] tem vírgulas).
function dividirNivelZero(texto) {
  const partes = [];
  let nivel = 0;
  let atual = "";
  for (const ch of texto) {
    if (ch === "(" || ch === "[") nivel += 1;
    if (ch === ")" || ch === "]") nivel -= 1;
    if (ch === "," && nivel === 0) { partes.push(atual); atual = ""; } else atual += ch;
  }
  if (atual.trim()) partes.push(atual);
  return partes;
}

function ordenarPorOrderBy(sql, linhas) {
  const m = sql.match(/ORDER BY ([\s\S]+?)\s+LIMIT/);
  if (!m) return linhas;
  const chaves = dividirNivelZero(m[1]).map((parte) => {
    const texto = parte.trim();
    // array_position(ARRAY['A','B',...]::text[], coluna) — ranking por enum.
    const ap = texto.match(/^array_position\(ARRAY\[([^\]]+)\]::text\[\], (\w+)\) (ASC|DESC)(?: NULLS (LAST|FIRST))?$/);
    if (ap) {
      const ordem = ap[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
      const idx = (row) => { const i = ordem.indexOf(row[ap[2]]); return i === -1 ? null : i + 1; };
      return { valor: idx, dir: ap[3], nulls: ap[4] || (ap[3] === "ASC" ? "LAST" : "FIRST") };
    }
    const mm = texto.match(/^(\w+) (ASC|DESC)(?: NULLS (LAST|FIRST))?$/);
    if (!mm) throw new Error(`marginSnapshotFakeDb: ORDER BY não suportado -> ${texto}`);
    return { valor: (row) => row[mm[1]], dir: mm[2], nulls: mm[3] || (mm[2] === "ASC" ? "LAST" : "FIRST") };
  });
  return linhas.slice().sort((a, b) => {
    for (const { valor, dir, nulls } of chaves) {
      const va = valor(a); const vb = valor(b);
      const na = va === null || va === undefined; const nb = vb === null || vb === undefined;
      if (na && nb) continue;
      if (na) return nulls === "LAST" ? 1 : -1;
      if (nb) return nulls === "LAST" ? -1 : 1;
      const x = va instanceof Date ? va.getTime() : va;
      const y = vb instanceof Date ? vb.getTime() : vb;
      if (x < y) return dir === "ASC" ? -1 : 1;
      if (x > y) return dir === "ASC" ? 1 : -1;
    }
    return 0;
  });
}

function makeMarginSnapshotFakeDb() {
  const runs = [];
  const snapshots = [];
  let nextRunId = 1;
  let nextSnapshotId = 1;

  async function query(sqlBruto, params = []) {
    const sql = String(sqlBruto);

    // ── M5/M6: leitura da Central (condições do builder) ─────────────────
    if (sql.includes("/* ms:list */")) {
      const limit = params[params.length - 2];
      const offset = params[params.length - 1];
      const linhas = ordenarPorOrderBy(sql, filtrarPorWhere(sql, snapshots, params));
      return { rows: linhas.slice(offset, offset + limit).map((r) => ({ ...r })) };
    }
    if (sql.includes("/* ms:kpis */")) {
      const linhas = filtrarPorWhere(sql, snapshots, params);
      const row = { total: linhas.length, com_margem: linhas.filter((r) => r.margin !== null && r.margin !== undefined).length };
      for (const m of sql.matchAll(/COUNT\(\*\) FILTER \(WHERE (\w+) = '([^']+)'\)::int AS "(\w+)"/g)) {
        row[m[3]] = linhas.filter((r) => r[m[1]] === m[2]).length;
      }
      row.ultimo_calculo = linhas.reduce((max, r) => (!max || r.calculated_at > max ? r.calculated_at : max), null);
      return { rows: [row] };
    }
    if (sql.includes("/* ms:count */")) {
      const linhas = filtrarPorWhere(sql, snapshots, params);
      const ultimo = linhas.reduce((max, r) => (!max || r.calculated_at > max ? r.calculated_at : max), null);
      return { rows: [{ total: linhas.length, ultimo_calculo: ultimo }] };
    }

    // ── M5: último run terminado / completo da conta ─────────────────────
    if (sql.includes("FROM margin_snapshot_runs") && (sql.includes("status IN ('completed','failed')") || sql.includes("AND status = 'completed'"))) {
      const [clienteId, clienteContaId, marketplace] = params;
      const aceitos = sql.includes("status IN ('completed','failed')") ? ["completed", "failed"] : ["completed"];
      const candidatos = runs
        .filter((r) => r.cliente_id === clienteId && r.cliente_conta_id === clienteContaId
          && r.marketplace === marketplace && aceitos.includes(r.status))
        .sort((a, b) => (b.finished_at || 0) - (a.finished_at || 0) || b.id - a.id);
      return { rows: candidatos.length ? [{ ...candidatos[0] }] : [] };
    }

    // Bootstrap idempotente (ensureMarginSnapshotTables lê o .sql inteiro e
    // manda como uma única string) — no-op no fake, as tabelas já "existem"
    // como arrays em memória.
    if (sql.includes("CREATE TABLE IF NOT EXISTS margin_snapshot_runs")) {
      return { rows: [] };
    }

    // ── margin_snapshot_runs ────────────────────────────────────────────

    if (sql.includes("INSERT INTO margin_snapshot_runs")) {
      const [clienteId, clienteSlug, clienteContaId, marketplace, baseId, reason, requestedBy] = params;
      const conflito = runs.find((r) =>
        r.cliente_id === clienteId
        && r.cliente_conta_id === clienteContaId
        && r.marketplace === marketplace
        && (r.status === "queued" || r.status === "running")
      );
      if (conflito) {
        const err = new Error('duplicate key value violates unique constraint "uq_margin_snapshot_runs_ativo"');
        err.code = "23505";
        throw err;
      }
      const now = new Date();
      const row = {
        id: nextRunId++,
        cliente_id: clienteId, cliente_slug: clienteSlug, cliente_conta_id: clienteContaId,
        marketplace, base_id: baseId ?? null, reason, status: "queued",
        total_items: null, processed_items: 0, success_items: 0, failed_items: 0, cursor_offset: 0,
        requested_by: requestedBy ?? null,
        created_at: now, started_at: null, heartbeat_at: null, finished_at: null,
        error_code: null, error_message: null, metadata_json: {},
        updated_at: now,
      };
      runs.push(row);
      return { rows: [{ ...row }] };
    }

    if (sql.includes("FROM margin_snapshot_runs") && sql.includes("WHERE id = $1")) {
      const [runId, clienteContaId] = params;
      const row = runs.find((r) => r.id === runId && r.cliente_conta_id === clienteContaId);
      return { rows: row ? [{ ...row }] : [] };
    }

    if (sql.includes("FROM margin_snapshot_runs") && sql.includes("status IN ('queued','running')")) {
      const [clienteId, clienteContaId, marketplace] = params;
      const candidatos = runs
        .filter((r) => r.cliente_id === clienteId && r.cliente_conta_id === clienteContaId
          && r.marketplace === marketplace && (r.status === "queued" || r.status === "running"))
        .sort((a, b) => b.id - a.id);
      return { rows: candidatos.length ? [{ ...candidatos[0] }] : [] };
    }

    if (sql.includes("UPDATE margin_snapshot_runs") && sql.includes("SET status = 'running'")
        && !sql.includes("FOR UPDATE SKIP LOCKED")) {
      const [runId] = params;
      const row = runs.find((r) => r.id === runId && r.status === "queued");
      if (!row) return { rows: [] };
      const now = new Date();
      row.status = "running"; row.started_at = now; row.heartbeat_at = now; row.updated_at = now;
      return { rows: [{ ...row }] };
    }

    // ── M2: claim atômico ────────────────────────────────────────────────
    // Espelha `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED
    // LIMIT 1) RETURNING *` — busca + mutação num único bloco síncrono (sem
    // `await` entre achar o candidato e marcá-lo `running`), a mesma
    // garantia que o Postgres dá com uma única instrução UPDATE: nenhuma
    // outra chamada pode "enxergar" o candidato entre o SELECT e o UPDATE.
    if (sql.includes("UPDATE margin_snapshot_runs") && sql.includes("FOR UPDATE SKIP LOCKED")) {
      // M3: $1 = contas excluídas do claim (em execução neste processo).
      const excluir = new Set((Array.isArray(params[0]) ? params[0] : []).map(Number));
      const candidatos = runs
        .filter((r) => r.status === "queued" && !excluir.has(Number(r.cliente_conta_id)))
        .sort((a, b) => a.created_at - b.created_at || a.id - b.id);
      const row = candidatos[0];
      if (!row) return { rows: [] };
      const now = new Date();
      row.status = "running"; row.started_at = now; row.heartbeat_at = now; row.updated_at = now;
      return { rows: [{ ...row }] };
    }

    // ── M2: heartbeat explícito ──────────────────────────────────────────
    if (sql.includes("UPDATE margin_snapshot_runs") && sql.includes("SET heartbeat_at = NOW()")) {
      const [runId] = params;
      const row = runs.find((r) => r.id === runId && r.status === "running");
      if (!row) return { rows: [] };
      row.heartbeat_at = new Date(); row.updated_at = new Date();
      return { rows: [{ ...row }] };
    }

    if (sql.includes("UPDATE margin_snapshot_runs") && sql.includes("SET status = $2")) {
      const [runId, status, errorCode, errorMessage] = params;
      const row = runs.find((r) => r.id === runId && r.status === "running");
      if (!row) return { rows: [] };
      const now = new Date();
      row.status = status; row.finished_at = now; row.updated_at = now;
      row.error_code = errorCode ?? null; row.error_message = errorMessage ?? null;
      return { rows: [{ ...row }] };
    }

    // ── M3: metadata merge (jsonb ||) ────────────────────────────────────
    if (sql.includes("UPDATE margin_snapshot_runs") && sql.includes("SET metadata_json")) {
      const [runId, patchJson] = params;
      const row = runs.find((r) => r.id === runId && r.status === "running");
      if (!row) return { rows: [] };
      row.metadata_json = { ...(row.metadata_json || {}), ...JSON.parse(patchJson || "{}") };
      row.updated_at = new Date();
      return { rows: [{ ...row }] };
    }

    if (sql.includes("UPDATE margin_snapshot_runs") && sql.includes("SET processed_items")) {
      const [runId, processedItems, successItems, failedItems, cursorOffset, totalItems] = params;
      const row = runs.find((r) => r.id === runId && r.status === "running");
      if (!row) return { rows: [] };
      row.processed_items = processedItems; row.success_items = successItems; row.failed_items = failedItems;
      row.cursor_offset = cursorOffset;
      if (totalItems != null) row.total_items = totalItems;
      row.heartbeat_at = new Date(); row.updated_at = new Date();
      return { rows: [{ ...row }] };
    }

    // ── margin_projection_snapshots ─────────────────────────────────────

    if (sql.includes("INSERT INTO margin_projection_snapshots")) {
      const [
        clienteId, clienteContaId, marketplace, itemId, sku, titulo, baseId,
        price, listPrice, promoPrice, cost, taxRate, fixedFee, commission, commissionRate, freight,
        profit, margin, marginPercent, status,
        confidenceLevel, qualityJson, missingJson, assumedJson, divergencesJson,
        observedAt, calculatedAt, sourceUpdatedAt,
        runId, refreshStatus, lastError,
        imageUrl,
      ] = params;

      let row = snapshots.find((r) =>
        r.cliente_id === clienteId && r.cliente_conta_id === clienteContaId
        && r.marketplace === marketplace && r.item_id === itemId
      );
      const now = new Date();
      const isNovo = !row;
      if (isNovo) {
        row = { id: nextSnapshotId++, cliente_id: clienteId, cliente_conta_id: clienteContaId, marketplace, item_id: itemId, created_at: now };
        snapshots.push(row);
      }
      row.sku = sku ?? null;
      row.titulo = titulo ?? null;
      row.base_id = baseId ?? null;
      row.price = price ?? null;
      row.list_price = listPrice ?? null;
      row.promo_price = promoPrice ?? null;
      row.cost = cost ?? null;
      row.tax_rate = taxRate ?? null;
      row.fixed_fee = fixedFee ?? null;
      row.commission = commission ?? null;
      row.commission_rate = commissionRate ?? null;
      row.freight = freight ?? null;
      row.profit = profit ?? null;
      row.margin = margin ?? null;
      row.margin_percent = marginPercent ?? null;
      row.status = status;
      row.confidence_level = confidenceLevel ?? null;
      row.quality_json = JSON.parse(qualityJson ?? "{}");
      row.missing_json = JSON.parse(missingJson ?? "[]");
      row.assumed_json = JSON.parse(assumedJson ?? "[]");
      row.divergences_json = JSON.parse(divergencesJson ?? "[]");
      row.observed_at = observedAt ?? null;
      row.calculated_at = calculatedAt ?? now;
      row.source_updated_at = sourceUpdatedAt ?? null;
      row.run_id = runId ?? null;
      row.refresh_status = refreshStatus;
      row.last_error = lastError ?? null;
      row.image_url = imageUrl ?? null;
      row.catalog_missing_since = null;
      row.updated_at = now;
      return { rows: [{ ...row }] };
    }

    // ── M3: falha parcial (preserva valores) ─────────────────────────────
    if (sql.includes("UPDATE margin_projection_snapshots") && sql.includes("SET refresh_status = 'failed'")) {
      const [clienteId, clienteContaId, marketplace, itemIds, lastError, runId] = params;
      const alvo = new Set(itemIds);
      const afetadas = snapshots.filter((r) => r.cliente_id === clienteId && r.cliente_conta_id === clienteContaId
        && r.marketplace === marketplace && alvo.has(r.item_id));
      for (const r of afetadas) {
        r.refresh_status = "failed"; r.last_error = lastError ?? null; r.run_id = runId ?? null; r.updated_at = new Date();
      }
      return { rows: afetadas.map((r) => ({ item_id: r.item_id })) };
    }

    // ── M3: fora do catálogo (marca, nunca apaga) ────────────────────────
    if (sql.includes("UPDATE margin_projection_snapshots") && sql.includes("SET catalog_missing_since = NOW()")) {
      const [clienteId, clienteContaId, marketplace, catalogo, runId] = params;
      const noCatalogo = new Set(catalogo);
      const afetadas = snapshots.filter((r) => r.cliente_id === clienteId && r.cliente_conta_id === clienteContaId
        && r.marketplace === marketplace && !r.catalog_missing_since && !noCatalogo.has(r.item_id));
      const now = new Date();
      for (const r of afetadas) {
        r.catalog_missing_since = now; r.refresh_status = "stale";
        r.last_error = "Item fora do catálogo (ativos + pausados) na última listagem completa.";
        r.run_id = runId ?? null; r.updated_at = now;
      }
      return { rows: afetadas.map((r) => ({ item_id: r.item_id })) };
    }

    if (sql.includes("FROM margin_projection_snapshots") && sql.includes("item_id = $3")) {
      const [clienteContaId, marketplace, itemId] = params;
      const row = snapshots.find((r) => r.cliente_conta_id === clienteContaId && r.marketplace === marketplace && r.item_id === itemId);
      return { rows: row ? [{ ...row }] : [] };
    }

    if (sql.includes("SELECT COUNT(*)::int AS total FROM margin_projection_snapshots")) {
      let clienteContaId, marketplace, status;
      if (params.length === 3) [clienteContaId, marketplace, status] = params;
      else [clienteContaId, marketplace] = params;
      const total = snapshots.filter((r) =>
        r.cliente_conta_id === clienteContaId && r.marketplace === marketplace
        && (status ? r.status === status : true)
      ).length;
      return { rows: [{ total }] };
    }

    if (sql.includes("FROM margin_projection_snapshots") && sql.includes("ORDER BY")) {
      let clienteContaId, marketplace, status, limit, offset;
      if (params.length === 5) [clienteContaId, marketplace, status, limit, offset] = params;
      else [clienteContaId, marketplace, limit, offset] = params;

      let linhas = snapshots.filter((r) =>
        r.cliente_conta_id === clienteContaId && r.marketplace === marketplace
        && (status ? r.status === status : true)
      );

      const m = sql.match(/ORDER BY (\w+) (ASC|DESC)/);
      const coluna = m ? m[1] : "updated_at";
      const dir = m ? m[2] : "DESC";
      linhas = linhas.slice().sort((a, b) => {
        const va = a[coluna]; const vb = b[coluna];
        if (va == null && vb == null) return 0;
        if (va == null) return 1; // NULLS LAST
        if (vb == null) return -1;
        if (va < vb) return dir === "ASC" ? -1 : 1;
        if (va > vb) return dir === "ASC" ? 1 : -1;
        return 0;
      });
      linhas = linhas.slice(offset, offset + limit);
      return { rows: linhas.map((r) => ({ ...r })) };
    }

    throw new Error(`marginSnapshotFakeDb: SQL nao mapeado -> ${sql.trim().slice(0, 200)}`);
  }

  return { runs, snapshots, query };
}

module.exports = { makeMarginSnapshotFakeDb };
