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
//  - anúncio COM VARIAÇÕES (modelo legado, variations[]) NÃO usa este fluxo:
//    POST /items/{id}/pictures não documenta efeito em variations[].picture_ids
//    (a foto ficaria só na lista geral, sem variação que a exiba). Ele usa o
//    fluxo próprio de adicionarImagemVariacao (mais abaixo), o único que a doc
//    descreve: PUT /items/{id} com pictures + variations inteiros.
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
  "Este anúncio tem variações: a imagem precisa ser adicionada a uma variação (escolha qual antes de enviar).";

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

// Etapa comum aos dois fluxos (anúncio simples e variação): só sobe o JPG ao
// CDN do ML e devolve o picture_id. Não vincula nada.
async function uploadImagemAnuncio(clienteId, itemId, mlUserId, jpg) {
  const nome = `${String(itemId).replace(/[^A-Za-z0-9_-]/g, "")}-${Date.now()}.jpg`;
  return enviarArquivo(clienteId, mlUserId, jpg, nome);
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

function resumoImagem(jpg) {
  return {
    width: jpg.width,
    height: jpg.height,
    bytes: jpg.bytes,
    abaixoDoMinimoMl: jpg.abaixoDoMinimoMl,
    original: jpg.original,
  };
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

  const upload = await uploadImagemAnuncio(clienteId, itemId, mlUserId, jpg);
  if (!upload.ok) { registrarRecusa(itemId, upload); return upload; }

  const imagem = resumoImagem(jpg);

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

// =============================================================================
// VARIAÇÕES (modelo legado, item_id -> variations[])
//
// Como o ML representa (documentacao_api_meli/variacoes.md, "Trabalhar com
// imagens em variações" e "Modificar imagens"; trabalhar-com-imagens.md,
// "Substituir imagens"):
//   - as imagens moram na lista GERAL do anúncio (item.pictures[]);
//   - cada variação aponta para um subconjunto dela (variations[].picture_ids);
//   - quem decide quais variações dividem imagens é o atributo da categoria
//     com a tag `defines_picture` (ex.: Cor). Variações com o mesmo valor nesse
//     atributo DEVEM ter as mesmas imagens; valores diferentes, imagens
//     diferentes (atributos.md, "Comportamentos especiais").
//
// Adicionar a uma variação = PUT /items/{id} com:
//   pictures   → TODAS as imagens atuais (ids) + a nova. Imagem omitida é
//                APAGADA ("Caso não quer conservar as imagens anteriores, não
//                devem ser enviadas").
//   variations → TODAS as variações (id + picture_ids). Variação omitida é
//                REMOVIDA do anúncio.
// Por isso a imagem vai para o GRUPO (valor do atributo defines_picture), não
// para uma combinação isolada — mandar só para "Azul M" deixaria "Azul P" com
// imagens diferentes, contra a regra do ML.
//
// Segurança do PUT inteiro (mesmo padrão de meliVariacoesLegadoEstoqueService):
//   1. o payload é montado de um GET feito IMEDIATAMENTE antes do PUT (depois
//      do upload), nunca do snapshot nem da leitura que abriu a tela;
//   2. depois do PUT, outro GET confere: nenhuma variação sumiu, nenhuma foto
//      antiga sumiu, a nova está em todas as variações do grupo e em nenhuma
//      outra. Perda de variação/foto é falha CRÍTICA (log estruturado), nunca
//      sucesso e nunca retry automático.
// =============================================================================

const ATRIBUTOS_ITEM_VARIACAO =
  "id,catalog_listing,category_id,user_product_id,variations,pictures,thumbnail,secure_thumbnail";

const MOTIVO_SEM_VARIACOES =
  "Este anúncio não tem variações no Mercado Livre. Use o envio normal de imagem.";
const MOTIVO_USER_PRODUCT =
  "Este anúncio está no modelo novo do Mercado Livre (User Product), que não usa a lista de variações. A imagem por variação não se aplica.";
const MOTIVO_SEM_ATRIBUTO_FOTO =
  "O Mercado Livre não indica, para a categoria deste anúncio, qual atributo das variações define a foto (defines_picture). Sem isso não dá para saber quais variações devem receber a imagem — use o Mercado Livre.";

async function lerItemComVariacoes(clienteId, itemId, mlUserId, etapa) {
  let resp;
  try {
    resp = await mlFetch(clienteId, `/items/${encodeURIComponent(itemId)}?attributes=${ATRIBUTOS_ITEM_VARIACAO}`, {
      method: "GET",
      mlUserId,
    });
  } catch (err) {
    return falhaConexao(err, etapa);
  }
  if (resp && resp.ok && resp.data) return { ok: true, item: resp.data };
  return falhaMl(resp, etapa);
}

// Ids dos atributos com a tag defines_picture na categoria. A tag só vale
// para atributos que aceitam variação (atributos.md).
async function atributosQueDefinemFoto(clienteId, categoryId, mlUserId) {
  if (!categoryId) {
    return falha("CATEGORIA_AUSENTE", "O Mercado Livre não informou a categoria deste anúncio.", "leitura");
  }
  let resp;
  try {
    resp = await mlFetch(clienteId, `/categories/${encodeURIComponent(categoryId)}/attributes`, {
      method: "GET",
      mlUserId,
    });
  } catch (err) {
    return falhaConexao(err, "leitura");
  }
  if (!resp || !resp.ok) return falhaMl(resp, "leitura");
  const lista = Array.isArray(resp.data) ? resp.data : [];
  const ids = lista
    .filter((a) => a && a.id && a.tags && a.tags.defines_picture === true)
    .map((a) => ({ id: String(a.id), nome: a.name ? String(a.name) : String(a.id) }));
  return { ok: true, atributos: ids };
}

// Chave estável de um valor de atributo: value_id quando existe (valores da
// lista do ML); value_name normalizado para característica personalizada,
// que pode vir sem value_id.
function chaveDoValor(ac) {
  if (!ac) return null;
  if (ac.value_id !== null && ac.value_id !== undefined && ac.value_id !== "" && String(ac.value_id) !== "-1") {
    return `id:${ac.value_id}`;
  }
  if (ac.value_name === null || ac.value_name === undefined) return null;
  const nome = String(ac.value_name).trim().toLowerCase();
  return nome ? `nome:${nome}` : null;
}

function rotuloDaVariacao(v, atributoFotoId) {
  const partes = (Array.isArray(v.attribute_combinations) ? v.attribute_combinations : [])
    .filter((ac) => ac && String(ac.id) !== atributoFotoId && ac.value_name != null)
    .map((ac) => String(ac.value_name));
  return partes.join(" / ");
}

// Checagens que valem para a LEITURA (tela) e para a ESCRITA (antes do PUT).
function elegibilidadeVariacoes(item) {
  if (!item) return falha("ITEM_NAO_ENCONTRADO", "Anúncio não encontrado no Mercado Livre.", "leitura");
  if (item.catalog_listing === true) return falha("IMAGENS_BLOQUEADAS_CATALOGO", MOTIVO_CATALOGO, "bloqueio");
  if (item.user_product_id) return falha("IMAGENS_VARIACOES_USER_PRODUCT", MOTIVO_USER_PRODUCT, "bloqueio");
  const variacoes = Array.isArray(item.variations) ? item.variations : [];
  if (!variacoes.length) return falha("IMAGENS_SEM_VARIACOES", MOTIVO_SEM_VARIACOES, "bloqueio");
  if (variacoes.some((v) => !v || v.id === undefined || v.id === null)) {
    return falha(
      "VARIACAO_SEM_ID",
      "O Mercado Livre devolveu uma variação sem id — a imagem não foi enviada para não arriscar apagar variações.",
      "bloqueio"
    );
  }
  const idsFotos = new Set((Array.isArray(item.pictures) ? item.pictures : []).map((p) => p && String(p.id)));
  if (!Array.isArray(item.pictures) || item.pictures.some((p) => !p || !p.id)) {
    return falha(
      "FOTO_SEM_ID",
      "O Mercado Livre devolveu uma foto sem id — a imagem não foi enviada para não arriscar apagar fotos.",
      "bloqueio"
    );
  }
  // Toda foto de variação precisa estar na lista geral: o PUT reenvia a lista
  // geral, e uma referência "solta" não teria como ser preservada.
  const solta = variacoes.some((v) =>
    (Array.isArray(v.picture_ids) ? v.picture_ids : []).some((pid) => !idsFotos.has(String(pid)))
  );
  if (solta) {
    return falha(
      "VARIACAO_FOTO_FORA_DA_GALERIA",
      "Uma variação aponta para uma foto que não está na lista geral do anúncio. A imagem não foi enviada para não alterar fotos sem querer — ajuste no Mercado Livre.",
      "bloqueio"
    );
  }
  return { ok: true, variacoes };
}

// Agrupa as variações pelo valor do atributo defines_picture. Função PURA
// (testável sem ML): recebe o item e os atributos da categoria com a tag.
function gruposDeFotoDasVariacoes(item, atributosFoto) {
  const eleg = elegibilidadeVariacoes(item);
  if (!eleg.ok) return eleg;
  const variacoes = eleg.variacoes;

  const idsNasCombinacoes = new Set();
  for (const v of variacoes) {
    for (const ac of Array.isArray(v.attribute_combinations) ? v.attribute_combinations : []) {
      if (ac && ac.id) idsNasCombinacoes.add(String(ac.id));
    }
  }
  const candidatos = (atributosFoto || []).filter((a) => idsNasCombinacoes.has(a.id));
  if (candidatos.length !== 1) {
    return falha("ATRIBUTO_FOTO_INDEFINIDO", MOTIVO_SEM_ATRIBUTO_FOTO, "bloqueio");
  }
  const atributo = candidatos[0];

  const urlPorId = {};
  for (const p of item.pictures) urlPorId[String(p.id)] = p.secure_url || p.url || null;

  const grupos = [];
  const porChave = {};
  for (const v of variacoes) {
    const ac = (v.attribute_combinations || []).find((x) => x && String(x.id) === atributo.id);
    const chave = chaveDoValor(ac);
    if (!chave) {
      return falha(
        "VARIACAO_SEM_VALOR_FOTO",
        `Uma variação não tem valor para "${atributo.nome}", o atributo que define a foto. A imagem não pode ser associada com segurança — ajuste no Mercado Livre.`,
        "bloqueio"
      );
    }
    let g = porChave[chave];
    if (!g) {
      const pictureIds = (Array.isArray(v.picture_ids) ? v.picture_ids : []).map(String);
      g = {
        chave,
        valor: String(ac.value_name != null ? ac.value_name : ac.value_id),
        variacoes: [],
        pictureIds,
        fotos: pictureIds.map((pid) => urlPorId[pid]).filter(Boolean),
      };
      porChave[chave] = g;
      grupos.push(g);
    }
    g.variacoes.push({ id: String(v.id), rotulo: rotuloDaVariacao(v, atributo.id) });
  }
  return { ok: true, atributo, grupos };
}

// Leitura para a tela: quais grupos existem e as fotos de cada um.
async function listarGruposDeFotoVariacoes({ clienteId, itemId, mlUserId }) {
  const lido = await lerItemComVariacoes(clienteId, itemId, mlUserId, "leitura");
  if (!lido.ok) return lido;
  const eleg = elegibilidadeVariacoes(lido.item);
  if (!eleg.ok) return eleg;
  const attrs = await atributosQueDefinemFoto(clienteId, lido.item.category_id, mlUserId);
  if (!attrs.ok) return attrs;
  return gruposDeFotoDasVariacoes(lido.item, attrs.atributos);
}

// Payload do PUT a partir de um item lido AGORA. Nada é reconstruído além de
// ids: pictures só com {id}, variations só com {id, picture_ids} — o mínimo
// que a doc mostra em "Modificar imagens".
function montarPayloadVariacao(item, grupo, pictureId) {
  const noGrupo = new Set(grupo.variacoes.map((v) => v.id));
  return {
    pictures: [...item.pictures.map((p) => ({ id: String(p.id) })), { id: pictureId }],
    variations: item.variations.map((v) => {
      const atuais = (Array.isArray(v.picture_ids) ? v.picture_ids : []).map(String);
      return { id: v.id, picture_ids: noGrupo.has(String(v.id)) ? [...atuais, pictureId] : atuais };
    }),
  };
}

async function vincularImagemVariacao({ clienteId, itemId, mlUserId, item, grupo, pictureId }) {
  const payload = montarPayloadVariacao(item, grupo, pictureId);
  let resp;
  try {
    resp = await mlFetch(clienteId, `/items/${encodeURIComponent(itemId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
      mlUserId,
    });
  } catch (err) {
    return falhaConexao(err, "vinculo");
  }
  if (resp && resp.ok) return { ok: true };
  return falhaMl(resp, "vinculo");
}

function falhaCriticaVariacao(codigo, motivo, contexto) {
  console.error(JSON.stringify({ event: "meli_imagem_variacao_perda_critica", codigo, ...contexto }));
  return falha(codigo, motivo, "confirmacao", { critico: true, pictureId: contexto.pictureId });
}

// Compara o antes (item usado no PUT) com o depois (GET de confirmação).
function conferirVinculoVariacao(antes, depois, grupo, pictureId) {
  const ctx = { itemId: antes.id, pictureId };
  const varsDepois = Array.isArray(depois.variations) ? depois.variations : [];
  const porId = {};
  for (const v of varsDepois) if (v && v.id != null) porId[String(v.id)] = v;

  const sumiuVariacao = antes.variations.some((v) => !porId[String(v.id)]);
  if (sumiuVariacao || varsDepois.length < antes.variations.length) {
    return falhaCriticaVariacao(
      "PERDA_DE_VARIACAO",
      "ATENÇÃO: uma ou mais variações deste anúncio podem ter sido removidas pelo Mercado Livre durante esta operação. Confira no Mercado Livre antes de repetir qualquer edição.",
      { ...ctx, nAntes: antes.variations.length, nDepois: varsDepois.length }
    );
  }
  const fotosDepois = new Set((Array.isArray(depois.pictures) ? depois.pictures : []).map((p) => p && String(p.id)));
  if (antes.pictures.some((p) => !fotosDepois.has(String(p.id)))) {
    return falhaCriticaVariacao(
      "PERDA_DE_FOTO",
      "ATENÇÃO: uma ou mais fotos antigas deste anúncio não aparecem mais no Mercado Livre depois desta operação. Confira no Mercado Livre antes de repetir qualquer edição.",
      ctx
    );
  }

  const noGrupo = new Set(grupo.variacoes.map((v) => v.id));
  const idsDe = (v) => (Array.isArray(v && v.picture_ids) ? v.picture_ids : []).map(String);
  const faltando = [...noGrupo].filter((id) => !idsDe(porId[id]).includes(pictureId));
  const vazou = varsDepois.filter((v) => !noGrupo.has(String(v.id)) && idsDe(v).includes(pictureId));
  if (faltando.length || vazou.length) {
    console.warn(
      `[anuncios-meli] imagem ${pictureId} de ${antes.id}: confirmação divergente (faltando em ${faltando.join(",") || "-"}; fora do grupo em ${vazou.map((v) => v.id).join(",") || "-"})`
    );
    return falha(
      "CONFIRMACAO_DIVERGENTE",
      "O Mercado Livre aceitou a alteração, mas as variações não ficaram como enviado. Confira as fotos das variações no Mercado Livre antes de tentar de novo.",
      "confirmacao",
      { pictureId }
    );
  }
  return { ok: true };
}

function grupoNoItem(item, atributo, chave) {
  const g = gruposDeFotoDasVariacoes(item, [atributo]);
  if (!g.ok) return g;
  const grupo = g.grupos.find((x) => x.chave === chave);
  if (!grupo) {
    return falha(
      "VARIACAO_GRUPO_INEXISTENTE",
      `Não existe mais variação com esse valor de "${atributo.nome}" no Mercado Livre. Reabra o anúncio e escolha de novo.`,
      "bloqueio"
    );
  }
  return { ok: true, grupo };
}

// ---------------------------------------------------------------------------
// Orquestração do fluxo de variação. Mesmo contrato de adicionarImagem, mais
// `grupo` { chave, valor, atributo, variacoes } no sucesso.
//
//   validação/JPG → GET item + atributos da categoria (elegibilidade, grupo)
//     → upload ao CDN → GET item de novo (base do PUT) → PUT pictures+variations
//     → GET de confirmação (nada sumiu, nova só no grupo) → snapshot (controller)
// ---------------------------------------------------------------------------
async function adicionarImagemVariacao({ clienteId, itemId, mlUserId, anuncio, arquivo, grupoChave }) {
  if (anuncio && anuncio.catalog_listing === true) {
    return falha("IMAGENS_BLOQUEADAS_CATALOGO", MOTIVO_CATALOGO, "bloqueio");
  }
  const chave = typeof grupoChave === "string" ? grupoChave.trim() : "";
  if (!chave) {
    return falha("VARIACAO_NAO_INFORMADA", "Escolha a variação que vai receber a imagem.", "validacao", {
      statusHttp: 400,
    });
  }

  let jpg;
  try {
    jpg = await normalizarParaJpg(arquivo);
  } catch (err) {
    if (err && err.codigo) {
      return falha(err.codigo, err.message, "validacao", { statusHttp: err.statusCode || 400 });
    }
    throw err;
  }

  const inicial = await lerItemComVariacoes(clienteId, itemId, mlUserId, "leitura");
  if (!inicial.ok) { registrarRecusa(itemId, inicial); return inicial; }
  const eleg = elegibilidadeVariacoes(inicial.item);
  if (!eleg.ok) return eleg;
  const attrs = await atributosQueDefinemFoto(clienteId, inicial.item.category_id, mlUserId);
  if (!attrs.ok) { registrarRecusa(itemId, attrs); return attrs; }
  const agrupado = gruposDeFotoDasVariacoes(inicial.item, attrs.atributos);
  if (!agrupado.ok) return agrupado;
  const atributo = agrupado.atributo;
  const alvoInicial = grupoNoItem(inicial.item, atributo, chave);
  if (!alvoInicial.ok) return alvoInicial;

  const upload = await uploadImagemAnuncio(clienteId, itemId, mlUserId, jpg);
  if (!upload.ok) { registrarRecusa(itemId, upload); return upload; }
  const imagem = resumoImagem(jpg);
  const pictureId = upload.pictureId;

  // Base do PUT: lida AGORA (o upload leva tempo; o anúncio pode ter mudado).
  const base = await lerItemComVariacoes(clienteId, itemId, mlUserId, "leitura");
  if (!base.ok) {
    registrarRecusa(itemId, base, pictureId);
    base.pictureId = pictureId;
    return base;
  }
  const alvo = grupoNoItem(base.item, atributo, chave);
  if (!alvo.ok) {
    registrarRecusa(itemId, alvo, pictureId);
    alvo.pictureId = pictureId;
    return alvo;
  }
  const grupo = alvo.grupo;
  const resumoGrupo = {
    chave: grupo.chave,
    valor: grupo.valor,
    atributo: atributo.nome,
    variacoes: grupo.variacoes.length,
  };
  const noGrupoInteiro = (item) => {
    const porId = {};
    for (const v of Array.isArray(item.variations) ? item.variations : []) porId[String(v.id)] = v;
    return grupo.variacoes.every((gv) =>
      (porId[gv.id] && Array.isArray(porId[gv.id].picture_ids) ? porId[gv.id].picture_ids : [])
        .map(String).includes(pictureId)
    );
  };

  const vinculo = await vincularImagemVariacao({ clienteId, itemId, mlUserId, item: base.item, grupo, pictureId });
  if (!vinculo.ok) {
    registrarRecusa(itemId, vinculo, pictureId);
    const incerto = vinculo.codigo === "ML_INDISPONIVEL" ||
      (vinculo.detalhesMl && Number(vinculo.detalhesMl.status) >= 500);
    if (incerto) {
      const conferido = await lerItemComVariacoes(clienteId, itemId, mlUserId, "confirmacao");
      if (!conferido.ok) {
        return falha("VINCULO_INCERTO", MOTIVO_VINCULO_INCERTO, "vinculo", { pictureId });
      }
      if (temFoto(conferido.item, pictureId) || noGrupoInteiro(conferido.item)) {
        // O PUT chegou: mesma conferência completa do caminho feliz.
        const conf = conferirVinculoVariacao(base.item, conferido.item, grupo, pictureId);
        if (!conf.ok) return conf;
        return Object.assign(respostaSucesso(pictureId, conferido.item, imagem), { grupo: resumoGrupo });
      }
    }
    vinculo.pictureId = pictureId;
    return vinculo;
  }

  const confirmado = await lerItemComVariacoes(clienteId, itemId, mlUserId, "confirmacao");
  if (!confirmado.ok) {
    registrarRecusa(itemId, confirmado, pictureId);
    return { ok: true, pictureId, fotos: null, confirmacaoPendente: true, imagem, grupo: resumoGrupo };
  }
  const conf = conferirVinculoVariacao(base.item, confirmado.item, grupo, pictureId);
  if (!conf.ok) return conf;
  return Object.assign(respostaSucesso(pictureId, confirmado.item, imagem), { grupo: resumoGrupo });
}

module.exports = {
  adicionarImagem,
  adicionarImagemVariacao,
  listarGruposDeFotoVariacoes,
  gruposDeFotoDasVariacoes,
  montarPayloadVariacao,
  uploadImagemAnuncio,
  vincularImagemVariacao,
  bloqueioDoAnuncio,
  bloqueioDoItemMl,
  normalizarParaJpg,
  urlsDasFotos,
  MAX_DIMENSAO_ML,
  MIN_DIMENSAO_ML,
  MOTIVO_CATALOGO,
  MOTIVO_VARIACOES,
};
