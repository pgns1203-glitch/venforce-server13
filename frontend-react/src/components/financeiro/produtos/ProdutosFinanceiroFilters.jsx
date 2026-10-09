// Filtros + busca da tabela de produtos. Filtro sem linha nenhuma continua
// visível (com 0) — exceto "Cancelados/devolvidos", que só existe quando o
// motor devolve status de pedido.
import { FILTROS_PRODUTO } from "../../../utils/financeiro/produtos.js";

export function ProdutosFinanceiroFilters({ filtro, onFiltro, busca, onBusca, contagem }) {
  const filtros = FILTROS_PRODUTO.filter((f) => !f.soQuandoHouver || contagem[f.id] > 0);
  return (
    <div className="vf-toolbar vf-fin-produtos__toolbar">
      <div className="vf-segmented vf-fin-produtos__filtros" role="group" aria-label="Filtrar produtos">
        {filtros.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`vf-segmented__item${filtro === f.id ? " is-active" : ""}`}
            aria-pressed={filtro === f.id}
            onClick={() => onFiltro(f.id)}
          >
            {f.label} <span className="vf-fin-produtos__contagem">{contagem[f.id] ?? 0}</span>
          </button>
        ))}
      </div>
      <input
        type="search"
        className="vf-input vf-input--sm vf-fin-produtos__busca"
        placeholder="Buscar por título, ID, SKU ou Model ID"
        aria-label="Buscar produto"
        value={busca}
        onChange={(e) => onBusca(e.target.value)}
      />
    </div>
  );
}
