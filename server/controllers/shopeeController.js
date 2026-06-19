function renderCallbackAtivo() {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Callback Shopee</title>
  </head>
  <body style="font-family:sans-serif;text-align:center;padding:3rem;background:#f8f9fc;">
    <main style="max-width:460px;margin:0 auto;background:#fff;border-radius:12px;padding:2.5rem;box-shadow:0 4px 24px rgba(0,0,0,.08);">
      <h1 style="margin:0 0 .75rem;color:#2d2d2d;font-size:1.75rem;">Callback Shopee ativo</h1>
      <p style="color:#6b7280;margin:0;">Aguardando redirecionamento de autorização.</p>
    </main>
  </body>
</html>`;
}

function renderCallbackRecebido() {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Callback Shopee</title>
  </head>
  <body style="font-family:sans-serif;text-align:center;padding:3rem;background:#f8f9fc;">
    <main style="max-width:460px;margin:0 auto;background:#fff;border-radius:12px;padding:2.5rem;box-shadow:0 4px 24px rgba(0,0,0,.08);">
      <h1 style="margin:0;color:#2d2d2d;font-size:1.75rem;">Callback Shopee recebido</h1>
    </main>
  </body>
</html>`;
}

function callbackShopeeController(req, res) {
  const code = req.query.code;

  if (!code || String(code).trim() === "") {
    return res.status(200).send(renderCallbackAtivo());
  }

  return res.status(200).send(renderCallbackRecebido());
}

module.exports = {
  callbackShopeeController,
};
