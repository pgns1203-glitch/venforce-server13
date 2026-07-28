// Cabeçalho do cliente: nome, período apurado e marcação de período parcial.
// O backend é a autoridade sobre o intervalo realmente usado — aqui só exibimos.

import { rotularCompetencia, formatarData } from "../../utils/dates.js";

export default function Cliente360Header({ cliente, periodo, comparacao }) {
  const intervalo = periodo ? `${formatarData(periodo.inicio)} – ${formatarData(periodo.fim)}` : null;
  const intervaloComparado = comparacao
    ? `${formatarData(comparacao.inicio)} – ${formatarData(comparacao.fim)}`
    : null;

  return (
    <header className="vf-page-header c360-header">
      <div className="vf-page-header__main">
        <p className="vf-page-header__eyebrow">Operação · Resultado do fechamento</p>
        <h1 className="vf-page-header__title">
          Cliente 360
          {cliente && <span className="c360-header__cliente"> · {cliente.nome}</span>}
        </h1>
        <p className="vf-page-header__description">
          O que aconteceu com o resultado operacional do mês, produto a produto, e quanto ainda dá para recuperar.
        </p>

        {periodo && (
          <div className="c360-header__periodos">
            <span className="vf-tag">
              {rotularCompetencia(periodo.competencia)} · {intervalo}
            </span>
            {periodo.parcial && (
              <span className="vf-badge is-warning">
                Período parcial — {periodo.diasNoPeriodo} de {periodo.diasNoMes} dias
              </span>
            )}
            {comparacao && (
              <span className="vf-tag is-neutral">
                comparado com {rotularCompetencia(comparacao.competencia)} · {intervaloComparado}
              </span>
            )}
          </div>
        )}

        {periodo?.parcial && (
          <p className="c360-header__nota">
            O mês corrente é comparado contra o mesmo número de dias do mês anterior — nunca 15 dias contra 30.
          </p>
        )}
      </div>
    </header>
  );
}
