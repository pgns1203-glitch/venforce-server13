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
import EmptyState from "./EmptyState.jsx";

export default function ProdutosNegativos({ itens = [] }) {
  return (
    <section className="vf-section">
      <div className="vf-section__header">
        <div>
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
        <div className="vf-table-wrap">
          <table className="vf-table vf-table--compact">
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col" className="c360-num">Unidades</th>
                <th scope="col" className="c360-num">Preço médio</th>
                <th scope="col" className="c360-num">Margem/un.</th>
                <th scope="col" className="c360-num">Margem</th>
                <th scope="col" className="c360-num">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.mlb} className="c360-linha-vermelho">
                  <th scope="row" className="c360-produto">
                    <span className="c360-produto__titulo">{item.titulo || item.mlb}</span>
                    <span className="c360-produto__mlb">{item.mlb}</span>
                    {item.curvaA && <span className="vf-tag is-primary">Curva A</span>}
                  </th>
                  <td className="c360-num">{formatarNumero(item.unidades)}</td>
                  <td className="c360-num">{formatarMoeda(item.precoMedio)}</td>
                  <td className="c360-num c360-dir--negativo">{formatarMoeda(item.margemUnitaria)}</td>
                  <td className="c360-num c360-dir--negativo">{formatarPercentual(item.margem)}</td>
                  <td className="c360-num c360-dir--negativo">{formatarMoeda(item.resultado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
