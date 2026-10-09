// frontend-react/src/components/financeiro/entrega/EntregaPainel.jsx
//
// A entrega DESTA conta na competência em tela — o passo depois de Salvar.
// Identidade (cliente, marketplace, conta, competência) é só leitura: vem do
// Shell e a entrega pertence a esse contexto.

import { formatarDataHora } from "../../../utils/dates.js";
import { EntregaAcoes } from "../EntregaAcoes.jsx";
import { MK_LABEL } from "../fechamento/FechamentoContextoBar.jsx";

export function EntregaPainel({ entrega, entregas, clienteNome, marketplace, contaNome, clienteContaId, periodoLabel }) {
  if (!entrega) {
    if (entregas?.carregando && !entregas?.entregas) {
      return <p className="vf-field__hint">Carregando a entrega desta competência…</p>;
    }
    if (entregas?.erro) {
      return <p className="vf-field__hint">Entrega indisponível: {entregas.erro.mensagem}</p>;
    }
    return null;
  }

  return (
    <section className="vf-section vf-section--inset vf-stack vf-stack--sm" aria-label="Entrega para o cliente">
      <div className="vf-cluster vf-cluster--between">
        <h3 className="vf-fin-novo__passo-titulo">Entrega para o cliente</h3>
        <span className={`vf-tag is-${entrega.publicado ? "success" : "neutral"}`}>
          {entrega.publicado ? "Publicado" : entrega.token_publico ? "Despublicado" : "Rascunho"}
        </span>
      </div>
      <dl className="vf-fin-contexto vf-fin-contexto--compacto">
        <div className="vf-fin-contexto__item"><dt>Cliente</dt><dd>{clienteNome || "—"}</dd></div>
        <div className="vf-fin-contexto__item"><dt>Marketplace</dt><dd>{MK_LABEL[marketplace] || marketplace || "—"}</dd></div>
        <div className="vf-fin-contexto__item"><dt>Conta</dt><dd>{contaNome || (clienteContaId ? `Operação #${clienteContaId}` : "—")}</dd></div>
        <div className="vf-fin-contexto__item"><dt>Competência</dt><dd>{periodoLabel}</dd></div>
      </dl>
      <p className="vf-field__hint">
        Salva em {formatarDataHora(entrega.created_at)}
        {entrega.publicado ? ` · publicada em ${formatarDataHora(entrega.published_at)}` : ""}
      </p>
      <EntregaAcoes
        entrega={entrega}
        ocupada={entregas.acaoEmCurso === entrega.id}
        bloqueada={entregas.acaoEmCurso != null && entregas.acaoEmCurso !== entrega.id}
        erro={entregas.erroDeAcao?.id === entrega.id ? entregas.erroDeAcao.mensagem : null}
        onPublicar={entregas.publicar}
        onDespublicar={entregas.despublicar}
      />
      <p className="vf-field__hint">
        Publicar gera um link público sem senha e sem validade. Despublicar revoga o link atual.
      </p>
    </section>
  );
}
