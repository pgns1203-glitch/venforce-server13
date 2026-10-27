#!/usr/bin/env node
// server/scripts/sentinel-e0-paridade.js
// E0 do Sentinel — paridade pedido a pedido entre sentinel_pedidos e um
// import publicado da Central de Vendas da mesma conta.
//
//   DATABASE_URL=... node server/scripts/sentinel-e0-paridade.js \
//     --conta=<cliente_conta_id> --import=<import_id> [--confirm-host=<host>] [--out=<dir>]
//
// SOMENTE LEITURA: a sessão inteira roda em BEGIN READ ONLY com
// statement_timeout curto; não há INSERT/UPDATE/DDL. Não carrega server/.env:
// o banco é só o DATABASE_URL do shell, e fora de localhost exige
// --confirm-host com o MESMO host (mesma proteção do sentinel-run-once.js).
//
// Premissas que a comparação NÃO esconde (cada divergência sai classificada):
//   - congelado: o ML não mexeu no pedido depois que o import foi criado
//     (ml_date_last_updated <= imports.created_at). Aqui a meta é R$ 0,00.
//   - mudou_depois: o pedido foi atualizado no ML depois do import; diferença
//     pode ser legítima (status, devolução, tarifa) e não conta como erro.
//   - ausente: um dos lados não tem o valor (NULL); nunca vira 0.
// O custo é comparado item a item, porque o import usou a base no dia do
// run (07/10) e o Sentinel usa a base de agora.

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const CAMPOS = ["faturamento", "comissao", "frete", "custo", "imposto", "lc", "margem_pct"];

function lerArgs(argv) {
  const args = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return n === null ? null : Math.round(n * 100) / 100;
}

// Diferença em centavos; null quando algum lado não tem valor.
function difCentavos(a, b) {
  if (a === null || b === null) return null;
  return Math.round(a * 100) - Math.round(b * 100);
}

// Pura (testável sem banco): compara as linhas já carregadas.
function compararPedidos({ importacao, central, sentinel }) {
  const criadoEm = new Date(importacao.created_at).getTime();
  const porId = new Map(sentinel.map((s) => [String(s.pedido_id), s]));
  const vistos = new Set();
  const linhas = [];

  for (const c of central) {
    const id = String(c.pedido_id);
    const s = porId.get(id);
    if (!s) {
      linhas.push({ pedido_id: id, situacao: "so_no_import" });
      continue;
    }
    vistos.add(id);
    const atualizado = s.ml_date_last_updated ? new Date(s.ml_date_last_updated).getTime() : null;
    const premissa = atualizado !== null && atualizado <= criadoEm ? "congelado" : "mudou_depois";
    const valores = {
      faturamento: [num(c.faturamento), num(s.faturamento)],
      comissao: [num(c.comissao), num(s.comissao)],
      frete: [num(c.frete), num(s.frete)],
      custo: [num(c.custo), num(s.custo)],
      imposto: [num(c.imposto), num(s.imposto)],
      lc: [num(c.lucro_contribuicao), num(s.margem_valor)],
      margem_pct: [round2(num(c.margem_contribuicao_percentual)), round2(num(s.margem_pct))],
    };
    const difs = {};
    const ausentes = [];
    for (const campo of CAMPOS) {
      const [vc, vs] = valores[campo];
      const d = difCentavos(vc, vs);
      if (d === null) {
        if (vc !== null || vs !== null) ausentes.push(campo);
      } else if (d !== 0) {
        difs[campo] = { central: vc, sentinel: vs, centavos: d };
      }
    }
    linhas.push({
      pedido_id: id,
      situacao: "nos_dois",
      premissa,
      status_central: c.status,
      status_ml: s.status_ml,
      estado_margem: s.estado_margem,
      pendencias: s.pendencias,
      valores,
      difs,
      ausentes,
      itens: compararItens(c.itens || [], s.itens || []),
    });
  }
  for (const s of sentinel) {
    if (!vistos.has(String(s.pedido_id))) linhas.push({ pedido_id: String(s.pedido_id), situacao: "so_no_sentinel" });
  }
  return { linhas, resumo: resumir(linhas) };
}

