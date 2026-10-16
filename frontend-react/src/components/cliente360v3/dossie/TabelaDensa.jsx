// frontend-react/src/components/cliente360v3/dossie/TabelaDensa.jsx
//
// Tabela do Dossiê: densa, com cabeçalho sticky, ordenação por coluna
// numérica e linha inteira clicável quando existe aprofundamento.
//
// Por que não reusar DataTable.jsx (V2): aquele componente resolve o problema
// dele muito bem — travar largura de coluna entre seções diferentes — mas não
// tem ordenação, seleção, linha clicável nem cabeçalho sticky, e a área de
// Produtos do Dossiê é uma ferramenta de busca, não uma lista de leitura.
// Acrescentar tudo isso lá mudaria o componente que a Cliente 360 V2 usa em
// produção. Aqui a V2 não é tocada.
//
// Desde a Etapa 3 da UI, a marcação e o comportamento (ordenação com
// aria-sort, linha clicável, linha marcada, vazio) são do VFTable; aqui fica
// o vocabulário do Dossiê e as classes c360d-tabela*.
//
// Acessibilidade da linha clicável: o `onClick` fica na `<tr>` (mouse), mas
// quem carrega o NOME acessível e o foco de teclado é um `<button>` real
// dentro da primeira célula — leitor de tela anuncia "Produto X, botão", não
// uma linha inteira virada em widget.

import { ehAusente } from "../../../utils/numbers.js";
import { VFTable } from "../../ui/VFTable/index.js";

// Visual denso do Dossiê sobre o comportamento do VFTable (Fundação V2).
const CLASSES_DOSSIE = {
  wrap: "c360d-tabela",
  scroll: "c360d-tabela--rolavel",
  table: "c360d-tabela__grade",
  compact: "",
  num: "is-num",
  sortButton: "c360d-tabela__ordenar",
  sortArrow: "c360d-tabela__seta",
  sortedHeader: "is-ordenada",
  clickableRow: "is-clicavel",
  selectedRow: "is-selecionada",
  empty: "c360d-tabela__vazio",
};

export default function TabelaDensa({
  colunas,
  linhas,
  chave,
  legenda,
  onSelecionar,
  selecionada,
  ordenacao,
  onOrdenar,
  classeLinha,
  vazio = "Nada para exibir.",
  rolavel = false,
}) {
  return (
    <VFTable
      columns={colunas.map((coluna) => ({
        key: coluna.key,
        header: coluna.header,
        width: coluna.width,
        align: coluna.align,
        headerTitle: coluna.titulo,
        rowHeader: coluna.cabecalhoDeLinha,
        render: coluna.render,
        cellClassName: coluna.cellClassName,
        sortKey: coluna.ordenarPor,
      }))}
      rows={linhas}
      getRowKey={chave}
      caption={legenda}
      onRowClick={onSelecionar}
      selectedKey={selecionada}
      sort={ordenacao ? { key: ordenacao.campo, dir: ordenacao.dir } : null}
      onSort={onOrdenar}
      rowClassName={classeLinha}
      emptyLabel={vazio}
      scroll={rolavel}
      compact={false}
      classNames={CLASSES_DOSSIE}
    />
  );
}

// Célula de produto: título (uma linha, trunca), faixa ABC e MLB em mono.
// É o único lugar da tabela onde o clique vira foco de teclado.
export function CelulaProdutoDensa({ linha, onAbrir, marcadores = [] }) {
  const conteudo = (
    <>
      <span className="c360d-prod__titulo" title={linha.titulo || linha.mlb}>
        {linha.titulo || linha.mlb}
      </span>
      <span className="c360d-prod__meta">
        <span className="c360d-prod__mlb">{linha.mlb}</span>
        {marcadores.map((m) => (
          <span key={m.label} className={`c360d-marca is-${m.tom}`} title={m.titulo}>{m.label}</span>
        ))}
      </span>
    </>
  );

  if (!onAbrir) return <span className="c360d-prod">{conteudo}</span>;
  return (
    <button type="button" className="c360d-prod c360d-prod--botao" onClick={(e) => { e.stopPropagation(); onAbrir(linha); }}>
      {conteudo}
    </button>
  );
}

// Faixa ABC como letra, não como pill colorida: são três valores possíveis e o
// olho aprende a letra mais rápido que a cor. `null` = produto sem faturamento
// no período — o backend não classifica, e a UI não inventa "C".
export function FaixaAbc({ valor }) {
  if (ehAusente(valor) || !valor) {
    return <span className="c360d-abc is-vazia" title="Sem faturamento no período — não classificado">–</span>;
  }
  return <span className={`c360d-abc is-${valor.toLowerCase()}`} title={`Curva ${valor}`}>{valor}</span>;
}
