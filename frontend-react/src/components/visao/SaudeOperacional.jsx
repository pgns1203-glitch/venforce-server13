// frontend-react/src/components/visao/SaudeOperacional.jsx
// Bloco 1 — saúde da operação. Fonte: cliente360Service.getCliente360()
// (escopoConta=false: é do CLIENTE inteiro, não desta conta específica).
//
// Deliberadamente NÃO repete números financeiros aqui (faturamento, MC) —
// esses já são o bloco "Resultado do período" (Central de Vendas, a fonte
// real e account-aware). Repetir um segundo "faturamento" de outra origem
// nesta tela pareceria dois números divergentes para o mesmo mês.

import { formatarDataHora } from "../../utils/dates.js";
import { AUSENTE } from "../../utils/numbers.js";
import { saudeStatusInfo, syncStatusInfo } from "../../utils/visaoLabels.js";

const ITENS_PRONTIDAO = [
  ["temGrant", "Integração conectada"],
  ["temBase", "Base de custo vinculada"],
  ["temDiagnostico", "Diagnóstico inicial"],
  ["temFechamentoMes", "Fechamento do mês"],
  ["temAds", "Ads configurado"],
  ["temFreteHistorico", "Histórico de frete"],
];

export function SaudeOperacional({ dados }) {
  const status = saudeStatusInfo(dados.saude?.status);
  const sync = syncStatusInfo(dados.sync?.status);
  const setup = dados.setup || {};
  const prontos = ITENS_PRONTIDAO.filter(([chave]) => setup[chave] === true).length;
  const passo = dados.proximoPasso;

  return (
    <div className="vf-stack">
      <div className="vf-cluster" style={{ justifyContent: "space-between" }}>
        <span className={`vf-status is-${status.tom}`}>{status.label}</span>
        <span className="vf-field__hint">
          Prontidão {prontos}/{ITENS_PRONTIDAO.length}
        </span>
      </div>

      <ul className="vf-stack vf-stack--sm" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {ITENS_PRONTIDAO.map(([chave, label]) => (
          <li key={chave} className="vf-cluster" style={{ gap: 8, fontSize: 13 }}>
            <span aria-hidden="true">{setup[chave] === true ? "●" : "○"}</span>
            <span className={setup[chave] === true ? "" : "vf-field__hint"}>{label}</span>
          </li>
        ))}
      </ul>

      <div className="vf-divider" />

      <div className="vf-cluster" style={{ justifyContent: "space-between" }}>
        <span className={`vf-tag is-${sync.tom}`}>{sync.label}</span>
        <span className="vf-field__hint">
          Última sync: {dados.sync?.ultimaSincronizacao ? formatarDataHora(dados.sync.ultimaSincronizacao) : AUSENTE}
        </span>
      </div>

      {passo && (
        <div className="vf-banner vf-banner--compact is-info">
          <div className="vf-banner__content">
            <p className="vf-banner__title">{passo.titulo}</p>
            {passo.descricao && <p className="vf-banner__description">{passo.descricao}</p>}
          </div>
          {passo.href && (
            <a className="vf-btn vf-btn--secondary vf-btn--sm" href={passo.href}>
              Resolver
            </a>
          )}
        </div>
      )}
    </div>
  );
}
