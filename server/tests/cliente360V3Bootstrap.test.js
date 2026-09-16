// server/tests/cliente360V3Bootstrap.test.js
//
// V3 FASE 1 — bootstrap da nova Cliente 360 V3 (server/services/cliente360/
// cliente360V3BootstrapService.js :: obterBootstrap).
//
// NOTA DE RECUPERAÇÃO: este arquivo existia antes com testes escritos para
// esta mesma unidade por outro trabalho em andamento no repositório — foi
// sobrescrito por engano nesta sessão (ver relatório de implementação,
// seção de achados da Fase 1) e o conteúdo original não pôde ser
// recuperado (arquivo nunca commitado). Este teste foi reescrito do zero
// LENDO o código real de cliente360V3BootstrapService.js — não é uma
// tentativa de reconstruir o teste original.
//
// Cobre o contrato observado na implementação real:
//   - conta (?conta=) é obrigatória, sem fallback "conta única resolve sozinha";
//   - periodo (?periodo=) é obrigatório e validado (PERIODO_OBRIGATORIO/PERIODO_INVALIDO,
//     server/utils/erroContextoCanonico.js);
//   - compararCom é opcional; quando ausente, default é o mês anterior ao período
//     (periodoUtils.competenciaAnteriorDe) — nunca null;
//   - conta de outro cliente / inativa propaga como erro real (403/409),
//     nunca como bloco "indisponível";
//   - capabilities e resultado são blocos independentes (bloco()): a falha
//     de UM não derruba o outro nem o bootstrap inteiro.
//
// Roda sem infra: node server/tests/cliente360V3Bootstrap.test.js

const assert = require("assert");
const { obterBootstrap } = require("../services/cliente360/cliente360V3BootstrapService");
const { criarContextKey } = require("../services/cliente360/cliente360V3ContextKey");

let passed = 0;
const check = (n, c) => { assert.ok(c, `FALHOU: ${n}`); passed++; console.log(`  ok  ${n}`); };

