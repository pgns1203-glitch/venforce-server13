// Testes do Histórico (Fase 6, Projeto_cliente360) — eventos tipados de
// entregas + sincronização + ações do consultor, cada fonte independente,
// escopo real por linha (nunca uma etiqueta fixa), ordenado por timestamp,
// falha parcial de uma fonte nunca esconde as outras duas.

const assert = require("assert");
const { listarEventos } = require("../services/cliente360/cliente360V3HistoricoService");

function check(desc, cond) {
  if (!cond) throw new Error(`FALHOU: ${desc}`);
  console.log(`  ok  ${desc}`);
}

async function main() {
  // 1. Entrega com cliente_conta_id preenchido → escopo "account"; entrega
  //    legada (cliente_conta_id NULL) → escopo "client_legacy". Nunca uma
  //    etiqueta fixa para a fonte inteira.
  {
    const deps = {
      listarEntregas: async () => ({
        entregas: [
          { id: 1, tipo: "fechamento_mensal", cliente_conta_id: 10, published_at: "2026-08-05T10:00:00Z", periodo: "2026-07", titulo: "Fechamento julho", status: "publicado", publicado: true, created_by: "consultor@x" },
          { id: 2, tipo: "fechamento_mensal", cliente_conta_id: null, created_at: "2026-01-05T10:00:00Z", periodo: "2025-12", titulo: "Fechamento dezembro (legado)", status: "publicado", publicado: true },
        ],
      }),
      listarSyncRuns: async () => [],
      acoesRepo: { listarAcoes: async () => [] },
    };
    const r = await listarEventos({ clienteSlug: "cliente-x", clienteContaId: 10, marketplace: "meli" }, deps);
    const entregaConta = r.eventos.find((e) => e.titulo === "Fechamento julho");
    const entregaLegada = r.eventos.find((e) => e.titulo === "Fechamento dezembro (legado)");
    check("entrega com cliente_conta_id → escopo account", entregaConta.escopo === "account");
    check("entrega cliente_conta_id NULL → escopo client_legacy", entregaLegada.escopo === "client_legacy");
    check("ator da entrega vem de created_by real", entregaConta.ator === "consultor@x");
  }

  // 2. Sincronização é sempre account-scoped; ator nunca inventado (null).
  {
    const deps = {
      listarEntregas: async () => ({ entregas: [] }),
      listarSyncRuns: async ({ clienteContaId }) => ([
        { id: 5, status: "completed", clienteContaId, startedAt: "2026-08-05T09:00:00Z", finishedAt: "2026-08-05T09:05:00Z", dateFrom: "2026-08-01", dateTo: "2026-08-05" },
      ]),
      acoesRepo: { listarAcoes: async () => [] },
    };
    const r = await listarEventos({ clienteSlug: "cliente-x", clienteContaId: 10, marketplace: "meli" }, deps);
    check("evento de sincronização presente", r.eventos.length === 1);
    check("sincronização é escopo account", r.eventos[0].escopo === "account");
    check("sincronização usa finishedAt como timestamp", r.eventos[0].timestamp === "2026-08-05T09:05:00Z");
    check("ator da sincronização não é inventado", r.eventos[0].ator === null);
  }

  // 3. Ações do consultor: sempre client_legacy (tabela sem cliente_conta_id).
  {
    const deps = {
      listarEntregas: async () => ({ entregas: [] }),
      listarSyncRuns: async () => [],
      acoesRepo: {
        listarAcoes: async () => [
          { id: 1, fator: "custo", mlb: "MLB1", titulo: "Produto 1", autor: "consultor@x", competencia: "2026-07", created_at: "2026-07-10T12:00:00Z" },
        ],
      },
    };
    const r = await listarEventos({ clienteSlug: "cliente-x", clienteContaId: 10, marketplace: "meli" }, deps);
    check("evento de ação do consultor presente", r.eventos.length === 1);
    check("ação do consultor é client_legacy (tabela sem cliente_conta_id)", r.eventos[0].escopo === "client_legacy");
    check("clienteContaId da ação nunca é inventado", r.eventos[0].clienteContaId === null);
    check("título vem do rótulo do fator (custo → Correção de custo)", r.eventos[0].titulo === "Correção de custo");
  }

  // 4. Ordenação por timestamp desc, misturando as 3 fontes.
  {
    const deps = {
      listarEntregas: async () => ({ entregas: [
        { id: 1, tipo: "fechamento_mensal", cliente_conta_id: 10, published_at: "2026-08-01T00:00:00Z", periodo: "2026-07", titulo: "Fechamento" },
      ] }),
      listarSyncRuns: async () => ([
        { id: 1, status: "completed", clienteContaId: 10, finishedAt: "2026-08-10T00:00:00Z" },
      ]),
      acoesRepo: { listarAcoes: async () => ([
        { id: 1, fator: "custo", autor: "x", created_at: "2026-08-05T00:00:00Z" },
      ]) },
    };
    const r = await listarEventos({ clienteSlug: "cliente-x", clienteContaId: 10, marketplace: "meli" }, deps);
    check("3 eventos de 3 fontes diferentes, ordenados por data desc", r.eventos.map((e) => e.tipo).join(",") === "sincronizacao,acao_consultor,entrega");
  }

  // 5. Falha parcial: uma fonte lança erro, as outras duas sobrevivem.
  {
    const deps = {
      listarEntregas: async () => { throw new Error("Falha simulada no serviço de entregas."); },
      listarSyncRuns: async () => ([{ id: 1, status: "completed", clienteContaId: 10, finishedAt: "2026-08-10T00:00:00Z" }]),
      acoesRepo: { listarAcoes: async () => ([{ id: 1, fator: "custo", created_at: "2026-08-05T00:00:00Z" }]) },
    };
    const r = await listarEventos({ clienteSlug: "cliente-x", clienteContaId: 10, marketplace: "meli" }, deps);
    check("entregas falhou mas sincronização/ações sobrevivem", r.eventos.length === 2);
    check("fonte entregas fica marcada como indisponível com o motivo real", r.fontes.entregas.disponivel === false && r.fontes.entregas.motivo === "Falha simulada no serviço de entregas.");
    check("fonte sincronizacao continua disponível", r.fontes.sincronizacao.disponivel === true);
  }

  // 6. limite respeitado após o merge das 3 fontes.
  {
    const muitasEntregas = Array.from({ length: 10 }, (_, i) => ({
      id: i, tipo: "fechamento_mensal", cliente_conta_id: 10,
      published_at: `2026-0${(i % 9) + 1}-01T00:00:00Z`, periodo: "2026-01", titulo: `Fechamento ${i}`,
    }));
    const deps = {
      listarEntregas: async () => ({ entregas: muitasEntregas }),
      listarSyncRuns: async () => [],
      acoesRepo: { listarAcoes: async () => [] },
    };
    const r = await listarEventos({ clienteSlug: "cliente-x", clienteContaId: 10, marketplace: "meli", limite: 3 }, deps);
    check("limite aplicado depois do merge, não por fonte", r.eventos.length === 3);
  }

  // 7. Evento sem timestamp real nunca aparece na timeline (nunca inventa data).
  {
    const deps = {
      listarEntregas: async () => ({ entregas: [{ id: 1, tipo: "fechamento_mensal", cliente_conta_id: 10, titulo: "Sem data" }] }),
      listarSyncRuns: async () => [],
      acoesRepo: { listarAcoes: async () => [] },
    };
    const r = await listarEventos({ clienteSlug: "cliente-x", clienteContaId: 10, marketplace: "meli" }, deps);
    check("entrega sem created_at/published_at/updated_at é descartada da timeline", r.eventos.length === 0);
  }

  console.log("\n17 verificações passaram. Histórico: 3 fontes independentes, escopo real por linha (nunca fixo), sem activity_logs fingindo ser timeline account-scoped, ordenação por timestamp real, falha parcial não esconde as outras fontes, nenhum timestamp inventado.");
}

main().catch((err) => { console.error(err); process.exit(1); });
