// Testes do hook de cruzamento de margem (Fase 3) — LAZY: só busca quando
// `habilitado`, cancela ao trocar de MLBs/conta, nunca deixa erro de abort
// aparecer como erro visível.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProdutosMargem } from "./useProdutosMargem.js";
import { ApiError } from "../services/apiClient.js";

const api = vi.hoisted(() => ({ obterProdutosMargemV3: vi.fn() }));
vi.mock("../services/cliente360V3ProdutosApi.js", () => api);

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("useProdutosMargem · lazy", () => {
  it("não chama a API quando habilitado=false (filtro Margem não foi aberto)", async () => {
    const { result } = renderHook(() => useProdutosMargem({
      clienteSlug: "n97", clienteContaId: 10, periodo: "2026-08", mlbs: ["MLB1"], habilitado: false,
    }));
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(api.obterProdutosMargemV3).not.toHaveBeenCalled();
    expect(result.current.dados).toBeNull();
  });

  it("chama a API só quando habilitado=true e há MLBs", async () => {
    api.obterProdutosMargemV3.mockResolvedValue({ aplicavel: true, porMlb: { MLB1: { identidade: "matched", status: "HEALTHY" } } });
    const { result } = renderHook(() => useProdutosMargem({
      clienteSlug: "n97", clienteContaId: 10, periodo: "2026-08", mlbs: ["MLB1"], habilitado: true,
    }));
    await waitFor(() => expect(result.current.dados).not.toBeNull());
    expect(result.current.dados.porMlb.MLB1.status).toBe("HEALTHY");
  });

  it("mlbs vazio: não chama a API mesmo habilitado", async () => {
    const { result } = renderHook(() => useProdutosMargem({
      clienteSlug: "n97", clienteContaId: 10, periodo: "2026-08", mlbs: [], habilitado: true,
    }));
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(api.obterProdutosMargemV3).not.toHaveBeenCalled();
  });
});

describe("useProdutosMargem · troca de contexto cancela a requisição anterior", () => {
  it("trocar de conta aborta o request em voo e só a resposta da conta nova é aplicada", async () => {
    let resolverPrimeira;
    let resolverSegunda;
    api.obterProdutosMargemV3
      .mockImplementationOnce(() => new Promise((res) => { resolverPrimeira = res; }))
      .mockImplementationOnce(() => new Promise((res) => { resolverSegunda = res; }));

    const { result, rerender } = renderHook(
      ({ clienteContaId }) => useProdutosMargem({ clienteSlug: "n97", clienteContaId, periodo: "2026-08", mlbs: ["MLB1"], habilitado: true }),
      { initialProps: { clienteContaId: 10 } }
    );
    await waitFor(() => expect(api.obterProdutosMargemV3).toHaveBeenCalledTimes(1));
    const primeiroSignal = api.obterProdutosMargemV3.mock.calls[0][1].signal;

    rerender({ clienteContaId: 11 });
    await waitFor(() => expect(api.obterProdutosMargemV3).toHaveBeenCalledTimes(2));
    expect(primeiroSignal.aborted).toBe(true);

    await act(async () => resolverPrimeira({ aplicavel: true, porMlb: { MLB1: { status: "conta-10-atrasada" } } }));
    expect(result.current.dados).toBeNull();

    await act(async () => resolverSegunda({ aplicavel: true, porMlb: { MLB1: { status: "conta-11" } } }));
    await waitFor(() => expect(result.current.dados?.porMlb?.MLB1?.status).toBe("conta-11"));
  });
});
