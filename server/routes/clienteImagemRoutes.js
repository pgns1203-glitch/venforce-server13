// server/routes/clienteImagemRoutes.js
// Montado em server/index.js: app.use("/cliente-imagens", clienteImagemRoutes).
//
// Imagem (avatar) do Cliente na tela Clientes e Contas. Rotas ADITIVAS — não
// alteram nenhuma rota existente de /clientes.
//
//   GET    /cliente-imagens              imagens da carteira do usuário
//   PUT    /cliente-imagens/:cliente     salva/troca  { imagem: "data:image/...;base64,..." }
//   DELETE /cliente-imagens/:cliente     remove
//
// Qualquer usuário interno (admin/user/membro) pode trocar a imagem de um
// cliente QUE ENXERGA — decisão de produto: é só identificação visual. O
// acesso ao cliente é o mesmo seam dos outros módulos (requireClienteNaCarteira).
// authMiddleware é por rota, nunca router.use() global (ver
// tests/clienteContasAuthPerRoute.test.js).

const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const service = require("../services/clienteImagens/clienteImagemService");

const router = express.Router();
const carteira = requireClienteNaCarteira("cliente");

function erro(res, err) {
  const status = err.statusCode || 500;
  if (status >= 500) console.error("[cliente-imagens]", err);
  return res.status(status).json({
    ok: false,
    erro: status >= 500 ? "Não foi possível concluir a operação com a imagem." : err.message,
    code: err.code,
  });
}

router.get("/", authMiddleware, requireAutomacoesAccess, async (req, res) => {
  try {
    const rows = await service.listarImagens(req.user || {});
    return res.json({
      ok: true,
      imagens: rows.map((r) => ({ clienteId: Number(r.cliente_id), imagem: r.imagem, atualizadoEm: r.atualizado_em })),
    });
  } catch (err) {
    return erro(res, err);
  }
});

router.put("/:cliente", authMiddleware, requireAutomacoesAccess, carteira, async (req, res) => {
  try {
    const row = await service.salvarImagem(req.clienteAutorizado?.id, req.body?.imagem, req.user?.id);
    return res.json({ ok: true, imagem: { clienteId: Number(row.cliente_id), imagem: row.imagem, atualizadoEm: row.atualizado_em } });
  } catch (err) {
    return erro(res, err);
  }
});

router.delete("/:cliente", authMiddleware, requireAutomacoesAccess, carteira, async (req, res) => {
  try {
    const r = await service.removerImagem(req.clienteAutorizado?.id);
    return res.json({ ok: true, ...r });
  } catch (err) {
    return erro(res, err);
  }
});

module.exports = router;
