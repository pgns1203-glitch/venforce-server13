// frontend-react/src/components/cliente360v3/dossie/FaixaExecutiva.jsx
//
// A resposta de 3 segundos: quanto entrou, quanto sobrou, quanto sobrou depois
// da mídia, com que margem, em quantos pedidos e a que ticket. Seis
// indicadores numa faixa única de ~104px — não seis cards.
//
// Duas decisões que valem explicação:
//
// 1. A BASE DE COMPARAÇÃO aparece UMA vez, no topo da faixa, não embaixo de
//    cada indicador. Repetir "vs Mai/2026" seis vezes é a mesma informação
//    ocupando seis lugares; o brief pede a base de comparação visível, não
//    seis cópias dela.
// 2. Os valores vão SEM centavos. Centavo não muda decisão nesta altura de
//    leitura e custa largura em seis colunas; o valor exato continua no
//    `title` de cada número e nas tabelas de detalhe, com centavo.

import { formatarMoeda } from "../../../utils/currency.js";
import { formatarNumero, ehAusente } from "../../../utils/numbers.js";
import { formatarPercentual, formatarVariacaoPercentual, formatarPontosPercentuais } from "../../../utils/percentage.js";
import { rotularCompetencia } from "../../../utils/dates.js";
import { Delta, Indicador } from "./Primitivos.jsx";

const MOTIVO_ADS = {
  parcial: "Ads cobre o mês inteiro; o período apurado é parcial.",
  sem_dados: "Sem investimento de Ads nesta competência.",
  sem_grant: "O token do cliente não tem permissão no Mercado Ads.",
  erro: "Falha ao consultar o Mercado Ads.",
};

function moeda(valor) {
  return formatarMoeda(valor, { casas: 0 });
}

export default function FaixaExecutiva({ fechamento, periodo, comparacao, onAbrirComparacao }) {
  const atual = fechamento?.atual || {};
  const variacoes = fechamento?.variacoes || {};
  const adsAusente = ehAusente(atual.resultadoAposAds);

  return (
    <section id="resultado" tabIndex={-1} className="c360d-faixa" aria-label="Resultado do período">
      <div className="c360d-faixa__meta">
        <span className="c360d-faixa__escopo">
          Resultado de {rotularCompetencia(periodo?.competencia)} · fonte: Fechamento API, pedido a pedido
        </span>
        <span className="c360d-faixa__base">
          Δ contra {rotularCompetencia(comparacao?.competencia)}
          {onAbrirComparacao && (
            <>
              {" · "}
              <button type="button" className="c360d-link" onClick={onAbrirComparacao}>
                tabela completa
              </button>
            </>
          )}
        </span>
      </div>

      <div className="c360d-faixa__grade">
        <Indicador
          rotulo="Faturamento"
          valor={<span title={formatarMoeda(atual.faturamento)}>{moeda(atual.faturamento)}</span>}
          delta={
            <Delta
              valor={variacoes.faturamento?.pct}
              texto={formatarVariacaoPercentual(variacoes.faturamento?.pct)}
              titulo={`Variação: ${formatarMoeda(variacoes.faturamento?.abs)}`}
            />
          }
        />

        <Indicador
          forte
          rotulo="Resultado operacional"
          valor={<span title={formatarMoeda(atual.resultadoOperacional)}>{moeda(atual.resultadoOperacional)}</span>}
          delta={
            <Delta
              valor={variacoes.resultadoOperacional?.pct}
              texto={formatarVariacaoPercentual(variacoes.resultadoOperacional?.pct)}
              titulo={`Variação: ${formatarMoeda(variacoes.resultadoOperacional?.abs)}`}
            />
          }
        />

        <Indicador
          rotulo="Resultado após Ads"
          ausente={adsAusente}
          valor={
            adsAusente
              ? "—"
              : <span title={formatarMoeda(atual.resultadoAposAds)}>{moeda(atual.resultadoAposAds)}</span>
          }
          delta={
            adsAusente ? null : (
              <Delta
                valor={variacoes.resultadoAposAds?.pct}
                texto={formatarVariacaoPercentual(variacoes.resultadoAposAds?.pct)}
                titulo={`Variação: ${formatarMoeda(variacoes.resultadoAposAds?.abs)}`}
              />
            )
          }
          // Ads ausente NUNCA vira zero: o indicador diz por que está vazio.
          nota={adsAusente ? (MOTIVO_ADS[atual.adsStatus] || "Investimento de Ads indisponível.") : null}
        />

        <Indicador
          rotulo="Margem operacional"
          valor={formatarPercentual(atual.margemOperacional)}
          delta={
            <Delta
              valor={variacoes.margemOperacional?.pp}
              texto={formatarPontosPercentuais(variacoes.margemOperacional?.pp)}
            />
          }
        />

        <Indicador
          rotulo="Pedidos"
          valor={formatarNumero(atual.pedidos)}
          delta={
            <Delta
              valor={variacoes.pedidos?.pct}
              texto={formatarVariacaoPercentual(variacoes.pedidos?.pct)}
              titulo={`${formatarNumero(atual.unidades)} unidades · ${formatarNumero(atual.cancelamentos)} cancelamentos`}
            />
          }
        />

        <Indicador
          rotulo="Ticket médio"
          valor={<span title={formatarMoeda(atual.ticketMedio)}>{moeda(atual.ticketMedio)}</span>}
          delta={
            <Delta
              valor={variacoes.ticketMedio?.pct}
              texto={formatarVariacaoPercentual(variacoes.ticketMedio?.pct)}
              titulo={`Variação: ${formatarMoeda(variacoes.ticketMedio?.abs)}`}
            />
          }
        />
      </div>
    </section>
  );
}
