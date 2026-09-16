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
// Acessibilidade da linha clicável: o `onClick` fica na `<tr>` (mouse), mas
// quem carrega o NOME acessível e o foco de teclado é um `<button>` real
// dentro da primeira célula — leitor de tela anuncia "Produto X, botão", não
// uma linha inteira virada em widget.

import { ehAusente } from "../../../utils/numbers.js";

const ARIA_SORT = { asc: "ascending", desc: "descending" };

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
  const temLinhas = Array.isArray(linhas) && linhas.length > 0;

  return (
    <div className={`c360d-tabela${rolavel ? " c360d-tabela--rolavel" : ""}`}>
      <table className="c360d-tabela__grade">
        {legenda && <caption className="vf-visually-hidden">{legenda}</caption>}
        <colgroup>
          {colunas.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>

        <thead>
          <tr>
            {colunas.map((coluna) => {
              // `!!coluna.ordenarPor` primeiro: sem ele, uma coluna sem
              // ordenação (`ordenarPor` undefined) casa com `ordenacao` nulo
              // (undefined === undefined) e todas as colunas se dizem ativas.
              const ativa = !!coluna.ordenarPor && ordenacao?.campo === coluna.ordenarPor;
              const podeOrdenar = !!coluna.ordenarPor && !!onOrdenar;
              return (
                <th
                  key={coluna.key}
                  scope="col"
                  title={coluna.titulo}
                  aria-sort={ativa ? ARIA_SORT[ordenacao.dir] : podeOrdenar ? "none" : undefined}
                  className={[
                    coluna.align === "right" ? "is-num" : "",
                    ativa ? "is-ordenada" : "",
                  ].filter(Boolean).join(" ")}
                >
                  {podeOrdenar ? (
                    <button
                      type="button"
                      className="c360d-tabela__ordenar"
                      onClick={() => onOrdenar(coluna.ordenarPor)}
                    >
                      {coluna.header}
                      <span className="c360d-tabela__seta" aria-hidden="true">
                        {ativa ? (ordenacao.dir === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  ) : (
                    coluna.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {!temLinhas && (
            <tr>
              <td className="c360d-tabela__vazio" colSpan={colunas.length}>{vazio}</td>
            </tr>
          )}

          {temLinhas && linhas.map((linha, i) => {
            const id = chave ? chave(linha, i) : i;
            const marcada = selecionada != null && selecionada === id;
            return (
              <tr
                key={id}
                className={[
                  onSelecionar ? "is-clicavel" : "",
                  marcada ? "is-selecionada" : "",
                  classeLinha ? classeLinha(linha) : "",
                ].filter(Boolean).join(" ")}
                onClick={onSelecionar ? () => onSelecionar(linha) : undefined}
              >
                {colunas.map((coluna) => {
                  const conteudo = coluna.render ? coluna.render(linha, i) : linha[coluna.key];
                  const classe = [
                    coluna.align === "right" ? "is-num" : "",
                    coluna.cellClassName ? coluna.cellClassName(linha) : "",
                  ].filter(Boolean).join(" ");

                  return coluna.cabecalhoDeLinha ? (
                    <th key={coluna.key} scope="row" className={classe}>{conteudo}</th>
                  ) : (
                    <td key={coluna.key} className={classe}>{conteudo}</td>
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
