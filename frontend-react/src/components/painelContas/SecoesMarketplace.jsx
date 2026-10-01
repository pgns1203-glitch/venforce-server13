// frontend-react/src/components/painelContas/SecoesMarketplace.jsx
//
// Seções do Painel por marketplace: Consolidado · Mercado Livre · Shopee ·
// TikTok Shop (+ qualquer marketplace novo que o servidor devolver). Abas
// sobre o padrão vf-tabs/vf-tab da Fundação V2 — nenhum componente novo no
// design system.
//
// A seção NÃO é um filtro de clientes sobre o número consolidado: o servidor
// recalcula cada cliente só com as contas daquele marketplace
// (GET /painel-contas?marketplace=). O consolidado continua sendo a primeira
// aba e o padrão.
//
// A lista de seções e a fonte de cada uma (API × manual) vêm do servidor
// (`secoesMarketplace`) — aqui só se desenha. Seção sem cliente continua
// visível com contagem 0: "não há operação TikTok" também é informação.

import { useRef } from "react";

const CONSOLIDADO = { codigo: null, rotulo: "Consolidado", descricao: "Todas as contas de cada cliente" };

export function SecoesMarketplace({ secoes = [], ativa = null, onSelecionar }) {
  const abas = [CONSOLIDADO, ...secoes];
  const refs = useRef([]);
  const indiceAtivo = Math.max(0, abas.findIndex((a) => a.codigo === ativa));
  const atual = abas[indiceAtivo];

  // Setas/Home/End movem o foco e já selecionam (padrão de abas
  // automáticas da WAI-ARIA): a lista é curta e cada troca é uma leitura.
  function aoTeclar(evento, i) {
    const ultimo = abas.length - 1;
    const destino = { ArrowRight: i === ultimo ? 0 : i + 1, ArrowLeft: i === 0 ? ultimo : i - 1, Home: 0, End: ultimo }[evento.key];
    if (destino === undefined) return;
    evento.preventDefault();
    refs.current[destino]?.focus();
    onSelecionar(abas[destino].codigo);
  }

  return (
    <div className="vf-ph-secoes">
      <nav className="vf-tabs vf-ph-secoes__abas" role="tablist" aria-label="Seção do painel por marketplace">
        {abas.map((aba, i) => {
          const selecionada = i === indiceAtivo;
          return (
            <button
              key={aba.codigo ?? "consolidado"}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="tab"
              className={`vf-tab${selecionada ? " is-active" : ""}`}
              aria-selected={selecionada}
              tabIndex={selecionada ? 0 : -1}
              onClick={() => onSelecionar(aba.codigo)}
              onKeyDown={(e) => aoTeclar(e, i)}
            >
              <span>{aba.rotulo}</span>
              {aba.codigo !== null && (
                <span className="vf-ph-secoes__n" aria-label={`${aba.clientes} ${aba.clientes === 1 ? "cliente" : "clientes"}`}>
                  {aba.clientes}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <p className="vf-ph-secoes__descricao" data-testid="secao-descricao">
        {atual.codigo === null
          ? "Consolidado: soma de todas as contas de cada cliente."
          : `${atual.rotulo}: ${atual.descricao.charAt(0).toLowerCase()}${atual.descricao.slice(1)}. Só as contas ${atual.rotulo} entram no número.`}
      </p>
    </div>
  );
}
