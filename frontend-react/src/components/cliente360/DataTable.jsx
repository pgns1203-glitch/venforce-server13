// Tabela única da Cliente 360.
//
// Todas as seções da tela usavam `<table>` próprio, com markup e larguras
// diferentes — as colunas "pulavam" de uma seção para a outra. Este componente
// centraliza a base visual; a variação fica nas COLUNAS passadas por prop.
//
// HTML semântico de verdade (`table/thead/tbody/tr/th/td`), não divs fingindo
// ser tabela: leitor de tela anuncia linha/coluna e o cabeçalho continua
// associado às células.
//
// Estabilidade de coluna vem de `table-layout: fixed` (no CSS) + `<colgroup>`
// com a largura declarada por coluna. Sem isso, a mesma coluna "Produto" tem
// largura diferente em cada seção. A tabela em si é o VFTable da Fundação;
// aqui fica só o formato de coluna desta tela e as classes c360-*.
//
// Formato de coluna:
//   {
//     key,                      // identificador único
//     header,                   // texto do cabeçalho
//     width,                    // largura do <col> (ex.: "34%", "120px"); opcional
//     align,                    // "left" (padrão) | "right"
//     variant,                  // "produto" → célula com título + MLB + tags
//     isRowHeader,              // true → vira <th scope="row">
//     render(linha, indice),    // conteúdo da célula
//     cellClassName(linha),     // classe extra por célula (ex.: cor do valor)
//     headerTitle,              // title= do cabeçalho, para abreviações
//   }

import { VFTable } from "../ui/VFTable/index.js";

// Classes da Cliente 360 sobre o VFTable (Fundação V2): mesma marcação e
// comportamento, visual desta tela.
const CLASSES_C360 = {
  wrap: "vf-table-wrap c360-tabela",
  scroll: "c360-tabela--scroll",
  num: "c360-td--num",
  empty: "c360-td--vazio",
};

export default function DataTable({
  columns,
  rows,
  getRowKey,
  rowClassName,
  caption,
  scroll = false,
  compact = true,
  emptyLabel = "Nada para exibir.",
}) {
  return (
    <VFTable
      columns={columns.map((coluna) => ({
        key: coluna.key,
        header: coluna.header,
        width: coluna.width,
        align: coluna.align,
        headerTitle: coluna.headerTitle,
        rowHeader: coluna.isRowHeader,
        render: coluna.render,
        cellClassName: (linha) =>
          [coluna.variant === "produto" ? "c360-td--produto" : "", coluna.cellClassName ? coluna.cellClassName(linha) : ""]
            .filter(Boolean)
            .join(" "),
      }))}
      rows={rows}
      getRowKey={getRowKey}
      rowClassName={rowClassName}
      caption={caption}
      scroll={scroll}
      compact={compact}
      emptyLabel={emptyLabel}
      classNames={CLASSES_C360}
    />
  );
}

// Célula de produto padronizada: título truncado em uma linha + MLB + tags.
// Usada por todas as seções que listam produto, para o alinhamento não variar.
export function CelulaProduto({ titulo, mlb, tags = [] }) {
  return (
    <span className="c360-produto">
      <span className="c360-produto__titulo" title={titulo}>{titulo}</span>
      <span className="c360-produto__meta">
        {mlb && <span className="c360-produto__mlb">{mlb}</span>}
        {tags.filter(Boolean).map((tag) => (
          <span key={tag.label} className={`vf-tag ${tag.tom || "is-neutral"}`}>{tag.label}</span>
        ))}
      </span>
    </span>
  );
}
