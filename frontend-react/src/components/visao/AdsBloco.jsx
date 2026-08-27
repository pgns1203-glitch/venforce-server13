// frontend-react/src/components/visao/AdsBloco.jsx
// Bloco 4 — Ads (mlAdsService). Só Mercado Livre; escopoConta=true.
//
// Armadilha real do backend: quando não há Ads configurado, a função NÃO
// lança — devolve `{semDados: true, codigo, motivo}` dentro de um bloco
// `disponivel:true`. Sem checar `semDados` primeiro, a UI tentaria ler
// `investimentoAds` de um objeto que não tem esse campo.

import { formatarMoeda } from "../../utils/currency.js";
import { formatarPercentual } from "../../utils/percentage.js";
import { formatarNumero } from "../../utils/numbers.js";
import { ADS_SEM_DADOS_MOTIVO } from "../../utils/visaoLabels.js";
import { BlocoIndisponivel } from "./BlocoCard.jsx";

export function AdsBloco({ dados }) {
  if (dados.semDados) {
    return <BlocoIndisponivel motivo={dados.motivo || ADS_SEM_DADOS_MOTIVO[dados.codigo] || "Ads não está configurado para esta operação."} />;
  }

  return (
    <div className="vf-stack">
      <div className="vf-kpi-grid">
        <div className="vf-kpi vf-kpi--featured">
          <span className="vf-kpi__label">Investimento em Ads</span>
          <span className="vf-kpi__value vf-kpi__value--currency">{formatarMoeda(dados.investimentoAds)}</span>
        </div>
        <div className="vf-kpi">
          <span className="vf-kpi__label">GMV via Ads</span>
          <span className="vf-kpi__value vf-kpi__value--currency">{formatarMoeda(dados.gmvAds)}</span>
        </div>
        <div className="vf-kpi">
          <span className="vf-kpi__label">ACOS</span>
          <span className="vf-kpi__value">{formatarPercentual((dados.acos ?? null) / 100)}</span>
        </div>
        <div className="vf-kpi">
          <span className="vf-kpi__label">ROAS</span>
          <span className="vf-kpi__value">{formatarNumero(dados.roas, 2)}</span>
        </div>
      </div>
      {dados.avisos?.length > 0 && (
        <p className="vf-field__hint">{dados.avisos[0]}</p>
      )}
    </div>
  );
}
