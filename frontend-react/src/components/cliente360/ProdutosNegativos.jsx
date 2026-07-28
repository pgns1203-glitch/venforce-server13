// Produtos no vermelho: margem de contribuição NEGATIVA.
//
// Não confundir com margem baixa. Aqui o preço de venda não cobre nem os custos
// que variam com a venda (comissão + frete + custo do produto + imposto) — cada
// unidade vendida aprofunda o prejuízo, então vender mais piora.
//
// A classificação é operacional: Ads não entra no cálculo da margem unitária.

import { formatarMoeda } from "../../utils/currency.js";
import { formatarNumero } from "../../utils/numbers.js";
import { formatarPercentual } from "../../utils/percentage.js";
import DataTable, { CelulaProduto } from "./DataTable.jsx";
import EmptyState from "./EmptyState.jsx";

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
  { key: "unidades", header: "Unidades", width: "11%", align: "right",
    render: (item) => formatarNumero(item.unidades) },
  { key: "preco", header: "Preço médio", width: "13%", align: "right",
    render: (item) => formatarMoeda(item.precoMedio) },
  { key: "margemUnitaria", header: "Margem/un.", width: "13%", align: "right",
    render: (item) => formatarMoeda(item.margemUnitaria),
    cellClassName: () => "c360-dir--negativo" },
  { key: "margem", header: "Margem", width: "11%", align: "right",
    render: (item) => formatarPercentual(item.margem),
    cellClassName: () => "c360-dir--negativo" },
  { key: "resultado", header: "Resultado", width: "14%", align: "right",
    render: (item) => formatarMoeda(item.resultado),
    cellClassName: () => "c360-dir--negativo" },
];

export default function ProdutosNegativos({ itens = [] }) {
  return (
    <section className="vf-section c360-secao">
      <div className="vf-section__header">
        <div className="vf-section__heading">
          <h2 className="vf-section__title">Produtos no vermelho</h2>
          <p className="vf-section__description">
            Margem de contribuição negativa: o preço não cobre comissão, frete, custo e imposto.
            Cada unidade vendida aprofunda o prejuízo.
          </p>
        </div>
        {itens.length > 0 && (
          <div className="vf-section__actions">
            <span className="vf-tag is-danger">{itens.length} item(ns)</span>
          </div>
        )}
      </div>

      {itens.length === 0 ? (
        <EmptyState
          compacto
          titulo="Nenhum produto no vermelho"
          descricao="Todos os itens do período cobrem os custos que variam com a venda."
        />
      ) : (
        <DataTable
          caption="Produtos com margem de contribuição negativa"
          columns={COLUNAS}
          rows={itens}
          getRowKey={(item) => item.mlb}
          rowClassName={() => "c360-linha-vermelho"}
        />
      )}
    </section>
  );
}
