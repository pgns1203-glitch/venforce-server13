// Página da Central de Gestão Full — build isolado (PR5).
//
// V1 desta tela: a conta ML vem explícita da URL (?clienteContaId=123).
// Um seletor de cliente/conta (GET /clientes/:slug/contas) fica para uma
// próxima rodada — não bloqueia o operacional de quem já sabe a conta.
//
// Sem múltiplas coletas simultâneas: resumo, filtros, tabela e drawer
// compartilham o MESMO `dados` de `useFullSnapshot`; o drawer dispara sua
// própria busca (detalhe + movimentos) só quando um inventory é selecionado.

import { useMemo, useState } from "react";
import { useFullSnapshot } from "../../hooks/useFullSnapshot.js";
import { computeFullSummary, filterInventories } from "../../utils/fullSummary.js";
import FullSummaryKpis from "../../components/full/FullSummaryKpis.jsx";
import FullFilters from "../../components/full/FullFilters.jsx";
import FullInventoryTable from "../../components/full/FullInventoryTable.jsx";
import FullInventoryDrawer from "../../components/full/FullInventoryDrawer.jsx";
import FullLoadingState from "../../components/full/FullLoadingState.jsx";
import FullErrorState from "../../components/full/FullErrorState.jsx";
import FullEmptyState from "../../components/full/FullEmptyState.jsx";

const FILTROS_PADRAO = { search: "", status: "", somenteComDemanda: false };

export function lerClienteContaIdDaUrl(search = window.location.search) {
  const q = new URLSearchParams(search || "");
  const n = Number(q.get("clienteContaId"));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default function FullGestaoPage() {
  const [clienteContaId] = useState(() => lerClienteContaIdDaUrl());
  const { dados, carregando, erro, recarregar } = useFullSnapshot(clienteContaId);
  const [filtros, setFiltros] = useState(FILTROS_PADRAO);
  const [inventoryIdSelecionado, setInventoryIdSelecionado] = useState(null);

  const atualizarFiltro = (parcial) => setFiltros((atual) => ({ ...atual, ...parcial }));

  const inventoriesFiltradas = useMemo(
    () => (dados ? filterInventories(dados.inventories, filtros) : []),
    [dados, filtros]
  );
  const resumo = useMemo(() => (dados ? computeFullSummary(dados.inventories) : null), [dados]);

  return (
    <div className="vf-page-shell full-page">
      <div className="vf-page-container vf-page-container--wide">
        <header className="full-header">
          <h1>Central de Gestão Full</h1>
          {dados && (
            <span className="full-header-meta">
              Conta {dados.account?.sellerIdMasked || "—"}
              {" · "}
              {dados.cache?.generatedAt
                ? `atualizado ${new Date(dados.cache.generatedAt).toLocaleString("pt-BR")}`
                : "atualização desconhecida"}
              {dados.cache?.stale ? " · dados desatualizados (nova coleta em andamento ou aguardando limite do ML)" : ""}
            </span>
          )}
          <button type="button" className="vf-btn" onClick={recarregar} disabled={carregando || !clienteContaId}>
            Atualizar
          </button>
        </header>

        {!clienteContaId && (
          <FullEmptyState mensagem="Informe ?clienteContaId=<id> na URL para escolher a conta Mercado Livre desta coleta." />
        )}

        {clienteContaId && erro && !dados && <FullErrorState erro={erro} onTentarNovamente={recarregar} />}

        {clienteContaId && !dados && !erro && carregando && <FullLoadingState />}

        {clienteContaId && dados && (
          <>
            {erro && (
              <p className="full-aviso full-aviso--erro" role="alert">
                Não foi possível atualizar agora ({erro.mensagem}). Mostrando o último dado bom carregado.
              </p>
            )}

            {!erro && dados.cache?.stale && (
              <p className="full-aviso" role="status">
                Dados desatualizados — a última coleta falhou ou está pendente. Números abaixo são do último snapshot bom.
              </p>
            )}

            {dados.quality?.status === "partial" && (
              <p className="full-aviso" role="status">
                Coleta parcial: uma ou mais fontes (itens, estoque ou operações) não puderam ser lidas por completo
                nesta rodada. Valores ausentes aparecem como “—”, nunca como zero inventado.
              </p>
            )}

            <FullSummaryKpis summary={resumo} />
            <FullFilters filtros={filtros} onAtualizar={atualizarFiltro} />

            {dados.inventories.length === 0 ? (
              <FullEmptyState mensagem="Esta conta não tem inventários Full identificados nesta coleta." />
            ) : (
              <FullInventoryTable inventories={inventoriesFiltradas} onDetalhar={setInventoryIdSelecionado} />
            )}
          </>
        )}
      </div>

      {inventoryIdSelecionado && (
        <FullInventoryDrawer
          clienteContaId={clienteContaId}
          inventoryId={inventoryIdSelecionado}
          onFechar={() => setInventoryIdSelecionado(null)}
        />
      )}
    </div>
  );
}
