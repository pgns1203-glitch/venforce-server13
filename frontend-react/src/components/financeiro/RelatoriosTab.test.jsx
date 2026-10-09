import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RelatoriosTab } from "./RelatoriosTab.jsx";

function estado(overrides = {}) {
  return {
    entregas: [], carregando: false, erro: null, recarregar: vi.fn(),
    acaoEmCurso: null, erroDeAcao: null, publicar: vi.fn(), despublicar: vi.fn(), excluir: vi.fn(),
    ...overrides,
  };
}

const A = { id: 101, periodo: "2026-10", cliente_conta_id: 1, publicado: true, token_publico: "tok-a", created_at: "2026-11-02T10:00:00Z", published_at: "2026-11-03T10:00:00Z", modo_calculo: "real_financial", cobertura_custo_percentual: "98.4", marketplace_payload: "shopee" };
const B = { id: 202, periodo: "2026-10", cliente_conta_id: 2, publicado: true, token_publico: "tok-b", created_at: "2026-11-02T11:00:00Z", published_at: "2026-11-03T11:00:00Z", modo_calculo: "estimated_performance", cobertura_custo_percentual: "91", marketplace_payload: "shopee" };
const LEGADO = { id: 303, periodo: "Outubro 2026", cliente_conta_id: null, publicado: false, created_at: "2026-10-30T10:00:00Z", marketplace_payload: "shopee" };

const ctxConta1 = { periodo: "2026-10", clienteContaId: 1, marketplace: "shopee", contaNome: "Shopee 1", contaRotuloExterno: "loja-a" };

function linha(id) {
  return document.querySelector(`tr[data-entrega="${id}"]`);
}

