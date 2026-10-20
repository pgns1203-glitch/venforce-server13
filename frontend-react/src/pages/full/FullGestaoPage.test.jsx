// Testes de render da Central do Full — modelo C (React Testing Library + Vitest).
//
// Cobrem o que não pode regredir: cliente/conta vêm do Shell (sem seletor
// próprio) · loading · erro sem dado anterior · erro/stale mantendo o último
// dado bom · leitura parcial avisada · zero exibido como "0" vs ausência "—" ·
// KPIs e painel de atenção filtram a lista sem nova chamada · custo sem Base
// aparece como ausente · aba Reposição (cobertura, edição, lista de
// conferência) · drawer do inventário (Escape, troca rápida cancela a busca).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FullGestaoPage from "./FullGestaoPage.jsx";

const mocks = vi.hoisted(() => ({
  obterSnapshotFull: vi.fn(),
  obterInventoryDetail: vi.fn(),
  obterInventoryMovements: vi.fn(),
}));

const contexto = vi.hoisted(() => ({ atual: null }));

vi.mock("../../services/fullApi.js", () => mocks);

vi.mock("../../hooks/useVfContext.js", () => ({
  useOperacaoAtual: () => contexto.atual,
}));

vi.mock("../../services/apiClient.js", async () => {
  const real = await vi.importActual("../../services/apiClient.js");
  return { ...real, getToken: () => "token-de-teste", irParaLogin: vi.fn() };
});

function operacao(overrides = {}) {
  return {
    pronta: true,
    clienteId: 1,
    clienteSlug: "cliente-a",
    clienteNome: "Cliente A",
    clienteContaId: 123,
    marketplace: "meli",
    snapshot: {
      meta: { nome: "Loja Principal", marketplace: "meli", externalAccountLabel: "LOJA_A", status: { label: "Conectado", tone: "success" } },
    },
    ...overrides,
  };
}

function inv(overrides = {}) {
  return {
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
    price: 50,
    thumbnail: null,
    listingStatus: "active",
    unitCost: 12,
    stockCost: 120,
    forecast30dUnits: 10,
    forecast30dRevenue: 500,
    ...overrides,
  };
}

const SEM_DADO = {
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
  price: null,
  thumbnail: null,
  listingStatus: "active",
  unitCost: null,
  stockCost: null,
  forecast30dUnits: null,
  forecast30dRevenue: null,
};

function snapshotBase(overrides = {}) {
  return {
    ok: true,
    account: { clienteContaId: 123, clienteId: 1, sellerIdMasked: "***4657", marketplace: "meli" },
    period: { from: "2026-08-04", to: "2026-08-17" },
    cache: { hit: false, stale: false, generatedAt: "2026-08-18T10:00:00.000Z", expiresAt: null, retryAt: null },
    quality: { status: "complete", sources: { costs: { status: "ok", reason: null, base: { slug: "base-a", nome: "Base A" } } } },
    inventories: [inv(), SEM_DADO],
    unresolvedReferences: [],
    ...overrides,
  };
}

function linhaDe(texto) {
  return screen.getByText(texto).closest('[role="row"]');
}

beforeEach(() => {
  contexto.atual = operacao();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Central do Full · contexto do Shell", () => {
  it("sem Cliente+Operação prontos no Shell, não renderiza nada nem chama a API", () => {
    contexto.atual = operacao({ pronta: false, clienteContaId: null });
    const { container } = render(<FullGestaoPage />);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.obterSnapshotFull).not.toHaveBeenCalled();
  });

  it("conta que não é do Mercado Livre explica e não chama a API", () => {
    contexto.atual = operacao({ marketplace: "shopee" });
    render(<FullGestaoPage />);
    expect(screen.getByText(/central do full é do mercado livre/i)).toBeInTheDocument();
    expect(mocks.obterSnapshotFull).not.toHaveBeenCalled();
  });

  it("lê o snapshot da conta do contexto e mostra o cliente no cartão", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());
    render(<FullGestaoPage />);
    expect(await screen.findByRole("heading", { name: "Cliente A" })).toBeInTheDocument();
    expect(mocks.obterSnapshotFull).toHaveBeenCalledWith(123, expect.anything());
    expect(screen.getByText(/Conta ML: LOJA_A/)).toBeInTheDocument();
    expect(screen.getByText(/Base de custo:\s*Base A/)).toBeInTheDocument();
  });
});

