// Painel "Precisa de atenção" (aba Estoque no Full): os recortes que pedem
// ação, cada um um atalho para o MESMO filtro da faixa de KPIs.
import { formatarNumero, plural } from "../../utils/numbers.js";
import { formatarMoeda } from "../../utils/currency.js";

const ICONES = {
  ruptura: <path d="M12 8v5M12 16h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  critico: <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  parado: <path d="M3 7h18M6 7v12h12V7" />,
  semCusto: <path d="M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6" />,
};

function Item({ chave, tom, titulo, texto, ativo, onFiltrar }) {
  return (
    <li>
      <button
        type="button"
        className={`full-atencao__item${ativo ? " is-active" : ""}`}
        aria-pressed={ativo ? "true" : "false"}
        onClick={() => onFiltrar(chave)}
      >
        <span className={`full-atencao__icone is-${tom}`} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {ICONES[chave]}
          </svg>
        </span>
        <span>
          <span className="full-atencao__titulo">{titulo}</span>
          <span className="full-atencao__texto">{texto}</span>
        </span>
      </button>
    </li>
  );
}

export default function FullAtencaoPainel({ resumo, kpisAtivos, onFiltrar, onPlanejar, custosDisponiveis }) {
  const soEste = (chave) => kpisAtivos.length === 1 && kpisAtivos[0] === chave;
  const itens = [];

  if (resumo.ruptura > 0) {
    itens.push({
      chave: "ruptura",
      tom: "danger",
      titulo: `${formatarNumero(resumo.ruptura)} sem estoque`,
      texto:
        resumo.giroRuptura > 0
          ? `Vendiam ${formatarNumero(resumo.giroRuptura, 1)} un/dia somados`
          : "Sem unidades disponíveis no Full",
    });
  }
  if (resumo.critico > 0) {
    itens.push({
      chave: "critico",
      tom: "danger",
      titulo: plural(resumo.critico, "crítico", "críticos"),
      texto: "Menos de 7 dias de cobertura",
    });
  }
  if (resumo.parado > 0) {
    itens.push({
      chave: "parado",
      tom: "warning",
      titulo: `${formatarNumero(resumo.parado)} com excesso ou sem giro`,
      texto:
        resumo.custoParado !== null
          ? `${formatarMoeda(resumo.custoParado, { casas: 0 })} de custo parado`
          : "Mais de 60 dias de estoque ou sem venda",
    });
  }
  if (custosDisponiveis && resumo.semCusto > 0) {
    itens.push({
      chave: "semCusto",
      tom: "info",
      titulo: `${formatarNumero(resumo.semCusto)} sem custo na Base`,
      texto: "O custo do estoque fica incompleto",
    });
  }

  return (
    <aside className="vf-card full-lateral" aria-labelledby="full-atencao-titulo">
      <div className="full-lateral__cabeca">
        <p className="full-eyebrow" id="full-atencao-titulo">Precisa de atenção</p>
        <p className="full-lateral__sub">
          {itens.length > 0 ? "Clique para filtrar a lista" : "Nada pedindo ação agora."}
        </p>
      </div>
      {itens.length > 0 ? (
        <ul className="full-atencao">
          {itens.map((item) => (
            <Item key={item.chave} {...item} ativo={soEste(item.chave)} onFiltrar={onFiltrar} />
          ))}
        </ul>
      ) : null}
      <div className="full-lateral__pe">
        <button type="button" className="vf-btn vf-btn--primary full-largura" onClick={onPlanejar}>
          Planejar envio com as sugestões
        </button>
      </div>
    </aside>
  );
}
