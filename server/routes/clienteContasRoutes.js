// server/routes/clienteContasRoutes.js
// Fundação de Contas do Marketplace (Fase 1) — cliente → cliente_conta.
//
// Leitura de metadados operacionais (cliente, conta, marketplace, ml_user_id,
// token_status, is_primary, base associada, ativo/inativo) fica disponível
// às roles internas (admin/user/membro), mesmo padrão de
// requireAutomacoesAccess usado em métricas/automações/Cliente 360 — para
// que Ads, Anúncios, Financeiro e Central de Margem possam reaproveitar
// esta API sem exigir admin só para ler. Nenhum destes endpoints retorna
// access_token/refresh_token (ver services/clienteContas/clienteContaService.js
// — cliente_contas nunca guarda tokens).
//
// Mutações (criar/editar/ativar/desativar/tornar principal/vincular base/
// desconectar grant) continuam admin-only.

const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const controller = require("../controllers/clienteContasController");

const router = express.Router();

router.use(authMiddleware);

// Leitura das contas de um cliente: além do gate de role, autorização real
// por carteira (V3 S4) — 403 CLIENTE_FORA_DA_CARTEIRA para cliente fora do
// Squad do usuário interno. Admin e seller (seller_clientes) inalterados.
router.get("/clientes/:cliente/contas", requireAutomacoesAccess, requireClienteNaCarteira("cliente"), controller.listar);
router.post("/clientes/:cliente/contas", requireAdmin, controller.criar);

router.get("/cliente-contas/:id", requireAutomacoesAccess, controller.obter);
router.patch("/cliente-contas/:id", requireAdmin, controller.atualizar);
router.patch("/cliente-contas/:id/principal", requireAdmin, controller.definirPrincipal);
router.get("/cliente-contas/:id/base", requireAutomacoesAccess, controller.obterBase);
router.get("/cliente-contas/:id/bases-elegiveis", requireAutomacoesAccess, controller.basesElegiveis);
router.put("/cliente-contas/:id/base", requireAdmin, controller.vincularBase);
router.delete("/cliente-contas/:id/ml-grant", requireAdmin, controller.desconectarMlGrant);

module.exports = router;
