// frontend-react/src/pages/FinanceiroPage.jsx
//
// F4.1 — Financeiro V3, SÓ LEITURA. Convive com Portal/financeiro.html
// (upload/processamento real) — não substitui nada ainda (ver
// vite.entries.js e financeiro-v3.html). Estrutura em 5 seções (pedido
// explícito desta rodada): Resultado, Conciliação, Fechamento, Relatórios
// gerados, Histórico — todas vêm de um único GET /financeiro/:cliente.
//
// Central de Vendas e Margem permanecem módulos próprios (D20 do Master
// Spec) — o Financeiro linka para elas, não as absorve.

import { useState } from "react";
import { useOperacaoAtual } from "../hooks/useVfContext.js";
import { useFinanceiro } from "../hooks/useFinanceiro.js";
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
              Leitura do que já foi processado. Para gerar ou publicar um fechamento, use{" "}
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
                <FechamentoTab resultado={dados.resultado} clienteSlug={clienteSlug} periodoLabel={periodoLabel} />
              )}
              {abaAtiva === "relatorios" && <RelatoriosTab relatorios={dados.relatorios} />}
              {abaAtiva === "historico" && <HistoricoTab relatorios={dados.relatorios} />}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
