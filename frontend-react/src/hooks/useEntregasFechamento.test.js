// Testes do hook operacional do Financeiro V3 (F4.2).
//
// O que está sendo medido aqui é o que dá errado em escrita de verdade —
// duplo clique, resposta que chega depois da troca de contexto, estado
// local que "acha" que publicou — e não o render (esse é o assunto de
// pages/FinanceiroPage.test.jsx).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEntregasFechamento, entregaDoPeriodo } from "./useEntregasFechamento.js";
import { ApiError } from "../services/apiClient.js";

const api = vi.hoisted(() => ({
  listarEntregasDeFechamento: vi.fn(),
  publicarEntrega: vi.fn(),
  despublicarEntrega: vi.fn(),
}));

vi.mock("../services/entregasApi.js", () => api);

function entrega(overrides = {}) {
  return { id: 501, periodo: "2026-08", publicado: false, cliente_slug: "n97", ...overrides };
}

// Promessa cuja resolução o teste controla — é o que permite observar o
// estado com a requisição AINDA EM VOO.
function deferida() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listarEntregasDeFechamento.mockResolvedValue({ ok: true, entregas: [entrega()] });
  api.publicarEntrega.mockResolvedValue({ ok: true });
  api.despublicarEntrega.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useEntregasFechamento · carga", () => {
  it("carrega ao montar e expõe a lista", async () => {
    const { result } = renderHook(() => useEntregasFechamento({ clienteSlug: "n97", habilitado: true }));
    await waitFor(() => expect(result.current.entregas).toHaveLength(1));
    expect(api.listarEntregasDeFechamento).toHaveBeenCalledWith("n97", expect.objectContaining({ signal: expect.anything() }));
  });

  it("contexto não pronto: não chama o servidor e não inventa lista vazia", async () => {
    const { result } = renderHook(() => useEntregasFechamento({ clienteSlug: "n97", habilitado: false }));
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(api.listarEntregasDeFechamento).not.toHaveBeenCalled();
    expect(result.current.entregas).toBeNull();
  });

  it("trocar de cliente recarrega e a resposta ANTIGA não sobrescreve a nova", async () => {
    const primeira = deferida();
    api.listarEntregasDeFechamento.mockReturnValueOnce(primeira.promessa);
    api.listarEntregasDeFechamento.mockResolvedValueOnce({ ok: true, entregas: [entrega({ id: 900, cliente_slug: "extra" })] });

    const { result, rerender } = renderHook(({ slug }) => useEntregasFechamento({ clienteSlug: slug, habilitado: true }), {
      initialProps: { slug: "n97" },
    });

    rerender({ slug: "extra" });
    await waitFor(() => expect(result.current.entregas).toHaveLength(1));
    expect(result.current.entregas[0].cliente_slug).toBe("extra");

    // A resposta do cliente anterior chega atrasada: precisa ser descartada.
    await act(async () => {
      primeira.resolver({ ok: true, entregas: [entrega({ id: 501, cliente_slug: "n97" })] });
      await primeira.promessa;
    });
    expect(result.current.entregas[0].cliente_slug).toBe("extra");
  });

  it("falha na carga vira erro tipado, sem lista fabricada", async () => {
    api.listarEntregasDeFechamento.mockRejectedValueOnce(new ApiError("Sem conexão.", { status: 0, codigo: "rede" }));
    const { result } = renderHook(() => useEntregasFechamento({ clienteSlug: "n97", habilitado: true }));
    await waitFor(() => expect(result.current.erro).not.toBeNull());
    expect(result.current.erro).toEqual({ codigo: "rede", mensagem: "Sem conexão.", status: 0 });
    expect(result.current.entregas).toBeNull();
  });
});