const CLIENTE_N97 = { id: 1, slug: "n97", nome: "N97 Comercial" };
const CONTA_10 = { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML Principal", ativo: true };
const CONTA_DE_OUTRO_CLIENTE = { id: 20, cliente_id: 2, marketplace: "meli", nome: "Outro", ativo: true };
const CONTA_INATIVA = { id: 99, cliente_id: 1, marketplace: "meli", nome: "Antiga", ativo: false };
const CONTAS_POR_ID = { 10: CONTA_10, 20: CONTA_DE_OUTRO_CLIENTE, 99: CONTA_INATIVA };

function depsFake(overrides = {}) {
  return {
    resolverClientePorIdOuSlug: async () => CLIENTE_N97,
    obterConta: async (id) => {
      const conta = CONTAS_POR_ID[Number(id)];
      if (!conta) { const e = new Error("Conta não encontrada."); e.statusCode = 404; throw e; }
      return conta;
    },
    sanitizarConta: (c) => c,
    getResultado: async () => ({ fechamento: {}, confianca: { nivel: "alta" } }),
    ...overrides,
  };
}

(async () => {
  // ── conta obrigatória ────────────────────────────────────────────────────
  let erroSemConta = null;
  try { await obterBootstrap({ clienteSlugRaw: "n97", competenciaRaw: "2026-08" }, depsFake()); }
  catch (e) { erroSemConta = e; }
  check("sem ?conta= → 400 (conta é obrigatória, sem fallback silencioso)", erroSemConta?.statusCode === 400);

  // ── periodo obrigatório e validado ──────────────────────────────────────
  let erroSemPeriodo = null;
  try { await obterBootstrap({ clienteSlugRaw: "n97", clienteContaIdRaw: 10 }, depsFake()); }
  catch (e) { erroSemPeriodo = e; }
  check("sem ?periodo= → 400 PERIODO_OBRIGATORIO", erroSemPeriodo?.statusCode === 400 && erroSemPeriodo.code === "PERIODO_OBRIGATORIO");

  let erroPeriodoInvalido = null;
  try { await obterBootstrap({ clienteSlugRaw: "n97", clienteContaIdRaw: 10, competenciaRaw: "não-é-periodo" }, depsFake()); }
  catch (e) { erroPeriodoInvalido = e; }
  check("periodo mal formatado → 400 PERIODO_INVALIDO", erroPeriodoInvalido?.statusCode === 400 && erroPeriodoInvalido.code === "PERIODO_INVALIDO");

  // ── conta rejeitada propaga como erro real (nunca escolhida em silêncio) ─
  let erroContaDeOutroCliente = null;
  try { await obterBootstrap({ clienteSlugRaw: "n97", clienteContaIdRaw: 20, competenciaRaw: "2026-08" }, depsFake()); }
  catch (e) { erroContaDeOutroCliente = e; }
  check("conta de outro cliente → 403 CONTA_NAO_PERTENCE_AO_CLIENTE", erroContaDeOutroCliente?.statusCode === 403 && erroContaDeOutroCliente.code === "CONTA_NAO_PERTENCE_AO_CLIENTE");

  let erroContaInativa = null;
  try { await obterBootstrap({ clienteSlugRaw: "n97", clienteContaIdRaw: 99, competenciaRaw: "2026-08" }, depsFake()); }
  catch (e) { erroContaInativa = e; }
  check("conta inativa → 409 CONTA_INATIVA", erroContaInativa?.statusCode === 409 && erroContaInativa.code === "CONTA_INATIVA");

  // ── caminho feliz ─────────────────────────────────────────────────────────
  const boot = await obterBootstrap({ clienteSlugRaw: "n97", clienteContaIdRaw: 10, competenciaRaw: "2026-08" }, depsFake());
  check("contexto: clienteContaId/marketplace vêm da CONTA, nunca de um parâmetro livre", boot.contexto.clienteContaId === 10 && boot.contexto.marketplace === "meli");
  check("contexto: competencia ecoada", boot.contexto.competencia === "2026-08");
  check("contexto: compararCom ausente vira o mês anterior por default (nunca null)", boot.contexto.compararCom === "2026-07");
  check("contexto: contextKey presente e é string", typeof boot.contexto.contextKey === "string" && boot.contexto.contextKey.length > 0);
  check("contexto: contextKey usa o algoritmo CANÔNICO de cliente360V3ContextKey.js (sem duplicação inline)",
    boot.contexto.contextKey === criarContextKey({ clienteId: 1, clienteContaId: 10, periodo: "2026-08", compararCom: "2026-07" }));
  check("capabilities: disponível, marketplace=meli, isMeli=true", boot.capabilities.disponivel === true && boot.capabilities.dados.isMeli === true);
  check("resultado: disponível com os dados do getResultado injetado", boot.resultado.disponivel === true && boot.resultado.dados.confianca.nivel === "alta");

  // ── compararCom explícito é respeitado ──────────────────────────────────
  const bootComComparacao = await obterBootstrap({ clienteSlugRaw: "n97", clienteContaIdRaw: 10, competenciaRaw: "2026-08", compararComRaw: "2026-05" }, depsFake());
  check("compararCom explícito é preservado (não é sobrescrito pelo default)", bootComComparacao.contexto.compararCom === "2026-05");

  // ── falha parcial: resultado falha, capabilities e contexto sobrevivem ──
  const erroResultado = new Error("Falha simulada ao montar o resultado.");
  erroResultado.code = "ERRO_SIMULADO_RESULTADO";
  const bootComFalhaParcial = await obterBootstrap(
    { clienteSlugRaw: "n97", clienteContaIdRaw: 10, competenciaRaw: "2026-08" },
    depsFake({ getResultado: async () => { throw erroResultado; } })
  );
  check("falha parcial: bootstrap NÃO lança (não derruba a página inteira)", bootComFalhaParcial && bootComFalhaParcial.contexto != null);
  check("falha parcial: resultado fica indisponível com o motivo/codigo reais", bootComFalhaParcial.resultado.disponivel === false && bootComFalhaParcial.resultado.codigo === "ERRO_SIMULADO_RESULTADO");
  check("falha parcial: capabilities continua disponível (falha foi só do OUTRO bloco)", bootComFalhaParcial.capabilities.disponivel === true);
  check("falha parcial: contexto continua íntegro", bootComFalhaParcial.contexto.clienteContaId === 10);

  console.log(`\n${passed} verificações passaram. Bootstrap V3: conta e período obrigatórios/validados, conta rejeitada nunca escolhida em silêncio, falha de um bloco não derruba o outro nem o contexto.`);
})().catch((e) => { console.error(e); process.exit(1); });
