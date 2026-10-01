// Testes do hook do Painel de Contas — só a parte de "Atualizar dados":
// disparo, 409 (acompanha o job que já roda), polling SÓ enquanto executa,
// releitura SILENCIOSA ao terminar (a tabela não esmaece), retomada pela
// lista após F5, dispensar e job perdido (restart do servidor).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePainelContas } from "./usePainelContas.js";
import { ApiError } from "../services/apiClient.js";

const api = vi.hoisted(() => ({
  listarPainelContas: vi.fn(),
  listarMesesCliente: vi.fn(),
  listarSemanasMes: vi.fn(),
  listarComposicaoContas: vi.fn(),
  salvarLancamentoManual: vi.fn(),
  removerLancamentoManual: vi.fn(),
  iniciarAtualizacaoCliente: vi.fn(),
  obterAtualizacaoCliente: vi.fn(),
}));
vi.mock("../services/painelContasApi.js", () => api);

const COMP = "2026-09";

function job(over = {}) {
  return {
    id: "j1", clienteId: 1, competencia: COMP, estado: "executando",
    periodo: { dateFrom: "2026-09-01", dateTo: "2026-09-29", incluiHoje: true, mesCompleto: false },
    progresso: { fase: "contas", concluidas: 0, total: 2 }, contas: [], ...over,
  };
}

function payload(clientes = [{ id: 1, nome: "Acme", atualizacao: null }]) {
  return {
    ok: true, competencia: COMP, competenciaAtual: COMP, clientes,
    resumoCarteira: {}, squadsDisponiveis: [], marketplacesDisponiveis: [],
    permissoes: { lancarManual: true, atualizarDados: true },
  };
}

async function montar() {
  const hook = renderHook(() => usePainelContas());
  await waitFor(() => expect(hook.result.current.clientes).not.toBeNull());
  return hook;
}

