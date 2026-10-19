// server/routes/painelContasRoutes.js
// Montado em server/index.js: app.use("/painel-contas", painelContasRoutes).
//
// Autorização SEMPRE no servidor (Auditoria §4/§15 — nunca "o cliente existe,
// logo acessa"). Papel: authMiddleware + requirePainelContasAccess (admin e
// papéis internos, inclusive `interno`; seller/shopee_reviewer não entram).
// Gate próprio do Painel: requirePainelContasAccess não aceita `interno` e não
// foi ampliado. Depois:
//   LEITURA  → escopo do Painel (painelContasAcesso: clientes dos Squads em
//              que o usuário tem membership ativa), independente de
//              SQUADS_ENFORCEMENT;
//   ESCRITA  → escopo do Painel E a carteira global (requireClienteNaCarteira)
//              — interseção, nunca ampliação; o service repete as duas e exige
//              que a conta pertença ao cliente do path;
//   ATUALIZAR → admin + carteira, como antes.

const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const { requireClienteNoPainel, requirePainelContasAccess } = require("../services/painelContas/painelContasAcesso");
const controller = require("../controllers/painelContasController");

const router = express.Router();
const naCarteira = requireClienteNaCarteira("clienteId");
const noPainel = requireClienteNoPainel("clienteId");

router.get("/", authMiddleware, requirePainelContasAccess, controller.listar);
router.get("/:clienteId/meses", authMiddleware, requirePainelContasAccess, noPainel, controller.listarMeses);
router.get("/:clienteId/meses/:competencia/semanas", authMiddleware, requirePainelContasAccess, noPainel, controller.listarSemanas);
router.get("/:clienteId/contas/semanas", authMiddleware, requirePainelContasAccess, noPainel, controller.listarSemanasDasContas);
router.get("/:clienteId/contas/composicao", authMiddleware, requirePainelContasAccess, noPainel, controller.listarComposicaoDasContas);
// Lançamento manual por conta × competência: papel do Painel + cliente no
// escopo do Painel + cliente na carteira global; o service repete as duas
// checagens e exige que a conta pertença ao cliente do path.
const manual = "/:clienteId/contas/:contaId/manual/:competencia";
// Rastreabilidade (só leitura): competências lançadas da conta e a trilha de
// alterações de uma competência.
router.get("/:clienteId/contas/:contaId/manual", authMiddleware, requirePainelContasAccess, noPainel, controller.listarLancamentosDaConta);
router.get(`${manual}/historico`, authMiddleware, requirePainelContasAccess, noPainel, controller.listarHistoricoLancamento);
router.put(manual, authMiddleware, requirePainelContasAccess, noPainel, naCarteira, controller.salvarLancamentoManual);
router.delete(manual, authMiddleware, requirePainelContasAccess, noPainel, naCarteira, controller.removerLancamentoManual);
// Atualização sob demanda (cliente × competência). Dispara sync no Mercado
// Livre: MESMO gate de POST /central-vendas/:slug/sync-runs (admin + carteira)
// — nenhuma regra de autorização nova.
const atualizar = "/:clienteId/atualizar/:competencia";
router.post(atualizar, authMiddleware, requireAdmin, naCarteira, controller.iniciarAtualizacao);
router.get(atualizar, authMiddleware, requireAdmin, naCarteira, controller.obterAtualizacao);

module.exports = router;