// Itens: quantidade por MLB e custo unitário×qtd por MLB.
function compararItens(itensCentral, itensSentinel) {
  const agrupa = (lista, mlbKey, qtdKey, custoFn) => {
    const m = new Map();
    for (const it of lista) {
      const k = String(it[mlbKey] || "?");
      const acc = m.get(k) || { qtd: 0, custo: 0, custoNulo: false };
      acc.qtd += num(it[qtdKey]) || 0;
      const c = custoFn(it);
      if (c === null) acc.custoNulo = true; else acc.custo += c;
      m.set(k, acc);
    }
    return m;
  };
  const mc = agrupa(itensCentral, "mlb", "quantidade", (it) => {
    const v = num(it.custo_produto);
    return v === null ? null : Math.abs(v);
  });
  const ms = agrupa(itensSentinel, "item_id", "quantidade", (it) => {
    const cu = num(it.custo_unitario);
    const q = num(it.quantidade);
    return cu === null || q === null ? null : cu * q;
  });
  const out = [];
  for (const k of new Set([...mc.keys(), ...ms.keys()])) {
    const a = mc.get(k);
    const b = ms.get(k);
    if (!a || !b) { out.push({ mlb: k, problema: a ? "so_no_import" : "so_no_sentinel" }); continue; }
    if (a.qtd !== b.qtd) out.push({ mlb: k, problema: "quantidade", central: a.qtd, sentinel: b.qtd });
    if (!a.custoNulo && !b.custoNulo && difCentavos(a.custo, b.custo) !== 0) {
      out.push({ mlb: k, problema: "custo", central: round2(a.custo), sentinel: round2(b.custo) });
    }
  }
  return out;
}

function resumir(linhas) {
  const r = {
    so_no_import: 0, so_no_sentinel: 0, nos_dois: 0,
    congelados: 0, congelados_identicos: 0, mudou_depois: 0,
    divergencias_congelados_por_campo: {}, divergencias_mudou_depois_por_campo: {},
    ausentes_por_campo: {}, itens_com_divergencia: 0,
    soma_centavos_congelados_por_campo: {},
    // Agregado sobre os MESMOS pedidos congelados, só onde os dois lados têm
    // valor (NULL nunca vira 0). Margem agregada = ΣLC/ΣFAT, nunca Σ%.
    agregado_congelados: {},
  };
  const ag = {};
  for (const l of linhas) {
    if (l.situacao !== "nos_dois") { r[l.situacao] += 1; continue; }
    r.nos_dois += 1;
    const congelado = l.premissa === "congelado";
    if (congelado) {
      for (const campo of ["faturamento", "comissao", "frete", "custo", "imposto", "lc"]) {
        const [vc, vs] = l.valores[campo];
        if (vc === null || vs === null) continue;
        const a = ag[campo] || { pedidos: 0, central: 0, sentinel: 0 };
        a.pedidos += 1;
        a.central += Math.round(vc * 100);
        a.sentinel += Math.round(vs * 100);
        ag[campo] = a;
      }
    }
    if (congelado) r.congelados += 1; else r.mudou_depois += 1;
    const alvo = congelado ? r.divergencias_congelados_por_campo : r.divergencias_mudou_depois_por_campo;
    for (const [campo, d] of Object.entries(l.difs)) {
      alvo[campo] = (alvo[campo] || 0) + 1;
      if (congelado) {
        r.soma_centavos_congelados_por_campo[campo] = (r.soma_centavos_congelados_por_campo[campo] || 0) + d.centavos;
      }
    }
    for (const campo of l.ausentes) r.ausentes_por_campo[campo] = (r.ausentes_por_campo[campo] || 0) + 1;
    if (l.itens.length) r.itens_com_divergencia += 1;
    if (congelado && !Object.keys(l.difs).length && !l.ausentes.length && !l.itens.length) r.congelados_identicos += 1;
  }
  for (const [campo, a] of Object.entries(ag)) {
    r.agregado_congelados[campo] = {
      pedidos: a.pedidos, central: a.central / 100, sentinel: a.sentinel / 100, diferenca: (a.central - a.sentinel) / 100,
    };
  }
  const fat = ag.faturamento;
  const lc = ag.lc;
  if (fat && lc && fat.pedidos === lc.pedidos && fat.central && fat.sentinel) {
    r.agregado_congelados.margem_pct = {
      central: round2((lc.central / fat.central) * 100), sentinel: round2((lc.sentinel / fat.sentinel) * 100),
    };
  }
  return r;
}

