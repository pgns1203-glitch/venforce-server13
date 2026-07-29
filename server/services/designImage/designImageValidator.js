// server/services/designImage/designImageValidator.js
// -----------------------------------------------------------------------------
// Validação de imagens recebidas pelo Estúdio de Templates.
//
// O MIME que o navegador envia no multipart é apenas uma sugestão: quem renomeia
// um .exe para .png manda "image/png" tranquilamente. Aqui o formato é decidido
// pelos bytes iniciais do arquivo (magic number), e o MIME declarado só precisa
// concordar com o que foi detectado.
//
// SVG é rejeitado de propósito: é um documento XML executável (script, foreignObject,
// xlink externo) e este projeto não tem sanitizador de SVG. Ver docs/DESIGN_IMAGE_EDITOR.md.
// -----------------------------------------------------------------------------

// 10 MB no multipart. Depois do Sharp a imagem normalizada fica bem menor.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Teto de pixels decodificados: barra "decompression bomb" (um PNG de 40 KB
// pode declarar 30000x30000 e estourar a memória do processo ao decodificar).
const MAX_INPUT_PIXELS = 50 * 1000 * 1000;

// Acima disso a imagem é reduzida. 1600 cobre com folga a peça de 1200x1200.
const MAX_DIMENSION = 1600;

const MIN_DIMENSION = 32;

const FORMATOS_ACEITOS = ["png", "jpeg", "webp"];

const MIME_POR_FORMATO = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// MIMEs equivalentes que o navegador/SO pode declarar para o mesmo formato.
const MIMES_EQUIVALENTES = {
  png: ["image/png", "image/x-png"],
  jpeg: ["image/jpeg", "image/jpg", "image/pjpeg"],
  webp: ["image/webp"],
};

function erroValidacao(codigo, mensagem, statusCode) {
  const error = new Error(mensagem);
  error.codigo = codigo;
  error.statusCode = statusCode || 400;
  return error;
}

// Detecta o formato pelos bytes. Retorna "png" | "jpeg" | "webp" | "svg" | null.
function detectarFormato(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return "png";

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) return "webp";

  // SVG: XML/<svg> nos primeiros bytes (com ou sem BOM/prólogo).
  const inicio = buffer.toString("utf8", 0, Math.min(buffer.length, 512)).trimStart();
  if (/^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg|<svg[\s>])/i.test(inicio)) {
    return "svg";
  }

  return null;
}

function normalizarMime(valor) {
  return String(valor || "").toLowerCase().split(";")[0].trim();
}

// Valida o arquivo que chegou pelo Multer (memoryStorage).
// Retorna { formato, mimeType, bytes } ou lança erro com codigo/statusCode.
function validarUpload(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw erroValidacao("ARQUIVO_AUSENTE", "Nenhuma imagem foi enviada.");
  }

  const bytes = file.buffer.length;
  if (bytes === 0) {
    throw erroValidacao("ARQUIVO_VAZIO", "O arquivo enviado está vazio.");
  }
  if (bytes > MAX_UPLOAD_BYTES) {
    const limite = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    throw erroValidacao("ARQUIVO_GRANDE", `Imagem muito grande. O limite é de ${limite} MB.`, 413);
  }

  const formato = detectarFormato(file.buffer);

  if (formato === "svg") {
    throw erroValidacao(
      "SVG_NAO_SUPORTADO",
      "SVG não é aceito como imagem de produto. Envie PNG, JPG ou WebP."
    );
  }

  if (!formato || !FORMATOS_ACEITOS.includes(formato)) {
    throw erroValidacao(
      "CONTEUDO_INVALIDO",
      "O conteúdo do arquivo não é uma imagem PNG, JPG ou WebP válida."
    );
  }

  // Divergência entre o que o cliente declarou e o que os bytes dizem.
  const declarado = normalizarMime(file.mimetype);
  if (declarado && !MIMES_EQUIVALENTES[formato].includes(declarado)) {
    throw erroValidacao(
      "MIME_DIVERGENTE",
      "O tipo declarado do arquivo não corresponde ao seu conteúdo."
    );
  }

  return { formato, mimeType: MIME_POR_FORMATO[formato], bytes };
}

// Nome de arquivo vindo do cliente: só serve para exibir. Tira caminho,
// controle e qualquer coisa que possa virar path traversal em log ou disco.
function sanitizarNomeArquivo(valor, fallback) {
  const bruto = String(valor == null ? "" : valor);
  const base = bruto.split(/[\\/]/).pop() || "";
  const limpo = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return limpo || fallback || "imagem";
}

// Dimensões declaradas pelo decodificador precisam ser sãs antes do resize.
function validarDimensoes(metadata) {
  const width = Number(metadata && metadata.width);
  const height = Number(metadata && metadata.height);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw erroValidacao("DIMENSOES_INVALIDAS", "Não foi possível ler as dimensões da imagem.");
  }
  if (width * height > MAX_INPUT_PIXELS) {
    throw erroValidacao("IMAGEM_EXCESSIVA", "A imagem tem resolução alta demais para ser processada.", 413);
  }
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    throw erroValidacao("IMAGEM_PEQUENA", `A imagem precisa ter ao menos ${MIN_DIMENSION} px de lado.`);
  }
  return { width, height };
}

module.exports = {
  MAX_UPLOAD_BYTES,
  MAX_INPUT_PIXELS,
  MAX_DIMENSION,
  MIN_DIMENSION,
  FORMATOS_ACEITOS,
  MIME_POR_FORMATO,
  erroValidacao,
  detectarFormato,
  validarUpload,
  validarDimensoes,
  sanitizarNomeArquivo,
};
