// server/services/designImage/designImageService.js
// -----------------------------------------------------------------------------
// Normalização de imagem com Sharp para o Estúdio de Templates.
//
// O que este service garante para o editor do navegador:
//   • orientação EXIF já aplicada (foto de celular deitada chega em pé);
//   • metadados removidos (EXIF/GPS não vazam para o cliente final);
//   • dimensão máxima de 1600 px no maior lado, sem ampliar imagens pequenas;
//   • transparência preservada (PNG entra com alfa, sai PNG com alfa);
//   • data URL pronto para o canvas, sem risco de "tainted canvas".
//
// IMPORTANTE — armazenamento: nada é gravado em disco. O disco do Render é
// efêmero (some a cada deploy), então fingir persistência seria mentira. O
// endpoint processa e devolve; quem guarda é o navegador (IndexedDB).
// -----------------------------------------------------------------------------

const validator = require("./designImageValidator");

// Sharp é binário nativo. Carregar sob demanda evita derrubar o servidor
// inteiro no boot caso o build da plataforma não tenha produzido o binário.
let sharpModule;
let sharpErro = null;

function getSharp() {
  if (sharpModule) return sharpModule;
  if (sharpErro) throw sharpErro;
  try {
    // eslint-disable-next-line global-require
    sharpModule = require("sharp");
    return sharpModule;
  } catch (error) {
    sharpErro = validator.erroValidacao(
      "SHARP_INDISPONIVEL",
      "O processamento de imagens não está disponível neste servidor.",
      503
    );
    console.error("[designImage] sharp indisponível:", error && error.message);
    throw sharpErro;
  }
}

function sharpDisponivel() {
  try {
    getSharp();
    return true;
  } catch {
    return false;
  }
}

const QUALIDADE_JPEG = 86;
const QUALIDADE_WEBP = 88;

// Abaixo disso a arte de 1200x1200 fica visivelmente macia; a tela avisa.
const LIMITE_BAIXA_RESOLUCAO = 600;

function paraDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

// Escolhe o formato de saída.
//
// Com alfa a saída é sempre PNG, mesmo quando a entrada é WebP: a imagem acaba
// dentro de um <image href="data:..."> de um SVG que é rasterizado em canvas, e
// PNG é o formato com suporte universal nesse caminho. Sem alfa, JPEG é bem
// menor e a peça final é opaca de qualquer jeito.
function escolherSaida(formatoEntrada, temAlfa) {
  if (temAlfa) return "png";
  return "jpeg";
}

function aplicarSaida(pipeline, formatoSaida) {
  if (formatoSaida === "png") {
    return pipeline.png({ compressionLevel: 9, palette: false });
  }
  if (formatoSaida === "webp") {
    return pipeline.webp({ quality: QUALIDADE_WEBP, alphaQuality: 100 });
  }
  return pipeline.jpeg({ quality: QUALIDADE_JPEG, progressive: true, chromaSubsampling: "4:4:4" });
}

// Normaliza o arquivo recebido pelo Multer (memoryStorage).
//
// Retorna:
// {
//   dataUrl, mimeType, formato, width, height, bytes,
//   temTransparencia, redimensionada, orientacaoCorrigida, baixaResolucao,
//   original: { width, height, formato, bytes }
// }
//
// Lança erros com { codigo, statusCode } — o controller só traduz para HTTP.
async function normalizarImagem(file, options) {
  const { formato, bytes } = validator.validarUpload(file);
  const sharp = getSharp();
  const maxDimensao = Number(options && options.maxDimensao) > 0
    ? Number(options.maxDimensao)
    : validator.MAX_DIMENSION;

  let metadata;
  try {
    metadata = await sharp(file.buffer, { limitInputPixels: validator.MAX_INPUT_PIXELS })
      .metadata();
  } catch (error) {
    // limitInputPixels estourado ou arquivo corrompido depois do cabeçalho.
    if (/pixel|limitInputPixels/i.test(String(error && error.message))) {
      throw validator.erroValidacao(
        "IMAGEM_EXCESSIVA",
        "A imagem tem resolução alta demais para ser processada.",
        413
      );
    }
    throw validator.erroValidacao(
      "CONTEUDO_INVALIDO",
      "Não foi possível decodificar a imagem enviada."
    );
  }

  // EXIF Orientation 5..8 troca largura e altura depois do .rotate().
  const orientacao = Number(metadata.orientation) || 1;
  const trocaEixos = orientacao >= 5 && orientacao <= 8;
  const larguraOriginal = trocaEixos ? metadata.height : metadata.width;
  const alturaOriginal = trocaEixos ? metadata.width : metadata.height;

  validator.validarDimensoes({ width: larguraOriginal, height: alturaOriginal });

  const temAlfa = metadata.hasAlpha === true;
  const formatoSaida = escolherSaida(formato, temAlfa);
  const precisaReduzir = Math.max(larguraOriginal, alturaOriginal) > maxDimensao;

  let pipeline = sharp(file.buffer, { limitInputPixels: validator.MAX_INPUT_PIXELS })
    // .rotate() sem argumento = aplicar a orientação EXIF e zerá-la.
    .rotate();

  if (precisaReduzir) {
    pipeline = pipeline.resize({
      width: maxDimensao,
      height: maxDimensao,
      fit: "inside",
      // Nunca ampliar: esticar uma foto ruim não melhora a arte e só pesa.
      withoutEnlargement: true,
    });
  }

  // Sem .withMetadata(): o Sharp descarta EXIF/ICC/GPS por padrão.
  const saida = await aplicarSaida(pipeline, formatoSaida).toBuffer({ resolveWithObject: true });

  const mimeType = validator.MIME_POR_FORMATO[formatoSaida];
  const width = saida.info.width;
  const height = saida.info.height;

  return {
    dataUrl: paraDataUrl(saida.data, mimeType),
    mimeType,
    formato: formatoSaida,
    width,
    height,
    bytes: saida.data.length,
    temTransparencia: temAlfa,
    redimensionada: width !== larguraOriginal || height !== alturaOriginal,
    orientacaoCorrigida: orientacao > 1,
    baixaResolucao: Math.min(width, height) < LIMITE_BAIXA_RESOLUCAO,
    original: {
      width: larguraOriginal,
      height: alturaOriginal,
      formato,
      bytes,
    },
  };
}

module.exports = {
  LIMITE_BAIXA_RESOLUCAO,
  QUALIDADE_JPEG,
  QUALIDADE_WEBP,
  escolherSaida,
  normalizarImagem,
  sharpDisponivel,
};
