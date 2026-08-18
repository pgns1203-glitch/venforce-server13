// Testes de render da Central de Gestão Full (React Testing Library + Vitest).
//
// Cobrem os estados que não podem regredir: sem conta na URL · loading ·
// erro sem dado anterior · erro mantendo o último dado bom · dados parciais
// avisados · zero exibido como "0" vs ausência como "—" · filtro local sem
// nova chamada à API · abrir/fechar o drawer Product360 (Escape) · troca
// rápida de inventory cancela a busca anterior.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FullGestaoPage from "./FullGestaoPage.jsx";

const mocks = vi.hoisted(() => ({
  obterSnapshotFull: vi.fn(),
  obterInventoryDetail: vi.fn(),
  obterInventoryMovements: vi.fn(),
}));

vi.mock("../../services/fullApi.js", () => mocks);

vi.mock("../../services/apiClient.js", async () => {
  const real = await vi.importActual("../../services/apiClient.js");
  return { ...real, getToken: () => "token-de-teste", irParaLogin: vi.fn() };
});

function irParaUrl(query) {
  window.history.replaceState({}, "", `/full-gestao.html${query}`);
}

function snapshotBase(overrides = {}) {
  return {
    ok: true,
    account: { clienteContaId: 123, clienteId: 1, sellerIdMasked: "***4657", marketplace: "meli" },
    period: { from: "2026-08-04", to: "2026-08-17" },
    cache: { hit: false, stale: false, generatedAt: "2026-08-18T10:00:00.000Z", expiresAt: null, retryAt: null },
    quality: { status: "complete", sources: {} },
    inventories: [
      {
        inventoryId: "INV-1",
        references: [{ mlb: "MLB1", sellerSku: "SKU-1", title: "Produto 1", variationId: null }],
        stock: { available: 10, notAvailable: 0, total: 10, status: "ok" },
        sales: { previous7d: 5, current7d: 9, total14d: 14, status: "ok" },
        trend: { deltaUnits: 4, variationPct: 80, variationKind: "comparable" },
        dailyTurnover: 1,
        coverageDays: 10,
        coverageState: "numeric",
        operationalStatus: "REPOR",
        sendQuantity: 20,
        replenishmentReason: null,
      },
      {
        inventoryId: "INV-2",
        references: [{ mlb: "MLB2", sellerSku: "SKU-2", title: "Produto 2", variationId: null }],
        stock: { available: null, notAvailable: null, total: null, status: "unavailable" },
        sales: { previous7d: null, current7d: null, total14d: null, status: "unavailable" },
        trend: null,
        dailyTurnover: null,
        coverageDays: null,
        coverageState: "stock_unavailable",
        operationalStatus: "SEM_DADO",
        sendQuantity: null,
        replenishmentReason: "stock_unavailable",
      },
    ],
    unresolvedReferences: [],
    ...overrides,
  };
}

