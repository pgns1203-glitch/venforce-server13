// Testes do hook Ads+Saúde (Fase 5) — lazy (só busca quando habilitado),
// dispara os dois em paralelo, cancela ao trocar de contexto.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSaudeAdsV3 } from "./useSaudeAdsV3.js";

const api = vi.hoisted(() => ({ obterAdsV3: vi.fn(), obterSaudeV3: vi.fn() }));
vi.mock("../services/cliente360V3SaudeAdsApi.js", () => api);

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("useSaudeAdsV3 · lazy", () => {
  it("não busca quando habilitado=false", async () => {
    const { result } = renderHook(() => useSaudeAdsV3({ clienteSlug: "n97", clienteContaId: 10, periodo: "2026-08", habilitado: false }));
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(api.obterAdsV3).not.toHaveBeenCalled();
    expect(api.obterSaudeV3).not.toHaveBeenCalled();
  });

  it("busca ads+saude em paralelo quando habilitado", async () => {
    api.obterAdsV3.mockResolvedValue({ ads: { disponivel: true, dados: { investimentoAds: 4100 } } });
    api.obterSaudeV3.mockResolvedValue({ saude: { grantBase: { disponivel: true, dados: { grantConectado: true } } } });

    const { result } = renderHook(() => useSaudeAdsV3({ clienteSlug: "n97", clienteContaId: 10, periodo: "2026-08", habilitado: true }));
    await waitFor(() => expect(result.current.ads).not.toBeNull());

    expect(result.current.ads.dados.investimentoAds).toBe(4100);
    expect(result.current.saude.grantBase.dados.grantConectado).toBe(true);
  });
});

describe("useSaudeAdsV3 · troca de contexto cancela requests em voo", () => {
  it("trocar de conta aborta e só a resposta da conta nova é aplicada", async () => {
    let resolverAds1, resolverSaude1, resolverAds2, resolverSaude2;
    api.obterAdsV3
      .mockImplementationOnce(() => new Promise((res) => { resolverAds1 = res; }))
      .mockImplementationOnce(() => new Promise((res) => { resolverAds2 = res; }));
    api.obterSaudeV3
      .mockImplementationOnce(() => new Promise((res) => { resolverSaude1 = res; }))
      .mockImplementationOnce(() => new Promise((res) => { resolverSaude2 = res; }));

    const { result, rerender } = renderHook(
      ({ clienteContaId }) => useSaudeAdsV3({ clienteSlug: "n97", clienteContaId, periodo: "2026-08", habilitado: true }),
      { initialProps: { clienteContaId: 10 } }
    );
    await waitFor(() => expect(api.obterAdsV3).toHaveBeenCalledTimes(1));
    const signal1 = api.obterAdsV3.mock.calls[0][1].signal;

    rerender({ clienteContaId: 11 });
    await waitFor(() => expect(api.obterAdsV3).toHaveBeenCalledTimes(2));
    expect(signal1.aborted).toBe(true);

    await act(async () => {
      resolverAds1({ ads: { disponivel: true, dados: { investimentoAds: "CONTA-10-ATRASADA" } } });
      resolverSaude1({ saude: {} });
    });
    expect(result.current.ads).toBeNull();

    await act(async () => {
      resolverAds2({ ads: { disponivel: true, dados: { investimentoAds: "conta-11" } } });
      resolverSaude2({ saude: {} });
    });
    await waitFor(() => expect(result.current.ads?.dados?.investimentoAds).toBe("conta-11"));
  });
});