describe("RelatoriosTab · identificação account-aware", () => {
  it("cada linha diz competência, operação (conta ou legado), modo, cobertura e status", () => {
    render(<RelatoriosTab relatorios={null} entregas={estado({ entregas: [A, B, LEGADO] })} {...ctxConta1} />);
    const a = linha(101);
    expect(a).toHaveTextContent("Outubro/2026");
    expect(a).toHaveTextContent("Shopee · Shopee 1 · loja-a");
    expect(a).toHaveTextContent("Financeiro real · Order.all");
    expect(a).toHaveTextContent("98,4%");
    expect(a).toHaveTextContent("Publicado");

    const b = linha(202);
    expect(b).toHaveTextContent("Outra conta (#2) · Shopee");
    expect(b).not.toHaveTextContent("Shopee 1");
    expect(b).toHaveTextContent("Estimativa por performance");

    const leg = linha(303);
    expect(leg).toHaveTextContent("Legado · operação não registrada (Shopee)");
    expect(leg).toHaveTextContent("Outubro/2026"); // texto livre normalizado por igualdade
    expect(leg).toHaveTextContent("Rascunho");
  });

  it("sem modo/cobertura gravados, mostra '—' (não 0%)", () => {
    render(<RelatoriosTab relatorios={null} entregas={estado({ entregas: [LEGADO] })} {...ctxConta1} />);
    const leg = linha(303);
    expect(leg).not.toHaveTextContent("0,0%");
    expect(within(leg).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("rascunho nunca finge uma data de publicação", () => {
    render(<RelatoriosTab relatorios={null} entregas={estado({ entregas: [LEGADO] })} {...ctxConta1} />);
    const celulas = linha(303).querySelectorAll("td");
    expect(celulas[6]).toHaveTextContent("—");
  });

  it("período ausente/ambíguo mostra '—' com o valor gravado entre parênteses", () => {
    render(<RelatoriosTab relatorios={null} entregas={estado({ entregas: [{ ...LEGADO, id: 304, periodo: "2026-07 a 2026-08" }] })} {...ctxConta1} />);
    expect(linha(304)).toHaveTextContent("— (2026-07 a 2026-08)");
  });
});

describe("RelatoriosTab · ações isoladas por id", () => {
  it("excluir A pede confirmação com competência e conta, avisa do link e exclui SÓ A", async () => {
    const usuario = userEvent.setup();
    const ent = estado({ entregas: [A, B] });
    render(<RelatoriosTab relatorios={null} entregas={ent} {...ctxConta1} />);
    await usuario.click(within(linha(101)).getByRole("button", { name: "Excluir" }));
    const confirmacao = within(linha(101)).getByRole("group", { name: "Confirmar exclusão" });
    expect(confirmacao).toHaveTextContent("Excluir permanentemente o fechamento de Outubro/2026 — Shopee · Shopee 1 · loja-a?");
    expect(confirmacao).toHaveTextContent("O link público deixará de funcionar.");
    await usuario.click(within(confirmacao).getByRole("button", { name: "Excluir permanentemente" }));
    expect(ent.excluir).toHaveBeenCalledTimes(1);
    expect(ent.excluir).toHaveBeenCalledWith(101);
  });

  it("cancelar a exclusão não exclui nada", async () => {
    const usuario = userEvent.setup();
    const ent = estado({ entregas: [A] });
    render(<RelatoriosTab relatorios={null} entregas={ent} {...ctxConta1} />);
    await usuario.click(within(linha(101)).getByRole("button", { name: "Excluir" }));
    await usuario.click(within(linha(101)).getByRole("button", { name: "Cancelar" }));
    expect(ent.excluir).not.toHaveBeenCalled();
  });

  it("despublicar A não toca em B", async () => {
    const usuario = userEvent.setup();
    const ent = estado({ entregas: [A, B] });
    render(<RelatoriosTab relatorios={null} entregas={ent} {...ctxConta1} />);
    await usuario.click(within(linha(101)).getByRole("button", { name: "Despublicar" }));
    await usuario.click(within(linha(101)).getByRole("button", { name: "Despublicar" }));
    expect(ent.despublicar).toHaveBeenCalledWith(101);
    expect(ent.despublicar).not.toHaveBeenCalledWith(202);
  });

  it("ação em curso numa linha desabilita as ações das OUTRAS", () => {
    render(<RelatoriosTab relatorios={null} entregas={estado({ entregas: [A, LEGADO], acaoEmCurso: 101 })} {...ctxConta1} />);
    expect(within(linha(303)).getByRole("button", { name: "Publicar" })).toBeDisabled();
    expect(within(linha(303)).getByRole("button", { name: "Excluir" })).toBeDisabled();
  });

  it("erro de escrita fica NA LINHA que falhou", () => {
    render(<RelatoriosTab relatorios={null} entregas={estado({ entregas: [A, B], erroDeAcao: { id: 202, mensagem: "Cliente fora da sua carteira." } })} {...ctxConta1} />);
    expect(within(linha(202)).getByRole("alert")).toHaveTextContent("Cliente fora da sua carteira.");
    expect(within(linha(101)).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a linha da competência em tela é marcada", () => {
    render(<RelatoriosTab relatorios={null} entregas={estado({ entregas: [A, { ...A, id: 105, periodo: "2026-09" }] })} {...ctxConta1} />);
    expect(linha(101)).toHaveClass("is-destacada");
    expect(linha(105)).not.toHaveClass("is-destacada");
  });
});

describe("RelatoriosTab · modo degradado", () => {
  it("lista operacional falhou: tabela em LEITURA a partir do GET /financeiro, com motivo e retry", async () => {
    const usuario = userEvent.setup();
    const ent = estado({ entregas: null, erro: { mensagem: "Sem conexão com o servidor." } });
    const relatorios = { disponivel: true, dados: [{ id: 1, periodo: "2026-10", clienteContaId: 1, status: "publicado", publicado: true, token: "t", geradoEm: "2026-11-01T00:00:00Z" }, { id: 2, periodo: null, clienteContaId: null, status: "rascunho", publicado: false, token: null }] };
    render(<RelatoriosTab relatorios={relatorios} entregas={ent} {...ctxConta1} />);
    expect(screen.getByText("Ações indisponíveis no momento")).toBeInTheDocument();
    expect(screen.getByText("Sem conexão com o servidor.")).toBeInTheDocument();
    expect(screen.getByText("Legado · operação não registrada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(ent.recarregar).toHaveBeenCalled();
  });

  it("bloco indisponível é decisão do backend", () => {
    render(<RelatoriosTab relatorios={{ disponivel: false, motivo: "Falha ao carregar este bloco." }} entregas={estado()} {...ctxConta1} />);
    expect(screen.getByText("Falha ao carregar este bloco.")).toBeInTheDocument();
  });
});
