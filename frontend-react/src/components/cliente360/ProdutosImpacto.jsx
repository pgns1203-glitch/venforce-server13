// Produtos que mais ajudaram / mais prejudicaram o resultado operacional.
//
// A contribuição de cada produto é 100% operacional (preço, custo, frete,
// comissão, imposto, volume). Nenhum produto recebe rótulo por causa de Ads —
// não existe atribuição de mídia por item.

import { formatarMoeda, formatarVariacaoMoeda } from "../../utils/currency.js";
import { formatarNumero } from "../../utils/numbers.js";
import EmptyState from "./EmptyState.jsx";

const MOTIVO_LABEL = {
  volume: "volume", preco: "preço", comissao: "comissão", frete: "frete",
  custo: "custo", imposto: "imposto",
  produto_novo: "produto novo", produto_saiu: "parou de vender",
};

export default function ProdutosImpacto({ titulo, descricao, itens = [], vazioTitulo, vazioDescricao }) {
  return (
    <section className="vf-section">
      <div className="vf-section__header">
        <div>
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
        <div className="vf-table-wrap">
          <table className="vf-table vf-table--compact">
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col">Motivo</th>
                <th scope="col" className="c360-num">Unidades</th>
                <th scope="col" className="c360-num">Faturamento</th>
                <th scope="col" className="c360-num">Impacto</th>
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
                  <td>{MOTIVO_LABEL[item.motivoDominante] || item.motivoDominante}</td>
                  <td className="c360-num">{formatarNumero(item.unidadesAtual ?? item.unidades)}</td>
                  <td className="c360-num">{formatarMoeda(item.faturamento)}</td>
                  <td className={`c360-num c360-dir--${item.contribuicao >= 0 ? "positivo" : "negativo"}`}>
                    {formatarVariacaoMoeda(item.contribuicao)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
