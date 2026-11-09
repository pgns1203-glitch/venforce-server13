import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabelaCarteira, ordenarCarteira } from "./TabelaCarteira.jsx";
import { useExpansao } from "./TabelaHierarquica.jsx";

const resumo = (o = {}) => ({ fat: 1000, lc: 150, mc: 0.15, ads: 40, acos: 0.1, tacos: 0.04, ...o });
const conta = (id, o = {}) => ({
  id, rotulo: `Mercado Livre ${id} · LOJA`, marketplace: "meli", ativa: true, conectada: true, avisos: [],
  status: { codigo: "sincronizado", rotulo: "Sincronizado" }, fonte: { tipo: "api", rotulo: "API" },
  resumo: resumo({ ads: null, tacos: null, acos: null }), dadosAte: "2026-09-28", podeLancarManual: false, manual: null, ...o,
});
const cliente = (id, o = {}) => ({
  id, nome: `Cliente ${id}`, squad: { id: 1, nome: "Alpha" }, competencia: "2026-09",
  escopo: { contasOperacionais: 2, contasComDado: 1 }, status: { codigo: "parcial", rotulo: "Parcial" },
  fonte: { tipo: "api", rotulo: "API" }, resumo: resumo(), dadosAte: "2026-09-28",
  contas: [conta(id * 10 + 1), conta(id * 10 + 2, {
    marketplace: "shopee", rotulo: "Shopee 1 · LOJA", fonte: null, resumo: null, podeLancarManual: true,
    status: { codigo: "sem_integracao", rotulo: "Sem integração", motivo: "Marketplace sem integração automática" },
  })],
  ...o,
});

let observadores;
beforeEach(() => {
  observadores = [];
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; observadores.push(this); }
    observe(el) { this.el = el; }
    disconnect() {}
  };
});

function Casca(props) {
  const expansao = useExpansao();
  return <TabelaCarteira competencia="2026-09" expansao={expansao} podeLancar {...props} />;
}

describe("TabelaCarteira (B Realistic)", () => {
  it("ordena por FAT ↓ com ausentes no fim", () => {
    const l = ordenarCarteira([cliente(1, { resumo: resumo({ fat: 10 }) }), cliente(2, { resumo: null }), cliente(3, { resumo: resumo({ fat: 99 }) })], { k: "fat", dir: -1 });
    expect(l.map((c) => c.id)).toEqual([3, 1, 2]);
  });

  it("cliente → contas em árvore: rótulo em dois pesos, 'no cliente' no Ads, botão de lançar na conta pendente", async () => {
    const onLancar = vi.fn();
    render(<Casca clientes={[cliente(1)]} onLancar={onLancar} />);
    expect(screen.getByTestId("situacao-1")).toHaveTextContent("Parcial · 1 de 2");
    await userEvent.click(screen.getByRole("button", { name: "Motivos" }));
    expect(screen.getByText("1 aguarda lançamento")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Cliente Cliente 1 — expandir/ }));
    const linhaApi = screen.getByRole("button", { name: /Conta Mercado Livre 11 · LOJA/ }).closest("tr");
    expect(linhaApi).toHaveClass("vf-pb-conta");
    expect(within(linhaApi).getByText("no cliente")).toBeInTheDocument();
    expect(within(linhaApi).getByText(/API/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Lançar dados — Shopee 1 · LOJA" }));
    expect(onLancar).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 12 }));
  });

  it("investigação: histórico e composição só carregam quando o painel fica visível", async () => {
    const carregarMeses = vi.fn();
    const carregarComposicao = vi.fn();
    render(<Casca clientes={[cliente(1)]} carregarMeses={carregarMeses} carregarComposicao={carregarComposicao} />);
    await userEvent.click(screen.getByRole("button", { name: /Cliente Cliente 1 — expandir/ }));
    expect(screen.getByRole("region", { name: "Investigar Cliente 1" })).toBeInTheDocument();
    expect(carregarMeses).not.toHaveBeenCalled();
    expect(carregarComposicao).not.toHaveBeenCalled();
    act(() => { observadores.at(-1).cb([{ isIntersecting: true }]); });
    expect(carregarMeses).toHaveBeenCalledWith(1);
    expect(carregarComposicao).toHaveBeenCalledWith(1, "2026-09");
  });

  it("histórico: barras por mês, tabela com variação do servidor e clique troca a competência", async () => {
    const onIr = vi.fn();
    const meses = { carregando: false, erro: null, meses: [
      { competencia: "2026-08", resumo: resumo({ fat: 800, mc: 0.14 }), variacaoVsMesAnterior: null },
      { competencia: "2026-09", resumo: resumo({ fat: 1000, mc: 0.15 }), variacaoVsMesAnterior: { fat: { pct: 0.25 }, mc: { pp: 0.01 } } },
    ] };
    render(<Casca clientes={[cliente(1)]} mesesPorCliente={{ 1: meses }} onIrParaCompetencia={onIr} />);
    await userEvent.click(screen.getByRole("button", { name: /Cliente Cliente 1 — expandir/ }));
    const inv = screen.getByRole("region", { name: "Investigar Cliente 1" });
    expect(within(inv).getByText("set/2026")).toBeInTheDocument();
    await userEvent.click(within(inv).getByRole("button", { name: /agosto\/2026/i }));
    expect(onIr).toHaveBeenCalledWith("2026-08");
  });

  it("agrupa por squad na ordem do servidor, com contagem e sem soma de dinheiro", () => {
    render(<Casca agrupar ordemSquads={[2, 1]} clientes={[cliente(1), cliente(2, { squad: { id: 2, nome: "Beta" } })]} />);
    const grupos = screen.getAllByRole("button", { name: /Squad / }).map((b) => b.textContent);
    expect(grupos[0]).toMatch(/Squad Beta/);
    expect(grupos[1]).toMatch(/Squad Alpha/);
  });
});
