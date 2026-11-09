// frontend-react/src/components/painelContas/atencao.js
//
// "Merece atenção" (V4): regras SIMPLES, sem score, sem diagnóstico novo.
// Cada regra só LÊ o que o servidor já classificou na lista do Painel
// (status do cliente, status de cada conta, `precisaAcao`, `custos.estado`) —
// nenhuma soma de dinheiro, nenhum limiar inventado.
//
// Fora daqui de propósito (não há fonte/limiar oficial hoje):
//   - margem baixa, TACoS elevado → dependem de um limiar definido pelo
//     negócio/backend; inventar aqui seria criar regra financeira no front.
//
// A lista de entrada é a MESMA que a tabela mostra (já recortada por
// seção/squad/busca/status no servidor) — a atenção fala do recorte visível.

// Mesmas causas acionáveis do servidor (painelContasOperacional.js
// CAUSAS_ACIONAVEIS), separadas em "lançar" × "integração" só para dizer a
// SAÍDA certa de cada uma.
const CAUSAS_INTEGRACAO = new Set(["sem_conexao", "erro_sync", "nao_publicado"]);

function contasAtivas(cliente) {
  return (cliente.contas || []).filter((c) => c.ativa);
}

// Conta que aguarda lançamento: sem integração automática, sem dado na
// competência e lançável por quem está vendo.
export function contaAguardaLancamento(conta) {
  return Boolean(conta.ativa && !conta.resumo && conta.status?.codigo === "sem_integracao" && conta.podeLancarManual);
}

export function regrasAtencao(clientes = []) {
  const semDados = [];
  const aguardam = [];
  const integracao = [];
  const parciais = [];
  const custo = [];

  for (const cliente of clientes) {
    const codigo = cliente.status?.codigo;
    const contas = contasAtivas(cliente);
    const pendentes = contas.filter(contaAguardaLancamento);
    const comProblema = contas.filter((c) => CAUSAS_INTEGRACAO.has(c.status?.codigo));

    if (codigo === "sem_dados" || codigo === "sem_conta") semDados.push({ cliente, detalhe: cliente.status?.motivo || null });
    if (pendentes.length) aguardam.push({ cliente, contas: pendentes, detalhe: pendentes.map((c) => c.rotulo).join(", ") });
    if (comProblema.length) {
      integracao.push({
        cliente,
        contas: comProblema,
        detalhe: comProblema.map((c) => `${c.rotulo}: ${c.status?.motivo || c.status?.rotulo}`).join(" · "),
      });
    }
    if (codigo === "parcial") parciais.push({ cliente, detalhe: cliente.status?.motivo || null });
    if (cliente.custos?.estado === "parcial") custo.push({ cliente, detalhe: "parte do FAT sem custo cadastrado" });
  }

  const regras = [
    {
      chave: "sem_dados",
      titulo: "Sem dados",
      explicacao: "nenhuma conta trouxe dado no mês",
      itens: semDados,
      acao: { tipo: "filtrar", status: "sem_dados", rotulo: "Filtrar" },
      forte: true,
    },
    {
      chave: "aguardam",
      titulo: "Aguardam lançamento",
      explicacao: "conta manual sem valores no mês",
      itens: aguardam,
      acao: { tipo: "fila", rotulo: "Abrir fila" },
      forte: true,
    },
    {
      chave: "integracao",
      titulo: "Problema de integração",
      explicacao: "conexão, sincronização ou publicação",
      itens: integracao,
      acao: { tipo: "abrir", rotulo: "Ver" },
      forte: true,
    },
    {
      chave: "parciais",
      titulo: "Dados parciais",
      explicacao: "parte das contas sem dado no mês",
      itens: parciais,
      acao: { tipo: "filtrar", status: "parcial", rotulo: "Filtrar" },
    },
    {
      chave: "custo",
      titulo: "Custo incompleto",
      explicacao: "LC/MC valem só para a parte com custo",
      itens: custo,
      acao: { tipo: "abrir", rotulo: "Ver" },
    },
  ];
  return regras.filter((r) => r.itens.length > 0);
}

// Fila de lançamento: cada conta pendente, na ordem da lista.
export function filaDeLancamento(clientes = []) {
  const fila = [];
  for (const cliente of clientes) {
    for (const conta of contasAtivas(cliente)) {
      if (contaAguardaLancamento(conta)) fila.push({ clienteId: cliente.id, contaId: conta.id });
    }
  }
  return fila;
}
