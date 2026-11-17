// server/services/sentinel/sentinelEvidenciaCobertura.js
//
// Relatório de COBERTURA da evidência financeira, por conta. SOMENTE LEITURA (dois SELECTs, nenhum DDL/DML).
//
// O que mede: quanto do que o Sentinel já gravou traz campos promocionais, quanto é legado, quanto é inconsistente.
// O que NÃO mede: "pedidos financeiramente corretos". Sem conciliação externa (faturamento/provisões) nada aqui
// prova que o lucro está certo — por isso `nao_conciliados` é reportado e o aviso acompanha todo relatório.
//
// Denominadores (sempre explícitos, { n, denominador, percentual }):
//   pedidos_considerados  — linhas da conta na janela (sem denominador)
//   legados / com_evidencia — denominador = pedidos_considerados
//   demais indicadores     — denominador = com_evidencia (legado não entra: não tem evidência por definição)
//   prejuizos_*            — denominador = pedidos pagos com evidência e margem < 0
// percentual é null quando o denominador é 0 (nunca 0% nem NaN).

const { evidenciaSchemaPronto } = require("./sentinelSchema");

const AVISO_COBERTURA = "Cobertura de campos, não acurácia: sem conciliação externa (faturamento/provisões) nenhum percentual aqui indica "
  + "pedidos financeiramente corretos; nao_conciliados cobre todos os pedidos com evidência nesta fase.";

const COBERTURA_SQL = `
SELECT cliente_conta_id,
       COUNT(*)::int AS considerados,
       COUNT(*) FILTER (WHERE calculo_versao IS NULL)::int AS legados,
       COUNT(*) FILTER (WHERE calculo_versao IS NOT NULL)::int AS com_evidencia,
       COUNT(*) FILTER (WHERE calculo_versao IS NOT NULL
                          AND COALESCE((evidencia_financeira->>'completude')::int, 0) > 0)::int AS com_campos_promocionais,
       COUNT(*) FILTER (WHERE calculo_versao IS NOT NULL
                          AND COALESCE((evidencia_financeira->>'completude')::int, 0) = 0)::int AS sem_evidencia_promocional,
       COUNT(*) FILTER (WHERE calculo_versao IS NOT NULL
                          AND evidencia_financeira->>'estado' = 'INCONSISTENTE')::int AS inconsistentes,
       COUNT(*) FILTER (WHERE calculo_versao IS NOT NULL
                          AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(evidencia_financeira->'itens', '[]'::jsonb)) i
                                       WHERE i->>'estado' = 'ML_PARTICIPA'))::int AS potencial_ml,
       COUNT(*) FILTER (WHERE calculo_versao IS NOT NULL
                          AND evidencia_financeira->>'estado' = 'NAO_DETERMINADO')::int AS nao_verificados,
       COUNT(*) FILTER (WHERE calculo_versao IS NOT NULL
                          AND COALESCE(evidencia_financeira->>'conciliacao', 'NAO_CONCILIADO') = 'NAO_CONCILIADO')::int AS nao_conciliados,
       COUNT(*) FILTER (WHERE calculo_versao IS NOT NULL AND status_ml = 'paid' AND margem_valor < 0)::int AS prejuizos_com_evidencia,
       COUNT(*) FILTER (WHERE calculo_versao IS NOT NULL AND status_ml = 'paid' AND margem_valor < 0
                          AND afirmacao_financeira IN ('OBSERVACAO', 'INCONSISTENTE'))::int AS prejuizos_que_virariam_pendentes
  FROM sentinel_pedidos
 WHERE cliente_conta_id = ANY($1::int[])
   AND ($2::timestamptz IS NULL OR data_pedido >= $2)
 GROUP BY cliente_conta_id
 ORDER BY cliente_conta_id`;

const DISTRIBUICAO_SQL = `
SELECT cliente_conta_id, afirmacao_financeira AS afirmacao, COUNT(*)::int AS n
  FROM sentinel_pedidos
 WHERE cliente_conta_id = ANY($1::int[])
   AND ($2::timestamptz IS NULL OR data_pedido >= $2)
   AND calculo_versao IS NOT NULL
 GROUP BY cliente_conta_id, afirmacao_financeira
 ORDER BY cliente_conta_id, afirmacao_financeira`;

const razao = (n, denominador) => ({
  n: Number(n) || 0,
  denominador,
  percentual: denominador > 0 ? Math.round(((Number(n) || 0) / denominador) * 10000) / 100 : null,
});

// Pura: linhas do SELECT → relatório. `contasPedidas` (opcional) descarta qualquer conta fora do pedido.
function resumirCobertura({ conta, dist }, contasPedidas = null) {
  const pedidas = contasPedidas ? new Set(contasPedidas.map(Number)) : null;
  const contas = (conta || []).filter((r) => !pedidas || pedidas.has(Number(r.cliente_conta_id))).map((r) => {
    const considerados = Number(r.considerados) || 0;
    const comEv = Number(r.com_evidencia) || 0;
    const prej = Number(r.prejuizos_com_evidencia) || 0;
    const distribuicao = {};
    for (const d of dist || []) {
      if (Number(d.cliente_conta_id) === Number(r.cliente_conta_id) && d.afirmacao) distribuicao[d.afirmacao] = Number(d.n) || 0;
    }
    return {
      cliente_conta_id: Number(r.cliente_conta_id),
      pedidos_considerados: { n: considerados, denominador: null, descricao: "linhas de sentinel_pedidos da conta na janela" },
      legados: razao(r.legados, considerados),
      com_evidencia: razao(comEv, considerados),
      com_campos_promocionais: razao(r.com_campos_promocionais, comEv),
      sem_evidencia_promocional: razao(r.sem_evidencia_promocional, comEv),
      inconsistentes: razao(r.inconsistentes, comEv),
      potencial_participacao_ml: razao(r.potencial_ml, comEv),
      nao_verificados: razao(r.nao_verificados, comEv),
      nao_conciliados: razao(r.nao_conciliados, comEv),
      prejuizos_com_evidencia: { n: prej, denominador: null, descricao: "pedidos pagos com evidência e margem < 0" },
      prejuizos_que_virariam_pendentes: razao(r.prejuizos_que_virariam_pendentes, prej),
      distribuicao_afirmacao: distribuicao,
    };
  });
  return { disponivel: true, aviso: AVISO_COBERTURA, contas };
}

/**
 * @param {object} db  pool/conexão (somente .query de SELECT)
 * @param {{contaIds:number[], desde?:string|Date|null}} opts  contaIds é OBRIGATÓRIO (nunca varre todas por omissão)
 */
async function relatorioCobertura(db, { contaIds, desde = null } = {}) {
  const ids = Array.isArray(contaIds) ? contaIds.map(Number) : [];
  if (!ids.length || ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error("relatorioCobertura exige contaIds (inteiros > 0, ao menos um).");
  if (!(await evidenciaSchemaPronto(db))) return { disponivel: false, motivo: "schema_evidencia_ausente", aviso: AVISO_COBERTURA, contas: [] };
  const params = [ids, desde ? new Date(desde).toISOString() : null];
  const conta = await db.query(COBERTURA_SQL, params);
  const dist = await db.query(DISTRIBUICAO_SQL, params);
  return resumirCobertura({ conta: conta.rows, dist: dist.rows }, ids);
}

module.exports = { relatorioCobertura, resumirCobertura, COBERTURA_SQL, DISTRIBUICAO_SQL, AVISO_COBERTURA };
