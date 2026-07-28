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
import DataTable from "./DataTable.jsx";

const NIVEL = {
  confiavel: { tag: "is-success", label: "Confiável" },
  parcial: { tag: "is-warning", label: "Parcial" },
  insuficiente: { tag: "is-danger", label: "Insuficiente" },
};

// Tabela de duas colunas: rótulo à esquerda, valor à direita, sem cabeçalho
// visível (o `caption` cobre o leitor de tela).
const COLUNAS_RECONCILIACAO = [
  { key: "label", header: "Componente", width: "70%", isRowHeader: true,
    render: (linha) => (
      <>
        {linha.label}
        {linha.detalhe && <span className="c360-fraco"> {linha.detalhe}</span>}
      </>
    ) },
  { key: "valor", header: "Valor", width: "30%", align: "right",
    render: (linha) => formatarMoeda(linha.valor),
    cellClassName: (linha) => linha.className || "" },
];

function linhasReconciliacao(reconciliacao) {
  const linhas = [
    { chave: "oficial", label: "Faturamento no fechamento (oficial)", valor: reconciliacao.faturamentoFechamento },
    { chave: "detalhe", label: "Faturamento detalhado por item", valor: reconciliacao.faturamentoDetalhe },
  ];
  if (reconciliacao.ajusteIdentificado) {
    linhas.push({
      chave: "ajuste",
      label: "Ajustes de fechamento (origem identificada)",
      detalhe: reconciliacao.origemAjuste,
      valor: reconciliacao.ajusteIdentificado,
    });
  }
  linhas.push({
    chave: "diferenca",
    label: "Diferença sem origem identificada",
    valor: reconciliacao.diferenca,
    destaque: !!reconciliacao.diferenca,
    className: reconciliacao.diferenca ? "c360-dir--negativo" : "",
  });
  return linhas;
}

const COLUNAS_PEDIDOS = [
  { key: "pedidoId", header: "Pedido", width: "26%", isRowHeader: true,
    render: (p) => p.pedidoId, cellClassName: () => "c360-td--truncar" },
  { key: "data", header: "Data", width: "16%", render: (p) => formatarData(p.data) },
  { key: "valor", header: "Valor", width: "18%", align: "right", render: (p) => formatarMoeda(p.valor) },
  { key: "pendencias", header: "Pendências", width: "40%",
    render: (p) => (p.pendencias || []).join(", ") || "—",
    cellClassName: () => "c360-fraco c360-td--truncar" },
];

export default function ConfiancaDados({ confianca, fechamento }) {
  const nivel = NIVEL[confianca.nivel] || NIVEL.insuficiente;
  const reconciliacao = confianca.reconciliacao || fechamento?.reconciliacao?.atual || null;
  const pedidos = (confianca.pedidosDerrubando || []).slice(0, 10);

  return (
    <section className="vf-section c360-secao c360-confianca">
      <div className="vf-section__header">
        <div className="vf-section__heading">
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
          <DataTable
            caption="Reconciliação entre o detalhe por item e o total do fechamento"
            columns={COLUNAS_RECONCILIACAO}
            rows={linhasReconciliacao(reconciliacao)}
            getRowKey={(linha) => linha.chave}
            rowClassName={(linha) => (linha.destaque ? "c360-linha-destaque" : undefined)}
          />
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
          <DataTable
            caption="Pedidos que derrubam a confiança"
            columns={COLUNAS_PEDIDOS}
            rows={pedidos}
            getRowKey={(p) => p.pedidoId}
          />
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
