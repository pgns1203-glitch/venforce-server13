// server/services/meliAnuncios/meliFotosService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — EDITOR DE FOTOS por grupo de variação (adicionar,
// excluir, reordenar), com um único salvar.
//
// Grupo = valor do atributo com a tag defines_picture (ex.: Cor "Robalo").
// Variações com o mesmo valor têm as mesmas fotos (regra do ML); a PRIMEIRA
// foto de picture_ids é a imagem principal da variação. Anúncio sem variação
// é um grupo só (a galeria geral); a primeira foto é a capa do anúncio.
//
// O grupo é identificado por grupoVariacao = { attribute_id, value_id,
// value_name }, exatamente como o ML descreve o valor — nada aqui assume que
// o atributo é COLOR.
//
// Escrita: PUT /items/{id} com pictures e variations INTEIROS — o que for
// omitido o ML apaga. Por isso o payload é sempre reconstruído assim:
//
//     estado atual do ML (lido agora) + alteração pedida (ordem) = payload final
//
// nunca a partir do que a tela viu. Fontes: documentacao_api_meli/
// variacoes.md, trabalhar-com-imagens.md, atributos.md. Contrato:
// docs/superpowers/specs/2026-09-30-fotos-por-variacao-design.md.
//
// Esta primeira parte é só de funções PURAS (sem ML, sem banco).
// -----------------------------------------------------------------------------

const img = require("./meliImagensService");
const { falha } = img;

// Proteção do VenForce quando a categoria não informa limite — não é regra
// do ML (spec §4.3).
const LIMITE_OPERACIONAL = { porVariacao: 10, porItem: 12 };

const MOTIVO_DESATUALIZADO = "O anúncio mudou no Mercado Livre desde que você abriu. Recarregue as fotos.";

function norm(s) {
  return s === null || s === undefined ? "" : String(s).trim().toLowerCase();
}

function temValueId(v) {
  return v !== null && v !== undefined && v !== "" && String(v) !== "-1";
}

function grupoVariacaoDe(ac) {
  return {
    attribute_id: String(ac.id),
    value_id: temValueId(ac.value_id) ? String(ac.value_id) : null,
    value_name: ac.value_name === null || ac.value_name === undefined ? null : String(ac.value_name),
  };
}

// `ac` é um attribute_combinations[] do ML ({ id, value_id, value_name });
// `gv` é um grupoVariacao. value_id decide quando existe; valor personalizado
// (sem value_id) casa pelo nome normalizado.
function mesmoValor(ac, gv) {
  if (!ac || !gv || String(ac.id) !== String(gv.attribute_id)) return false;
  if (temValueId(gv.value_id)) return String(ac.value_id) === String(gv.value_id);
  return norm(ac.value_name) !== "" && norm(ac.value_name) === norm(gv.value_name);
}

function urlPorId(item) {
  const m = {};
  for (const p of Array.isArray(item.pictures) ? item.pictures : []) {
    if (p && p.id) m[String(p.id)] = p.secure_url || p.url || null;
  }
  return m;
}

// Grupos de um item COM variações. Pressupõe elegibilidadeVariacoes(item) ok
// (toda variação com id, toda foto de variação presente na galeria).
function montarGrupos(item, atributo) {
  const urls = urlPorId(item);
  const grupos = [];
  for (const v of item.variations) {
    const ac = (v.attribute_combinations || []).find((x) => x && String(x.id) === atributo.id);
    if (!ac || (!temValueId(ac.value_id) && norm(ac.value_name) === "")) {
      return falha(
        "VARIACAO_SEM_VALOR_FOTO",
        `Uma variação não tem valor para "${atributo.nome}", o atributo que define a foto. Ajuste no Mercado Livre.`,
        "bloqueio"
      );
    }
    let g = grupos.find((x) => mesmoValor(ac, x.grupoVariacao));
    if (!g) {
      const ids = (Array.isArray(v.picture_ids) ? v.picture_ids : []).map(String);
      g = {
        grupoVariacao: grupoVariacaoDe(ac),
        rotulo: String(ac.value_name != null ? ac.value_name : ac.value_id),
        variacoes: [],
        fotos: ids.map((id) => ({ id, url: urls[id] || null })),
      };
      grupos.push(g);
    }
    g.variacoes.push({ id: String(v.id), rotulo: img.rotuloDaVariacao(v, atributo.id) });
  }
  return { ok: true, grupos };
}

// Anúncio sem variação: um grupo só, com a galeria inteira.
function grupoSimples(item) {
  const urls = urlPorId(item);
  return {
    grupoVariacao: null,
    rotulo: "",
    variacoes: [],
    fotos: (Array.isArray(item.pictures) ? item.pictures : [])
      .filter((p) => p && p.id)
      .map((p) => ({ id: String(p.id), url: urls[String(p.id)] || null })),
  };
}

