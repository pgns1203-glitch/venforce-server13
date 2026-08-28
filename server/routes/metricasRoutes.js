// server/routes/metricasRoutes.js
// Montagem esperada em server/index.js:
//   const metricasRoutes = require('./routes/metricasRoutes');
//   app.use('/metricas', metricasRoutes);
//
// Proteção: authMiddleware + requireAutomacoesAccess (mesmo padrão de anuncios-meli).
const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middlewares/authMiddleware');
const { requireAutomacoesAccess } = require('../middlewares/accessMiddleware');
const { requireClienteNaCarteira } = require('../middlewares/carteiraMiddleware');
const ctrl = require('../controllers/metricasController');

router.use(authMiddleware, requireAutomacoesAccess);

// P2.1 — seam de carteira no router: as rotas com `clienteSlug` (só /resumo)
// são validadas; /clientes (lista global) passa direto (sem clienteSlug).
router.use(requireClienteNaCarteira({ query: 'clienteSlug', body: 'clienteSlug' }));

router.get('/clientes', ctrl.clientes);
router.get('/resumo',   ctrl.resumo);

module.exports = router;
