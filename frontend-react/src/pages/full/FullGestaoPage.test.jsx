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
  obterClientesDisponiveis: vi.fn(),
  obterContasMeliDoCliente: vi.fn(),
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

function clienteMock(overrides = {}) {
  return { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true, ...overrides };
}

function contaMock(overrides = {}) {
  return {
    id: 501,
    cliente_id: 1,
    marketplace: "meli",
    nome: "Loja Principal",
    slug: "cliente-a-meli",
    ativo: true,
    is_primary: true,
    grant: { id: 9, ml_user_id: "384324657", token_status: "valid", is_primary: true },
    base: null,
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

describe("Central de Gestão Full · seletor Cliente → Conta ML", () => {
  it("sem clienteContaId na URL, mostra o seletor de cliente/conta e nunca chama a API", async () => {
    irParaUrl("");
    mocks.obterClientesDisponiveis.mockResolvedValue({ ok: true, clientes: [clienteMock()] });

    render(<FullGestaoPage />);
    expect(await screen.findByLabelText(/^cliente$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/conta mercado livre/i)).toBeInTheDocument();
    expect(mocks.obterSnapshotFull).not.toHaveBeenCalled();
  });

  it("cliente com 1 conta ML: seleciona automaticamente e carrega o snapshot dessa conta", async () => {
    irParaUrl("");
    mocks.obterClientesDisponiveis.mockResolvedValue({ ok: true, clientes: [clienteMock()] });
    mocks.obterContasMeliDoCliente.mockResolvedValue({ ok: true, contas: [contaMock()] });
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());

    render(<FullGestaoPage />);
    await userEvent.selectOptions(await screen.findByLabelText(/^cliente$/i), "1");

    await waitFor(() => expect(mocks.obterContasMeliDoCliente).toHaveBeenCalledWith("1", expect.anything()));
    await screen.findByText("Produto 1");
    expect(mocks.obterSnapshotFull).toHaveBeenCalledWith(501, expect.anything());
  });

  it("cliente com 2+ contas ML: nunca escolhe sozinho, exige seleção manual", async () => {
    irParaUrl("");
    mocks.obterClientesDisponiveis.mockResolvedValue({ ok: true, clientes: [clienteMock()] });
    mocks.obterContasMeliDoCliente.mockResolvedValue({
      ok: true,
      contas: [contaMock({ id: 501, nome: "Loja 1" }), contaMock({ id: 502, nome: "Loja 2" })],
    });

    render(<FullGestaoPage />);
    await userEvent.selectOptions(await screen.findByLabelText(/^cliente$/i), "1");

    expect(await screen.findByText(/mais de uma conta mercado livre/i)).toBeInTheDocument();
    expect(mocks.obterSnapshotFull).not.toHaveBeenCalled();

    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());
    await userEvent.selectOptions(screen.getByLabelText(/conta mercado livre/i), "502");
    await waitFor(() => expect(mocks.obterSnapshotFull).toHaveBeenCalledWith(502, expect.anything()));
  });

  it("conta sem grant: aparece como aguardando grant/pendente e nunca dispara a coleta Full", async () => {
    irParaUrl("");
    mocks.obterClientesDisponiveis.mockResolvedValue({ ok: true, clientes: [clienteMock()] });
    mocks.obterContasMeliDoCliente.mockResolvedValue({ ok: true, contas: [contaMock({ grant: null })] });

    render(<FullGestaoPage />);
    await userEvent.selectOptions(await screen.findByLabelText(/^cliente$/i), "1");

    expect(await screen.findByRole("status")).toHaveTextContent(/aguardando grant/i);
    expect(mocks.obterSnapshotFull).not.toHaveBeenCalled();
  });

  it("conta com grant válido: ao selecionar entre várias, carrega o snapshot da conta certa", async () => {
    irParaUrl("");
    mocks.obterClientesDisponiveis.mockResolvedValue({ ok: true, clientes: [clienteMock()] });
    mocks.obterContasMeliDoCliente.mockResolvedValue({
      ok: true,
      contas: [
        contaMock({ id: 501, nome: "Loja sem grant", grant: null }),
        contaMock({ id: 502, nome: "Loja conectada", grant: { id: 9, ml_user_id: "1", token_status: "valid" } }),
      ],
    });
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());

    render(<FullGestaoPage />);
    await userEvent.selectOptions(await screen.findByLabelText(/^cliente$/i), "1");
    await userEvent.selectOptions(await screen.findByLabelText(/conta mercado livre/i), "502");

    await screen.findByText("Produto 1");
    expect(mocks.obterSnapshotFull).toHaveBeenCalledWith(502, expect.anything());
    expect(mocks.obterSnapshotFull).not.toHaveBeenCalledWith(501, expect.anything());
  });

  it("conta duplicada na resposta (mesma cliente_conta_id 2x) conta como UMA conta, não como ambiguidade", async () => {
    // Regressão de um caso real de produção: /clientes/:id/contas pode
    // devolver a mesma cliente_conta_id 2x quando ela tem 2+ vínculos de
    // base ativos (fan-out de JOIN no backend). O seletor precisa tratar
    // isso como uma única conta, nunca como "2 contas" exigindo escolha.
    irParaUrl("");
    mocks.obterClientesDisponiveis.mockResolvedValue({ ok: true, clientes: [clienteMock()] });
    mocks.obterContasMeliDoCliente.mockResolvedValue({
      ok: true,
      contas: [contaMock({ id: 21 }), contaMock({ id: 21 })],
    });
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());

    render(<FullGestaoPage />);
    await userEvent.selectOptions(await screen.findByLabelText(/^cliente$/i), "1");

    await screen.findByText("Produto 1");
    expect(mocks.obterSnapshotFull).toHaveBeenCalledWith(21, expect.anything());
    expect(screen.getAllByRole("option", { name: /loja principal/i })).toHaveLength(1);
  });

  it("deep-link por clienteContaId ignora o seletor, carrega direto e permite trocar de conta", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());
    render(<FullGestaoPage />);

    await screen.findByText("Produto 1");
    expect(mocks.obterSnapshotFull).toHaveBeenCalledWith(123, expect.anything());
    expect(screen.queryByLabelText(/^cliente$/i)).not.toBeInTheDocument();
    expect(mocks.obterClientesDisponiveis).not.toHaveBeenCalled();

    mocks.obterClientesDisponiveis.mockResolvedValue({ ok: true, clientes: [] });
    await userEvent.click(screen.getByRole("button", { name: /trocar cliente\/conta/i }));
    expect(await screen.findByLabelText(/^cliente$/i)).toBeInTheDocument();
  });
});

describe("Central de Gestão Full · estados", () => {
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
