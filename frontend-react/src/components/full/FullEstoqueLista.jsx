// Lista da aba "Estoque no Full": uma grade única (cabeçalho e linhas com as
// mesmas colunas), no padrão de .am-listagem de Anúncios ML. Abaixo de ~1040px
// a LISTA rola na horizontal dentro do card, nunca corta coluna.
//
// Clicar na linha abre o detalhe do inventário (atalho de mouse); o botão da
// última coluna é o caminho de teclado e leitor de tela.
import { useState } from "react";
import { formatarNumero, ehAusente, AUSENTE } from "../../utils/numbers.js";
import { formatarMoeda } from "../../utils/currency.js";
import { diasInteiros } from "../../utils/fullSummary.js";
import { FullACaminho, FullProdutoInfo, FullStatus, FullThumb } from "./FullProduto.jsx";

const PAGINA = 50;
const META_DIAS = 30;

const COR_BARRA = {
  RUPTURA: "is-danger",
  CRITICO: "is-danger",
  REPOR: "is-warning",
  SAUDAVEL: "is-success",
  ALTO: "is-warning",
  EXCESSO: "is-warning",
};

// `variationPct` já vem em pontos percentuais (80 = 80%).
export function Tendencia({ trend }) {
  if (!trend || ehAusente(trend.variationPct)) return null;
  const pct = trend.variationPct;
  const classe = pct > 0 ? "is-up" : pct < 0 ? "is-down" : "";
  const seta = pct > 0 ? "▲" : pct < 0 ? "▼" : "=";
  return (
    <span className={`full-tendencia ${classe}`}>
      {seta} {formatarNumero(Math.abs(pct), 0)}%
    </span>
  );
}

export function Cobertura({ inv }) {
  if (inv.operationalStatus === "SEM_GIRO") return <span className="full-cobertura__dias">sem giro</span>;
  if (ehAusente(inv.coverageDays)) return <span className="full-cobertura__dias">{AUSENTE}</span>;
  const largura = Math.min(100, (inv.coverageDays / META_DIAS) * 100);
  return (
    <span className="full-cobertura">
      <span className="full-cobertura__trilho" aria-hidden="true">
        <span className={`full-cobertura__barra ${COR_BARRA[inv.operationalStatus] || ""}`} style={{ width: `${largura}%` }} />
      </span>
      <span className={`full-cobertura__dias ${COR_BARRA[inv.operationalStatus] === "is-danger" ? "is-danger" : ""}`}>
        {formatarNumero(diasInteiros(inv.coverageDays))} dias
      </span>
    </span>
  );
}

export default function FullEstoqueLista({ inventories, onDetalhar }) {
  const [limite, setLimite] = useState(PAGINA);

  if (!inventories.length) {
    return <p className="full-vazio">Nenhum produto encontrado com os filtros atuais.</p>;
  }

  const visiveis = inventories.slice(0, limite);

  return (
    <>
      <div className="full-lista full-lista--estoque" role="table" aria-label="Estoque no Full">
        <div className="full-lista__cabeca" role="row">
          <span role="columnheader" className="full-lista__col-produto">Produto</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Disponível</span>
          <span role="columnheader">Vendas 14d</span>
          <span role="columnheader">Cobertura</span>
          <span role="columnheader">Custo estoque</span>
          <span role="columnheader">Enviar</span>
          <span role="columnheader"><span className="vf-visually-hidden">Ações</span></span>
        </div>
        {visiveis.map((inv) => (
          <div key={inv.inventoryId} className="full-linha" role="row" onClick={() => onDetalhar(inv.inventoryId)}>
            <span role="cell"><FullThumb inv={inv} /></span>
            <span role="cell" className="full-linha__produto"><FullProdutoInfo inv={inv} /></span>
            <span role="cell"><FullStatus inv={inv} /></span>
            <span role="cell" className="full-num full-disponivel">
              {formatarNumero(inv.stock?.available)}
              <FullACaminho inv={inv} />
            </span>
            <span role="cell" className="full-num">
              {formatarNumero(inv.sales?.total14d)} <Tendencia trend={inv.trend} />
            </span>
            <span role="cell"><Cobertura inv={inv} /></span>
            <span role="cell" className="full-num">{formatarMoeda(inv.stockCost)}</span>
            <span role="cell" className="full-num full-num--destaque">
              {inv.sendQuantity > 0 ? formatarNumero(inv.sendQuantity) : AUSENTE}
            </span>
            <span role="cell">
              <button
                type="button"
                className="full-linha__abrir"
                aria-label={`Ver detalhe de ${inv.references?.[0]?.title || inv.inventoryId}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDetalhar(inv.inventoryId);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="full-lista__rodape">
        <span>
          Mostrando {formatarNumero(visiveis.length)} de {formatarNumero(inventories.length)}
        </span>
        {inventories.length > limite ? (
          <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setLimite((n) => n + PAGINA)}>
            Mostrar mais {formatarNumero(Math.min(PAGINA, inventories.length - limite))}
          </button>
        ) : null}
      </div>
    </>
  );
}
