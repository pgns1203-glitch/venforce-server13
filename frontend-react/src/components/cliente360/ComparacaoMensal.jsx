// Comparação com a competência anterior.
//
// Só indicadores OPERACIONAIS aqui — Ads tem bloco próprio logo abaixo, para não
// misturar mídia com operação na mesma tabela de "o que melhorou / o que piorou".

import { formatarMoeda, formatarVariacaoMoeda } from "../../utils/currency.js";
import { formatarNumero, direcao, ehAusente, AUSENTE } from "../../utils/numbers.js";
import { formatarPercentual, formatarVariacaoPercentual, formatarPontosPercentuais } from "../../utils/percentage.js";
import { rotularCompetencia } from "../../utils/dates.js";

function delta(valor, formatador) {
  return ehAusente(valor) ? AUSENTE : formatador(valor);
}

export default function ComparacaoMensal({ fechamento, periodo, comparacao }) {
  const { atual, anterior, variacoes } = fechamento;

  const linhas = [
    {
      label: "Faturamento",
      a: formatarMoeda(anterior.faturamento), b: formatarMoeda(atual.faturamento),
      delta: delta(variacoes.faturamento.abs, formatarVariacaoMoeda),
      pct: formatarVariacaoPercentual(variacoes.faturamento.pct),
      dir: direcao(variacoes.faturamento.abs),
    },
    {
      label: "Resultado operacional", destaque: true,
      a: formatarMoeda(anterior.resultadoOperacional), b: formatarMoeda(atual.resultadoOperacional),
      delta: delta(variacoes.resultadoOperacional.abs, formatarVariacaoMoeda),
      pct: formatarVariacaoPercentual(variacoes.resultadoOperacional.pct),
      dir: direcao(variacoes.resultadoOperacional.abs),
    },
    {
      label: "Margem operacional",
      a: formatarPercentual(anterior.margemOperacional), b: formatarPercentual(atual.margemOperacional),
      delta: formatarPontosPercentuais(variacoes.margemOperacional.pp), pct: AUSENTE,
      dir: direcao(variacoes.margemOperacional.pp),
    },
    {
      label: "Pedidos",
      a: formatarNumero(anterior.pedidos), b: formatarNumero(atual.pedidos),
      delta: delta(variacoes.pedidos.abs, (v) => formatarNumero(v)),
      pct: formatarVariacaoPercentual(variacoes.pedidos.pct),
      dir: direcao(variacoes.pedidos.abs),
    },
    {
      label: "Unidades",
      a: formatarNumero(anterior.unidades), b: formatarNumero(atual.unidades),
      delta: delta(variacoes.unidades.abs, (v) => formatarNumero(v)),
      pct: formatarVariacaoPercentual(variacoes.unidades.pct),
      dir: direcao(variacoes.unidades.abs),
    },
    {
      label: "Ticket médio",
      a: formatarMoeda(anterior.ticketMedio), b: formatarMoeda(atual.ticketMedio),
      delta: delta(variacoes.ticketMedio.abs, formatarVariacaoMoeda),
      pct: formatarVariacaoPercentual(variacoes.ticketMedio.pct),
      dir: direcao(variacoes.ticketMedio.abs),
    },
    {
      label: "Cancelamentos",
      a: formatarNumero(anterior.cancelamentos), b: formatarNumero(atual.cancelamentos),
      delta: delta(variacoes.cancelamentos.abs, (v) => formatarNumero(v)),
      pct: formatarVariacaoPercentual(variacoes.cancelamentos.pct),
      // subir cancelamento é ruim
      dir: direcao(variacoes.cancelamentos.abs, { inverso: true }),
    },
  ];

  return (
    <section className="vf-section">
      <div className="vf-section__header">
        <div>
          <h2 className="vf-section__title">Comparação com o mês anterior</h2>
          <p className="vf-section__description">
            {rotularCompetencia(periodo.competencia)} contra {rotularCompetencia(comparacao.competencia)}
            {periodo.parcial ? ` · mesmo número de dias (${periodo.diasNoPeriodo})` : ""}
          </p>
        </div>
      </div>

      <div className="vf-table-wrap">
        <table className="vf-table vf-table--compact">
          <thead>
            <tr>
              <th scope="col">Indicador</th>
              <th scope="col" className="c360-num">{rotularCompetencia(comparacao.competencia)}</th>
              <th scope="col" className="c360-num">{rotularCompetencia(periodo.competencia)}</th>
              <th scope="col" className="c360-num">Variação</th>
              <th scope="col" className="c360-num">%</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.label} className={linha.destaque ? "c360-linha-destaque" : undefined}>
                <th scope="row">{linha.label}</th>
                <td className="c360-num">{linha.a}</td>
                <td className="c360-num">{linha.b}</td>
                <td className={`c360-num c360-dir--${linha.dir}`}>{linha.delta}</td>
                <td className="c360-num c360-fraco">{linha.pct}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
