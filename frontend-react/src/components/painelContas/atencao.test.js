// Regras de "Merece atenção" (V4): só leitura do que o servidor já
// classificou — nenhum score, nenhum limiar financeiro.
import { describe, it, expect } from "vitest";
import { regrasAtencao, filaDeLancamento, contaAguardaLancamento } from "./atencao.js";

const conta = (over = {}) => ({
  id: 1, rotulo: "Mercado Livre 1 · X", marketplace: "meli", ativa: true,
  status: { codigo: "sincronizado", rotulo: "Sincronizado" }, resumo: { fat: 10 }, podeLancarManual: false, ...over,
});
const cliente = (over = {}) => ({
  id: 1, nome: "Cliente", status: { codigo: "sincronizado", precisaAtencao: false }, custos: null, contas: [conta()], ...over,
});

describe("regrasAtencao", () => {
  it("cliente completo não gera regra nenhuma", () => {
    expect(regrasAtencao([cliente()])).toEqual([]);
  });

  it("separa sem dados · aguardam lançamento · integração · parciais · custo, com a saída de cada uma", () => {
    const clientes = [
      cliente({ id: 1, nome: "Sem", status: { codigo: "sem_dados", motivo: "Mercado Livre não conectado" },
        contas: [conta({ id: 11, resumo: null, status: { codigo: "sem_conexao", motivo: "Mercado Livre não conectado" } })] }),
      cliente({ id: 2, nome: "Parc", status: { codigo: "parcial", motivo: "1 de 2 contas com dados" },
        contas: [conta({ id: 21 }), conta({ id: 22, marketplace: "shopee", resumo: null, podeLancarManual: true, status: { codigo: "sem_integracao" } })] }),
      cliente({ id: 3, nome: "Custo", custos: { estado: "parcial", cobertura: 0.9 } }),
    ];
    const regras = regrasAtencao(clientes);
    const porChave = Object.fromEntries(regras.map((r) => [r.chave, r]));
    expect(Object.keys(porChave)).toEqual(["sem_dados", "aguardam", "integracao", "parciais", "custo"]);
    expect(porChave.sem_dados.itens.map((i) => i.cliente.nome)).toEqual(["Sem"]);
    expect(porChave.sem_dados.acao).toMatchObject({ tipo: "filtrar", status: "sem_dados" });
    expect(porChave.aguardam.itens[0].contas.map((c) => c.id)).toEqual([22]);
    expect(porChave.aguardam.acao.tipo).toBe("fila");
    expect(porChave.integracao.itens[0].detalhe).toMatch(/não conectado/);
    expect(porChave.parciais.acao).toMatchObject({ tipo: "filtrar", status: "parcial" });
    expect(porChave.custo.itens.map((i) => i.cliente.nome)).toEqual(["Custo"]);
  });

  it("conta inativa ou sem permissão de lançar não entra em 'aguardam lançamento'", () => {
    expect(contaAguardaLancamento(conta({ resumo: null, status: { codigo: "sem_integracao" }, podeLancarManual: false }))).toBe(false);
    expect(contaAguardaLancamento(conta({ ativa: false, resumo: null, status: { codigo: "sem_integracao" }, podeLancarManual: true }))).toBe(false);
    expect(contaAguardaLancamento(conta({ resumo: null, status: { codigo: "sem_integracao" }, podeLancarManual: true }))).toBe(true);
  });
});

describe("filaDeLancamento", () => {
  it("lista as contas pendentes na ordem da tabela", () => {
    const pend = (id) => conta({ id, resumo: null, podeLancarManual: true, status: { codigo: "sem_integracao" } });
    const fila = filaDeLancamento([
      cliente({ id: 1, contas: [conta({ id: 10 }), pend(11)] }),
      cliente({ id: 2, contas: [pend(21), pend(22)] }),
    ]);
    expect(fila).toEqual([{ clienteId: 1, contaId: 11 }, { clienteId: 2, contaId: 21 }, { clienteId: 2, contaId: 22 }]);
  });
});