describe("useEntregasFechamento · escrita", () => {
  it("depois de publicar, relê do servidor — o estado não é remendado localmente", async () => {
    const { result } = renderHook(() => useEntregasFechamento({ clienteSlug: "n97", habilitado: true }));
    await waitFor(() => expect(result.current.entregas).toHaveLength(1));
    expect(api.listarEntregasDeFechamento).toHaveBeenCalledTimes(1);

    api.listarEntregasDeFechamento.mockResolvedValueOnce({
      ok: true,
      entregas: [entrega({ publicado: true, token_publico: "tok-1" })],
    });
    await act(async () => {
      await result.current.publicar(501);
    });

    expect(api.publicarEntrega).toHaveBeenCalledWith(501);
    expect(api.listarEntregasDeFechamento).toHaveBeenCalledTimes(2); // GET autoritativo
    expect(result.current.entregas[0].publicado).toBe(true);
  });

  it("duplo clique: a segunda chamada não sai enquanto a primeira está em voo", async () => {
    const emVoo = deferida();
    api.publicarEntrega.mockReturnValueOnce(emVoo.promessa);

    const { result } = renderHook(() => useEntregasFechamento({ clienteSlug: "n97", habilitado: true }));
    await waitFor(() => expect(result.current.entregas).toHaveLength(1));

    let segunda;
    act(() => {
      result.current.publicar(501);
    });
    await waitFor(() => expect(result.current.acaoEmCurso).toBe(501));

    await act(async () => {
      segunda = await result.current.publicar(501);
    });
    expect(segunda).toBe(false);
    expect(api.publicarEntrega).toHaveBeenCalledTimes(1);

    await act(async () => {
      emVoo.resolver({ ok: true });
      await emVoo.promessa;
    });
    await waitFor(() => expect(result.current.acaoEmCurso).toBeNull());
  });

  it("trocar de cliente DURANTE a escrita: a resposta não recarrega a lista do cliente novo", async () => {
    const emVoo = deferida();
    api.publicarEntrega.mockReturnValueOnce(emVoo.promessa);

    const { result, rerender } = renderHook(({ slug }) => useEntregasFechamento({ clienteSlug: slug, habilitado: true }), {
      initialProps: { slug: "n97" },
    });
    await waitFor(() => expect(result.current.entregas).toHaveLength(1));

    act(() => {
      result.current.publicar(501);
    });
    await waitFor(() => expect(result.current.acaoEmCurso).toBe(501));

    rerender({ slug: "extra" }); // troca de contexto no meio do voo
    await waitFor(() => expect(api.listarEntregasDeFechamento).toHaveBeenCalledTimes(2)); // recarga do cliente novo

    await act(async () => {
      emVoo.resolver({ ok: true });
      await emVoo.promessa;
    });

    // A escrita valeu no servidor, mas esta tela já fala de outro cliente:
    // nenhuma terceira carga, nenhum erro fabricado.
    expect(api.listarEntregasDeFechamento).toHaveBeenCalledTimes(2);
    expect(result.current.erroDeAcao).toBeNull();
  });

  it("erro de escrita fica ligado ao id que falhou e não apaga a lista", async () => {
    api.publicarEntrega.mockRejectedValueOnce(new ApiError("Cliente fora da sua carteira.", { status: 403, codigo: "sem_permissao" }));

    const { result } = renderHook(() => useEntregasFechamento({ clienteSlug: "n97", habilitado: true }));
    await waitFor(() => expect(result.current.entregas).toHaveLength(1));

    await act(async () => {
      await result.current.publicar(501);
    });

    expect(result.current.erroDeAcao).toEqual({ id: 501, mensagem: "Cliente fora da sua carteira." });
    expect(result.current.entregas).toHaveLength(1);
    expect(result.current.acaoEmCurso).toBeNull();
    expect(api.listarEntregasDeFechamento).toHaveBeenCalledTimes(1); // não recarrega no erro
  });

  it("despublicar usa o endpoint de despublicar, não o de publicar", async () => {
    const { result } = renderHook(() => useEntregasFechamento({ clienteSlug: "n97", habilitado: true }));
    await waitFor(() => expect(result.current.entregas).toHaveLength(1));

    await act(async () => {
      await result.current.despublicar(501);
    });
    expect(api.despublicarEntrega).toHaveBeenCalledWith(501);
    expect(api.publicarEntrega).not.toHaveBeenCalled();
  });
});

describe("entregaDoPeriodo", () => {
  it("acha a entrega da competência em tela", () => {
    const lista = [entrega({ id: 1, periodo: "2026-07" }), entrega({ id: 2, periodo: "2026-08" })];
    expect(entregaDoPeriodo(lista, "2026-08").id).toBe(2);
  });

  it("tolera o período em texto livre do fluxo legado (mesma regra do backend)", () => {
    const lista = [entrega({ id: 3, periodo: "Agosto 2026-08 (parcial)" })];
    expect(entregaDoPeriodo(lista, "2026-08").id).toBe(3);
  });

  it("sem correspondência devolve null — nunca a primeira da lista", () => {
    const lista = [entrega({ id: 1, periodo: "2026-07" }), entrega({ id: 2, periodo: "2026-06" })];
    expect(entregaDoPeriodo(lista, "2026-08")).toBeNull();
  });

  it("lista ausente ou período ausente devolve null", () => {
    expect(entregaDoPeriodo(null, "2026-08")).toBeNull();
    expect(entregaDoPeriodo([entrega()], null)).toBeNull();
  });

  it("com clienteContaId, prefere a entrega desta conta mesmo se outra conta apareceu antes na lista (V3 P2.6 D1)", () => {
    const lista = [
      entrega({ id: 10, periodo: "2026-08", cliente_conta_id: 20 }), // Shopee, chegou primeiro na lista
      entrega({ id: 11, periodo: "2026-08", cliente_conta_id: 10 }), // MELI — é esta conta
    ];
    expect(entregaDoPeriodo(lista, "2026-08", 10).id).toBe(11);
  });

  it("com clienteContaId sem entrega desta conta, cai para a entrega legada (cliente_conta_id null)", () => {
    const lista = [
      entrega({ id: 12, periodo: "2026-08", cliente_conta_id: 20 }), // outra conta
      entrega({ id: 13, periodo: "2026-08", cliente_conta_id: null }), // legada, do cliente
    ];
    expect(entregaDoPeriodo(lista, "2026-08", 10).id).toBe(13);
  });

  it("com clienteContaId, NUNCA devolve a entrega de uma conta diferente e específica — nem por publicar/despublicar em outra conta por engano", () => {
    const lista = [entrega({ id: 14, periodo: "2026-08", cliente_conta_id: 20 })];
    expect(entregaDoPeriodo(lista, "2026-08", 10)).toBeNull();
  });
});
