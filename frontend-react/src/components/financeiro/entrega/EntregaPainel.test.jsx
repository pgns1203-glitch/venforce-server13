import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntregaPainel } from "./EntregaPainel.jsx";
import { FechamentoApiError } from "../../../services/financeiroFechamentoApi.js";
import { conteudoParaPayload } from "../../../utils/financeiro/entregaConteudo.js";

const api = vi.hoisted(() => ({ buscar: vi.fn(), patch: vi.fn() }));
vi.mock("../../../services/entregasApi.js", async (orig) => ({ ...(await orig()), buscarEntrega: api.buscar }));
vi.mock("../../../services/financeiroFechamentoApi.js", async (orig) => ({ ...(await orig()), atualizarEntregaFechamento: api.patch }));

const PAYLOAD = {
  versao: 1,
  periodo: "2026-10",
  cliente: { slug: "influencia", nome: "Influência Jeans" },
  summary: { finalResult: 1700, grossRevenueTotal: 100000 },
  detailedRows: [{ id: 1 }],
  entrega: { destaques: ["Receita acima da meta"], atencoes: [], prioridades: { alta: [{ titulo: "Repor estoque", desc: "Comprar 200 un.", data: "15/11" }], media: [], baixa: [] } },
};

function entregas(overrides = {}) {
  return { acaoEmCurso: null, erroDeAcao: null, publicar: vi.fn(), despublicar: vi.fn(), ...overrides };
}

const props = {
  clienteNome: "Influência Jeans",
  marketplace: "meli",
  contaNome: "Mercado Livre 1",
  clienteContaId: 42,
  periodo: "2026-10",
  periodoLabel: "Outubro/2026",
};

beforeEach(() => {
  vi.clearAllMocks();
  api.buscar.mockResolvedValue({ ok: true, entrega: { id: 7, payload_json: PAYLOAD } });
  api.patch.mockImplementation(async (id, body) => ({ id, payload_json: body.payload_json }));
});

describe("EntregaPainel · identidade e apresentação", () => {
  it("identidade vem do contexto e é só leitura", async () => {
    render(<EntregaPainel entrega={{ id: 7, periodo: "2026-10", publicado: false, cliente_conta_id: 42 }} entregas={entregas()} {...props} />);
    const id = screen.getByTestId("identidade-entrega");
    expect(id).toHaveTextContent("Influência Jeans");
    expect(id).toHaveTextContent("Mercado Livre");
    expect(id).toHaveTextContent("Mercado Livre 1");
    expect(id).toHaveTextContent("Outubro/2026");
    expect(within(id).queryByRole("textbox")).not.toBeInTheDocument();
    expect(await screen.findByDisplayValue("Receita acima da meta")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Repor estoque")).toBeInTheDocument();
  });

  it("editar destaques/prioridades → Salvar alterações faz PATCH só do campo entrega, preservando números", async () => {
    const usuario = userEvent.setup();
    const ent = entregas();
    render(<EntregaPainel entrega={{ id: 7, periodo: "2026-10", publicado: false, cliente_conta_id: 42 }} entregas={ent} {...props} />);
    await screen.findByDisplayValue("Receita acima da meta");

    await usuario.type(screen.getByRole("textbox", { name: "Ponto de atenção 1" }), "Ruptura no produto X");
    const media = screen.getByText("Média prioridade").closest("details");
    await usuario.click(within(media).getByRole("button", { name: "+ Adicionar ação" }));
    await usuario.type(screen.getByRole("textbox", { name: "Média prioridade: título da ação 1" }), "Revisar preços");

    // edição não salva bloqueia publicar
    expect(screen.getByRole("button", { name: "Publicar" })).toBeDisabled();
    expect(screen.getByText("Salve as alterações da apresentação antes de publicar.")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [id, body] = api.patch.mock.calls[0];
    expect(id).toBe(7);
    expect(body.payload_json.summary).toEqual(PAYLOAD.summary);
    expect(body.payload_json.detailedRows).toEqual(PAYLOAD.detailedRows);
    expect(body.payload_json.entrega.atencoes).toEqual(["Ruptura no produto X"]);
    expect(body.payload_json.entrega.prioridades.media).toEqual([{ titulo: "Revisar preços", desc: "", data: "" }]);
    expect(body.payload_json.entrega.prioridades.alta).toEqual(PAYLOAD.entrega.prioridades.alta);
    expect(body.payload_json.entrega.cliente).toBe("Influência Jeans");

    expect(await screen.findByText("Apresentação salva.")).toBeInTheDocument();
    const publicar = screen.getByRole("button", { name: "Publicar" });
    expect(publicar).toBeEnabled();
    await usuario.click(publicar);
    expect(screen.getByText(/Publicar Outubro\/2026\?/)).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Publicar" }));
    expect(ent.publicar).toHaveBeenCalledWith(7);
  });

  it("entrega que já teve link é histórica: apresentação em leitura e nenhum PATCH", async () => {
    render(
      <EntregaPainel
        entrega={{ id: 8, periodo: "2026-10", publicado: true, token_publico: "tok", published_at: "2026-11-01T10:00:00Z", cliente_conta_id: 42 }}
        entregas={entregas()}
        {...props}
      />
    );
    expect(await screen.findByText("Receita acima da meta")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Salvar alterações|Rascunho salvo/ })).not.toBeInTheDocument();
    expect(screen.getByText(/conteúdo é histórico e não pode ser alterado/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", expect.stringContaining("token=tok"));
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("409 ENTREGA_PUBLICADA_IMUTAVEL vira mensagem explícita", async () => {
    api.patch.mockRejectedValueOnce(new FechamentoApiError("bloqueado", { status: 409, codigo: "ENTREGA_PUBLICADA_IMUTAVEL" }));
    const usuario = userEvent.setup();
    render(<EntregaPainel entrega={{ id: 7, periodo: "2026-10", publicado: false, cliente_conta_id: 42 }} entregas={entregas()} {...props} />);
    await screen.findByDisplayValue("Receita acima da meta");
    await usuario.type(screen.getByRole("textbox", { name: "Ponto de atenção 1" }), "x");
    await usuario.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("já teve link público");
  });

  it("informa à página quando há edição não salva", async () => {
    const usuario = userEvent.setup();
    const onAlterado = vi.fn();
    render(<EntregaPainel entrega={{ id: 7, periodo: "2026-10", publicado: false, cliente_conta_id: 42 }} entregas={entregas()} onAlterado={onAlterado} {...props} />);
    await screen.findByDisplayValue("Receita acima da meta");
    await usuario.type(screen.getByRole("textbox", { name: "Ponto de atenção 1" }), "y");
    expect(onAlterado).toHaveBeenLastCalledWith(true);
  });

  it("sem entrega desta conta, não há painel", () => {
    const { container } = render(<EntregaPainel entrega={null} entregas={entregas({ entregas: [] })} {...props} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("conteudoParaPayload · compatível com o relatório público", () => {
  it("descarta linhas vazias e ações sem título (o público filtra por titulo)", () => {
    const p = conteudoParaPayload({
      destaques: ["  ", "A"],
      atencoes: [""],
      prioridades: { alta: [{ titulo: "", desc: "x", data: "" }, { titulo: "T", desc: "", data: "1/1" }], media: [], baixa: [] },
    });
    expect(p).toEqual({ destaques: ["A"], atencoes: [], prioridades: { alta: [{ titulo: "T", desc: "", data: "1/1" }], media: [], baixa: [] } });
  });
});