async function passarPolling() {
  await act(async () => { vi.advanceTimersByTime(2500); });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", `/painel-contas.html?competencia=${COMP}`);
  // Relógio falso que também anda sozinho: o waitFor (que usa timers)
  // continua funcionando e o polling de 2,5 s é adiantado à mão.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.listarPainelContas.mockResolvedValue(payload());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePainelContas · atualizar dados", () => {
  it("dispara, acompanha e, ao terminar, relê a lista SEM esmaecer a tabela", async () => {
    api.iniciarAtualizacaoCliente.mockResolvedValue({ ok: true, atualizacao: job() });
    api.obterAtualizacaoCliente
      .mockResolvedValueOnce({ ok: true, atualizacao: job({ progresso: { fase: "contas", concluidas: 1, total: 2 } }) })
      .mockResolvedValueOnce({ ok: true, atualizacao: job({ estado: "concluida", progresso: { fase: "concluida", concluidas: 2, total: 2 } }) });
    const { result } = await montar();
    expect(api.listarPainelContas).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.atualizarCliente(1); });
    expect(api.iniciarAtualizacaoCliente).toHaveBeenCalledWith(1, COMP);
    expect(result.current.atualizacoes[1].job.estado).toBe("executando");

    await passarPolling();
    await waitFor(() => expect(result.current.atualizacoes[1].job.progresso.concluidas).toBe(1));
    expect(api.listarPainelContas).toHaveBeenCalledTimes(1);

    await passarPolling();
    await waitFor(() => expect(result.current.atualizacoes[1].job.estado).toBe("concluida"));
    await waitFor(() => expect(api.listarPainelContas).toHaveBeenCalledTimes(2));
    expect(result.current.atualizando).toBe(false);
    expect(result.current.carregando).toBe(false);

    // Terminado: o polling para.
    await passarPolling();
    expect(api.obterAtualizacaoCliente).toHaveBeenCalledTimes(2);
  });

  it("409: passa a acompanhar a atualização que já está rodando", async () => {
    api.iniciarAtualizacaoCliente.mockRejectedValue(new ApiError("Já existe", { status: 409 }));
    api.obterAtualizacaoCliente.mockResolvedValue({ ok: true, atualizacao: job({ id: "outro" }) });
    const { result } = await montar();
    await act(async () => { await result.current.atualizarCliente(1); });
    expect(result.current.atualizacoes[1].job.id).toBe("outro");
    expect(result.current.atualizacoes[1].erro).toBeNull();
  });

  it("recusa (422) vira erro na linha, sem polling nem releitura", async () => {
    api.iniciarAtualizacaoCliente.mockRejectedValue(new ApiError("Nenhuma conta Mercado Livre ativa e conectada.", { status: 422 }));
    const { result } = await montar();
    await act(async () => { await result.current.atualizarCliente(1); });
    expect(result.current.atualizacoes[1].erro.mensagem).toMatch(/nenhuma conta/i);
    await passarPolling();
    expect(api.obterAtualizacaoCliente).not.toHaveBeenCalled();
    expect(api.listarPainelContas).toHaveBeenCalledTimes(1);
  });

  it("F5 no meio: o job em curso vem na lista e o acompanhamento recomeça", async () => {
    api.listarPainelContas.mockResolvedValue(payload([{ id: 1, nome: "Acme", atualizacao: job() }]));
    api.obterAtualizacaoCliente.mockResolvedValue({ ok: true, atualizacao: job() });
    const { result } = await montar();
    expect(result.current.atualizacoes[1].job.id).toBe("j1");
    await passarPolling();
    expect(api.obterAtualizacaoCliente).toHaveBeenCalledWith("1", COMP);
  });

  it("dispensar tira a faixa e a releitura da lista não a traz de volta", async () => {
    const terminado = job({ estado: "concluida_com_pendencias" });
    api.listarPainelContas.mockResolvedValue(payload([{ id: 1, nome: "Acme", atualizacao: terminado }]));
    const { result } = await montar();
    expect(result.current.atualizacoes[1]).toBeTruthy();
    act(() => { result.current.dispensarAtualizacao(1); });
    expect(result.current.atualizacoes[1]).toBeUndefined();
    await act(async () => { result.current.recarregar(); });
    await waitFor(() => expect(api.listarPainelContas).toHaveBeenCalledTimes(2));
    expect(result.current.atualizacoes[1]).toBeUndefined();
  });

  it("job perdido (servidor reiniciou): avisa com honestidade e relê a lista", async () => {
    api.iniciarAtualizacaoCliente.mockResolvedValue({ ok: true, atualizacao: job() });
    api.obterAtualizacaoCliente.mockResolvedValue({ ok: true, atualizacao: null });
    const { result } = await montar();
    await act(async () => { await result.current.atualizarCliente(1); });
    await passarPolling();
    await waitFor(() => expect(result.current.atualizacoes[1].erro?.mensagem).toMatch(/se perdeu/));
    await waitFor(() => expect(api.listarPainelContas).toHaveBeenCalledTimes(2));
  });
});

describe("usePainelContas · composição do faturamento", () => {
  it("busca uma vez por cliente × competência, guarda contas + soma e repete só com forcar", async () => {
    api.listarComposicaoContas.mockResolvedValue({ ok: true, contas: [{ contaId: 11, composicao: null }], somaDasContas: null });
    const hook = await montar();
    act(() => hook.result.current.carregarComposicao(1, COMP));
    act(() => hook.result.current.carregarComposicao(1, COMP));
    await waitFor(() => expect(hook.result.current.composicaoPorCliente[`1:${COMP}`]?.contas).toHaveLength(1));
    expect(api.listarComposicaoContas).toHaveBeenCalledTimes(1);
    expect(api.listarComposicaoContas).toHaveBeenCalledWith(1, COMP);
    act(() => hook.result.current.carregarComposicao(1, COMP));
    expect(api.listarComposicaoContas).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.carregarComposicao(1, COMP, { forcar: true }));
    await waitFor(() => expect(api.listarComposicaoContas).toHaveBeenCalledTimes(2));
  });

  it("erro fica na chave e permite tentar de novo", async () => {
    api.listarComposicaoContas.mockRejectedValueOnce(new ApiError("Falhou", { status: 500, codigo: "X" }));
    const hook = await montar();
    act(() => hook.result.current.carregarComposicao(1, COMP));
    await waitFor(() => expect(hook.result.current.composicaoPorCliente[`1:${COMP}`]?.erro).toBeTruthy());
    api.listarComposicaoContas.mockResolvedValueOnce({ ok: true, contas: [], somaDasContas: null });
    act(() => hook.result.current.carregarComposicao(1, COMP, { forcar: true }));
    await waitFor(() => expect(hook.result.current.composicaoPorCliente[`1:${COMP}`]?.contas).toEqual([]));
  });
});
