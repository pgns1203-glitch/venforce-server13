// @ts-check
// VFTable — tabela da Fundação Global V2 dirigida por colunas.
//
// Junta o que a DataTable (Cliente 360) e a TabelaDensa (Dossiê) faziam cada
// uma do seu jeito: HTML semântico de verdade (table/thead/tbody, th com
// scope), larguras travadas por <colgroup>, coluna numérica alinhada,
// cabeçalho que ordena (aria-sort + botão), linha clicável, linha marcada e
// estado vazio dentro da própria tabela.
//
// Visual padrão: `.vf-table` e companhia (Portal/css/vf-components-v2.css).
// Uma ilha com visual próprio troca só as classes por `classNames` (o Dossiê
// é denso e tem cabeçalho sticky) — o comportamento continua um só.
//
// Linha clicável: o onClick fica na <tr> (atalho de mouse). Teclado e leitor
// de tela usam um botão/link real dentro de uma célula — a tabela não vira
// widget.

import { cx } from "../../../utils/cx.js";

const ARIA_SORT = { asc: "ascending", desc: "descending" };

/** Classes padrão da V2. */
const PADRAO = {
  wrap: "vf-table-wrap",
  scroll: "vf-table-scroll",
  table: "vf-table",
  compact: "vf-table--compact",
  num: "num",
  sortButton: "vf-table__sort",
  // A V2 desenha a seta no ::after do botão (e gira ao inverter); só ilhas
  // com seta própria em texto passam uma classe aqui.
  sortArrow: null,
  sortedHeader: "",
  clickableRow: "is-clickable",
  selectedRow: "row--selected",
  empty: "vf-table__empty",
};

/**
 * @typedef {object} VFTableColumn
 * @property {string} key
 * @property {import("react").ReactNode} header
 * @property {string} [width]          Largura do <col> ("34%", "120px").
 * @property {"left" | "right"} [align] "right" = coluna numérica.
 * @property {(row: any, index: number) => import("react").ReactNode} [render] Padrão: row[key].
 * @property {(row: any) => string | null | undefined} [cellClassName]
 * @property {boolean} [rowHeader]     Vira <th scope="row">.
 * @property {string} [headerTitle]    title= do cabeçalho (abreviações).
 * @property {string} [headerClassName]
 * @property {string} [sortKey]        Coluna ordenável por esta chave.
 */

/**
 * @param {object} props
 * @param {VFTableColumn[]} props.columns
 * @param {any[]} props.rows
 * @param {(row: any, index: number) => string | number} [props.getRowKey]
 * @param {import("react").ReactNode} [props.caption]  Nome da tabela (fica visível só para leitor de tela).
 * @param {(row: any) => string | null | undefined} [props.rowClassName]
 * @param {(row: any) => void} [props.onRowClick]
 * @param {string | number | null} [props.selectedKey]
 * @param {{ key: string, dir: "asc" | "desc" } | null} [props.sort]
 * @param {(key: string) => void} [props.onSort]
 * @param {import("react").ReactNode} [props.emptyLabel="Nada para exibir."]
 * @param {boolean} [props.compact=true]
 * @param {boolean} [props.scroll=false]
 * @param {Partial<typeof PADRAO>} [props.classNames]  Troca as classes (ilhas com visual próprio).
 * @param {string} [props.className]                   Extra no contêiner.
 */
export function VFTable({
  columns,
  rows,
  getRowKey,
  caption,
  rowClassName,
  onRowClick,
  selectedKey = null,
  sort = null,
  onSort,
  emptyLabel = "Nada para exibir.",
  compact = true,
  scroll = false,
  classNames,
  className,
}) {
  const c = { ...PADRAO, ...classNames };
  const temLinhas = Array.isArray(rows) && rows.length > 0;

  return (
    <div className={cx(c.wrap, scroll && c.scroll, className)}>
      <table className={cx(c.table, compact && c.compact)}>
        {caption && <caption className="vf-visually-hidden">{caption}</caption>}

        {/* Com table-layout fixed, é o <col> que trava a largura entre tabelas. */}
        <colgroup>
          {columns.map((col) => (
            <col key={col.key} style={col.width ? { width: col.width } : undefined} />
          ))}
        </colgroup>

        <thead>
          <tr>
            {columns.map((col) => {
              // `!!col.sortKey` primeiro: sem ele, coluna sem ordenação casa
              // com `sort` nulo (undefined === undefined) e se diz ativa.
              const ativa = !!col.sortKey && sort?.key === col.sortKey;
              const ordenavel = !!col.sortKey && !!onSort;
              return (
                <th
                  key={col.key}
                  scope="col"
                  title={col.headerTitle}
                  aria-sort={ativa && sort ? ARIA_SORT[sort.dir] : ordenavel ? "none" : undefined}
                  className={cx(col.align === "right" && c.num, ativa && c.sortedHeader, col.headerClassName) || undefined}
                >
                  {ordenavel ? (
                    <button
                      type="button"
                      className={cx(c.sortButton, ativa && sort && `is-${sort.dir}`)}
                      onClick={() => onSort(/** @type {string} */ (col.sortKey))}
                    >
                      {col.header}
                      {c.sortArrow && (
                        <span className={c.sortArrow} aria-hidden="true">
                          {ativa && sort ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
                        </span>
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {!temLinhas && (
            <tr>
              <td className={c.empty} colSpan={columns.length}>
                {emptyLabel}
              </td>
            </tr>
          )}

          {temLinhas &&
            rows.map((row, i) => {
              const chave = getRowKey ? getRowKey(row, i) : i;
              return (
                <tr
                  key={chave}
                  className={
                    cx(
                      onRowClick && c.clickableRow,
                      selectedKey != null && selectedKey === chave && c.selectedRow,
                      rowClassName && rowClassName(row),
                    ) || undefined
                  }
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => {
                    const conteudo = col.render ? col.render(row, i) : row[col.key];
                    const classe = cx(col.align === "right" && c.num, col.cellClassName && col.cellClassName(row)) || undefined;
                    return col.rowHeader ? (
                      <th key={col.key} scope="row" className={classe}>
                        {conteudo}
                      </th>
                    ) : (
                      <td key={col.key} className={classe}>
                        {conteudo}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
