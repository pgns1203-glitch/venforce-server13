// Portal/clientes-contas-resumo.js
// -----------------------------------------------------------------------------
// Lógica PURA (sem DOM, sem fetch) usada por Portal/clientes.js para:
//
//   1. classificar o status operacional de UMA cliente_conta (grant ML /
//      base Shopee) — classificarStatusConta();
//   2. resumir TODAS as contas de um marketplace numa única linha compacta
//      pra coluna "Contas" de /clientes.html — resumirContasMarketplace();
//   3. controlar qual linha da tabela está expandida (só uma por vez) —
//      criarExpansaoUnica().
//
// Regra de cor (não é a de marketplace, é a de ESTADO — pedido explícito do
// Fechamento da Fase 1 da Fundação de Clientes/Contas):
//   verde  (saudavel)  = todas as contas ativas estão operacionais
//   amarelo (pendencia) = existe conta ativa sem operar, mas nenhuma "problema"
//   vermelho (problema) = existe grant com token_status inválido
//   cinza  (vazio)     = nenhuma conta ativa daquele marketplace
//
// "Operacional" depende do marketplace:
//   Mercado Livre → grant existe e token_status é 'valid'
//   Shopee        → existe base vinculada (conta.base.base_id)
// Conta inativa nunca conta pro total nem pro numerador.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_CLIENTES_CONTAS_RESUMO = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // grant == null            → sem grant / aguardando conexão
  // grant existe + valid     → conectado
  // grant existe + problema  → atenção (token_status indica erro/revogação)
  function classificarStatusConta(conta) {
    if (!conta || !conta.grant) {
      return { code: "sem_grant", label: "Aguardando grant", cls: "", symbol: "○" };
    }
    const status = String(conta.grant.token_status || "valid").toLowerCase();
    if (status === "valid") {
      return { code: "conectado", label: "Conectado", cls: "is-success", symbol: "●" };
    }
    return { code: "atencao", label: "Grant com problema", cls: "is-warning", symbol: "⚠" };
  }

  const LABELS = {
    meli: { singular: "conectada", plural: "conectadas" },
    shopee: { singular: "configurada", plural: "configuradas" },
  };

  // contas: só as contas DESTE marketplace (meli OU shopee), de UM cliente.
  // Devolve { state, symbol, texto, total, operacionais, pendentes, problemas }.
  //   state ∈ 'vazio' | 'saudavel' | 'pendencia' | 'problema'
  function resumirContasMarketplace(marketplace, contas) {
    const labels = LABELS[marketplace] || LABELS.meli;
    const ativas = (contas || []).filter((c) => c.ativo !== false);
    const total = ativas.length;

    if (total === 0) {
      return { state: "vazio", symbol: "○", texto: "nenhuma", total: 0, operacionais: 0, pendentes: 0, problemas: 0 };
    }

    let operacionais = 0;
    let pendentes = 0;
    let problemas = 0;

    if (marketplace === "meli") {
      for (const conta of ativas) {
        const status = classificarStatusConta(conta).code;
        if (status === "conectado") operacionais += 1;
        else if (status === "atencao") problemas += 1;
        else pendentes += 1;
      }
    } else {
      for (const conta of ativas) {
        if (conta.base && conta.base.base_id) operacionais += 1;
        else pendentes += 1;
      }
    }

    if (problemas > 0) {
      const partes = [`${operacionais} ${operacionais === 1 ? labels.singular : labels.plural}`, `${problemas} com problema`];
      if (pendentes) partes.push(`${pendentes} pendente${pendentes > 1 ? "s" : ""}`);
      return { state: "problema", symbol: "⚠", texto: partes.join(" · "), total, operacionais, pendentes, problemas };
    }

    if (operacionais === total) {
      const texto = total === 1 ? `${operacionais} ${labels.singular}` : `${operacionais}/${total} ${labels.plural}`;
      return { state: "saudavel", symbol: "●", texto, total, operacionais, pendentes, problemas };
    }

    const texto = total === 1 ? "pendente" : `${operacionais}/${total} ${labels.plural}`;
    return { state: "pendencia", symbol: "⚠", texto, total, operacionais, pendentes, problemas };
  }

  // Controla qual linha da tabela de clientes está expandida — nunca mais de
  // uma ao mesmo tempo (abrir a linha B recolhe a A automaticamente).
  function criarExpansaoUnica() {
    let atual = null;
    return {
      isExpandido: (id) => atual !== null && atual === id,
      // devolve o novo estado (id expandido, ou null se recolheu)
      toggle(id) {
        atual = atual === id ? null : id;
        return atual;
      },
      fechar() {
        const anterior = atual;
        atual = null;
        return anterior;
      },
      atual: () => atual,
    };
  }

  return { classificarStatusConta, resumirContasMarketplace, criarExpansaoUnica };
});
