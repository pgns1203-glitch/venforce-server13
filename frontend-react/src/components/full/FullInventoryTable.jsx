import { VFTable } from "../ui/VFTable/index.js";
import { formatarNumero, ehAusente, AUSENTE } from "../../utils/numbers.js";
import { STATUS_LABEL, STATUS_TONE } from "../../utils/fullOperationalStatus.js";

// `variationPct` do backend já é ponto percentual pronto (80 = 80%), ao
// contrário de utils/percentage.js (que espera fração 0-1 vinda do motor de
// margem). Formatador local para não confundir os dois contratos.
function formatarVariacaoPontos(pct) {
  if (ehAusente(pct)) return AUSENTE;
  const sinal = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sinal}${formatarNumero(Math.abs(pct), 1)}%`;
}

function referenciaPrincipal(inv) {
  const referencias = Array.isArray(inv.references) ? inv.references : [];
  const principal = referencias[0] || {};
  return {
    titulo: principal.title || inv.inventoryId,
    mlb: principal.mlb || AUSENTE,
    sku: principal.sellerSku || AUSENTE,
    extras: Math.max(0, referencias.length - 1),
  };
}

// Colunas da tabela de inventários Full (VFTable da Fundação V2).
function colunas(onDetalhar) {
  const numero = (key, header, valor) => ({ key, header, align: "right", render: valor });
  return [
    {
      key: "produto",
      header: "Produto / referências",
      render: (inv) => {
        const principal = referenciaPrincipal(inv);
        return (
          <div className="full-table-produto">
            <strong>{principal.titulo}</strong>
            <span className="full-table-refs">
              <span className="vf-mono">{principal.mlb}</span> · SKU{" "}
              <span className="vf-mono">{principal.sku}</span>
              {principal.extras > 0 ? ` · +${principal.extras} ref.` : ""}
            </span>
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (inv) => {
        const statusTom = STATUS_TONE[inv.operationalStatus] || "";
        return (
          <span className={`vf-status${statusTom ? ` ${statusTom}` : ""}`}>
            {STATUS_LABEL[inv.operationalStatus] || inv.operationalStatus || AUSENTE}
          </span>
        );
      },
    },
    numero("disponivel", "Estoque disp.", (inv) => formatarNumero(inv.stock?.available)),
    numero("indisponivel", "Indisp.", (inv) => formatarNumero(inv.stock?.notAvailable)),
    numero("anterior7d", "7d anterior", (inv) => formatarNumero(inv.sales?.previous7d)),
    numero("atual7d", "7d atual", (inv) => formatarNumero(inv.sales?.current7d)),
    numero("variacao", "Δ / variação", (inv) =>
      inv.trend ? (
        <>
          {formatarNumero(inv.trend.deltaUnits)} ({formatarVariacaoPontos(inv.trend.variationPct)})
        </>
      ) : (
        AUSENTE
      ),
    ),
    numero("giro", "Giro/dia", (inv) => formatarNumero(inv.dailyTurnover, 2)),
    numero("cobertura", "Cobertura (dias)", (inv) => formatarNumero(inv.coverageDays, 1)),
    numero("enviar", "Enviar", (inv) => formatarNumero(inv.sendQuantity)),
    {
      key: "acoes",
      header: <span className="vf-visually-hidden">Ações</span>,
      render: (inv) => (
        <button
          type="button"
          className="vf-btn vf-btn--ghost vf-btn--sm"
          onClick={(e) => {
            e.stopPropagation();
            onDetalhar(inv.inventoryId);
          }}
        >
          Detalhar
        </button>
      ),
    },
  ];
}

// Clicar na linha também abre o detalhe (atalho de mouse); o botão
// "Detalhar" continua sendo o caminho de teclado e leitor de tela.
export default function FullInventoryTable({ inventories, onDetalhar }) {
  if (!inventories.length) {
    return <p className="full-table-vazio">Nenhum inventário encontrado com os filtros atuais.</p>;
  }

  return (
    <VFTable
      columns={colunas(onDetalhar)}
      rows={inventories}
      getRowKey={(inv) => inv.inventoryId}
      onRowClick={(inv) => onDetalhar(inv.inventoryId)}
      compact={false}
      caption="Inventários Full"
    />
  );
}
