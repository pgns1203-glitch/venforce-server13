// Fechamento do mês: KPIs principais.
//
// A separação visual mais importante da tela mora aqui. RESULTADO OPERACIONAL e
// RESULTADO APÓS ADS são dois números diferentes, em dois grupos diferentes, com
// a fórmula de cada um à vista. O grupo de Ads carrega o aviso de que "após Ads"
// NÃO é lucro líquido — salários, ferramentas e despesas fixas podem não estar lá.
//
// Ads indisponível não vira zero: os cards mostram "—" e o motivo aparece acima.

import { formatarMoeda } from "../../utils/currency.js";
import { formatarNumero } from "../../utils/numbers.js";
import { formatarPercentual } from "../../utils/percentage.js";

const AVISO_STATUS_ADS = {
  carregado: null,
  parcial: "Ads do mês inteiro — o período apurado é parcial, então os números não cobrem o mesmo intervalo.",
  sem_dados: "Sem dados de Ads para esta competência.",
  sem_grant: "O token do cliente não tem permissão no Mercado Ads.",
  erro: "Falha ao consultar o Mercado Ads.",
};

function Kpi({ label, valor, destaque = false, negativo = false, rodape = null, vazio = false }) {
  const classes = [
    "vf-kpi",
    destaque ? "vf-kpi--featured" : "",
    negativo ? "vf-kpi--danger" : "",
    vazio ? "c360-kpi--vazio" : "",
  ].filter(Boolean).join(" ");

  return (
    <article className={classes}>
      <p className="vf-kpi__label">{label}</p>
      <p className="vf-kpi__value">{valor}</p>
      {rodape && <p className="vf-kpi__foot">{rodape}</p>}
    </article>
  );
}

export default function FechamentoResumo({ fechamento, ads }) {
  const atual = fechamento.atual;
  const adsIndisponivel = atual.ads === null || atual.ads === undefined;
  const aviso = AVISO_STATUS_ADS[atual.adsStatus] || null;

  return (
    <section className="vf-section c360-fechamento">
      <div className="vf-section__header">
        <div>
          <h2 className="vf-section__title">Fechamento do mês</h2>
          <p className="vf-section__description">
            Resultado operacional apurado pela Fechamento API, pedido a pedido.
          </p>
        </div>
      </div>

      {/* Grupo 1 — OPERAÇÃO (antes de Ads) */}
      <div className="c360-grupo">
        <p className="c360-grupo__titulo">
          Operação
          <span className="c360-grupo__formula">
            faturamento − comissão − frete − custo do produto − imposto
          </span>
        </p>
        <div className="vf-kpi-grid c360-kpis">
          <Kpi label="Faturamento" valor={formatarMoeda(atual.faturamento)} />
          <Kpi
            label="Resultado operacional"
            valor={formatarMoeda(atual.resultadoOperacional)}
            destaque
            negativo={(atual.resultadoOperacional ?? 0) < 0}
          />
          <Kpi label="Margem operacional" valor={formatarPercentual(atual.margemOperacional)} />
          <Kpi label="Pedidos" valor={formatarNumero(atual.pedidos)} />
          <Kpi label="Unidades" valor={formatarNumero(atual.unidades)} />
          <Kpi label="Ticket médio" valor={formatarMoeda(atual.ticketMedio)} />
          <Kpi
            label="Cancelamentos"
            valor={formatarNumero(atual.cancelamentos)}
            rodape={`${formatarMoeda(atual.valorCancelado)} cancelados`}
          />
        </div>
      </div>

      {/* Grupo 2 — DEPOIS DE ADS (mesmo resultado, menos a mídia do mês) */}
      <div className="c360-grupo c360-grupo--ads">
        <p className="c360-grupo__titulo">
          Depois de Ads
          <span className="c360-grupo__formula">resultado operacional − investimento em Ads</span>
        </p>

        {adsIndisponivel && (
          <div className="vf-banner is-info vf-banner--compact c360-ads-ausente">
            <div className="vf-banner__content">
              <p className="vf-banner__title">Sem dados de Ads</p>
              <p className="vf-banner__description">
                {aviso || "Investimento não disponível nesta competência."}{" "}
                TACoS, resultado após Ads e margem após Ads ficam indisponíveis. O resultado
                operacional acima continua válido.
              </p>
            </div>
          </div>
        )}

        <div className="vf-kpi-grid c360-kpis c360-kpis--ads">
          <Kpi label="Ads investido" valor={formatarMoeda(atual.ads)} vazio={adsIndisponivel} />
          <Kpi label="TACoS" valor={formatarPercentual(atual.tacos)} vazio={adsIndisponivel} />
          <Kpi
            label="Resultado após Ads"
            valor={formatarMoeda(atual.resultadoAposAds)}
            destaque
            negativo={(atual.resultadoAposAds ?? 0) < 0}
            vazio={adsIndisponivel}
          />
          <Kpi label="Margem após Ads" valor={formatarPercentual(atual.margemAposAds)} vazio={adsIndisponivel} />
        </div>

        <p className="c360-nota">
          <strong>Resultado após Ads não é lucro líquido.</strong>{" "}
          Salários, ferramentas, despesas fixas e outras despesas podem não estar incluídos.
        </p>

        {!adsIndisponivel && ads?.atual?.fonte && (
          <p className="c360-nota c360-nota--fraca">
            Ads da competência via{" "}
            <span className="vf-tag is-neutral">
              {ads.atual.fonte === "mercado_ads" ? "Mercado Ads" : "resumo mensal"}
            </span>
            {aviso ? ` · ${aviso}` : ""}
          </p>
        )}
      </div>
    </section>
  );
}
