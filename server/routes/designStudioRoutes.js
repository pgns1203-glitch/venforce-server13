const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireDesignAccess } = require("../middlewares/accessMiddleware");
const controller = require("../controllers/designStudioController");

const router = express.Router();
router.use(authMiddleware, requireDesignAccess);

router.get("/clientes", controller.listClients);
router.get("/clientes/:clienteId", controller.getWorkspace);
router.put("/clientes/:clienteId/identidade", controller.updateIdentity);
router.post("/clientes/:clienteId/gerar-templates", controller.generateTemplates);
router.post("/clientes/:clienteId/:type(templates|artworks)", controller.createItem);
router.get("/clientes/:clienteId/:type(templates|artworks)/:id", controller.getItem);
router.put("/clientes/:clienteId/:type(templates|artworks)/:id", controller.updateItem);
router.post("/clientes/:clienteId/:type(templates|artworks)/:id/arquivar", controller.archiveItem);
router.post("/clientes/:clienteId/:type(templates|artworks)/:id/duplicar", controller.duplicateItem);
router.get("/clientes/:clienteId/:type(templates|artworks)/:id/versoes", controller.listVersions);
router.post("/clientes/:clienteId/:type(templates|artworks)/:id/versoes/:version/restaurar", controller.restoreVersion);

module.exports = router;
