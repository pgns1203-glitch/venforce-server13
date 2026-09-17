// server/tests/cliente360V3SaudeAdsService.test.js
//
// FASE 5A+5C (Projeto_cliente360) — Ads account-scoped real + Saúde leve por
// dimensão. Tudo com deps injetadas — NUNCA chama a API real do Mercado
// Livre nem o Postgres real.

const assert = require("assert");
const { obterAds, obterSaude } = require("../services/cliente360/cliente360V3SaudeAdsService");

let passed = 0;
const check = (n, c) => { assert.ok(c, `FALHOU: ${n}`); passed++; console.log(`  ok  ${n}`); };

(async () => {
  // ── obterAds ─────────────────────────────────────────────────────────────
  const naoMeli = await obterAds({ clienteSlug: "n97", marketplace: "shopee", competencia: "2026-08", clienteContaId: 10 });
  check("marketplace != meli → indisponível, código MARKETPLACE_NAO_SUPORTADO", naoMeli.disponivel === false && naoMeli.codigo === "MARKETPLACE_NAO_SUPORTADO");

  const semDados = await obterAds(
    { clienteSlug: "n97", marketplace: "meli", competencia: "2026-08", clienteContaId: 10 },
    { buscarPerformanceML: async () => ({ semDados: true, codigo: "NO_TOKEN", motivo: "Cliente sem token ML." }) }
  );
  check("performance sem dados → indisponível com o motivo/código REAIS da fonte, nunca genérico", semDados.disponivel === false && semDados.codigo === "NO_TOKEN" && semDados.motivo === "Cliente sem token ML.");

  const comDados = await obterAds(
    { clienteSlug: "n97", marketplace: "meli", competencia: "2026-08", clienteContaId: 10 },
    {
      buscarPerformanceML: async (slug, mesRef, janela, contaId) => {
        check("buscarPerformanceML recebe clienteContaId (nunca escolhe conta sozinho)", contaId === 10);
        return { investimentoAds: 4100, gmvAds: 100000, roas: 24.4, acos: 0.041, codigo: "OK" };
      },
    }
  );
  check("performance com dados → disponível, dados passam intactos (sem recálculo)", comDados.disponivel === true && comDados.dados.investimentoAds === 4100 && comDados.dados.roas === 24.4);
  check("escopo do bloco Ads é account (comprovado por conta, não client_legacy)", comDados.escopo === "account");

  // ── obterSaude ───────────────────────────────────────────────────────────
  const saude = await obterSaude(
    { clienteId: 1, clienteSlug: "n97", clienteContaId: 10, marketplace: "meli" },
    {
      listarContasDoCliente: async () => [
        { id: 10, grant_token_status: "valid", vinculo_base_slug: "base-n97" },
        { id: 11, grant_token_status: null, vinculo_base_slug: null },
      ],
      listarSyncRuns: async ({ clienteContaId }) => {
        check("listarSyncRuns recebe clienteContaId (dimensão account-aware)", clienteContaId === 10);
        return [{ id: 501, status: "success" }];
      },
      listarEntregas: async ({ query }) => {
        check("listarEntregas recebe cliente_conta_id (dimensão preferencialmente account-scoped)", query.cliente_conta_id === 10);
        return { entregas: [{ id: 9001, periodo: "2026-08", cliente_conta_id: 10 }] };
      },
    }
  );
  check("grantBase: dimensão própria, disponível, dados da CONTA certa (10, não 11)", saude.grantBase.disponivel === true && saude.grantBase.dados.grantConectado === true && saude.grantBase.dados.baseSlug === "base-n97");
  check("grantBase: escopo account", saude.grantBase.escopo === "account");
  check("sync: dimensão própria, disponível", saude.sync.disponivel === true && saude.sync.dados.ultimasExecucoes.length === 1);
  check("entrega desta conta (cliente_conta_id bate) → escopoEntrega account, rotulado por linha real", saude.entrega.dados.ultimaEntrega.id === 9001 && saude.entrega.dados.escopoEntrega === "account");

  // entrega LEGADA (cliente_conta_id NULL) → escopoEntrega client_legacy, nunca escondida nem reclassificada.
  const saudeComEntregaLegada = await obterSaude(
    { clienteId: 1, clienteSlug: "n97", clienteContaId: 10, marketplace: "meli" },
    {
      listarContasDoCliente: async () => [{ id: 10, grant_token_status: "valid", vinculo_base_slug: "base-n97" }],
      listarSyncRuns: async () => [],
      listarEntregas: async () => ({ entregas: [{ id: 9002, periodo: "2025-12", cliente_conta_id: null }] }),
    }
  );
  check("entrega legada (cliente_conta_id NULL) → escopoEntrega client_legacy", saudeComEntregaLegada.entrega.dados.escopoEntrega === "client_legacy");

  // ── falha parcial: uma dimensão falha, as outras sobrevivem ─────────────
  const saudeComFalha = await obterSaude(
    { clienteId: 1, clienteSlug: "n97", clienteContaId: 99, marketplace: "meli" },
    {
      listarContasDoCliente: async () => [{ id: 10, grant_token_status: "valid", vinculo_base_slug: "base-n97" }], // conta 99 não existe na lista
      listarSyncRuns: async () => [],
      listarEntregas: async () => ({ entregas: [] }),
    }
  );
  check("conta não encontrada na dimensão grantBase → indisponível, mas sync/entrega sobrevivem (falha parcial)",
    saudeComFalha.grantBase.disponivel === false && saudeComFalha.sync.disponivel === true && saudeComFalha.entrega.disponivel === true);
  check("sem entrega do período → ultimaEntrega null, nunca inventado", saudeComFalha.entrega.dados.ultimaEntrega === null);

  console.log(`\n${passed} verificações passaram. Ads account-scoped real (nunca escolhe conta) + Saúde em 3 dimensões independentes, cada uma com escopo/fonte próprios.`);
})().catch((e) => { console.error(e); process.exit(1); });
