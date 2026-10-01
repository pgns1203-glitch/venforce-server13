// server/routes/painelContasRoutes.js
// Montado em server/index.js: app.use("/painel-contas", painelContasRoutes).
//
// Autorização SEMPRE no servidor (Auditoria §4/§15 — nunca "o cliente existe,
// logo acessa"). Papel: authMiddleware + requireAutomacoesAccess
// (admin/user/membro; seller/shopee_reviewer não entram). Depois:
//   LEITURA  → escopo próprio do Painel (painelContasAcesso: admin, coordenador
//              do Squad, gestor do cliente), independente de SQUADS_ENFORCEMENT;
//   ESCRITA  → carteira global (requireClienteNaCarteira) E o escopo do Painel
//              (no service) — interseção, nunca ampliação;
//   ATUALIZAR → admin + carteira, como antes.

const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const { requireClienteNoPainel } = require("../services/painelContas/painelContasAcesso");
const controller = require("../controllers/painelContasController");

const router = express.Router();
const naCarteira = requireClienteNaCarteira("clienteId");
const noPainel = requireClienteNoPainel("clienteId");

router.get("/", authMiddleware, requireAutomacoesAccess, controller.listar);
router.get("/:clienteId/meses", authMiddleware, requireAutomacoesAccess, noPainel, controller.listarMeses);
router.get("/:clienteId/meses/:competencia/semanas", authMiddleware, requireAutomacoesAccess, noPainel, controller.listarSemanas);
router.get("/:clienteId/contas/semanas", authMiddleware, requireAutomacoesAccess, noPainel, controller.listarSemanasDasContas);
// Lançamento manual por conta × competência. Mesmo gate de PUT
// /ads/resumo-mensal (o outro lançamento gerencial manual): papel de
// automações + cliente na carteira; o service ainda exige o escopo de leitura
// do Painel e que a conta pertença ao cliente do path.
const manual = "/:clienteId/contas/:contaId/manual/:competencia";
// Rastreabilidade (só leitura): competências lançadas da conta e a trilha de
// alterações de uma competência.
router.get("/:clienteId/contas/:contaId/manual", authMiddleware, requireAutomacoesAccess, noPainel, controller.listarLancamentosDaConta);
router.get(`${manual}/historico`, authMiddleware, requireAutomacoesAccess, noPainel, controller.listarHistoricoLancamento);
router.put(manual, authMiddleware, requireAutomacoesAccess, naCarteira, controller.salvarLancamentoManual);
router.delete(manual, authMiddleware, requireAutomacoesAccess, naCarteira, controller.removerLancamentoManual);
// Atualização sob demanda (cliente × competência). Dispara sync no Mercado
// Livre: MESMO gate de POST /central-vendas/:slug/sync-runs (admin + carteira)
// — nenhuma regra de autorização nova.
const atualizar = "/:clienteId/atualizar/:competencia";
router.post(atualizar, authMiddleware, requireAdmin, naCarteira, controller.iniciarAtualizacao);
router.get(atualizar, authMiddleware, requireAdmin, naCarteira, controller.obterAtualizacao);

module.exports = router;