function localizarGrupo(grupos, gv) {
  if (!gv) return grupos.length === 1 && grupos[0].grupoVariacao === null ? grupos[0] : null;
  return grupos.find((g) => g.grupoVariacao && mesmoValor(
    { id: g.grupoVariacao.attribute_id, value_id: g.grupoVariacao.value_id, value_name: g.grupoVariacao.value_name },
    gv
  )) || null;
}

function nomeDoGrupo(plano) {
  return plano && plano.grupoVariacao && plano.grupoVariacao.value_name
    ? `A variação ${plano.grupoVariacao.value_name}`
    : "O anúncio";
}

function planoInvalido(motivo) {
  return falha("PLANO_INVALIDO", motivo, "validacao", { statusHttp: 400 });
}

// Forma do plano, sem estado do ML. Grupo vazio sai aqui, com a mensagem da
// spec, antes de qualquer chamada.
function validarForma(plano, qtdNovas) {
  if (!plano || typeof plano !== "object") return planoInvalido("Plano de fotos ausente ou inválido.");
  const gv = plano.grupoVariacao;
  if (gv !== null && (typeof gv !== "object" || !gv.attribute_id || (!temValueId(gv.value_id) && !gv.value_name))) {
    return planoInvalido("Grupo de variação inválido.");
  }
  if (!Array.isArray(plano.base) || plano.base.some((x) => typeof x !== "string")) {
    return planoInvalido("Base de fotos inválida.");
  }
  if (!Array.isArray(plano.ordem)) return planoInvalido("Ordem de fotos inválida.");
  if (plano.ordem.length === 0) {
    return falha(
      "VARIACAO_SEM_IMAGEM",
      `Não é possível salvar. ${nomeDoGrupo(plano)} precisa ter pelo menos uma imagem.`,
      "validacao",
      { statusHttp: 400 }
    );
  }
  const vistos = new Set();
  const novasUsadas = new Set();
  for (const e of plano.ordem) {
    const existente = !!e && typeof e.existente === "string";
    const nova = !!e && Number.isInteger(e.nova);
    if (existente === nova) return planoInvalido("Cada foto da ordem é existente ou nova.");
    if (existente) {
      if (vistos.has(e.existente)) return planoInvalido("Foto repetida na ordem.");
      vistos.add(e.existente);
    } else {
      if (e.nova < 0 || e.nova >= qtdNovas || novasUsadas.has(e.nova)) {
        return planoInvalido("Foto nova sem arquivo correspondente.");
      }
      novasUsadas.add(e.nova);
    }
  }
  if (novasUsadas.size !== qtdNovas) return planoInvalido("Arquivo enviado sem lugar na ordem.");
  return { ok: true, plano };
}

// A base que a tela viu precisa ser EXATAMENTE (ids e ordem) o grupo atual;
// toda foto existente da ordem precisa ser deste grupo.
function conferirBase(grupo, plano) {
  const atuais = grupo.fotos.map((f) => f.id);
  if (JSON.stringify(atuais) !== JSON.stringify(plano.base)) {
    return falha("FOTOS_DESATUALIZADAS", MOTIVO_DESATUALIZADO, "bloqueio");
  }
  const noGrupo = new Set(atuais);
  if (plano.ordem.some((e) => typeof e.existente === "string" && !noGrupo.has(e.existente))) {
    return planoInvalido("A ordem tem uma foto que não é deste grupo.");
  }
  return { ok: true };
}

// Plano completo contra os grupos do estado ATUAL do ML: forma → grupo
// existe → base confere. Devolve o grupo atual para a reconstrução.
function validarPlano(plano, grupos, qtdNovas) {
  const forma = validarForma(plano, qtdNovas);
  if (!forma.ok) return forma;
  const grupo = localizarGrupo(grupos, plano.grupoVariacao);
  if (!grupo) {
    return falha(
      "VARIACAO_GRUPO_INEXISTENTE",
      "Esta variação não existe mais no Mercado Livre. Recarregue as fotos.",
      "bloqueio"
    );
  }
  const base = conferirBase(grupo, plano);
  if (!base.ok) return base;
  return { ok: true, grupo };
}

function validarLimite(plano, limite) {
  if (plano.ordem.length > limite) {
    return falha(
      "LIMITE_IMAGENS",
      `Não é possível salvar. ${nomeDoGrupo(plano)} pode ter no máximo ${limite} imagens.`,
      "validacao",
      { statusHttp: 400 }
    );
  }
  return { ok: true };
}

function resolverOrdem(ordem, idsNovos) {
  return ordem.map((e) => (typeof e.existente === "string" ? e.existente : String(idsNovos[e.nova])));
}

