// Confiança dos dados: cobertura de custo/frete em % do FATURAMENTO e a
// reconciliação entre o detalhe por item e o total oficial do fechamento.
//
// Divergência não é escondida nem forçada a fechar. Quando existe diferença sem
// origem identificada — ou quando a decomposição da ponte deixa resíduo — o valor
// aparece em reais, a fonte é nomeada e a confiança cai para parcial.
//
// A disponibilidade de Ads NÃO entra nesta conta: falta de Ads não degrada a
// qualidade do resultado operacional.

import { formatarMoeda } from "../../utils/currency.js";
import { formatarNumero } from "../../utils/numbers.js";
import { formatarPercentual } from "../../utils/percentage.js";
import { formatarData, formatarDataHora } from "../../utils/dates.js";

const NIVEL = {
  confiavel: { tag: "is-success", label: "Confiável" },
  parcial: { tag: "is-warning", label: "Parcial" },
  insuficiente: { tag: "is-danger", label: "Insuficiente" },
};

export default function ConfiancaDados({ confianca, fechamento }) {
  const nivel = NIVEL[confianca.nivel] || NIVEL.insuficiente;
  const reconciliacao = confianca.reconciliacao || fechamento?.reconciliacao?.atual || null;
  const pedidos = (confianca.pedidosDerrubando || []).slice(0, 10);

  return (
    <section className="vf-section c360-confianca">
      <div className="vf-section__header">
        <div>
          <h2 className="vf-section__title">Confiança dos dados</h2>
          <p className="vf-section__description">
            Cobertura medida em percentual do faturamento — um pedido grande sem custo pesa mais
            que dez pequenos.
          </p>
        </div>
        <div className="vf-section__actions">
          <span className={`vf-tag ${nivel.tag}`}>{nivel.label}</span>
        </div>
      </div>

      <div className="vf-kpi-grid c360-kpis">
        <article className="vf-kpi">
          <p className="vf-kpi__label">Cobertura de resultado</p>
          <p className="vf-kpi__value">{formatarPercentual(confianca.coberturaResultado)}</p>
        </article>
        <article className="vf-kpi">
          <p className="vf-kpi__label">Cobertura de custo</p>
          <p className="vf-kpi__value">{formatarPercentual(confianca.coberturaCusto)}</p>
        </article>
        <article className="vf-kpi">
          <p className="vf-kpi__label">Cobertura de frete</p>
          <p className="vf-kpi__value">{formatarPercentual(confianca.coberturaFrete)}</p>
        </article>
        <article className="vf-kpi">
          <p className="vf-kpi__label">Receita sem apuração</p>
          <p className="vf-kpi__value">{formatarMoeda(confianca.receitaBloqueada)}</p>
          <p className="vf-kpi__foot">
            {formatarNumero(confianca.pedidosBloqueados)} pedido(s) bloqueado(s)
          </p>
        </article>
      </div>

      {(confianca.alertas || []).map((alerta) => (
        <div
          key={alerta.chave}
          className={`vf-banner vf-banner--compact ${alerta.severidade === "critico" ? "is-danger" : "is-warning"}`}
        >
          <div className="vf-banner__content">
            <p className="vf-banner__description">
              {alerta.mensagem}
              {alerta.fonte ? ` (fonte: ${alerta.fonte})` : ""}
            </p>
          </div>
        </div>
      ))}

      {reconciliacao && (
        <div className="c360-reconciliacao">
          <p className="c360-grupo__titulo">
            Reconciliação detalhe × fechamento
            <span className={`vf-tag ${reconciliacao.status === "reconciliado" ? "is-success" : "is-warning"}`}>
              {reconciliacao.status === "reconciliado" ? "Reconciliado" : "Divergente"}
            </span>
          </p>
          <div className="vf-table-wrap">
            <table className="vf-table vf-table--compact">
              <tbody>
                <tr>
                  <th scope="row">Faturamento no fechamento (oficial)</th>
                  <td className="c360-num">{formatarMoeda(reconciliacao.faturamentoFechamento)}</td>
                </tr>
                <tr>
                  <th scope="row">Faturamento detalhado por item</th>
                  <td className="c360-num">{formatarMoeda(reconciliacao.faturamentoDetalhe)}</td>
                </tr>
                {!!reconciliacao.ajusteIdentificado && (
                  <tr>
                    <th scope="row">
                      Ajustes de fechamento (origem identificada)
                      <span className="c360-fraco"> {reconciliacao.origemAjuste}</span>
                    </th>
                    <td className="c360-num">{formatarMoeda(reconciliacao.ajusteIdentificado)}</td>
                  </tr>
                )}
                <tr className={reconciliacao.diferenca ? "c360-linha-destaque" : undefined}>
                  <th scope="row">Diferença sem origem identificada</th>
                  <td className={`c360-num${reconciliacao.diferenca ? " c360-dir--negativo" : ""}`}>
                    {formatarMoeda(reconciliacao.diferenca)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {reconciliacao.status === "divergente" && (
            <p className="c360-nota">
              A diferença é mostrada como está. Nenhum número foi forçado a fechar e nenhum ajuste
              artificial foi criado.
            </p>
          )}
        </div>
      )}

      {pedidos.length > 0 && (
        <details className="c360-detalhe">
          <summary>Pedidos que derrubam a confiança ({pedidos.length})</summary>
          <div className="vf-table-wrap">
            <table className="vf-table vf-table--compact">
              <thead>
                <tr>
                  <th scope="col">Pedido</th>
                  <th scope="col">Data</th>
                  <th scope="col" className="c360-num">Valor</th>
                  <th scope="col">Pendências</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => (
                  <tr key={p.pedidoId}>
                    <th scope="row">{p.pedidoId}</th>
                    <td>{formatarData(p.data)}</td>
                    <td className="c360-num">{formatarMoeda(p.valor)}</td>
                    <td className="c360-fraco">{(p.pendencias || []).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {confianca.geradoEm && (
        <p className="c360-nota c360-nota--fraca">
          Fechamento sincronizado em {formatarDataHora(confianca.geradoEm)}.
        </p>
      )}
    </section>
  );
}
