// frontend-react/src/components/financeiro/mesa/PainelEtapas.jsx
//
// O painel à direita da mesa (modelo B): as seis etapas do fechamento, de
// cima para baixo, e a ação do próximo passo no rodapé. A etapa "atual" é a
// primeira não feita. A altura acompanha o bloco da esquerda (termina na
// borda de baixo de "Da receita ao resultado").

const CHECK = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ROTULO_ESTADO = { feita: "concluída", atual: "próximo passo", pendente: "pendente" };

export function PainelEtapas({ titulo, subtitulo, etapas, children }) {
  return (
    <aside className="vf-card vf-fin-mesa-painel" aria-label="Etapas do fechamento">
      <header className="vf-fin-mesa-painel__cabecalho">
        <h3 className="vf-fin-mesa__titulo">{titulo}</h3>
        {subtitulo && <p className="vf-fin-mesa__descricao">{subtitulo}</p>}
      </header>
      <ol className="vf-fin-mesa-painel__etapas">
        {etapas.map((e, i) => (
          <li key={e.id} className={`vf-fin-mesa-etapa is-${e.estado}`} data-etapa={e.id} data-estado={e.estado}>
            <span className="vf-fin-mesa-etapa__marca" aria-hidden="true">
              {e.estado === "feita" ? CHECK : i + 1}
            </span>
            <div className="vf-fin-mesa-etapa__texto">
              <span className="vf-fin-mesa-etapa__titulo">
                {e.titulo}
                <span className="vf-visually-hidden"> ({ROTULO_ESTADO[e.estado]})</span>
              </span>
              {e.detalhe && <span className="vf-fin-mesa-etapa__detalhe">{e.detalhe}</span>}
            </div>
            {e.acao ? (
              <button type="button" className="vf-fin-mesa-etapa__acao" onClick={e.acao.onClick} disabled={e.acao.disabled} aria-label={`${e.acao.rotulo}: ${e.titulo}`}>
                {e.acao.rotulo}
              </button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ol>
      <div className="vf-fin-mesa-painel__rodape">{children}</div>
    </aside>
  );
}

// O botão grande do rodapé (mesma família do "Radar de subsídios" de
// Anúncios ML): ícone, título e uma linha de apoio.
export function AcaoPrincipal({ titulo, apoio, tom = "primary", icone = null, ...rest }) {
  return (
    <button type="button" className={`vf-fin-mesa-cta is-${tom}`} {...rest}>
      {icone && <span className="vf-fin-mesa-cta__icone" aria-hidden="true">{icone}</span>}
      <span className="vf-fin-mesa-cta__texto">
        <span className="vf-fin-mesa-cta__titulo">{titulo}</span>
        {apoio && <span className="vf-fin-mesa-cta__apoio">{apoio}</span>}
      </span>
    </button>
  );
}

export const ICONES = {
  enviar: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </svg>
  ),
  arquivo: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  processar: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4l14 8-14 8z" />
    </svg>
  ),
  link: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  ),
};
