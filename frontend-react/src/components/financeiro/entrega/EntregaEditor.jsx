// Editor da apresentação da entrega: destaques + prioridades. Em entrega que
// já teve link público, só leitura (o conteúdo é histórico).
import { EntregaDestaques } from "./EntregaDestaques.jsx";
import { EntregaPrioridades } from "./EntregaPrioridades.jsx";

export function EntregaEditor({ conteudo, onChange, somenteLeitura }) {
  return (
    <div className="vf-stack vf-fin-entrega__editor">
      <EntregaDestaques conteudo={conteudo} onChange={onChange} somenteLeitura={somenteLeitura} />
      <EntregaPrioridades conteudo={conteudo} onChange={onChange} somenteLeitura={somenteLeitura} />
    </div>
  );
}
