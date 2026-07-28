// Vazio honesto: diz o que falta em vez de fingir que o número é zero.

export default function EmptyState({ titulo, descricao, acaoLabel, acaoHref, compacto = false }) {
  return (
    <div className={`vf-empty${compacto ? " c360-vazio--compacto" : ""}`}>
      <h3 className="vf-empty__title">{titulo}</h3>
      {descricao && <p className="vf-empty__description">{descricao}</p>}
      {acaoLabel && acaoHref && (
        <div className="vf-empty__actions">
          <a className="vf-btn vf-btn--secondary" href={acaoHref}>{acaoLabel}</a>
        </div>
      )}
    </div>
  );
}
