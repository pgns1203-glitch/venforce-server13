// frontend-react/src/components/cliente360v3/dossie/MargemPainel.jsx
//
// Margem como RESUMO, não como segundo painel de produtos (§19): a análise
// item a item já vive na Central de Produtos e no drawer do produto. Aqui só
// a contagem por status do Motor de Margem e a porta de entrada para o modo
// "Margem" da tabela.
//
// A consulta continua LAZY. O Motor de Margem é uma chamada cara e
// account-sensível (só é aplicável quando o cliente tem uma conta MELI ativa);
// carregá-lo junto do Dossiê custaria uma requisição em toda abertura de tela
// para um bloco que nem sempre é olhado. O botão diz o que vai acontecer.

import { formatarNumero, plural } from "../../../utils/numbers.js";
import { formatarPercentual } from "../../../utils/percentage.js";
import { STATUS_MARGEM } from "../../../utils/dossie.js";
import { Indisponivel, Esqueleto, Fonte } from "./Primitivos.jsx";

const ORDEM = ["LOSS", "LOW_MARGIN", "SUSPECT_DATA", "HEALTHY", "RECONCILING", "UNVALIDATED"];

export default function MargemPainel({ margem, resumo, margemOperacional, onConsultar, onVerNaTabela }) {
  if (margem?.carregando && !margem?.dados) return <Esqueleto linhas={3} />;

  if (margem?.erro && !margem?.dados) {
    return <Indisponivel compacto titulo="Não foi possível consultar o Motor de Margem" motivo={margem.erro.mensagem || String(margem.erro)} />;
  }

  if (!margem?.dados) {
    return (
      <Indisponivel
        compacto
        titulo="Margem por item não consultada"
        motivo="O Motor de Margem só é chamado sob demanda — ele cruza catálogo e custo desta conta, e não roda junto do Dossiê."
        acao={
          <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={onConsultar}>
            Consultar margem por item
          </button>
        }
      />
    );
  }

  if (!margem.dados.aplicavel) {
    return <Indisponivel compacto titulo="Margem indisponível para esta conta" motivo={margem.dados.motivo} />;
  }

  return (
    <div className="c360d-margem">
      <div className="c360d-margem__ancora">
        <span className="c360d-margem__rotulo">Margem operacional do período</span>
        <span className="c360d-margem__valor">{formatarPercentual(margemOperacional)}</span>
        {/* Nunca publicar uma "MC média por item" ao lado desta: a média
            aritmética das margens de item NÃO é a margem da operação, e as
            duas lado a lado ensinariam o número errado. */}
        <span className="c360d-margem__nota">
          <Fonte>fechamento — não é a média das margens de item</Fonte>
        </span>
      </div>

      <ul className="c360d-margem__status">
        {ORDEM.filter((s) => resumo?.contagem?.[s]).map((s) => (
          <li key={s}>
            <span className={`vf-status is-${STATUS_MARGEM[s].tom}`}>{STATUS_MARGEM[s].label}</span>
            <span className="c360d-margem__contagem">{formatarNumero(resumo.contagem[s])}</span>
          </li>
        ))}
        {resumo?.semIdentidade > 0 && (
          <li>
            <span className="vf-status is-empty" title="Item que o Motor de Margem não encontrou no catálogo desta conta">
              Sem custo no catálogo
            </span>
            <span className="c360d-margem__contagem">{formatarNumero(resumo.semIdentidade)}</span>
          </li>
        )}
      </ul>

      <div className="c360d-margem__rodape">
        <span className="c360d-fonte">Motor de Margem · {plural(resumo?.total, "item consultado", "itens consultados")}</span>
        <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={onVerNaTabela}>
          Ver item a item
        </button>
      </div>
    </div>
  );
}
