// frontend-react/src/pages/FinanceiroPage.jsx
//
// F4.1/F4.2 — Financeiro V3. As 5 seções (Resultado, Conciliação,
// Fechamento, Relatórios gerados, Histórico) continuam vindo de um único
// GET /financeiro/:cliente; F4.2 acrescentou a camada OPERACIONAL sobre as
// entregas de fechamento (GET /entregas-cliente + publicar/despublicar),
// que o backend já suportava e nenhuma tela chamava.
//
// O que continua no legado (Portal/financeiro.html): upload, cálculo e
// salvamento do fechamento. Não por falta de vontade — o endpoint que
// processa não recebe `periodo` e a entrega salva não guarda
// `cliente_conta_id`; migrar esses botões seria prometer, numa tela que
// exibe cliente + operação + competência, uma garantia que o contrato não
// dá. Ver Squads_migration/VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md.
//
// Central de Vendas e Margem permanecem módulos próprios (D20 do Master
// Spec) — o Financeiro linka para elas, não as absorve.

import { useState } from "react";
import { useOperacaoAtual } from "../hooks/useVfContext.js";
import { useFinanceiro } from "../hooks/useFinanceiro.js";
import { useEntregasFechamento } from "../hooks/useEntregasFechamento.js";
import { competenciasRecentes, rotularCompetencia } from "../utils/dates.js";
import { Tabs } from "../components/financeiro/Tabs.jsx";
import { ResultadoTab } from "../components/financeiro/ResultadoTab.jsx";
import { ConciliacaoTab } from "../components/financeiro/ConciliacaoTab.jsx";
import { FechamentoTab } from "../components/financeiro/FechamentoTab.jsx";
import { RelatoriosTab } from "../components/financeiro/RelatoriosTab.jsx";
import { HistoricoTab } from "../components/financeiro/HistoricoTab.jsx";

const PERIODOS = competenciasRecentes(13);
const ABAS = [
  { id: "resultado", label: "Resultado" },
  { id: "conciliacao", label: "Conciliação" },
  { id: "fechamento", label: "Fechamento" },
  { id: "relatorios", label: "Relatórios gerados" },
  { id: "historico", label: "Histórico" },
];

export default function FinanceiroPage() {
  const { pronta, clienteSlug, clienteContaId } = useOperacaoAtual();
  const { periodo, setPeriodo, dados, carregando, erro } = useFinanceiro({ clienteSlug, clienteContaId, pronta });
  // Entregas são de CLIENTE (entregas_cliente não tem cliente_conta_id), por
  // isso a chave aqui é só o slug: trocar de operação não reabre esta lista.
  const entregas = useEntregasFechamento({ clienteSlug, habilitado: pronta });
  const [abaAtiva, setAbaAtiva] = useState("resultado");

  // Contexto incompleto: o Shell (data-vf-scope="account") já cuida do
  // gating — nada a duplicar aqui.
  if (!pronta) return null;

  const periodoLabel = rotularCompetencia(periodo);

  return (
    <div className="vf-page-shell">
      <div className="vf-page-container">
        <header className="vf-page-header">
          <div className="vf-page-header__main">
            <p className="vf-page-header__eyebrow">Financeiro · em validação (V3)</p>
            <h1 className="vf-page-header__title">Resultado e fechamento do período</h1>
            <p className="vf-page-header__description">
              Leitura do que já foi processado, e publicação dos fechamentos gerados. Para{" "}
              <strong>gerar</strong> um fechamento (upload e cálculo), use{" "}
              <a href={`financeiro.html?cliente=${encodeURIComponent(clienteSlug)}`}>o Financeiro atual →</a>
            </p>
          </div>
          <div className="vf-page-header__actions">
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
              <p className="vf-banner__title">Não foi possível carregar o Financeiro</p>
              <p className="vf-banner__description">{erro.mensagem}</p>
            </div>
          </div>
        )}

        {!dados && carregando && (
          <div className="vf-stack" style={{ marginTop: 20 }}>
            <div className="vf-skeleton vf-skeleton--title" />
            <div className="vf-skeleton vf-skeleton--row" />
            <div className="vf-skeleton vf-skeleton--row" />
          </div>
        )}

        {dados && (
          <section className={`vf-section${carregando ? " is-atualizando" : ""}`} style={{ marginTop: 20 }}>
            <Tabs abas={ABAS} ativa={abaAtiva} onChange={setAbaAtiva} />
            <div className="vf-fin-painel">
              {abaAtiva === "resultado" && (
                <ResultadoTab resultado={dados.resultado} clienteSlug={clienteSlug} periodoLabel={periodoLabel} />
              )}
              {abaAtiva === "conciliacao" && <ConciliacaoTab conciliacao={dados.conciliacao} />}
              {abaAtiva === "fechamento" && (
                <FechamentoTab
                  resultado={dados.resultado}
                  clienteSlug={clienteSlug}
                  periodo={periodo}
                  periodoLabel={periodoLabel}
                  entregas={entregas}
                />
              )}
              {abaAtiva === "relatorios" && (
                <RelatoriosTab relatorios={dados.relatorios} entregas={entregas} periodo={periodo} />
              )}
              {abaAtiva === "historico" && (
                <HistoricoTab relatorios={dados.relatorios} entregas={entregas} periodo={periodo} />
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