describe("Central do Full · estados", () => {
  it("mostra loading enquanto o snapshot não chega", async () => {
    mocks.obterSnapshotFull.mockReturnValue(new Promise(() => {}));
    render(<FullGestaoPage />);
    expect(await screen.findByText(/lendo o estoque full/i)).toBeInTheDocument();
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

  it("zero real aparece como '0', ausência aparece como '—' (nunca confundidos)", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(
      snapshotBase({ inventories: [inv({ stock: { available: 0, notAvailable: 0, total: 0, status: "ok" }, operationalStatus: "RUPTURA", coverageDays: 0 }), SEM_DADO] })
    );
    render(<FullGestaoPage />);
    await screen.findByText("Produto 1");

    expect(within(linhaDe("Produto 1")).getAllByText("0").length).toBeGreaterThan(0);
    expect(within(linhaDe("Produto 2")).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("leitura parcial (quality.status=partial) mostra aviso explícito", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase({ quality: { status: "partial", sources: {} } }));
    render(<FullGestaoPage />);
    expect(await screen.findByText(/leitura parcial/i)).toBeInTheDocument();
  });

  it("cache stale avisa sem apagar a lista", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(
      snapshotBase({ cache: { hit: true, stale: true, generatedAt: "2026-08-18T10:00:00.000Z", expiresAt: null, retryAt: null } })
    );
    render(<FullGestaoPage />);
    expect(await screen.findByText(/dados desatualizados/i)).toBeInTheDocument();
    expect(screen.getByText("Produto 1")).toBeInTheDocument();
  });
});

describe("Central do Full · KPIs, painel e lista", () => {
  const TRES = () =>
    snapshotBase({
      inventories: [
        inv(),
        inv({
          inventoryId: "INV-3",
          references: [{ mlb: "MLB3", sellerSku: "SKU-3", title: "Produto 3" }],
          stock: { available: 0, notAvailable: 0, total: 0, status: "ok" },
          operationalStatus: "RUPTURA",
          coverageDays: 0,
          dailyTurnover: 2,
          stockCost: 0,
        }),
        SEM_DADO,
      ],
    });

  it("KPIs somam custo e previsão conhecidos e contam por status", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(TRES());
    render(<FullGestaoPage />);
    await screen.findByText("Produto 1");

    const kpis = screen.getByRole("group", { name: /resumo do full/i });
    expect(within(kpis).getByRole("button", { name: /^Sem estoque\s*1/ })).toBeInTheDocument();
    expect(within(kpis).getByRole("button", { name: /^Custo no Full\s*R\$ 120/ })).toBeInTheDocument();
    expect(within(kpis).getByText("R$ 1.000")).toBeInTheDocument(); // previsão 500 + 500
  });

  it("clicar num KPI filtra a lista localmente, sem nova chamada à API", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(TRES());
    render(<FullGestaoPage />);
    await screen.findByText("Produto 1");

    await userEvent.click(screen.getByRole("button", { name: /^Sem estoque\s*1/ }));
    expect(screen.queryByText("Produto 1")).not.toBeInTheDocument();
    expect(screen.getByText("Produto 3")).toBeInTheDocument();
    expect(screen.getByText(/Filtros: Sem estoque/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(screen.getByText("Produto 1")).toBeInTheDocument();
    expect(mocks.obterSnapshotFull).toHaveBeenCalledTimes(1);
  });

  it("o painel de atenção aplica o mesmo filtro e mostra o giro perdido", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(TRES());
    render(<FullGestaoPage />);
    await screen.findByText("Produto 1");

    const item = screen.getByRole("button", { name: /1 sem estoque/i });
    expect(item).toHaveTextContent("Vendiam 2,0 un/dia somados");
    await userEvent.click(item);
    expect(screen.queryByText("Produto 1")).not.toBeInTheDocument();
    expect(screen.getByText("Produto 3")).toBeInTheDocument();
  });

  it("ordena por padrão pelo maior disponível no Full", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(
      snapshotBase({
        inventories: [
          inv({ inventoryId: "INV-A", references: [{ mlb: "MLBA", title: "Pouco" }], stock: { available: 2, total: 2, status: "ok" } }),
          inv({ inventoryId: "INV-B", references: [{ mlb: "MLBB", title: "Muito" }], stock: { available: 50, total: 50, status: "ok" } }),
          inv({ inventoryId: "INV-C", references: [{ mlb: "MLBC", title: "Médio" }], stock: { available: 9, total: 9, status: "ok" } }),
        ],
      })
    );
    render(<FullGestaoPage />);
    await screen.findByText("Muito");

    expect(screen.getByLabelText("Ordenar por")).toHaveValue("disponivel");
    const titulos = screen.getAllByText(/^(Pouco|Muito|Médio)$/).map((el) => el.textContent);
    expect(titulos).toEqual(["Muito", "Médio", "Pouco"]);
  });

  it("busca local não dispara nova chamada à API", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());
    render(<FullGestaoPage />);
    await screen.findByText("Produto 1");

    await userEvent.type(screen.getByLabelText(/buscar produtos/i), "Produto 2");
    expect(screen.queryByText("Produto 1")).not.toBeInTheDocument();
    expect(screen.getByText("Produto 2")).toBeInTheDocument();
    expect(mocks.obterSnapshotFull).toHaveBeenCalledTimes(1);
  });

  it("conta sem Base de custo: custo aparece como ausente, nunca R$ 0", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(
      snapshotBase({
        quality: { status: "complete", sources: { costs: { status: "unavailable", reason: "SEM_BASE", base: null } } },
        inventories: [inv({ unitCost: null, stockCost: null })],
      })
    );
    render(<FullGestaoPage />);
    await screen.findByText("Produto 1");

    const custo = screen.getByRole("button", { name: /^Custo no Full/ });
    expect(custo).toHaveTextContent("sem Base de custo");
    expect(custo).toBeDisabled();
    expect(screen.getByRole("link", { name: "não vinculada" })).toHaveAttribute("href", "bases.html");
  });
});

