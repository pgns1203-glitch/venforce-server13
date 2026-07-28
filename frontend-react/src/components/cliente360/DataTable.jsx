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
// largura diferente em cada seção.
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

const ALINHAMENTO = { right: "c360-td--num", left: "" };

function classes(...valores) {
  return valores.filter(Boolean).join(" ");
}

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
  const temLinhas = Array.isArray(rows) && rows.length > 0;

  return (
    <div className={classes("vf-table-wrap", "c360-tabela", scroll && "c360-tabela--scroll")}>
      <table className={classes("vf-table", compact && "vf-table--compact")}>
        {caption && <caption className="vf-visually-hidden">{caption}</caption>}

        {/* Larguras declaradas: com table-layout fixed, é isto que trava a coluna. */}
        <colgroup>
          {columns.map((coluna) => (
            <col key={coluna.key} style={coluna.width ? { width: coluna.width } : undefined} />
          ))}
        </colgroup>

        <thead>
          <tr>
            {columns.map((coluna) => (
              <th
                key={coluna.key}
                scope="col"
                title={coluna.headerTitle}
                className={ALINHAMENTO[coluna.align] ?? ""}
              >
                {coluna.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {!temLinhas && (
            <tr>
              <td className="c360-td--vazio" colSpan={columns.length}>{emptyLabel}</td>
            </tr>
          )}

          {temLinhas && rows.map((linha, indice) => (
            <tr
              key={getRowKey ? getRowKey(linha, indice) : indice}
              className={rowClassName ? rowClassName(linha) : undefined}
            >
              {columns.map((coluna) => {
                const conteudo = coluna.render ? coluna.render(linha, indice) : linha[coluna.key];
                const className = classes(
                  ALINHAMENTO[coluna.align] ?? "",
                  coluna.variant === "produto" && "c360-td--produto",
                  coluna.cellClassName ? coluna.cellClassName(linha) : null
                );

                return coluna.isRowHeader ? (
                  <th key={coluna.key} scope="row" className={className}>{conteudo}</th>
                ) : (
                  <td key={coluna.key} className={className}>{conteudo}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
