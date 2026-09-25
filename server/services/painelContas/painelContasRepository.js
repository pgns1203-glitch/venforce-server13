// server/services/painelContas/painelContasRepository.js
// Leitura em LOTE (nunca 1 query por cliente) sobre os snapshots já
// persistidos — cliente_360_resumos_mensais (Cliente 360) e ads_resumos_mensais
// (Ads, só para gmv_ads, usado na derivação de ACOS). Segue o padrão LATERAL
// de dashboardService.loadProductionData (Auditoria §13/§18/§19): uma query
// cobre N clientes, sempre `WHERE c.id = ANY($1::int[])` ou equivalente.
//
// NENHUMA chamada aqui aciona cliente360ResultadoService.getResultado nem
// qualquer motor ao vivo — só leitura do snapshot batch (Auditoria §18 riscos
// 1/2, ETAPA 1 do checklist §27).

const pool = require("../../config/database");

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRow(row) {
  return {
    clienteId: Number(row.cliente_id),
    clienteSlug: row.cliente_slug || null,
    competencia: row.competencia || null,
    faturamento: row.faturamento,
    mcMedia: row.mc_media,
    adsInvestido: row.ads_investido,
    gmvAds: row.gmv_ads,
    sincronizadoEm: toIso(row.sincronizado_em),
  };
}

// Um resumo por cliente: o mais recente dentro do ano informado (ou o mais
// recente de qualquer ano, se `ano` for null/undefined). Clientes sem NENHUM
// snapshot simplesmente não aparecem no resultado — quem chama trata a
// ausência como `resumo: null`, nunca erro.
async function listarUltimosResumos(clienteIds, { ano = null } = {}) {
  if (!Array.isArray(clienteIds) || !clienteIds.length) return [];
  const anoLike = ano ? `${ano}-%` : null;
  const { rows } = await pool.query(
    `/* painelContas:ULTIMO_RESUMO_POR_CLIENTE */
     SELECT c.id AS cliente_id, c.slug AS cliente_slug,
            r.competencia, r.faturamento, r.mc_media, r.ads_investido, r.sincronizado_em,
            ads.gmv_ads
       FROM clientes c
       LEFT JOIN LATERAL (
         SELECT competencia, faturamento, mc_media, ads_investido, sincronizado_em
           FROM cliente_360_resumos_mensais s
          WHERE s.cliente_id = c.id
            AND ($2::text IS NULL OR s.competencia LIKE $2)
          ORDER BY s.competencia DESC
          LIMIT 1
       ) r ON true
       LEFT JOIN LATERAL (
         SELECT gmv_ads
           FROM ads_resumos_mensais a
          WHERE a.cliente_slug = c.slug
            AND a.mes_ref = r.competencia
            AND a.loja_campanha = 'todas'
          LIMIT 1
       ) ads ON r.competencia IS NOT NULL
      WHERE c.id = ANY($1::int[])`,
    [clienteIds, anoLike]
  );
  return rows.filter((row) => row.competencia !== null).map(mapRow);
}

// Todas as competências de um cliente dentro de um ano, ordenadas do mais
// antigo para o mais recente (para permitir variação mês-a-mês em sequência
// no service, sem nova query por mês).
async function listarResumosDoAno(clienteId, clienteSlug, ano) {
  const { rows } = await pool.query(
    `/* painelContas:RESUMOS_DO_ANO */
     SELECT s.cliente_id, s.cliente_slug, s.competencia, s.faturamento, s.mc_media,
            s.ads_investido, s.sincronizado_em, ads.gmv_ads
       FROM cliente_360_resumos_mensais s
       LEFT JOIN LATERAL (
         SELECT gmv_ads
           FROM ads_resumos_mensais a
          WHERE a.cliente_slug = $3 AND a.mes_ref = s.competencia AND a.loja_campanha = 'todas'
          LIMIT 1
       ) ads ON true
      WHERE s.cliente_id = $1 AND s.competencia LIKE $2
      ORDER BY s.competencia ASC`,
    [clienteId, `${ano}-%`, clienteSlug]
  );
  return rows.map(mapRow);
}

module.exports = { listarUltimosResumos, listarResumosDoAno };
