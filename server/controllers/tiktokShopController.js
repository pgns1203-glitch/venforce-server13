function callbackTikTokShopController(req, res) {
  const code = req.query.code || req.query.auth_code;

  if (!code || String(code).trim() === "") {
    return res.status(400).send(
      `<html><body style="font-family:sans-serif;padding:2rem;">
        <h2>Erro</h2>
        <p>Parâmetro code ou auth_code não recebido.</p>
      </body></html>`
    );
  }

  return res.send(
    `<html><body style="font-family:sans-serif;text-align:center;padding:3rem;background:#f8f9fc;">
      <div style="max-width:420px;margin:0 auto;background:#fff;border-radius:16px;padding:2.5rem;box-shadow:0 4px 24px rgba(0,0,0,.08);">
        <div style="font-size:2.5rem;margin-bottom:1rem;">OK</div>
        <h2 style="margin:0 0 .5rem;color:#2d2d2d;">TikTok Shop autorizado</h2>
        <p style="color:#6b7280;margin:0;">Callback recebido com sucesso.</p>
      </div>
    </body></html>`
  );
}

module.exports = {
  callbackTikTokShopController,
};
