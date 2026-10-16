// frontend-react/src/components/financeiro/EntregaAcoes.jsx
//
// F4.2 — as ações de uma entrega de fechamento, num só lugar, para que a
// aba "Relatórios gerados" e a aba "Fechamento" não divirjam sobre o que
// significa publicar.
//
// Publicar e despublicar mudam o que um TERCEIRO enxerga: publicar cria um
// link público sem senha e sem validade (`expires_at` nunca é preenchido
// por este fluxo), despublicar o revoga. Por isso as duas passam por uma
// confirmação em dois tempos que NOMEIA a competência — a maior armadilha
// deste fluxo é publicar o mês errado, e um botão que não diz qual mês vai
// publicar é um convite a isso.
//
// A confirmação é inline, nunca `window.confirm`: um diálogo modal do
// navegador congela a página inteira e não dá para dizer nele de qual
// competência se trata.

import { useEffect, useState } from "react";
import { VFButton, useFeedbackOk } from "../ui/VFButton/index.js";
import { rotularCompetencia } from "../../utils/dates.js";

export function linkPublico(token) {
  return `${window.location.origin}/relatorio-publico.html?token=${encodeURIComponent(token)}`;
}

export function EntregaAcoes({ entrega, ocupada, bloqueada, erro, onPublicar, onDespublicar }) {
  const [confirmando, setConfirmando] = useState(null); // "publicar" | "despublicar" | null
  const [copiado, confirmarCopia] = useFeedbackOk(1600);

  // Trocou a entrega debaixo do componente (recarga autoritativa, troca de
  // período): nenhuma confirmação pendente sobrevive a isso.
  useEffect(() => {
    setConfirmando(null);
  }, [entrega?.id, entrega?.publicado]);

  if (!entrega) return null;

  const competencia = rotularCompetencia(entrega.periodo);
  const publicado = !!entrega.publicado;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(linkPublico(entrega.token_publico));
      confirmarCopia();
    } catch {
      /* clipboard indisponível (contexto não seguro) — sem quebrar a tela */
    }
  }

  if (confirmando) {
    const publicar = confirmando === "publicar";
    return (
      <div className="vf-cluster vf-fin-confirm" role="group" aria-label={`Confirmar ${confirmando}`}>
        <span className="vf-field__hint">
          {publicar
            ? `Publicar ${competencia}? Gera um link público sem senha.`
            : `Despublicar ${competencia}? O link atual deixa de abrir.`}
        </span>
        <VFButton
          variant={publicar ? "primary" : "danger"}
          size="sm"
          disabled={ocupada}
          onClick={() => {
            setConfirmando(null);
            (publicar ? onPublicar : onDespublicar)(entrega.id);
          }}
        >
          {ocupada ? "Enviando…" : publicar ? "Publicar" : "Despublicar"}
        </VFButton>
        <VFButton variant="ghost" size="sm" onClick={() => setConfirmando(null)}>
          Cancelar
        </VFButton>
      </div>
    );
  }

  return (
    <div className="vf-cluster vf-table__actions">
      {publicado && entrega.token_publico && (
        <>
          <VFButton variant="ghost" size="sm" href={linkPublico(entrega.token_publico)} target="_blank" rel="noreferrer">
            Abrir
          </VFButton>
          <VFButton variant="ghost" size="sm" feedback={copiado} feedbackLabel="Link copiado" onClick={copiar}>
            Copiar link
          </VFButton>
        </>
      )}
      <VFButton
        variant={publicado ? "ghost" : "primary"}
        size="sm"
        disabled={ocupada || bloqueada}
        aria-busy={ocupada ? "true" : undefined}
        title={bloqueada ? "Outra ação está em andamento." : undefined}
        onClick={() => setConfirmando(publicado ? "despublicar" : "publicar")}
      >
        {ocupada ? "Enviando…" : publicado ? "Despublicar" : "Publicar"}
      </VFButton>
      {erro && (
        <span className="vf-status is-danger" role="alert">
          {erro}
        </span>
      )}
    </div>
  );
}
