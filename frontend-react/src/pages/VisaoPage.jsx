// frontend-react/src/pages/VisaoPage.jsx
//
// F3.2 — Visão operacional: "como está ESTE cliente/operação agora?"
// Nasce de Cliente+Operação escolhidos no Shell (vf-context) — nunca tem
// seletor próprio (MASTER_SPEC §11.1/§16). Não é dashboard genérico: cada
// bloco vem de uma fonte real já auditada (visaoService.js) e aponta para o
// módulo que resolve.
//
// O cabeçalho do Shell já mostra Cliente/Operação/Base — o cabeçalho desta
// página só acrescenta o que é específico dela: período e estado geral.

import { useOperacaoAtual } from "../hooks/useVfContext.js";
import { useVisao } from "../hooks/useVisao.js";
import { competenciasRecentes, rotularCompetencia } from "../utils/dates.js";
import { saudeStatusInfo } from "../utils/visaoLabels.js";
import { BlocoCard, BlocoIndisponivel, BlocoSkeleton } from "../components/visao/BlocoCard.jsx";
import { SaudeOperacional } from "../components/visao/SaudeOperacional.jsx";
import { ResultadoPeriodo } from "../components/visao/ResultadoPeriodo.jsx";
import { MargemBloco } from "../components/visao/MargemBloco.jsx";
import { AdsBloco } from "../components/visao/AdsBloco.jsx";
import { FechamentoBloco } from "../components/visao/FechamentoBloco.jsx";
import { AtividadeBloco } from "../components/visao/AtividadeBloco.jsx";

const PERIODOS = competenciasRecentes(13);

function Bloco({ envelope, ...props }) {
  if (!envelope) return null;
  return (
    <BlocoCard escopoConta={envelope.escopoConta} {...props}>
      {envelope.disponivel ? props.render(envelope.dados) : <BlocoIndisponivel motivo={envelope.motivo} />}
    </BlocoCard>
  );
}

export default function VisaoPage() {
  const { pronta, clienteSlug, clienteContaId, marketplace } = useOperacaoAtual();
  const { periodo, setPeriodo, dados, carregando, erro } = useVisao({ clienteSlug, clienteContaId, pronta });

  // Contexto incompleto: o Shell (data-vf-scope="account" em visao.html) já
  // esconde `.vf-shell__main` nesse caso e mostra o próprio banner de
  // estado (Escolha a operação / Selecione um cliente / etc). Nada a
  // renderizar aqui além de um espaço vazio — duplicar a mensagem seria
  // "informação repetida" (checklist de design review, §62).
  if (!pronta) return null;

  const qs = `cliente=${encodeURIComponent(clienteSlug)}&conta=${encodeURIComponent(clienteContaId)}`;
  const statusGeral = dados?.saude?.disponivel ? saudeStatusInfo(dados.saude.dados?.saude?.status) : null;

  return (
    <div className="vf-page-shell">
      <div className="vf-page-container">
        <header className="vf-page-header">
          <div className="vf-page-header__main">
            <p className="vf-page-header__eyebrow">Visão</p>
            <h1 className="vf-page-header__title">Como está esta operação</h1>
          </div>
          <div className="vf-page-header__actions">
            {statusGeral && <span className={`vf-status is-${statusGeral.tom}`}>{statusGeral.label}</span>}
            <label className="vf-field" style={{ margin: 0 }}>
              <span className="vf-visually-hidden">Período</span>
              <select className="vf-select vf-select--sm" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
                {PERIODOS.map((c) => (
                  <option key={c} value={c}>{rotularCompetencia(c)}</option>
                ))}
              </select>
            </label>
          </div>
        </header>

        {erro && !dados && (
          <div className="vf-banner is-danger" role="alert">
            <div className="vf-banner__content">
              <p className="vf-banner__title">Não foi possível carregar a Visão</p>
              <p className="vf-banner__description">{erro.mensagem}</p>
            </div>
          </div>
        )}

        {!dados && carregando && (
          <div className="vf-visao-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <section key={i} className="vf-section vf-visao-bloco">
                <BlocoSkeleton linhas={4} />
              </section>
            ))}
          </div>
        )}

        {dados && (
          <div className={`vf-visao-grid${carregando ? " is-atualizando" : ""}`}>
            <Bloco
              envelope={dados.saude}
              titulo="Saúde da operação"
              render={(d) => <SaudeOperacional dados={d} />}
            />
            <Bloco
              envelope={dados.resultado}
              titulo="Resultado do período"
              linkHref={`fechamentos-api.html?${qs}`}
              linkLabel="Central de Vendas"
              render={(d) => <ResultadoPeriodo dados={d} />}
            />
            <Bloco
              envelope={dados.margem}
              titulo="Margem"
              linkHref={`central-margem.html?cliente=${encodeURIComponent(clienteSlug)}`}
              linkLabel="Margem"
              render={(d) => <MargemBloco dados={d} />}
            />
            <Bloco
              envelope={dados.ads}
              titulo="Ads"
              linkHref={`anuncios-meli.html?cliente=${encodeURIComponent(clienteSlug)}`}
              linkLabel="Anúncios"
              render={(d) => <AdsBloco dados={d} />}
            />
            <Bloco
              envelope={dados.fechamento}
              titulo="Fechamento"
              linkHref={`financeiro.html?cliente=${encodeURIComponent(clienteSlug)}`}
              linkLabel="Financeiro"
              render={(d) => <FechamentoBloco dados={d} periodo={rotularCompetencia(periodo)} />}
            />
            <Bloco
              envelope={dados.atividade}
              titulo="Atividade recente"
              linkHref={`fechamentos-api.html?${qs}`}
              linkLabel="Central de Vendas"
              render={(d) => <AtividadeBloco dados={d} />}
            />
          </div>
        )}
      </div>
    </div>
  );
}
