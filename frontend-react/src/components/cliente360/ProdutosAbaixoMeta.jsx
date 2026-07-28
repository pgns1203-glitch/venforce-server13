// Produtos abaixo da margem-alvo: margem POSITIVA, mas menor que o alvo.
// O recuperável é o gap até o alvo — via preço ou custo, nunca via mídia.

import { formatarMoeda } from "../../utils/currency.js";
import { formatarNumero } from "../../utils/numbers.js";
import { formatarPercentual } from "../../utils/percentage.js";
import EmptyState from "./EmptyState.jsx";

export default function ProdutosAbaixoMeta({ itens = [], margemAlvo }) {
  const alvoPercent = Math.round((margemAlvo ?? 0.15) * 100);

  return (
    <section className="vf-section">
      <div className="vf-section__header">
        <div>
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
        <div className="vf-table-wrap">
          <table className="vf-table vf-table--compact">
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col" className="c360-num">Unidades</th>
                <th scope="col" className="c360-num">Faturamento</th>
                <th scope="col" className="c360-num">Margem</th>
                <th scope="col" className="c360-num">Gap p/ alvo</th>
                <th scope="col" className="c360-num">Recuperável</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.mlb}>
                  <th scope="row" className="c360-produto">
                    <span className="c360-produto__titulo">{item.titulo || item.mlb}</span>
                    <span className="c360-produto__mlb">{item.mlb}</span>
                    {item.curvaA && <span className="vf-tag is-primary">Curva A</span>}
                  </th>
                  <td className="c360-num">{formatarNumero(item.unidades)}</td>
                  <td className="c360-num">{formatarMoeda(item.faturamento)}</td>
                  <td className="c360-num">{formatarPercentual(item.margem)}</td>
                  <td className="c360-num">{formatarNumero(item.gapMargemPp, 1)} p.p.</td>
                  <td className="c360-num">{formatarMoeda(item.recuperavelAteAlvo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
