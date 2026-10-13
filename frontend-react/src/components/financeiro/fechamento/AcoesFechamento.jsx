// frontend-react/src/components/financeiro/fechamento/AcoesFechamento.jsx
//
// O que fazer com o fechamento processado: salvar a entrega, reprocessar ou
// voltar para os arquivos/ajustes. Fica DEPOIS da leitura (resultado,
// pendências, composição) e ANTES dos produtos: quem decide salvar já viu o
// que está salvando. Duplicidade (409) mora aqui porque é uma decisão sobre
// salvar.

export function AcoesFechamento({ f, periodoLabel, legado }) {
  const salvando = f.estado === "salvando";
  const salvo = f.estado === "salvo";
  const reprocessando = f.estado === "processando";

  return (
    <div className="vf-stack">
      {/* ── Duplicidade (409) ─────────────────────────────────────────── */}
      {f.duplicidade && (
        <div className={`vf-banner ${f.duplicidade.publicado ? "is-danger" : "is-warning"}`} role="alert">
          <div className="vf-banner__content">
            <p className="vf-banner__title">
              {f.duplicidade.publicado
                ? `${periodoLabel} já tem um fechamento PUBLICADO para esta operação`
                : `${periodoLabel} já tem um fechamento salvo para esta operação`}
            </p>
            <p className="vf-banner__description">
              {f.duplicidade.publicado
                ? "Substituir grava um novo fechamento desta competência. O link que já está com o cliente continua abrindo o fechamento antigo; o novo ganha um link próprio quando for publicado."
                : "Substituir atualiza a entrega existente com o que acabou de ser processado."}
            </p>
            <div className="vf-cluster">
              <button type="button" className="vf-btn vf-btn--danger vf-btn--sm" disabled={salvando} onClick={f.substituir}>
                {salvando ? "Substituindo…" : "Substituir"}
              </button>
              <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={f.resetar}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {salvo ? (
        <div className="vf-cluster">
          <span className="vf-status is-success" role="status">
            Entrega salva. Edite a apresentação e publique em “Entrega para o cliente”, logo abaixo.
          </span>
          <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={f.resetar}>
            Processar outro
          </button>
        </div>
      ) : !f.duplicidade ? (
        <div className="vf-cluster vf-fin-acoes">
          <button
            type="button"
            className="vf-btn vf-btn--primary"
            disabled={salvando || reprocessando || (f.divergente && !f.confirmouDivergencia)}
            aria-busy={salvando ? "true" : undefined}
            onClick={() => f.salvar()}
          >
            {salvando ? "Salvando…" : "Salvar entrega"}
          </button>
          <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" disabled={salvando || reprocessando} onClick={f.reprocessar}>
            {reprocessando ? "Reprocessando…" : "Reprocessar fechamento"}
          </button>
          <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" disabled={salvando} onClick={f.voltarAoFormulario}>
            Editar arquivos e ajustes
          </button>
        </div>
      ) : null}

      <p className="vf-field__hint">
        Reprocessar pelo motor antigo continua possível no <a href={legado}>Financeiro (legado) →</a>
      </p>
    </div>
  );
}
