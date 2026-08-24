import { useEffect, useRef, useState } from "react";
import { useFullInventoryDetail } from "../../hooks/useFullInventoryDetail.js";
import { formatarNumero, ehAusente, AUSENTE } from "../../utils/numbers.js";
import { formatarDataHora } from "../../utils/dates.js";
import { STATUS_LABEL, STATUS_TONE } from "../../utils/fullOperationalStatus.js";

// Product360 operacional: identidade, estoque, condições, cálculo e
// movimentos de um único inventory_id. Foco restaurado ao botão que abriu o
// drawer quando ele fecha (o chamador controla isso via `onFechar`).
//
// `.vf-drawer` (Fundação V2) exige a classe `is-open` para entrar em cena —
// ela some por padrão (visibility:hidden + translateX) para permitir a
// transição de slide-in dos pares HTML/CSS estáticos do Portal. Aqui o
// drawer é montado/desmontado pelo React, então `aberto` liga `is-open` um
// frame depois do mount para a transição realmente rodar.
export default function FullInventoryDrawer({ clienteContaId, inventoryId, onFechar }) {
  const { detalhe, movimentos, carregando, erro } = useFullInventoryDetail(clienteContaId, inventoryId);
  const fecharRef = useRef(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setAberto(true));
    fecharRef.current?.focus();
    function onKeyDown(evento) {
      if (evento.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onFechar]);

  if (!inventoryId) return null;

  const semDadosDeVenda = !detalhe || detalhe.sales?.status === "unavailable";
  const statusTom = detalhe ? STATUS_TONE[detalhe.operationalStatus] || "" : "";

  return (
    <>
      <div
        className={`vf-drawer-backdrop${aberto ? " is-open" : ""}`}
        role="presentation"
        onClick={onFechar}
      />
      <aside
        className={`vf-drawer vf-drawer--lg${aberto ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-drawer-title"
      >
        <div className="vf-drawer__header">
          <h2 className="vf-drawer__title" id="full-drawer-title">
            Inventário <span className="vf-mono">{inventoryId}</span>
          </h2>
          <button
            type="button"
            className="vf-btn vf-btn--ghost vf-btn--icon vf-btn--sm"
            aria-label="Fechar"
            onClick={onFechar}
            ref={fecharRef}
          >
            ✕
          </button>
        </div>

        <div className="vf-drawer__body">
          {carregando && <p>Carregando detalhe…</p>}
          {erro && <p role="alert">{erro.mensagem}</p>}

          {detalhe && (
            <div className="vf-stack">
              <section>
                <h3 className="full-drawer-section-title">Referências</h3>
                <ul className="full-drawer-refs">
                  {(detalhe.references || []).map((ref, indice) => (
                    <li key={`${ref.mlb || "sem-mlb"}-${ref.variationId || indice}`}>
                      <span className="vf-mono">{ref.mlb || AUSENTE}</span> · SKU{" "}
                      <span className="vf-mono">{ref.sellerSku || AUSENTE}</span>
                      {ref.variationId ? ` · variação ${ref.variationId}` : ""} — {ref.title || AUSENTE}
                    </li>
                  ))}
                </ul>
              </section>

              <hr className="vf-divider" />

              <section>
                <h3 className="full-drawer-section-title">Estoque</h3>
                <div className="full-drawer-fields">
                  <div className="vf-field">
                    <span className="vf-field__label">Disponível</span>
                    <span className="num">{formatarNumero(detalhe.stock?.available)}</span>
                  </div>
                  <div className="vf-field">
                    <span className="vf-field__label">Indisponível</span>
                    <span className="num">{formatarNumero(detalhe.stock?.notAvailable)}</span>
                  </div>
                  <div className="vf-field">
                    <span className="vf-field__label">Total</span>
                    <span className="num">{formatarNumero(detalhe.stock?.total)}</span>
                  </div>
                </div>
              </section>

              <hr className="vf-divider" />

              <section>
                <h3 className="full-drawer-section-title">Cálculo</h3>
                <div className="full-drawer-fields">
                  <div className="vf-field">
                    <span className="vf-field__label">Status operacional</span>
                    <span className={`vf-status${statusTom ? ` ${statusTom}` : ""}`}>
                      {STATUS_LABEL[detalhe.operationalStatus] || detalhe.operationalStatus || AUSENTE}
                    </span>
                  </div>
                  <div className="vf-field">
                    <span className="vf-field__label">Giro/dia</span>
                    <span className="num">{formatarNumero(detalhe.dailyTurnover, 2)}</span>
                  </div>
                  <div className="vf-field">
                    <span className="vf-field__label">Cobertura</span>
                    <span className="num">{formatarNumero(detalhe.coverageDays, 1)} dias</span>
                  </div>
                  <div className="vf-field">
                    <span className="vf-field__label">Enviar</span>
                    <span className="num">
                      {formatarNumero(detalhe.sendQuantity)}
                      {detalhe.replenishmentReason ? ` (${detalhe.replenishmentReason})` : ""}
                    </span>
                  </div>
                </div>
              </section>

              <hr className="vf-divider" />

              <section>
                <h3 className="full-drawer-section-title">Movimentos (janela de 14 dias)</h3>
                {semDadosDeVenda ? (
                  <p className="full-drawer-hint">Movimentos indisponíveis nesta coleta.</p>
                ) : ehAusente(movimentos?.movements?.length) || movimentos.movements.length === 0 ? (
                  <p className="full-drawer-hint">Nenhum movimento no período.</p>
                ) : (
                  <ul className="full-drawer-movs">
                    {movimentos.movements.map((movimento) => (
                      <li key={movimento.operationId}>
                        <span>{formatarDataHora(movimento.date)} — {movimento.type}</span>
                        <span className="num">
                          {ehAusente(movimento.units) ? AUSENTE : formatarNumero(movimento.units)} un.
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
