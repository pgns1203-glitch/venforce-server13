// Produtos abaixo da margem-alvo: margem POSITIVA, mas menor que o alvo.
// O recuperável é o gap até o alvo — via preço ou custo, nunca via mídia.

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
  { key: "faturamento", header: "Faturamento", width: "15%", align: "right",
    render: (item) => formatarMoeda(item.faturamento) },
  { key: "margem", header: "Margem", width: "11%", align: "right",
    render: (item) => formatarPercentual(item.margem) },
  { key: "gap", header: "Gap p/ alvo", width: "12%", align: "right",
    render: (item) => `${formatarNumero(item.gapMargemPp, 1)} p.p.` },
  { key: "recuperavel", header: "Recuperável", width: "13%", align: "right",
    render: (item) => formatarMoeda(item.recuperavelAteAlvo) },
];

export default function ProdutosAbaixoMeta({ itens = [], margemAlvo }) {
  const alvoPercent = Math.round((margemAlvo ?? 0.15) * 100);

  return (
    <section className="vf-section c360-secao">
      <div className="vf-section__header">
        <div className="vf-section__heading">
          <h2 className="vf-section__title">Produtos abaixo da margem-alvo ({alvoPercent}%)</h2>
          <p className="vf-section__description">
            Margem positiva, porém abaixo do alvo. O recuperável é o gap até o alvo, mantido o faturamento.
          </p>
        </div>
        {itens.length > 0 && (
          <div className="vf-section__actions">
            <span className="vf-tag is-warning">{itens.length} item(ns)</span>
          </div>
        )}
      </div>

      {itens.length === 0 ? (
        <EmptyState
          compacto
          titulo="Nenhum produto abaixo da margem-alvo"
          descricao="Todos os itens com margem positiva já atingem o alvo configurado."
        />
      ) : (
        <DataTable
          caption="Produtos com margem positiva abaixo do alvo"
          columns={COLUNAS}
          rows={itens}
          getRowKey={(item) => item.mlb}
        />
      )}
    </section>
  );
}
