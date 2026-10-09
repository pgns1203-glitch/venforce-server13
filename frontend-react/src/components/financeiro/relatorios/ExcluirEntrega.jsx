// Excluir uma entrega — por ID EXATO (DELETE /entregas-cliente/:id). A
// confirmação nomeia competência e conta; se a entrega está publicada, diz
// que o link público deixa de funcionar. Inline, nunca window.confirm.
import { useEffect, useState } from "react";

export function ExcluirEntrega({ descricao, publicado, ocupada, bloqueada, onExcluir }) {
  const [confirmando, setConfirmando] = useState(false);
  useEffect(() => setConfirmando(false), [descricao.id]);

  if (!confirmando) {
    return (
      <button
        type="button"
        className="vf-btn vf-btn--ghost vf-btn--sm vf-fin-excluir"
        disabled={ocupada || bloqueada}
        onClick={() => setConfirmando(true)}
      >
        Excluir
      </button>
    );
  }
  return (
    <div className="vf-cluster vf-fin-confirm" role="group" aria-label="Confirmar exclusão">
      <span className="vf-field__hint">
        Excluir permanentemente o fechamento de {descricao.competenciaLabel} — {descricao.operacao}?
        {publicado ? " O link público deixará de funcionar." : ""}
      </span>
      <button
        type="button"
        className="vf-btn vf-btn--danger vf-btn--sm"
        disabled={ocupada}
        onClick={() => {
          setConfirmando(false);
          onExcluir(descricao.id);
        }}
      >
        Excluir permanentemente
      </button>
      <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setConfirmando(false)}>
        Cancelar
      </button>
    </div>
  );
}
