// server/services/meliAnuncios/meliImagensService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — ADICIONAR uma imagem a um anúncio no Mercado Livre.
//
// Fluxo separado do PATCH /conteudo de propósito: aqui entra um arquivo
// (multipart), não JSON, e são quatro chamadas ao ML em sequência:
//
//   arquivo (multer, memória) → validação (bytes reais, 10 MB)
//     → normalização JPG (Sharp)
//     → GET  /items/{id}               elegibilidade AO VIVO (catálogo/variações)
//     → POST /pictures/items/upload    multipart "file" → { id }
//     → POST /items/{id}/pictures      { id }            → vincula ao anúncio
//     → GET  /items/{id}               lista de fotos confirmada pelo ML
//     → snapshot local (quem grava é o controller, só depois disso tudo)
//
// Referência: documentacao_api_meli/trabalhar-com-imagens.md.
//
// Escopo desta primeira versão (decisão de produto, não limitação da API):
//  - só ADICIONA. Remover, trocar capa e reordenar exigem PUT com a lista
//    inteira de pictures e ficam para depois;
//  - anúncio de CATÁLOGO (catalog_listing) é bloqueado: a página de catálogo
//    exibe as fotos do produto do ML e o efeito do vínculo não está
//    documentado;
//  - anúncio COM VARIAÇÕES (modelo legado, variations[]) é bloqueado: a foto
//    nova entraria só na lista geral, sem picture_ids em variação nenhuma, e as
//    regras de defines_picture do ML ficam para a fase de variações.
//
// Regras herdadas de meliConteudoService:
//  - Mercado Livre primeiro; o snapshot só muda depois da confirmação;
//  - erro do ML chega à tela como veio (código, mensagem, causas) — nenhum
//    motivo é inventado. Recusa LOCAL (formato, tamanho, bloqueio) não carrega
//    `detalhesMl`, justamente para a tela não atribuí-la ao ML;
//  - `mlUserId` vem de cima; este service não escolhe conta.
// -----------------------------------------------------------------------------

const { mlFetch } = require("../../utils/mlClient");
const validator = require("../designImage/designImageValidator");
const {
  motivoDoErroMl,
  codigoDoErroMl,
  detalhesDoErroMl,
} = require("./meliConteudoService");

// Doc do ML: aceita até 1920x1920 (versão F) e redimensiona o que passar
// disso. Reduzir aqui só economiza banda — não muda o que o ML guardaria.
const MAX_DIMENSAO_ML = 1920;
const QUALIDADE_JPEG_ML = 90;
// Mínimo DOCUMENTADO pelo ML (versão M). Não bloqueia aqui: abaixo disso quem
// decide é o ML (erro 509, "below the minimum allowed size"). Só vira aviso.
const MIN_DIMENSAO_ML = 500;

const MOTIVO_CATALOGO =
  "Este anúncio é de catálogo: as fotos exibidas são do produto de catálogo do Mercado Livre e não podem ser alteradas por aqui.";
const MOTIVO_VARIACOES =
  "Este anúncio tem variações. Adicionar imagens em anúncios com variações ainda não está disponível no VenForce — use o Mercado Livre.";

function falha(codigo, motivo, etapa, extra) {
  return Object.assign({ ok: false, codigo, motivo, etapa }, extra || {});
}

// Falha vinda de uma resposta do ML: código/motivo pela MESMA leitura do
// conteúdo, mais o corpo bruto interpretado só em campos (detalhesMl).
function falhaMl(resp, etapa) {
  const data = resp && resp.data;
  const status = resp && resp.status;
  return falha(codigoDoErroMl(data, status), motivoDoErroMl(data, status), etapa, {
    detalhesMl: detalhesDoErroMl(data, status),
  });
}

function falhaConexao(err, etapa) {
  return falha(
    "ML_INDISPONIVEL",
    err && err.message
      ? `Falha ao falar com o Mercado Livre: ${err.message}`
      : "Falha ao falar com o Mercado Livre.",
    etapa
  );
}

