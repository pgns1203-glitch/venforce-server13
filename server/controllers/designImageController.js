const service = require("../services/designImage/designImageService");
const validator = require("../services/designImage/designImageValidator");
const imageAiProvider = require("../services/ai/imageAiProvider");

// Segue o padrão dos demais controllers: status vem de err.statusCode, 5xx é
// logado e o corpo é sempre { ok:false, erro, codigo }. Nunca devolve stack
// nem caminho interno, e nunca loga o conteúdo da imagem.
function tratarErro(res, err, contexto) {
  const statusCode =
    Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400
      ? Number(err.statusCode)
      : 500;
  // Erro com `codigo` é previsto (validação, provedor ausente): a mensagem é
  // apresentável e não vira ruído no log. Sem `codigo` é falha inesperada:
  // registra no servidor e devolve texto genérico, sem stack nem caminho.
  const previsto = Boolean(err?.codigo);
  if (statusCode >= 500 && !previsto) console.error(`[designImage] ${contexto}:`, err?.message);
  return res.status(statusCode).json({
    ok: false,
    erro: previsto
      ? err.message
      : (statusCode >= 500 ? "Erro interno ao processar a imagem." : (err?.message || "Requisição inválida.")),
    codigo: err?.codigo || (statusCode >= 500 ? "ERRO_INTERNO" : "REQUISICAO_INVALIDA"),
  });
}

async function normalizarImagem(req, res) {
  try {
    const file = req.file;
    const imagem = await service.normalizarImagem(file);
    return res.json({
      ok: true,
      imagem: {
        ...imagem,
        fileName: validator.sanitizarNomeArquivo(file?.originalname, "imagem"),
      },
    });
  } catch (err) {
    return tratarErro(res, err, "normalizarImagem");
  }
}

async function obterCapacidades(req, res) {
  try {
    const estado = imageAiProvider.capacidades();
    return res.json({
      ok: true,
      provider: estado.provider,
      disponivel: estado.disponivel,
      motivo: estado.motivo,
      capacidades: estado.capacidades,
      processamento: { sharp: service.sharpDisponivel() },
    });
  } catch (err) {
    return tratarErro(res, err, "obterCapacidades");
  }
}

async function executarIa(req, res) {
  try {
    const operacao = String(req.params.operacao || "");
    if (!imageAiProvider.operacaoValida(operacao)) {
      const erro = new Error("Operação de IA não reconhecida.");
      erro.statusCode = 400;
      erro.codigo = "OPERACAO_DESCONHECIDA";
      throw erro;
    }
    const resultado = await imageAiProvider.executar(operacao, {
      dataUrl: req.body?.dataUrl,
      opcoes: req.body?.opcoes,
    });
    return res.json({ ok: true, imagem: resultado });
  } catch (err) {
    return tratarErro(res, err, "executarIa");
  }
}

module.exports = {
  normalizarImagem,
  obterCapacidades,
  executarIa,
};
