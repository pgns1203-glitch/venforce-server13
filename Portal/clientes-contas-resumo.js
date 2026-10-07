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

  // ── Diagnóstico por conta (tela Clientes e Contas, layout lista+painel) ──
  // Traduz o estado técnico (grant/token_status/base/ativo) em linguagem de
  // operação: um rótulo, um tom (success|warning|danger|neutral), uma
  // prioridade (2 = problema, 1 = pendência, 0 = ok, -1 = fora da operação)
  // e a lista "o que está ok" (Conexão / Base / Status).
  //
  // Diferença deliberada em relação a resumirContasMarketplace(): aqui uma
  // conta Mercado Livre conectada SEM base conta como pendência, porque sem
  // base margem e fechamento não calculam — é exatamente a etiqueta
  // "Base não definida" que a tela antiga já mostrava no card.
  function check(chave, label, tom, texto) {
    return { chave, label, tom, texto };
  }

  function diagnosticarConta(conta) {
    const c = conta || {};
    const mp = c.marketplace;
    const ativa = c.ativo !== false;
    const temBase = !!(c.base && c.base.base_id);
    const nomeBase = temBase ? (c.base.nome || c.base.slug || `Base #${c.base.base_id}`) : null;

    const checkBase = mp === "tiktok"
      ? check("base", "Base", "na", "Não se aplica")
      : temBase
        ? check("base", "Base", "ok", nomeBase)
        : check("base", "Base", ativa ? "warn" : "na", "Nenhuma base definida");
    const checkStatus = ativa
      ? check("status", "Status", "ok", "Ativa")
      : check("status", "Status", "na", "Desativada");

    if (!ativa) {
      const conexao = mp === "meli" && c.grant
        ? check("conexao", "Conexão", "na", "Conectada, mas fora da operação")
        : check("conexao", "Conexão", "na", "Conta desativada");
      return {
        code: "desativada", tom: "neutral", prioridade: -1, label: "Desativada",
        dica: "Fora da operação. Pode ser reativada quando quiser.",
        checks: [conexao, checkBase, checkStatus],
      };
    }

    if (mp === "tiktok") {
      return {
        code: "manual", tom: "neutral", prioridade: 0, label: "Lançamento manual",
        dica: "Sem integração: os números entram pelo Painel de Contas.",
        checks: [check("conexao", "Conexão", "na", "Sem integração"), checkBase, checkStatus],
      };
    }

    if (mp === "meli") {
      const grant = classificarStatusConta(c).code;
      if (grant === "sem_grant") {
        const jaConectou = !!c.external_account_id;
        return {
          code: jaConectou ? "desconectada" : "sem_grant",
          tom: "warning", prioridade: 1,
          label: jaConectou ? "Desconectada do Mercado Livre" : "Aguardando conexão",
          dica: jaConectou
            ? "A conexão foi removida. A reconexão precisa usar a mesma conta do Mercado Livre."
            : "A conta ainda não foi autorizada no Mercado Livre. Dá para conectar direto ou enviar o link para o cliente.",
          checks: [
            check("conexao", "Conexão", "warn", jaConectou ? "Desconectada" : "Ainda não autorizada"),
            checkBase, checkStatus,
          ],
        };
      }
      if (grant === "atencao") {
        return {
          code: "grant_problema", tom: "danger", prioridade: 2, label: "Conexão com problema",
          dica: "Os dados desta conta podem ter parado de atualizar até ela ser reconectada.",
          checks: [check("conexao", "Conexão", "bad", "Precisa reconectar"), checkBase, checkStatus],
        };
      }
      const conexaoOk = check("conexao", "Conexão", "ok", "Funcionando");
      if (!temBase) {
        return {
          code: "sem_base", tom: "warning", prioridade: 1, label: "Falta definir a base de custos",
          dica: "Sem base, margem e fechamento não calculam.",
          checks: [conexaoOk, checkBase, checkStatus],
        };
      }
      return {
        code: "pronta", tom: "success", prioridade: 0, label: "Pronta para operar",
        dica: "", checks: [conexaoOk, checkBase, checkStatus],
      };
    }

    // Shopee (e qualquer marketplace sem grant próprio): a saúde é a base.
    const conexaoNa = check("conexao", "Conexão", "na", "Sem conexão por API");
    if (!temBase) {
      return {
        code: "sem_base", tom: "warning", prioridade: 1, label: "Falta definir a base de custos",
        dica: "Sem base, margem e fechamento não calculam.",
        checks: [conexaoNa, checkBase, checkStatus],
      };
    }
    return {
      code: "pronta", tom: "success", prioridade: 0, label: "Pronta para operar",
      dica: "", checks: [conexaoNa, checkBase, checkStatus],
    };
  }

  // Resumo do cliente inteiro a partir das contas (só as ativas contam).
  //   code ∈ 'sem_contas' | 'problema' | 'pendencia' | 'pronto'
  function diagnosticarCliente(contas) {
    const ativas = (contas || []).filter((c) => c && c.ativo !== false);
    const total = ativas.length;
    if (!total) {
      return {
        code: "sem_contas", tom: "neutral", label: "Sem contas", curto: "Sem contas",
        descricao: "Nenhuma conta ativa. Adicione a conta de um marketplace para começar a operar.",
        total: 0, prontas: 0, pendencias: 0, problemas: 0,
      };
    }
    let problemas = 0;
    let pendencias = 0;
    for (const conta of ativas) {
      const p = diagnosticarConta(conta).prioridade;
      if (p === 2) problemas += 1;
      else if (p === 1) pendencias += 1;
    }
    const prontas = total - problemas - pendencias;
    const base = `${prontas} de ${total} ${total === 1 ? "conta pronta" : "contas prontas"}.`;
    if (problemas) {
      return {
        code: "problema", tom: "danger", label: "Precisa de atenção",
        curto: problemas === 1 ? "1 problema" : `${problemas} problemas`,
        descricao: `${base} ${problemas === 1 ? "Uma conexão está" : `${problemas} conexões estão`} com problema.`,
        total, prontas, pendencias, problemas,
      };
    }
    if (pendencias) {
      const rotulo = pendencias === 1 ? "1 pendência" : `${pendencias} pendências`;
      return {
        code: "pendencia", tom: "warning", label: rotulo, curto: rotulo,
        descricao: `${base} Resolva o que falta abaixo para liberar margem e fechamento.`,
        total, prontas, pendencias, problemas,
      };
    }
    return {
      code: "pronto", tom: "success", label: "Tudo pronto", curto: "Pronto",
      descricao: `${base} Nenhuma ação necessária.`,
      total, prontas, pendencias, problemas,
    };
  }

  return {
    classificarStatusConta,
    resumirContasMarketplace,
    criarExpansaoUnica,
    diagnosticarConta,
    diagnosticarCliente,
  };
});