const SQL_CENTRAL = `
  SELECT p.pedido_id, p.status, p.faturamento, p.lucro_contribuicao, p.margem_contribuicao_percentual,
         ABS(SUM(c.valor) FILTER (WHERE c.tipo = 'tarifa_venda'    AND c.item_row_id IS NOT NULL)) AS comissao,
         ABS(SUM(c.valor) FILTER (WHERE c.tipo = 'frete_seller'    AND c.item_row_id IS NOT NULL)) AS frete,
         ABS(SUM(c.valor) FILTER (WHERE c.tipo = 'custo_produto'   AND c.item_row_id IS NOT NULL)) AS custo,
         ABS(SUM(c.valor) FILTER (WHERE c.tipo = 'imposto_interno' AND c.item_row_id IS NOT NULL)) AS imposto,
         (SELECT COALESCE(json_agg(json_build_object('mlb', i.mlb, 'sku', i.sku, 'quantidade', i.quantidade,
                                                     'custo_produto', i.custo_produto)), '[]'::json)
            FROM central_vendas_pedido_itens i WHERE i.pedido_row_id = p.id) AS itens
    FROM central_vendas_pedidos p
    LEFT JOIN central_vendas_componentes c ON c.pedido_row_id = p.id
   WHERE p.import_id = $1
   GROUP BY p.id`;

async function main() {
  const args = lerArgs(process.argv.slice(2));
  const contaId = Number(args.conta);
  const importId = Number(args.import);
  if (!Number.isInteger(contaId) || !Number.isInteger(importId)) {
    console.error("uso: node server/scripts/sentinel-e0-paridade.js --conta=<id> --import=<id> [--confirm-host=<host>] [--out=<dir>]");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL não definido no shell (o .env NÃO é lido por este script).");
    process.exit(2);
  }
  const host = new URL(process.env.DATABASE_URL).hostname;
  console.log(`[sentinel-e0-paridade] banco: host=${host} (somente leitura)`);
  if (!LOCAL_HOSTS.has(host) && args["confirm-host"] !== host) {
    console.error(`[sentinel-e0-paridade] host não-local. Para confirmar, repita com --confirm-host=${host}`);
    process.exit(3);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: LOCAL_HOSTS.has(host) ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const imp = await client.query(
      `SELECT id, cliente_conta_id, competencia, publication_status, created_at, coverage_date_from, coverage_date_to
         FROM central_vendas_imports WHERE id = $1`,
      [importId]
    );
    if (!imp.rows.length) throw new Error(`import ${importId} não existe`);
    const importacao = imp.rows[0];
    if (Number(importacao.cliente_conta_id) !== contaId) {
      throw new Error(`import ${importId} é da conta ${importacao.cliente_conta_id}, não ${contaId}`);
    }
    const central = (await client.query(SQL_CENTRAL, [importId])).rows;
    const sentinel = (await client.query(
      `SELECT pedido_id, status_ml, ml_date_last_updated, faturamento, comissao, frete, custo, imposto,
              margem_valor, margem_pct, estado_margem, pendencias, itens
         FROM sentinel_pedidos WHERE cliente_conta_id = $1 AND competencia = $2`,
      [contaId, String(importacao.competencia).trim()]
    )).rows;
    await client.query("ROLLBACK");

    const { linhas, resumo } = compararPedidos({ importacao, central, sentinel });
    const outDir = args.out || path.join(require("os").homedir(), "venforce-backups", "sentinel-e0");
    fs.mkdirSync(outDir, { recursive: true });
    const arquivo = path.join(outDir, `paridade-conta${contaId}-import${importId}.json`);
    fs.writeFileSync(arquivo, JSON.stringify({ importacao, resumo, linhas }, null, 2));
    console.log(JSON.stringify({ importacao: { id: importacao.id, competencia: importacao.competencia, criado_em: importacao.created_at }, resumo }, null, 2));
    console.log(`[sentinel-e0-paridade] detalhe pedido a pedido: ${arquivo}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[sentinel-e0-paridade] falhou: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { compararPedidos, compararItens, resumir };
