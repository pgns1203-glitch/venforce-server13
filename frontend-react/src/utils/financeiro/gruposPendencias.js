// frontend-react/src/utils/financeiro/gruposPendencias.js
//
// "7 produtos precisam de custo" não diz ao operador o que ele PODE fazer.
// Este módulo divide as pendências em três grupos, sempre uma PARTIÇÃO (cada
// pendência está em exatamente um grupo, e a soma bate com o total):
//
//   agora      Corrigir agora no portal — a identidade é segura (o ID aponta
//              para um único registro da base, ou para um registro novo).
//   planilha   Corrigir por planilha — as MESMAS pendências seguras, quando
//              são muitas para digitar uma a uma (ou quando o operador prefere).
//   bloqueadas Bloqueadas / dependem de decisão — o que não dá para gravar com
//              segurança sem uma escolha explícita (Shopee: o Item já tem o
//              registro de outra variação) ou sem corrigir fora daqui (sem ID
//              do Item, custo ambíguo, 2+ registros do mesmo Item).
//
// Quem decide "seguro / ambíguo / insuficiente" é identidadeDaPendencia
// (baseCustos.js), com os registros REAIS da base. Aqui só se agrupa — nenhuma
// regra de matching nova e nenhum número financeiro.

import { identidadeDaPendencia, normalizarId } from "./baseCustos.js";

// Até aqui, digitar uma a uma é mais rápido que montar planilha.
export const LIMITE_CORRECAO_INDIVIDUAL = 12;

// preferencia: null (decide pelo volume) | "portal" | "planilha"
// registrados: { [chave]: registro } — o que já foi gravado NESTA tela fica no
// grupo em que foi corrigido, mesmo que a base relida mude a identidade dele.
export function classificarPendencias({
  pendencias,
  marketplace,
  indice,
  preferencia = null,
  registrados = {},
  limite = LIMITE_CORRECAO_INDIVIDUAL,
}) {
  const corrigiveis = [];
  const decisao = [];
  const bloqueadas = [];

  for (const p of pendencias || []) {
    if (registrados[p.chave]) {
      corrigiveis.push(p);
      continue;
    }
    const identidade = identidadeDaPendencia({ marketplace, pendencia: p, indice });
    if (identidade.classe === "segura") corrigiveis.push(p);
    else if (identidade.classe === "ambigua") decisao.push({ pendencia: p, motivo: identidade.motivo });
    else bloqueadas.push({ pendencia: p, motivo: identidade.motivo });
  }

  const modoPadrao = corrigiveis.length > limite ? "planilha" : "portal";
  const modo = preferencia || modoPadrao;

  // Pendências seguras do MESMO Item: a base guarda um registro por Item, então
  // gravar a segunda substitui a primeira. A tela avisa em cada uma.
  const porItem = new Map();
  for (const p of corrigiveis) {
    const id = normalizarId(marketplace, p.itemId);
    if (id) porItem.set(id, (porItem.get(id) || 0) + 1);
  }
  const mesmoItem = {};
  for (const p of corrigiveis) {
    const n = porItem.get(normalizarId(marketplace, p.itemId)) || 0;
    if (n > 1) mesmoItem[p.chave] = n;
  }

  return {
    modo,
    modoPadrao,
    corrigiveis,
    agora: modo === "portal" ? corrigiveis : [],
    planilha: modo === "planilha" ? corrigiveis : [],
    decisao,
    bloqueadas,
    mesmoItem,
    contagem: {
      agora: modo === "portal" ? corrigiveis.length : 0,
      planilha: modo === "planilha" ? corrigiveis.length : 0,
      bloqueadas: decisao.length + bloqueadas.length,
    },
  };
}