// Bloqueio pela linha local (sincronizada do ML). `variations_count` e
// `catalog_listing` podem estar NULL em linhas antigas — aí não trava nada
// aqui e a checagem AO VIVO (bloqueioDoItemMl) decide.
function bloqueioDoAnuncio(anuncio) {
  if (!anuncio) return null;
  if (anuncio.catalog_listing === true) {
    return falha("IMAGENS_BLOQUEADAS_CATALOGO", MOTIVO_CATALOGO, "bloqueio");
  }
  if (Number(anuncio.variations_count) > 0) {
    return falha("IMAGENS_BLOQUEADAS_VARIACOES", MOTIVO_VARIACOES, "bloqueio");
  }
  return null;
}

// Mesma regra, sobre o item lido agora do ML — a fonte da verdade.
function bloqueioDoItemMl(item) {
  if (!item) return null;
  return bloqueioDoAnuncio({
    catalog_listing: item.catalog_listing === true,
    variations_count: Array.isArray(item.variations) ? item.variations.length : 0,
  });
}

// Mesma extração do sync (meliSyncService): pictures_json guarda URLs.
function urlsDasFotos(item) {
  return (Array.isArray(item && item.pictures) ? item.pictures : [])
    .map((p) => p && (p.secure_url || p.url))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Normalização: qualquer PNG/JPG/WebP válido vira JPG. A doc de imagens do ML
// lista JPG/JPEG/PNG; WebP não é citado, então nunca é enviado como WebP.
// PNG com transparência é achatado sobre BRANCO — o fundo que o ML recomenda
// (o diagnóstico de imagens reprova fundo não branco).
// ---------------------------------------------------------------------------
async function normalizarParaJpg(file) {
  // Formato pelos bytes reais, MIME coerente, 10 MB — lança erro com
  // { codigo, statusCode } e mensagem pronta para a tela.
  const { formato, bytes } = validator.validarUpload(file);

  let sharp;
  try {
    // eslint-disable-next-line global-require
    sharp = require("sharp");
  } catch (_) {
    throw validator.erroValidacao(
      "SHARP_INDISPONIVEL",
      "O processamento de imagens não está disponível neste servidor.",
      503
    );
  }

  let metadata;
  try {
    metadata = await sharp(file.buffer, { limitInputPixels: validator.MAX_INPUT_PIXELS }).metadata();
  } catch (error) {
    if (/pixel|limitInputPixels/i.test(String(error && error.message))) {
      throw validator.erroValidacao("IMAGEM_EXCESSIVA", "A imagem tem resolução alta demais para ser processada.", 413);
    }
    throw validator.erroValidacao("CONTEUDO_INVALIDO", "Não foi possível decodificar a imagem enviada.");
  }

  const orientacao = Number(metadata.orientation) || 1;
  const trocaEixos = orientacao >= 5 && orientacao <= 8;
  const larguraOriginal = trocaEixos ? metadata.height : metadata.width;
  const alturaOriginal = trocaEixos ? metadata.width : metadata.height;
  validator.validarDimensoes({ width: larguraOriginal, height: alturaOriginal });

  let pipeline = sharp(file.buffer, { limitInputPixels: validator.MAX_INPUT_PIXELS })
    .rotate()
    .flatten({ background: "#ffffff" });
  if (Math.max(larguraOriginal, alturaOriginal) > MAX_DIMENSAO_ML) {
    pipeline = pipeline.resize({
      width: MAX_DIMENSAO_ML,
      height: MAX_DIMENSAO_ML,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  const saida = await pipeline
    .jpeg({ quality: QUALIDADE_JPEG_ML, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: saida.data,
    width: saida.info.width,
    height: saida.info.height,
    bytes: saida.data.length,
    abaixoDoMinimoMl: Math.min(saida.info.width, saida.info.height) < MIN_DIMENSAO_ML,
    original: { formato, bytes, width: larguraOriginal, height: alturaOriginal },
  };
}

// ---------------------------------------------------------------------------
// Chamadas ao ML — uma função por etapa, cada uma devolvendo { ok, ... } ou
// uma falha com `etapa` preenchida (a tela diz ONDE parou).
// ---------------------------------------------------------------------------
async function lerItem(clienteId, itemId, mlUserId, etapa) {
  let resp;
  try {
    resp = await mlFetch(
      clienteId,
      `/items/${encodeURIComponent(itemId)}?attributes=id,catalog_listing,variations,pictures,thumbnail,secure_thumbnail`,
      { method: "GET", mlUserId }
    );
  } catch (err) {
    return falhaConexao(err, etapa);
  }
  if (resp && resp.ok && resp.data) return { ok: true, item: resp.data };
  return falhaMl(resp, etapa);
}

async function enviarArquivo(clienteId, mlUserId, jpg, nomeArquivo) {
  const form = new FormData();
  form.append("file", new Blob([jpg.buffer], { type: "image/jpeg" }), nomeArquivo);
  let resp;
  try {
    resp = await mlFetch(clienteId, "/pictures/items/upload", { method: "POST", body: form, mlUserId });
  } catch (err) {
    return falhaConexao(err, "upload");
  }
  if (resp && resp.ok && resp.data && resp.data.id) return { ok: true, pictureId: String(resp.data.id) };
  if (resp && resp.ok) {
    // 2xx sem id: não dá para vincular nada — e não se inventa um id.
    return falha("ML_UPLOAD_SEM_ID", "O Mercado Livre aceitou o arquivo mas não devolveu o id da imagem.", "upload", {
      detalhesMl: detalhesDoErroMl(resp.data, resp.status),
    });
  }
  return falhaMl(resp, "upload");
}

async function vincularAoItem(clienteId, itemId, mlUserId, pictureId) {
  let resp;
  try {
    resp = await mlFetch(clienteId, `/items/${encodeURIComponent(itemId)}/pictures`, {
      method: "POST",
      body: JSON.stringify({ id: pictureId }),
      mlUserId,
    });
  } catch (err) {
    return falhaConexao(err, "vinculo");
  }
  if (resp && resp.ok) return { ok: true };
  return falhaMl(resp, "vinculo");
}

// `pictureId` entra no log quando a imagem JÁ existe no CDN do ML (falha no
// vínculo ou na releitura): é o único rastro para achá-la depois — o ML não
// documenta como apagar uma imagem enviada e o VenForce não a guarda.
function registrarRecusa(itemId, r, pictureId) {
  if (!r.detalhesMl && !pictureId) return;
  // Mesmo espírito do conteúdo: o corpo real da recusa é a única fonte para
  // auditar a próxima sem adivinhar (não carrega token nem dado pessoal).
  console.warn(
    `[anuncios-meli] ML recusou imagem de ${itemId} (etapa ${r.etapa}${pictureId ? `, picture_id ${pictureId}` : ""}):`,
    r.detalhesMl ? r.detalhesMl.status : r.codigo,
    JSON.stringify(r.detalhesMl || { codigo: r.codigo, motivo: r.motivo }).slice(0, 1000)
  );
}

function temFoto(item, pictureId) {
  return (Array.isArray(item && item.pictures) ? item.pictures : [])
    .some((p) => p && String(p.id) === String(pictureId));
}

function respostaSucesso(pictureId, item, imagem) {
  const urls = urlsDasFotos(item);
  return {
    ok: true,
    pictureId,
    fotos: {
      pictures_json: urls,
      pictures_count: urls.length,
      thumbnail: item.secure_thumbnail || item.thumbnail || null,
    },
    confirmacaoPendente: false,
    imagem,
  };
}

const MOTIVO_VINCULO_INCERTO =
  "Não foi possível confirmar se a imagem entrou no anúncio (falha de conexão com o Mercado Livre). Confira o anúncio no Mercado Livre antes de tentar de novo, para não duplicar a foto.";

// ---------------------------------------------------------------------------
// Orquestração. Devolve:
//   sucesso → { ok:true, pictureId, fotos:{ pictures_json, pictures_count,
//               thumbnail } | null, confirmacaoPendente, imagem }
//   falha   → { ok:false, codigo, motivo, etapa, detalhesMl? }
//
// `fotos` null + confirmacaoPendente=true: a imagem FOI vinculada no ML, mas a
// releitura falhou — o controller não grava lista inventada no snapshot, e a
// tela diz que a imagem entrou e que a lista local atualiza no próximo sync.
// ---------------------------------------------------------------------------
async function adicionarImagem({ clienteId, itemId, mlUserId, anuncio, arquivo }) {
  const bloqueioLocal = bloqueioDoAnuncio(anuncio);
  if (bloqueioLocal) return bloqueioLocal;

  let jpg;
  try {
    jpg = await normalizarParaJpg(arquivo);
  } catch (err) {
    if (err && err.codigo) {
      return falha(err.codigo, err.message, "validacao", { statusHttp: err.statusCode || 400 });
    }
    throw err;
  }

  const atual = await lerItem(clienteId, itemId, mlUserId, "leitura");
  if (!atual.ok) { registrarRecusa(itemId, atual); return atual; }
  const bloqueioMl = bloqueioDoItemMl(atual.item);
  if (bloqueioMl) return bloqueioMl;

  const nome = `${String(itemId).replace(/[^A-Za-z0-9_-]/g, "")}-${Date.now()}.jpg`;
  const upload = await enviarArquivo(clienteId, mlUserId, jpg, nome);
  if (!upload.ok) { registrarRecusa(itemId, upload); return upload; }

  const imagem = {
    width: jpg.width,
    height: jpg.height,
    bytes: jpg.bytes,
    abaixoDoMinimoMl: jpg.abaixoDoMinimoMl,
    original: jpg.original,
  };

  const vinculo = await vincularAoItem(clienteId, itemId, mlUserId, upload.pictureId);
  if (!vinculo.ok) {
    registrarRecusa(itemId, vinculo, upload.pictureId);
    // Falha de CONEXÃO no vínculo não diz se o ML aplicou ou não (o pedido
    // pode ter chegado e só a resposta se perdeu). Em vez de afirmar
    // "falhou" — e induzir um novo envio que duplicaria a foto —, relê o
    // item e decide pelo que o ML mostra.
    // O mesmo vale para 5xx (ex.: 504 do gateway do ML).
    const incerto = vinculo.codigo === "ML_INDISPONIVEL" ||
      (vinculo.detalhesMl && Number(vinculo.detalhesMl.status) >= 500);
    if (incerto) {
      const conferido = await lerItem(clienteId, itemId, mlUserId, "confirmacao");
      if (conferido.ok && temFoto(conferido.item, upload.pictureId)) {
        return respostaSucesso(upload.pictureId, conferido.item, imagem);
      }
      if (!conferido.ok) {
        // Sem detalhesMl de propósito: o que a tela precisa dizer é "confira
        // antes de reenviar", e não a resposta do 5xx (que já foi para o log).
        return falha("VINCULO_INCERTO", MOTIVO_VINCULO_INCERTO, "vinculo", { pictureId: upload.pictureId });
      }
    }
    // A imagem subiu para o CDN do ML mas não entrou no anúncio: dizer isso,
    // com o id, em vez de fingir que nada aconteceu.
    vinculo.pictureId = upload.pictureId;
    return vinculo;
  }

  const confirmado = await lerItem(clienteId, itemId, mlUserId, "confirmacao");
  if (!confirmado.ok) {
    registrarRecusa(itemId, confirmado, upload.pictureId);
    return { ok: true, pictureId: upload.pictureId, fotos: null, confirmacaoPendente: true, imagem };
  }

  return respostaSucesso(upload.pictureId, confirmado.item, imagem);
}

module.exports = {
  adicionarImagem,
  bloqueioDoAnuncio,
  bloqueioDoItemMl,
  normalizarParaJpg,
  urlsDasFotos,
  MAX_DIMENSAO_ML,
  MIN_DIMENSAO_ML,
  MOTIVO_CATALOGO,
  MOTIVO_VARIACOES,
};
