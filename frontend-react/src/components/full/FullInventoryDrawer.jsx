import { useEffect, useRef } from "react";
import { useFullInventoryDetail } from "../../hooks/useFullInventoryDetail.js";
import { formatarNumero, ehAusente, AUSENTE } from "../../utils/numbers.js";
import { formatarDataHora } from "../../utils/dates.js";

// Product360 operacional: identidade, estoque, condições, cálculo e
// movimentos de um único inventory_id. Foco restaurado ao botão que abriu o
// drawer quando ele fecha (o chamador controla isso via `onFechar`).
export default function FullInventoryDrawer({ clienteContaId, inventoryId, onFechar }) {
  const { detalhe, movimentos, carregando, erro } = useFullInventoryDetail(clienteContaId, inventoryId);
  const fecharRef = useRef(null);

  useEffect(() => {
    fecharRef.current?.focus();
    function onKeyDown(evento) {
      if (evento.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onFechar]);

  if (!inventoryId) return null;

  const semDadosDeVenda = !detalhe || detalhe.sales?.status === "unavailable";

  return (
    <div className="full-drawer-overlay" role="presentation" onClick={onFechar}>
      <aside
        className="full-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhe do inventário ${inventoryId}`}
        onClick={(evento) => evento.stopPropagation()}
      >
        <button type="button" className="vf-btn vf-btn--ghost full-drawer-fechar" onClick={onFechar} ref={fecharRef}>
          Fechar
        </button>

        {carregando && <p>Carregando detalhe…</p>}
        {erro && <p role="alert">{erro.mensagem}</p>}

        {detalhe && (
          <>
            <h2>{inventoryId}</h2>

            <section>
              <h3>Referências</h3>
              <ul>
                {(detalhe.references || []).map((ref, indice) => (
                  <li key={`${ref.mlb || "sem-mlb"}-${ref.variationId || indice}`}>
                    {ref.mlb || AUSENTE} · SKU {ref.sellerSku || AUSENTE}
                    {ref.variationId ? ` · variação ${ref.variationId}` : ""} — {ref.title || AUSENTE}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3>Estoque</h3>
              <p>Disponível: {formatarNumero(detalhe.stock?.available)}</p>
              <p>Indisponível: {formatarNumero(detalhe.stock?.notAvailable)}</p>
              <p>Total: {formatarNumero(detalhe.stock?.total)}</p>
            </section>

            <section>
              <h3>Cálculo</h3>
              <p>Status operacional: {detalhe.operationalStatus}</p>
              <p>Giro/dia: {formatarNumero(detalhe.dailyTurnover, 2)}</p>
              <p>Cobertura: {formatarNumero(detalhe.coverageDays, 1)} dias</p>
              <p>
                Enviar: {formatarNumero(detalhe.sendQuantity)}
                {detalhe.replenishmentReason ? ` (${detalhe.replenishmentReason})` : ""}
              </p>
            </section>

            <section>
              <h3>Movimentos (janela de 14 dias)</h3>
              {semDadosDeVenda ? (
                <p>Movimentos indisponíveis nesta coleta.</p>
              ) : ehAusente(movimentos?.movements?.length) || movimentos.movements.length === 0 ? (
                <p>Nenhum movimento no período.</p>
              ) : (
                <ul>
                  {movimentos.movements.map((movimento) => (
                    <li key={movimento.operationId}>
                      {formatarDataHora(movimento.date)} — {movimento.type} —{" "}
                      {ehAusente(movimento.units) ? AUSENTE : formatarNumero(movimento.units)} un.
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
