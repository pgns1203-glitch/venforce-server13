// server/utils/fechamento/curvaAbcEntrada.js
// Contrato de entrada da Curva ABC anual (POST /fechamentos/compilar):
// de 1 a 12 planilhas de UM único marketplace (Shopee Performance ou
// Mercado Livre Vendas). O frontend valida o mesmo limite, mas o backend não
// depende dele.

const MAX_PLANILHAS_CURVA_ABC = 12;
const MARKETPLACES_CURVA_ABC = Object.freeze(["meli", "shopee"]);

function validarEntradaCurvaAbc(marketplaceRaw, quantidadeArquivos) {
  const marketplace = String(marketplaceRaw ?? "").trim().toLowerCase();

  if (!MARKETPLACES_CURVA_ABC.includes(marketplace)) {
    return { ok: false, erro: 'Marketplace inválido. Use "meli" ou "shopee".' };
  }
  if (!Number.isInteger(quantidadeArquivos) || quantidadeArquivos < 1) {
    return { ok: false, erro: "Nenhum arquivo enviado." };
  }
  if (quantidadeArquivos > MAX_PLANILHAS_CURVA_ABC) {
    return { ok: false, erro: `Selecione no máximo ${MAX_PLANILHAS_CURVA_ABC} planilhas.` };
  }

  return { ok: true, marketplace };
}

// multer entrega originalname decodificado como latin1: "março.xlsx" chega
// como "marÃ§o.xlsx". Recupera o UTF-8 original para citar o arquivo certo.
function nomeOriginalUtf8(file) {
  const nome = String(file?.originalname ?? "");
  const recuperado = Buffer.from(nome, "latin1").toString("utf8");
  return recuperado.includes("\uFFFD") ? nome : recuperado;
}

// Middleware de upload da rota: o limite de arquivos é aplicado pelo próprio
// multer (campo "files") e convertido numa resposta 400 legível, em vez de cair
// no handler global como erro genérico.
function criarMiddlewareUploadCurvaAbc(upload, MulterError) {
  const receber = upload.array("files", MAX_PLANILHAS_CURVA_ABC);

  return function uploadCurvaAbc(req, res, next) {
    receber(req, res, (err) => {
      if (!err) return next();
      if (err instanceof MulterError) {
        const erro = err.code === "LIMIT_UNEXPECTED_FILE"
          ? `Selecione no máximo ${MAX_PLANILHAS_CURVA_ABC} planilhas.`
          : `Erro no upload: ${err.message}`;
        return res.status(400).json({ ok: false, erro });
      }
      return next(err);
    });
  };
}

// Handler de POST /fechamentos/compilar (depois do upload). Valida a entrada,
// despacha para o compilador do marketplace e devolve a curva consolidada ou
// o erro com o nome do arquivo que falhou — nunca um resultado parcial.
function criarHandlerCompilarCurvaAbc({ gerarExcelBase64 }) {
  // require tardio: evita carregar os dois motores de planilha só para
  // validar entrada (e nos testes que usam apenas validarEntradaCurvaAbc).
  const { compilarFechamentos } = require("./process");
  const { compilarFechamentosMeli } = require("./meliConversaoService");

  return function compilarCurvaAbc(req, res) {
    const arquivos = req.files || [];
    const entrada = validarEntradaCurvaAbc(req.body?.marketplace, arquivos.length);

    if (!entrada.ok) {
      return res.status(400).json({ ok: false, erro: entrada.erro });
    }

    const buffers = arquivos.map((f) => f.buffer);
    const nomes = arquivos.map(nomeOriginalUtf8);

    const resultado = entrada.marketplace === "meli"
      ? compilarFechamentosMeli(buffers, nomes)
      : compilarFechamentos(buffers, nomes);

    if (resultado.error || resultado.erro) {
      return res.status(400).json({ ok: false, erro: resultado.error || resultado.erro });
    }

    const excelBase64 = gerarExcelBase64(resultado);

    return res.json({ data: resultado, excelBase64: excelBase64 || null });
  };
}

module.exports = {
  MAX_PLANILHAS_CURVA_ABC,
  MARKETPLACES_CURVA_ABC,
  validarEntradaCurvaAbc,
  nomeOriginalUtf8,
  criarMiddlewareUploadCurvaAbc,
  criarHandlerCompilarCurvaAbc,
};
