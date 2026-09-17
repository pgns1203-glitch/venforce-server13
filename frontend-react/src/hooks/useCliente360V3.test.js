// Testes do hook de bootstrap da Cliente 360 V3 (Fase 1).
//
// O que está sendo medido aqui é exatamente o critério de aceite da Fase 1
// que não aparece no render: cancelamento ao trocar contexto (nunca mostrar
// dado da conta/período anterior) e a checagem extra de ContextKey (uma
// resposta cujo contexto ecoado não bate com o que foi pedido é descartada
// mesmo sem erro e sem abort a tempo). O render em si é assunto de
// pages/Cliente360V3Page.test.jsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCliente360V3 } from "./useCliente360V3.js";
import { criarContextKey } from "../utils/cliente360V3ContextKey.js";
import { competenciaAnterior } from "../utils/dates.js";
import { ApiError } from "../services/apiClient.js";

const api = vi.hoisted(() => ({ obterBootstrapCliente360V3: vi.fn() }));
vi.mock("../services/cliente360V3Api.js", () => api);

function boot({ clienteId = 1, clienteContaId = 10, periodo = "2026-08", compararCom = null, dados = {} } = {}) {
  const compararComEfetivo = compararCom || competenciaAnterior(periodo);
  return {
    contexto: {
      clienteId,
      clienteSlug: "n97",
      clienteContaId,
      marketplace: "meli",
      competencia: periodo,
      compararCom: compararComEfetivo,
      contextKey: criarContextKey({ clienteId, clienteContaId, periodo, compararCom: compararComEfetivo }),
    },
    capabilities: { disponivel: true, escopo: "account", dados: { marketplace: "meli", isMeli: true } },
    resultado: { disponivel: true, escopo: "account", dados },
  };
}

// Promessa cuja resolução o teste controla — necessário para observar o
// estado com a requisição AINDA EM VOO (guarda de corrida).
function deferida() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCliente360V3 · contexto incompleto", () => {
  it("não chama o servidor quando !pronta", async () => {
    const { result } = renderHook(() =>
      useCliente360V3({ clienteId: 1, clienteSlug: "n97", clienteContaId: 10, pronta: false })
    );
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(api.obterBootstrapCliente360V3).not.toHaveBeenCalled();
    expect(result.current.boot).toBeNull();
  });
});

describe("useCliente360V3 · carga normal", () => {
  it("busca com o período default e expõe o boot quando o contextKey ecoado bate", async () => {
    api.obterBootstrapCliente360V3.mockResolvedValue(boot({ periodo: "2026-08" }));
    const { result } = renderHook(() =>
      useCliente360V3({ clienteId: 1, clienteSlug: "n97", clienteContaId: 10, pronta: true })
    );
    act(() => result.current.setPeriodo("2026-08"));

    await waitFor(() => expect(result.current.boot).not.toBeNull());
    expect(api.obterBootstrapCliente360V3).toHaveBeenCalledWith(
      "n97",
      expect.objectContaining({ clienteContaId: 10, periodo: "2026-08", signal: expect.anything() })
    );
  });

  it("compararCom omitido (null) ainda casa a chave — mesmo default do backend (mês anterior)", async () => {
    api.obterBootstrapCliente360V3.mockResolvedValue(boot({ periodo: "2026-08", compararCom: null }));
    const { result } = renderHook(() =>
      useCliente360V3({ clienteId: 1, clienteSlug: "n97", clienteContaId: 10, pronta: true })
    );
    act(() => result.current.setPeriodo("2026-08"));

    await waitFor(() => expect(result.current.boot).not.toBeNull());
    expect(result.current.boot.contexto.compararCom).toBe("2026-07");
  });
});

describe("useCliente360V3 · ContextKey — resposta de outro contexto é descartada", () => {
  it("payload com contextKey que não bate com o contexto atual não atualiza o boot", async () => {
    // Simula uma resposta "vazada" de outra conta (bug de servidor, cache
    // desalinhado, o que for) — o contexto ecoado não é o pedido.
    const payloadErrado = boot({ clienteContaId: 999, periodo: "2026-08" });
    api.obterBootstrapCliente360V3.mockResolvedValue(payloadErrado);

    const { result } = renderHook(() =>
      useCliente360V3({ clienteId: 1, clienteSlug: "n97", clienteContaId: 10, pronta: true })
    );
    act(() => result.current.setPeriodo("2026-08"));

    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(result.current.boot).toBeNull();
  });
});

describe("useCliente360V3 · troca de contexto cancela a requisição anterior", () => {
  it("mudar clienteContaId aborta o request em voo e só o resultado da conta nova é aplicado", async () => {
    const primeira = deferida();
    const segunda = deferida();
    api.obterBootstrapCliente360V3
      .mockImplementationOnce(() => primeira.promessa)
      .mockImplementationOnce(() => segunda.promessa);

    const { result, rerender } = renderHook(
      ({ clienteContaId }) => useCliente360V3({ clienteId: 1, clienteSlug: "n97", clienteContaId, pronta: true }),
      { initialProps: { clienteContaId: 10 } }
    );
    act(() => result.current.setPeriodo("2026-08"));
    await waitFor(() => expect(api.obterBootstrapCliente360V3).toHaveBeenCalledTimes(1));

    const primeiroSignal = api.obterBootstrapCliente360V3.mock.calls[0][1].signal;
    expect(primeiroSignal.aborted).toBe(false);

    // Troca de conta ANTES da primeira resposta chegar.
    rerender({ clienteContaId: 11 });
    await waitFor(() => expect(api.obterBootstrapCliente360V3).toHaveBeenCalledTimes(2));
    expect(primeiroSignal.aborted).toBe(true); // master prompt Fase 1: cancelar requests ao trocar contexto

    // A resposta ATRASADA da conta 10 chega DEPOIS da troca — não pode vazar.
    await act(async () => primeira.resolver(boot({ clienteContaId: 10, periodo: "2026-08" })));
    expect(result.current.boot).toBeNull(); // ainda não aplicou — seq já mudou

    await act(async () => segunda.resolver(boot({ clienteContaId: 11, periodo: "2026-08" })));
    await waitFor(() => expect(result.current.boot?.contexto.clienteContaId).toBe(11));
  });

  it("um AbortError da requisição cancelada nunca aparece como erro visível", async () => {
    const primeira = deferida();
    api.obterBootstrapCliente360V3
      .mockImplementationOnce(() => primeira.promessa)
      .mockResolvedValueOnce(boot({ clienteContaId: 11, periodo: "2026-08" }));

    const { result, rerender } = renderHook(
      ({ clienteContaId }) => useCliente360V3({ clienteId: 1, clienteSlug: "n97", clienteContaId, pronta: true }),
      { initialProps: { clienteContaId: 10 } }
    );
    act(() => result.current.setPeriodo("2026-08"));
    await waitFor(() => expect(api.obterBootstrapCliente360V3).toHaveBeenCalledTimes(1));

    rerender({ clienteContaId: 11 });
    await waitFor(() => expect(result.current.boot?.contexto.clienteContaId).toBe(11));

    const erroAbort = new ApiError("Aborted", { status: 0, codigo: "abort" });
    erroAbort.name = "AbortError";
    await act(async () => primeira.rejeitar(erroAbort));

    expect(result.current.erro).toBeNull();
    expect(result.current.boot?.contexto.clienteContaId).toBe(11);
  });
});
