'use strict';

const express = require('express');
const clickupController = require('../controllers/clickupController');

const authMiddleware = require('../middlewares/authMiddleware');
const accessMiddleware = require('../middlewares/accessMiddleware');

const router = express.Router();

function pickMiddleware(moduleValue, possibleNames, label) {
  if (typeof moduleValue === 'function') return moduleValue;
  for (const name of possibleNames) {
    if (moduleValue && typeof moduleValue[name] === 'function') {
      return moduleValue[name];
    }
  }
  throw new Error(`[clickupRoutes] Middleware não encontrado: ${label}`);
}

const verifyToken = pickMiddleware(
  authMiddleware,
  ['authMiddleware', 'verifyToken', 'authenticateToken', 'requireAuth'],
  'JWT/auth'
);

const requireClickupAccess = pickMiddleware(
  {
    requireAutomacoesAccess: accessMiddleware && accessMiddleware.requireAutomacoesAccess,
    requireAdmin: authMiddleware && authMiddleware.requireAdmin,
  },
  ['requireAutomacoesAccess', 'requireAdmin'],
  'requireAutomacoesAccess ou requireAdmin'
);

// Camada 1 — resumo executivo rápido
// GET /api/clickup/executivo/resumo
router.get('/executivo/resumo', verifyToken, requireClickupAccess, clickupController.getResumoExecutivo);

// Camada 3 — comentários de uma tarefa, sob demanda
// GET /api/clickup/executivo/tarefas/:taskId/comentarios
router.get('/executivo/tarefas/:taskId/comentarios', verifyToken, requireClickupAccess, clickupController.getTaskComments);

module.exports = router;
