// frontend-react/src/components/cliente360v3/dossie/AdsPainel.jsx
//
// Ads em duas fontes diferentes, ditas em voz alta — é o ponto da tela onde
// misturar origem sairia mais caro:
//
//   · Investimento, GMV Ads, ROAS e ACOS vêm do Mercado Ads DESTA CONTA
//     (mlAdsService, account-scoped comprovado);
//   · TACoS e resultado após Ads vêm do FECHAMENTO — é o investimento do mês
//     cruzado com o faturamento operacional já apurado.
//
// As duas origens ficam em grupos separados, cada um com sua etiqueta no
// cabeçalho do grupo (§20), em vez de uma nota embaixo de cada número.
//
// A "leitura" de uma linha vem pronta do backend (`ads.leitura`) — descritiva,
// sobre métricas que já estão na tela. Nada de causalidade inventada aqui.

import { formatarMoeda } from "../../../utils/currency.js";
import { formatarPercentual, formatarVariacaoPercentual, formatarPontosPercentuais } from "../../../utils/percentage.js";
import { ehAusente, AUSENTE, formatarNumero } from "../../../utils/numbers.js";
import { Delta, Indisponivel, Esqueleto, Fonte } from "./Primitivos.jsx";

function tacos(investimento, faturamento) {
  const f = Number(faturamento);
  if (investimento == null || !Number.isFinite(f) || f <= 0) return null;
  return investimento / f;
}

function Metrica({ rotulo, valor, delta, titulo }) {
  return (
    <div className="c360d-metrica" title={titulo}>
      <span className="c360d-metrica__rotulo">{rotulo}</span>
      <span className="c360d-metrica__valor">{valor}</span>
      {delta && <span className="c360d-metrica__delta">{delta}</span>}
    </div>
  );
}

export default function AdsPainel({ adsConta, adsFechamento, carregando, erro, fechamento }) {
  if (carregando && !adsConta) return <Esqueleto linhas={3} />;

  if (erro && !adsConta) {
    return <Indisponivel compacto titulo="Não foi possível consultar Ads" motivo={erro.mensagem || String(erro)} />;
  }

  if (!adsConta) {
    return <Indisponivel compacto titulo="Ads ainda não consultado" motivo="Esta seção busca o Mercado Ads desta conta ao carregar o Dossiê." />;
  }

  if (!adsConta.disponivel) {
    return <Indisponivel compacto titulo="Ads indisponível para esta conta" motivo={adsConta.motivo} />;
  }

  const d = adsConta.dados || {};
  const faturamento = fechamento?.atual?.faturamento;
  const tacosValor = tacos(d.investimentoAds, faturamento);
  const resultadoAposAds = fechamento?.atual?.resultadoAposAds;
  const varResultadoAposAds = fechamento?.variacoes?.resultadoAposAds;

  return (
    <div className="c360d-ads">
      <div className="c360d-ads__grupo">
        <p className="c360d-ads__fonte">
          <Fonte>Mercado Ads · conta desta operação</Fonte>
        </p>
        <div className="c360d-ads__metricas">
          <Metrica rotulo="Investimento" valor={formatarMoeda(d.investimentoAds, { casas: 0 })} />
          <Metrica rotulo="GMV Ads" valor={formatarMoeda(d.gmvAds, { casas: 0 })} />
          <Metrica rotulo="ROAS" valor={d.roas != null ? `${formatarNumero(d.roas, 2)}×` : AUSENTE} titulo="Receita de Ads por real investido" />
          <Metrica rotulo="ACOS" valor={d.acos != null ? `${formatarNumero(d.acos, 1)}%` : AUSENTE} titulo="Investimento sobre a receita atribuída a Ads" />
        </div>
      </div>

      <div className="c360d-ads__grupo">
        <p className="c360d-ads__fonte">
          <Fonte>Fechamento · investimento do mês sobre o resultado operacional</Fonte>
        </p>
        <div className="c360d-ads__metricas">
          <Metrica
            rotulo="TACoS"
            valor={tacosValor != null ? formatarPercentual(tacosValor) : AUSENTE}
            titulo={tacosValor == null ? "Sem faturamento do período para calcular" : "Investimento sobre o faturamento total"}
            delta={
              adsFechamento?.variacoes?.tacosPp != null
                ? <Delta valor={adsFechamento.variacoes.tacosPp} texto={formatarPontosPercentuais(adsFechamento.variacoes.tacosPp, 2)} inverso />
                : null
            }
          />
          <Metrica
            rotulo="Resultado após Ads"
            valor={ehAusente(resultadoAposAds) ? AUSENTE : formatarMoeda(resultadoAposAds, { casas: 0 })}
            delta={
              varResultadoAposAds?.pct != null
                ? <Delta valor={varResultadoAposAds.pct} texto={formatarVariacaoPercentual(varResultadoAposAds.pct)} />
                : null
            }
          />
        </div>
      </div>

      {adsFechamento?.leitura && <p className="c360d-ads__leitura">{adsFechamento.leitura}</p>}

      <p className="c360d-ads__aviso">
        Resultado após Ads não é lucro líquido — salários, ferramentas e despesas fixas podem não estar aí.
      </p>
    </div>
  );
}
