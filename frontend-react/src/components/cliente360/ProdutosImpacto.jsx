// Produtos que mais ajudaram / mais prejudicaram o resultado operacional.
//
// A contribuição de cada produto é 100% operacional (preço, custo, frete,
// comissão, imposto, volume). Nenhum produto recebe rótulo por causa de Ads —
// não existe atribuição de mídia por item.

import { formatarMoeda, formatarVariacaoMoeda } from "../../utils/currency.js";
import { formatarNumero } from "../../utils/numbers.js";
import DataTable, { CelulaProduto } from "./DataTable.jsx";
import EmptyState from "./EmptyState.jsx";

const MOTIVO_LABEL = {
  volume: "volume", preco: "preço", comissao: "comissão", frete: "frete",
  custo: "custo", imposto: "imposto",
  produto_novo: "produto novo", produto_saiu: "parou de vender",
};

// Larguras somam 100%: com table-layout fixed, isso trava a coluna "Produto"
// no mesmo lugar em todas as seções de produto da página.
const COLUNAS = [
  {
    key: "produto", header: "Produto", width: "38%", variant: "produto", isRowHeader: true,
    render: (item) => (
      <CelulaProduto
        titulo={item.titulo || item.mlb}
        mlb={item.mlb}
        tags={item.curvaA ? [{ label: "Curva A", tom: "is-primary" }] : []}
      />
    ),
  },
  {
    key: "motivo", header: "Motivo", width: "16%",
    render: (item) => MOTIVO_LABEL[item.motivoDominante] || item.motivoDominante,
  },
  {
    key: "unidades", header: "Unidades", width: "14%", align: "right",
    render: (item) => formatarNumero(item.unidadesAtual ?? item.unidades),
  },
  {
    key: "faturamento", header: "Faturamento", width: "16%", align: "right",
    render: (item) => formatarMoeda(item.faturamento),
  },
  {
    key: "contribuicao", header: "Impacto", width: "16%", align: "right",
    render: (item) => formatarVariacaoMoeda(item.contribuicao),
    cellClassName: (item) => (item.contribuicao >= 0 ? "c360-dir--positivo" : "c360-dir--negativo"),
  },
];

export default function ProdutosImpacto({ titulo, descricao, itens = [], vazioTitulo, vazioDescricao }) {
  return (
    <section className="vf-section c360-secao">
      <div className="vf-section__header">
        <div className="vf-section__heading">
          <h2 className="vf-section__title">{titulo}</h2>
          {descricao && <p className="vf-section__description">{descricao}</p>}
        </div>
        {itens.length > 0 && (
          <div className="vf-section__actions">
            <span className="vf-tag is-neutral">{itens.length} item(ns)</span>
          </div>
        )}
      </div>

      {itens.length === 0 ? (
        <EmptyState compacto titulo={vazioTitulo} descricao={vazioDescricao} />
      ) : (
        <DataTable
          caption={`${titulo} — contribuição por produto`}
          columns={COLUNAS}
          rows={itens}
          getRowKey={(item) => item.mlb}
        />
      )}
    </section>
  );
}