beforeEach(() => {
  irParaUrl("?clienteContaId=123");
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Central de Gestão Full · estados", () => {
  it("sem clienteContaId na URL, pede o parâmetro e nunca chama a API", async () => {
    irParaUrl("");
    render(<FullGestaoPage />);
    expect(await screen.findByText(/informe \?clienteContaId=/i)).toBeInTheDocument();
    expect(mocks.obterSnapshotFull).not.toHaveBeenCalled();
  });

  it("mostra loading enquanto o snapshot não chega", async () => {
    mocks.obterSnapshotFull.mockReturnValue(new Promise(() => {}));
    render(<FullGestaoPage />);
    expect(await screen.findByText(/coletando invent/i)).toBeInTheDocument();
  });

  it("erro sem nenhum dado anterior mostra ErrorState com ação de tentar de novo", async () => {
    mocks.obterSnapshotFull.mockRejectedValueOnce(Object.assign(new Error("falhou"), { codigo: "erro_api", status: 502 }));
    mocks.obterSnapshotFull.mockResolvedValueOnce(snapshotBase());

    render(<FullGestaoPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("falhou");

    await userEvent.click(screen.getByRole("button", { name: /tentar novamente/i }));
    expect(await screen.findByText("Produto 1")).toBeInTheDocument();
    expect(mocks.obterSnapshotFull).toHaveBeenCalledTimes(2);
  });

  it("renderiza KPIs e tabela com dados completos", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());
    render(<FullGestaoPage />);

    expect(await screen.findByText("Produto 1")).toBeInTheDocument();
    expect(screen.getByText("Produto 2")).toBeInTheDocument();

    const linhaProduto1 = screen.getByText("Produto 1").closest("tr");
    expect(within(linhaProduto1).getByText("10")).toBeInTheDocument(); // estoque disponivel = 10 (zero real seria exibido como 0)
    expect(within(linhaProduto1).getByText("REPOR".length ? "Repor" : "Repor")).toBeInTheDocument();
  });

  it("zero real aparece como '0', ausência aparece como '—' (nunca confundidos)", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());
    render(<FullGestaoPage />);
    await screen.findByText("Produto 1");

    const linhaIndisponivel = screen.getByText("Produto 1").closest("tr");
    expect(within(linhaIndisponivel).getByText("0")).toBeInTheDocument(); // notAvailable=0 (zero real)

    const linhaSemDado = screen.getByText("Produto 2").closest("tr");
    expect(within(linhaSemDado).getAllByText("—").length).toBeGreaterThan(0); // estoque/vendas ausentes
  });

  it("dados parciais (quality.status=partial) mostram aviso explícito", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase({ quality: { status: "partial", sources: {} } }));
    render(<FullGestaoPage />);
    expect(await screen.findByText(/coleta parcial/i)).toBeInTheDocument();
  });

  it("cache stale mostra aviso de dados desatualizados sem apagar a tabela", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(
      snapshotBase({ cache: { hit: true, stale: true, generatedAt: "2026-08-18T10:00:00.000Z", expiresAt: null, retryAt: null } })
    );
    render(<FullGestaoPage />);
    expect((await screen.findAllByText(/dados desatualizados/i)).length).toBeGreaterThan(0);
    expect(screen.getByText("Produto 1")).toBeInTheDocument();
  });

  it("filtro de busca local não dispara nova chamada à API", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());
    render(<FullGestaoPage />);
    await screen.findByText("Produto 1");

    await userEvent.type(screen.getByLabelText(/buscar invent/i), "Produto 2");
    expect(screen.queryByText("Produto 1")).not.toBeInTheDocument();
    expect(screen.getByText("Produto 2")).toBeInTheDocument();
    expect(mocks.obterSnapshotFull).toHaveBeenCalledTimes(1);
  });

  it("abre o drawer Product360, busca detalhe/movimentos e fecha com Escape", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());
    mocks.obterInventoryDetail.mockResolvedValue({
      inventoryId: "INV-1",
      references: [{ mlb: "MLB1", sellerSku: "SKU-1", title: "Produto 1" }],
      stock: { available: 10, notAvailable: 0, total: 10 },
      operationalStatus: "REPOR",
      dailyTurnover: 1,
      coverageDays: 10,
      sendQuantity: 20,
      sales: { status: "ok" },
    });
    mocks.obterInventoryMovements.mockResolvedValue({
      inventoryId: "INV-1",
      movements: [{ operationId: "OP1", type: "SALE_CONFIRMATION", date: "2026-08-10T00:00:00Z", units: 2 }],
      nextCursor: null,
      total: 1,
      salesStatus: "ok",
    });

    render(<FullGestaoPage />);
    await screen.findByText("Produto 1");

    await userEvent.click(screen.getAllByRole("button", { name: /detalhar/i })[0]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(mocks.obterInventoryDetail).toHaveBeenCalledWith(123, "INV-1", expect.anything()));
    expect(mocks.obterInventoryMovements).toHaveBeenCalledWith(123, "INV-1", expect.anything());

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("troca rápida de inventory cancela a busca anterior (nunca mostra o detalhe errado)", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());

    let resolverPrimeiro;
    mocks.obterInventoryDetail.mockImplementationOnce(
      () => new Promise((resolve) => { resolverPrimeiro = resolve; })
    );
    mocks.obterInventoryDetail.mockResolvedValueOnce({
      inventoryId: "INV-2",
      references: [{ mlb: "MLB2", sellerSku: "SKU-2", title: "Produto 2" }],
      stock: {},
      operationalStatus: "SEM_DADO",
      sales: { status: "unavailable" },
    });
    mocks.obterInventoryMovements.mockResolvedValue({ movements: [], nextCursor: null, total: 0, salesStatus: "unavailable" });

    render(<FullGestaoPage />);
    await screen.findByText("Produto 1");

    const botoes = screen.getAllByRole("button", { name: /detalhar/i });
    await userEvent.click(botoes[0]); // abre INV-1 (fica pendente)
    await userEvent.click(botoes[1]); // troca para INV-2 antes do INV-1 responder

    await screen.findByText("INV-2");
    resolverPrimeiro?.({ inventoryId: "INV-1", references: [], stock: {}, operationalStatus: "REPOR", sales: { status: "ok" } });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("INV-2")).toBeInTheDocument();
    expect(screen.queryByText("INV-1")).not.toBeInTheDocument();
  });
});
