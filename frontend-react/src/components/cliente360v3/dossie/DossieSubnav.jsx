// frontend-react/src/components/cliente360v3/dossie/DossieSubnav.jsx
//
// Subnavegação horizontal sticky. Substitui o "trilho" anterior, que era uma
// lista de âncoras sem estado: o usuário clicava, a página pulava, e nada
// indicava onde ele estava depois. Aqui há scrollspy real
// (IntersectionObserver, ver hooks/useScrollSpy.js) e offset correto de
// header + barra.
//
// Só entram seções que a página está REALMENTE renderizando nesta carga — link
// morto para seção ausente é pior que ausência de link.
//
// Alguns itens carregam contexto (contagem de problemas, dinheiro na mesa,
// confiança), mas com parcimônia: a subnav é navegação, não um segundo painel
// de indicadores.

export default function DossieSubnav({ secoes, ativa, onIr }) {
  if (!secoes || secoes.length === 0) return null;

  return (
    <nav className="c360d-subnav" aria-label="Seções do dossiê">
      <ul className="c360d-subnav__lista">
        {secoes.map((secao) => {
          const atual = secao.id === ativa;
          return (
            <li key={secao.id}>
              <a
                href={`#${secao.id}`}
                className={`c360d-subnav__item${atual ? " is-ativa" : ""}`}
                aria-current={atual ? "location" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onIr(secao.id);
                }}
              >
                {secao.label}
                {secao.contexto && (
                  <span className={`c360d-subnav__contexto${secao.alerta ? " is-alerta" : ""}`}>
                    {secao.contexto}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
