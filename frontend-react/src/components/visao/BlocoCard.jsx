// frontend-react/src/components/visao/BlocoCard.jsx
// Casca comum de todo bloco da Visão: título, badge de escopo (honestidade
// de conta — MASTER_SPEC §14 do backend readiness: "isto é uma limitação
// real e documentada, não escondida atrás de um payload que parece
// filtrado e não é") e o link de aprofundamento para o módulo que resolve.
// "A Visão nunca é onde o trabalho acontece; é onde ele é priorizado."

export function BlocoCard({ titulo, escopoConta, linkHref, linkLabel, children }) {
  return (
    <section className="vf-section vf-visao-bloco">
      <header className="vf-section__header">
        <h2 className="vf-section__title">{titulo}</h2>
        <div className="vf-cluster" style={{ gap: 8 }}>
          {escopoConta === false && (
            <span className="vf-tag" title="Este bloco ainda reflete o cliente inteiro, não só esta operação.">
              cliente inteiro
            </span>
          )}
          {linkHref && (
            <a className="vf-btn vf-btn--ghost vf-btn--sm" href={linkHref}>
              {linkLabel} →
            </a>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}

export function BlocoIndisponivel({ motivo }) {
  return (
    <div className="vf-empty">
      <p className="vf-empty__description">{motivo || "Este bloco não está disponível no momento."}</p>
    </div>
  );
}

export function BlocoSkeleton({ linhas = 3 }) {
  return (
    <div className="vf-stack vf-stack--sm" aria-hidden="true">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="vf-skeleton vf-skeleton--row" />
      ))}
    </div>
  );
}
