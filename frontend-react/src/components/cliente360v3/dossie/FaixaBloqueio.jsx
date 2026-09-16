// frontend-react/src/components/cliente360v3/dossie/FaixaBloqueio.jsx
//
// O que BLOQUEIA número relevante não pode viver no rodapé da página (§21).
// Grant caído, base ausente, competência sem fechamento: tudo isso muda o que
// os números acima significam, então aparece ANTES deles, numa faixa fina com
// a ação ao lado.
//
// Regra igualmente importante: quando está tudo certo, esta faixa NÃO
// RENDERIZA. Não existe banner verde de "tudo ok" — silêncio é a confirmação.

export default function FaixaBloqueio({ estado, bloqueios = [], clienteSlug }) {
  const itens = [];

  if (estado && estado.chave !== "ok") {
    itens.push({
      chave: `estado-${estado.chave}`,
      grave: !!estado.bloqueante,
      titulo: estado.chave === "sem_fechamento" ? "Competência sem fechamento" : "Números podem mudar",
      descricao: estado.mensagem,
    });
  }

  for (const b of bloqueios) {
    itens.push({
      chave: b.chave,
      grave: true,
      titulo: b.titulo,
      descricao: b.descricao,
      acao: b.acaoLabel && b.acaoDestino
        ? { label: b.acaoLabel, href: `${b.acaoDestino}?cliente=${encodeURIComponent(clienteSlug || "")}` }
        : null,
    });
  }

  if (itens.length === 0) return null;

  return (
    <div className="c360d-bloqueios">
      {itens.map((item) => (
        <div key={item.chave} className={`c360d-bloqueio${item.grave ? " is-grave" : ""}`} role={item.grave ? "alert" : undefined}>
          <span className="c360d-bloqueio__marca" aria-hidden="true">{item.grave ? "■" : "◆"}</span>
          <span className="c360d-bloqueio__texto">
            <strong>{item.titulo}</strong>
            {item.descricao && <> — {item.descricao}</>}
          </span>
          {item.acao && (
            <a className="vf-btn vf-btn--secondary vf-btn--sm" href={item.acao.href}>{item.acao.label}</a>
          )}
        </div>
      ))}
    </div>
  );
}
