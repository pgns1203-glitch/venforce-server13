// Estado de carregamento. Usa o skeleton da Fundação Global V2 para a tela não
// "piscar" diferente do resto do Portal.

export default function LoadingState({ titulo = "Carregando fechamento…", linhas = 4 }) {
  return (
    <div className="c360-loading" role="status" aria-live="polite">
      <div className="c360-loading__head">
        <span className="vf-spinner vf-spinner--sm" aria-hidden="true" />
        <span>{titulo}</span>
      </div>
      <div className="c360-loading__grid">
        {Array.from({ length: linhas }, (_, i) => (
          <div key={i} className="vf-skeleton vf-skeleton--row" />
        ))}
      </div>
    </div>
  );
}
