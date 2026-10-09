import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistoricoTab } from "./HistoricoTab.jsx";

function estado(overrides = {}) {
  return { entregas: [], carregando: false, erro: null, recarregar: vi.fn(), ...overrides };
}
const mes = (m) => document.querySelector(`li[data-competencia="${m}"]`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00-03:00"));
});
afterEach(() => vi.useRealTimers());

describe("HistoricoTab", () => {
  it("sequência de 12 competências, inclusive meses sem fechamento", () => {
    render(<HistoricoTab relatorios={null} entregas={estado({ entregas: [{ id: 1, periodo: "2026-08", cliente_conta_id: 1, publicado: true, token_publico: "t" }] })} periodo="2026-10" clienteContaId={1} />);
    const itens = screen.getAllByRole("listitem");
    expect(itens).toHaveLength(12);
    expect(itens[0]).toHaveAttribute("data-competencia", "2026-10");
    expect(mes("2026-08")).toHaveTextContent("Publicado");
    expect(mes("2026-09")).toHaveTextContent("Sem fechamento");
    expect(mes("2026-10")).toHaveTextContent("em tela");
  });

  it("status é DESTA conta: outra conta não conta; legado é sinalizado", () => {
    const entregas = [
      { id: 2, periodo: "2026-09", cliente_conta_id: 2, publicado: true },
      { id: 3, periodo: "Setembro 2026", cliente_conta_id: null, publicado: false },
    ];
    render(<HistoricoTab relatorios={null} entregas={estado({ entregas })} periodo="2026-10" clienteContaId={1} />);
    expect(mes("2026-09")).toHaveTextContent("Sem fechamento");
    expect(mes("2026-09")).toHaveTextContent("existe fechamento legado (sem conta)");
  });

  it("duplicatas da conta no mesmo mês são declaradas", () => {
    const entregas = [
      { id: 4, periodo: "2026-07", cliente_conta_id: 1, publicado: false },
      { id: 5, periodo: "2026-07", cliente_conta_id: 1, publicado: false },
    ];
    render(<HistoricoTab relatorios={null} entregas={estado({ entregas })} periodo="2026-10" clienteContaId={1} />);
    expect(mes("2026-07")).toHaveTextContent("2 fechamentos gravados");
  });

  it("clicar num mês pede a troca de competência pela página", async () => {
    vi.useRealTimers();
    const usuario = userEvent.setup();
    const escolher = vi.fn();
    render(<HistoricoTab relatorios={null} entregas={estado()} periodo="2026-10" clienteContaId={1} onEscolherCompetencia={escolher} />);
    await usuario.click(within(mes("2026-08")).getByRole("button", { name: "Agosto/2026" }));
    expect(escolher).toHaveBeenCalledWith("2026-08");
  });

  it("modo degradado usa a leitura do GET /financeiro", () => {
    const relatorios = { disponivel: true, dados: [{ id: 9, periodo: "2026-06", clienteContaId: 1, publicado: true, token: "t", geradoEm: "2026-07-01T00:00:00Z" }] };
    render(<HistoricoTab relatorios={relatorios} entregas={estado({ entregas: null, erro: { mensagem: "x" } })} periodo="2026-10" clienteContaId={1} />);
    expect(screen.getByText(/histórico montado a partir da leitura/)).toBeInTheDocument();
    expect(mes("2026-06")).toHaveTextContent("Publicado");
  });
});