// estado atual (item, lido agora) + ordem pedida = payload completo.
//   com variações: TODAS as variações (a do grupo com a ordem pedida, as
//     outras com os picture_ids atuais) e a galeria atual sem as excluídas
//     que nenhuma outra variação usa, com as novas no fim;
//   sem variação: a galeria é a própria ordem.
function reconstruirPayload(item, grupo, ordemIds) {
  const galeria = item.pictures.map((p) => String(p.id));
  const grupoIds = grupo.fotos.map((f) => f.id);
  const excluidas = grupoIds.filter((id) => !ordemIds.includes(id));

  if (!grupo.grupoVariacao) {
    return { payload: { pictures: ordemIds.map((id) => ({ id })) }, removidas: excluidas };
  }

  const noGrupo = new Set(grupo.variacoes.map((v) => v.id));
  const usadasFora = new Set();
  for (const v of item.variations) {
    if (!noGrupo.has(String(v.id))) (v.picture_ids || []).forEach((id) => usadasFora.add(String(id)));
  }
  const removidas = excluidas.filter((id) => !usadasFora.has(id));
  const novas = ordemIds.filter((id) => !galeria.includes(id));
  return {
    payload: {
      pictures: galeria.filter((id) => !removidas.includes(id)).concat(novas).map((id) => ({ id })),
      variations: item.variations.map((v) => ({
        id: v.id,
        picture_ids: noGrupo.has(String(v.id)) ? ordemIds.slice() : (v.picture_ids || []).map(String),
      })),
    },
    removidas,
  };
}

function falhaCritica(codigo, motivo, contexto) {
  console.error(JSON.stringify({ event: "meli_fotos_perda_critica", codigo, ...contexto }));
  return falha(codigo, motivo, "confirmacao", { critico: true });
}

const MOTIVO_DIVERGENTE =
  "O Mercado Livre aceitou a alteração, mas as fotos não ficaram como enviado. Confira no Mercado Livre antes de tentar de novo.";

// Compara o estado usado no PUT (itemBase) com o lido depois (itemDepois).
function conferirFotos(itemBase, itemDepois, grupo, ordemIds, removidas) {
  const ctx = { itemId: itemBase.id };
  const galeriaDepois = (itemDepois.pictures || []).map((p) => p && String(p.id));

  // Toda foto que não foi excluída precisa continuar na galeria.
  const perdidas = itemBase.pictures
    .map((p) => String(p.id))
    .filter((id) => !removidas.includes(id) && !galeriaDepois.includes(id));
  if (perdidas.length) {
    return falhaCritica(
      "PERDA_DE_FOTO",
      "ATENÇÃO: fotos que deviam continuar no anúncio não aparecem mais no Mercado Livre. Confira no Mercado Livre antes de repetir qualquer edição.",
      { ...ctx, perdidas }
    );
  }

  if (grupo.grupoVariacao) {
    const depoisPorId = {};
    for (const v of itemDepois.variations || []) if (v && v.id != null) depoisPorId[String(v.id)] = v;
    const sumiuVar = itemBase.variations.some((v) => !depoisPorId[String(v.id)]);
    if (sumiuVar || (itemDepois.variations || []).length < itemBase.variations.length) {
      return falhaCritica(
        "PERDA_DE_VARIACAO",
        "ATENÇÃO: uma ou mais variações deste anúncio podem ter sido removidas pelo Mercado Livre. Confira no Mercado Livre antes de repetir qualquer edição.",
        { ...ctx, nAntes: itemBase.variations.length, nDepois: (itemDepois.variations || []).length }
      );
    }
    const noGrupo = new Set(grupo.variacoes.map((v) => v.id));
    for (const v of itemBase.variations) {
      const esperado = noGrupo.has(String(v.id)) ? ordemIds : (v.picture_ids || []).map(String);
      const veio = (depoisPorId[String(v.id)].picture_ids || []).map(String);
      if (JSON.stringify(veio) !== JSON.stringify(esperado)) {
        return falha("CONFIRMACAO_DIVERGENTE", MOTIVO_DIVERGENTE, "confirmacao");
      }
    }
  } else if (JSON.stringify(galeriaDepois) !== JSON.stringify(ordemIds)) {
    return falha("CONFIRMACAO_DIVERGENTE", MOTIVO_DIVERGENTE, "confirmacao");
  }

  // Excluída que continuou ou nova que não entrou na galeria.
  if (removidas.some((id) => galeriaDepois.includes(id)) || ordemIds.some((id) => !galeriaDepois.includes(id))) {
    return falha("CONFIRMACAO_DIVERGENTE", MOTIVO_DIVERGENTE, "confirmacao");
  }
  return { ok: true };
}

module.exports = {
  LIMITE_OPERACIONAL,
  mesmoValor,
  montarGrupos,
  grupoSimples,
  localizarGrupo,
  validarForma,
  validarPlano,
  validarLimite,
  conferirBase,
  resolverOrdem,
  reconstruirPayload,
  conferirFotos,
};
