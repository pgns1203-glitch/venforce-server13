// Comparação com a competência anterior.
//
// Só indicadores OPERACIONAIS aqui — Ads tem bloco próprio logo abaixo, para não
// misturar mídia com operação na mesma tabela de "o que melhorou / o que piorou".

import { formatarMoeda, formatarVariacaoMoeda } from "../../utils/currency.js";
import { formatarNumero, direcao, ehAusente, AUSENTE } from "../../utils/numbers.js";
import { formatarPercentual, formatarVariacaoPercentual, formatarPontosPercentuais } from "../../utils/percentage.js";
import { rotularCompetencia } from "../../utils/dates.js";
import DataTable from "./DataTable.jsx";

function delta(valor, formatador) {
  return ehAusente(valor) ? AUSENTE : formatador(valor);
}

export default function ComparacaoMensal({ fechamento, periodo, comparacao }) {
  const { atual, anterior, variacoes } = fechamento;

  const linhas = [
    {
      chave: "faturamento", label: "Faturamento",
      a: formatarMoeda(anterior.faturamento), b: formatarMoeda(atual.faturamento),
      delta: delta(variacoes.faturamento.abs, formatarVariacaoMoeda),
      pct: formatarVariacaoPercentual(variacoes.faturamento.pct),
      dir: direcao(variacoes.faturamento.abs),
    },
    {
      chave: "resultado", label: "Resultado operacional", destaque: true,
      a: formatarMoeda(anterior.resultadoOperacional), b: formatarMoeda(atual.resultadoOperacional),
      delta: delta(variacoes.resultadoOperacional.abs, formatarVariacaoMoeda),
      pct: formatarVariacaoPercentual(variacoes.resultadoOperacional.pct),
      dir: direcao(variacoes.resultadoOperacional.abs),
    },
    {
      chave: "margem", label: "Margem operacional",
      a: formatarPercentual(anterior.margemOperacional), b: formatarPercentual(atual.margemOperacional),
      delta: formatarPontosPercentuais(variacoes.margemOperacional.pp), pct: AUSENTE,
      dir: direcao(variacoes.margemOperacional.pp),
    },
    {
      chave: "pedidos", label: "Pedidos",
      a: formatarNumero(anterior.pedidos), b: formatarNumero(atual.pedidos),
      delta: delta(variacoes.pedidos.abs, (v) => formatarNumero(v)),
      pct: formatarVariacaoPercentual(variacoes.pedidos.pct),
      dir: direcao(variacoes.pedidos.abs),
    },
    {
      chave: "unidades", label: "Unidades",
      a: formatarNumero(anterior.unidades), b: formatarNumero(atual.unidades),
      delta: delta(variacoes.unidades.abs, (v) => formatarNumero(v)),
      pct: formatarVariacaoPercentual(variacoes.unidades.pct),
      dir: direcao(variacoes.unidades.abs),
    },
    {
      chave: "ticket", label: "Ticket médio",
      a: formatarMoeda(anterior.ticketMedio), b: formatarMoeda(atual.ticketMedio),
      delta: delta(variacoes.ticketMedio.abs, formatarVariacaoMoeda),
      pct: formatarVariacaoPercentual(variacoes.ticketMedio.pct),
      dir: direcao(variacoes.ticketMedio.abs),
    },
    {
      chave: "cancelamentos", label: "Cancelamentos",
      a: formatarNumero(anterior.cancelamentos), b: formatarNumero(atual.cancelamentos),
      delta: delta(variacoes.cancelamentos.abs, (v) => formatarNumero(v)),
      pct: formatarVariacaoPercentual(variacoes.cancelamentos.pct),
      // subir cancelamento é ruim
      dir: direcao(variacoes.cancelamentos.abs, { inverso: true }),
    },
  ];

  const colunas = [
    { key: "label", header: "Indicador", width: "34%", isRowHeader: true, render: (l) => l.label },
    { key: "a", header: rotularCompetencia(comparacao.competencia), width: "17%", align: "right", render: (l) => l.a },
    { key: "b", header: rotularCompetencia(periodo.competencia), width: "17%", align: "right", render: (l) => l.b },
    { key: "delta", header: "Variação", width: "17%", align: "right",
      render: (l) => l.delta, cellClassName: (l) => `c360-dir--${l.dir}` },
    { key: "pct", header: "%", width: "15%", align: "right",
      render: (l) => l.pct, cellClassName: () => "c360-fraco" },
  ];

  return (
    <section className="vf-section c360-secao">
      <div className="vf-section__header">
        <div className="vf-section__heading">
          <h2 className="vf-section__title">Comparação com o mês anterior</h2>
          <p className="vf-section__description">
            {rotularCompetencia(periodo.competencia)} contra {rotularCompetencia(comparacao.competencia)}
            {periodo.parcial ? ` · mesmo número de dias (${periodo.diasNoPeriodo})` : ""}
          </p>
        </div>
      </div>

      <DataTable
        caption="Indicadores operacionais das duas competências"
        columns={colunas}
        rows={linhas}
        getRowKey={(l) => l.chave}
        rowClassName={(l) => (l.destaque ? "c360-linha-destaque" : undefined)}
      />
    </section>
  );
}