describe("Central do Full · Reposição sugerida", () => {
  async function abrirReposicao() {
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());
    render(<FullGestaoPage />);
    await screen.findByText("Produto 1");
    await userEvent.click(screen.getByRole("button", { name: "Planejar novo envio" }));
    await screen.findByRole("table", { name: "Reposição sugerida" });
  }

  it("sugere pela cobertura escolhida e recalcula ao trocar 30 → 15 dias", async () => {
    await abrirReposicao();
    const entrada = screen.getByRole("spinbutton", { name: /quantidade a enviar de produto 1/i });
    expect(entrada).toHaveValue(20); // 1/dia × 30 − 10 disponíveis
    expect(screen.queryByText("Produto 2")).not.toBeInTheDocument(); // sem giro conhecido não entra

    await userEvent.click(screen.getByRole("button", { name: "15 dias" }));
    expect(screen.getByRole("spinbutton", { name: /quantidade a enviar de produto 1/i })).toHaveValue(5);
  });

  it("editar a quantidade marca 'editado' e atualiza o resumo do envio", async () => {
    await abrirReposicao();
    const entrada = screen.getByRole("spinbutton", { name: /quantidade a enviar de produto 1/i });
    await userEvent.clear(entrada);
    await userEvent.type(entrada, "30");

    expect(within(linhaDe("Produto 1")).getByText("editado")).toBeInTheDocument();
    const resumo = screen.getByRole("complementary", { name: "Resumo do envio" });
    expect(within(resumo).getByText("Unidades").nextSibling).toHaveTextContent("30");
    expect(within(resumo).getByText("Custo da mercadoria").nextSibling).toHaveTextContent("R$ 360,00");
  });

  it("desmarcar tira do envio; a lista de conferência sai só com os marcados", async () => {
    await abrirReposicao();
    const baixar = screen.getByRole("button", { name: "Baixar lista de conferência" });
    expect(baixar).toBeEnabled();

    await userEvent.click(screen.getByRole("checkbox", { name: /incluir produto 1/i }));
    expect(baixar).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /incluir produto 1/i }));

    const blobs = [];
    const criar = vi.fn((blob) => {
      blobs.push(blob);
      return "blob:lista";
    });
    vi.stubGlobal("URL", { createObjectURL: criar, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await userEvent.click(baixar);

    expect(criar).toHaveBeenCalledTimes(1);
    const csv = await new Promise((resolve) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(leitor.result);
      leitor.readAsText(blobs[0]);
    });
    expect(csv).toContain("Produto;MLB;Variação;SKU;Inventory ID;Quantidade;Conferido");
    expect(csv).toContain("Produto 1;MLB1;;SKU-1;INV-1;20;");
    vi.unstubAllGlobals();
  });
});

describe("Central do Full · drawer do inventário", () => {
  it("abre o detalhe, busca detalhe/movimentos e fecha com Escape", async () => {
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

    await userEvent.click(screen.getByRole("button", { name: /ver detalhe de produto 1/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(mocks.obterInventoryDetail).toHaveBeenCalledWith(123, "INV-1", expect.anything()));
    expect(mocks.obterInventoryMovements).toHaveBeenCalledWith(123, "INV-1", expect.anything());

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("troca rápida de inventário cancela a busca anterior (nunca mostra o detalhe errado)", async () => {
    mocks.obterSnapshotFull.mockResolvedValue(snapshotBase());

    let resolverPrimeiro;
    mocks.obterInventoryDetail.mockImplementationOnce(() => new Promise((resolve) => { resolverPrimeiro = resolve; }));
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

    await userEvent.click(screen.getByRole("button", { name: /ver detalhe de produto 1/i }));
    // O drawer é modal: a lista atrás não recebe clique, então a troca real é
    // fechar e abrir outro — com o INV-1 ainda pendente.
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: /ver detalhe de produto 2/i }));

    await screen.findByText("INV-2");
    resolverPrimeiro?.({ inventoryId: "INV-1", references: [], stock: {}, operationalStatus: "REPOR", sales: { status: "ok" } });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("INV-2")).toBeInTheDocument();
    expect(screen.queryByText("INV-1")).not.toBeInTheDocument();
  });
});
