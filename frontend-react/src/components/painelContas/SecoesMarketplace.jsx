// frontend-react/src/components/painelContas/SecoesMarketplace.jsx
//
// Seções do Painel por marketplace: Consolidado · Mercado Livre · Shopee ·
// TikTok Shop (+ qualquer marketplace novo que o servidor devolver). Abas
// do VFTabs (Fundação V2 + Radix Tabs: setas/Home/End selecionam, traço
// desliza até a aba escolhida).
//
// A seção NÃO é um filtro de clientes sobre o número consolidado: o servidor
// recalcula cada cliente só com as contas daquele marketplace
// (GET /painel-contas?marketplace=). O consolidado continua sendo a primeira
// aba e o padrão.
//
// A lista de seções e a fonte de cada uma (API × manual) vêm do servidor
// (`secoesMarketplace`) — aqui só se desenha. Seção sem cliente continua
// visível com contagem 0: "não há operação TikTok" também é informação.

import { VFTabs } from "../ui/VFTabs/index.js";

const CONSOLIDADO = { codigo: null, rotulo: "Consolidado", descricao: "Todas as contas de cada cliente" };

export function SecoesMarketplace({ secoes = [], ativa = null, onSelecionar }) {
  const abas = [CONSOLIDADO, ...secoes];
  const indiceAtivo = Math.max(0, abas.findIndex((a) => a.codigo === ativa));
  const atual = abas[indiceAtivo];

  return (
    <div className="vf-ph-secoes">
      <VFTabs
        className="vf-ph-secoes__abas"
        ariaLabel="Seção do painel por marketplace"
        value={atual.codigo}
        onValueChange={onSelecionar}
        tabs={abas.map((aba) => ({
          value: aba.codigo,
          label: (
            <>
              <span>{aba.rotulo}</span>
              {aba.codigo !== null && (
                <span className="vf-ph-secoes__n" aria-label={`${aba.clientes} ${aba.clientes === 1 ? "cliente" : "clientes"}`}>
                  {aba.clientes}
                </span>
              )}
            </>
          ),
        }))}
      />
      <p className="vf-ph-secoes__descricao" data-testid="secao-descricao">
        {atual.codigo === null
          ? "Consolidado: soma de todas as contas de cada cliente."
          : `${atual.rotulo}: ${atual.descricao.charAt(0).toLowerCase()}${atual.descricao.slice(1)}. Só as contas ${atual.rotulo} entram no número.`}
      </p>
    </div>
  );
}
