// server/routes/cliente360ResultadoRoutes.js
// Rotas do cockpit de RESULTADO da Cliente 360 (a tela React).
//
// Montado em server/index.js no MESMO prefixo das rotas atuais da 360:
//   app.use("/operacao/cliente-360", cliente360ResultadoRoutes);   ← este, primeiro
//   app.use("/operacao/cliente-360", cliente360Routes);            ← o existente
//
// Todos os caminhos aqui são `/:slug/<sub>`, então não colidem com o `/:slug` puro
// do router legado. Registrar este antes deixa a intenção explícita e evita que
// uma futura rota curinga capture os subcaminhos.
//
// Permissões espelham as da Cliente 360 atual (nenhum modelo de acesso novo):
//   leitura         → authMiddleware + requireAutomacoesAccess (admin/user/membro)
//   simulação       → mesmo nível de leitura (não muta nada)
//   escrita de ação → authMiddleware + requireAdmin (admin only)

const express = require("express");
const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/cliente360ResultadoController");

const router = express.Router();

// Leitura
router.get("/:slug/resultado", authMiddleware, requireAutomacoesAccess, controller.obterResultado);
router.get("/:slug/elasticidades", authMiddleware, requireAutomacoesAccess, controller.obterElasticidades);
router.get("/:slug/placar", authMiddleware, requireAutomacoesAccess, controller.obterPlacar);
router.get("/:slug/acoes", authMiddleware, requireAutomacoesAccess, controller.listarAcoes);

// Simulação (leitura pesada, mas não persiste nada)
router.post("/:slug/resultado/simular", authMiddleware, requireAutomacoesAccess, controller.simularResultado);

// Escrita de ações do consultor (admin)
router.post("/:slug/acoes", authMiddleware, requireAdmin, controller.registrarAcao);
router.delete("/:slug/acoes/:id", authMiddleware, requireAdmin, controller.removerAcao);

module.exports = router;
