// server/services/promoSnapshot/promoSnapshotFonte.js
// Promo Snapshot — FONTE ÚNICA de promoções para as telas.
//
// A aba Promoções (listarOportunidades) e a Bancada (simular) respondem com o
// MESMO objeto `fontePromocoes`, montado aqui a partir do estado de
// sincronização da conta + a allowlist do piloto + (só se a conta não tem
// snapshot) o diagnóstico legado. As duas telas só renderizam este objeto —
// nenhuma decide estado por conta própria, então nunca divergem.
//
//   estado                         rotulo
//   fora_do_piloto                 Promoções automáticas não ativadas para esta conta
//   primeira_sincronizacao_pendente Primeira sincronização pendente
//   sincronizando                  Sincronizando promoções…
//   desatualizado (stale)          atualizando
//   falhou                         falha na atualização · <motivo>
//   atualizado (fresh/parcial)     "" (só a data do snapshot)
//
// Precedência: fora do piloto > sincronizando > falhou > (sem snapshot) primeira
// pendente > desatualizado > atualizado. `ultimoBom` existe sempre que a conta
// tem snapshot (mostrado mesmo em stale/sincronizando/falhou). `legado` só
// existe quando a conta NÃO tem snapshot: é diagnóstico antigo, rotulado como
// tal, e a Bancada o trata como estimativa (sem Participar).

const { avaliarPiloto } = require("./promoSnapshotConfig");

const ESTADO = Object.freeze({
  FORA_DO_PILOTO: "fora_do_piloto",
  PRIMEIRA_PENDENTE: "primeira_sincronizacao_pendente",
  SINCRONIZANDO: "sincronizando",
  DESATUALIZADO: "desatualizado",
  FALHOU: "falhou",
  ATUALIZADO: "atualizado",
});

const ROTULO = Object.freeze({
  [ESTADO.FORA_DO_PILOTO]: "Promoções automáticas não ativadas para esta conta",
  [ESTADO.PRIMEIRA_PENDENTE]: "Primeira sincronização pendente",
  [ESTADO.SINCRONIZANDO]: "Sincronizando promoções…",
  [ESTADO.DESATUALIZADO]: "atualizando",
  [ESTADO.FALHOU]: "falha na atualização",
  [ESTADO.ATUALIZADO]: "",
});

const MOTIVO_DA_FALHA = Object.freeze({
  ML_GRANT_REVOKED: "conexão com o Mercado Livre revogada",
  PROMO_SNAPSHOT_GRANT_INDISPONIVEL: "conexão com o Mercado Livre indisponível",
  CONTA_SEM_GRANT_ML: "conta sem conexão com o Mercado Livre",
  PROMO_SNAPSHOT_RUN_STALE: "a leitura travou e foi encerrada",
  PROMO_SNAPSHOT_WORKER_STOPPED: "servidor reiniciado durante a leitura",
  MARGIN_SNAPSHOT_WORKER_STOPPED: "servidor reiniciado durante a leitura",
  PROMO_SNAPSHOT_PARCIAL_NAO_PROMOVIDO: "muitos anúncios sem leitura",
  PROMO_SNAPSHOT_LOTES_FALHANDO: "o Mercado Livre falhou em vários lotes seguidos",
  PROMO_SNAPSHOT_ML_ERRO: "erro do Mercado Livre",
  PROMO_SNAPSHOT_CATALOGO_FALHOU: "não foi possível listar os anúncios",
  PROMO_SNAPSHOT_CATALOGO_EXCEDE_LIMITE: "catálogo acima do limite",
  PROMO_SNAPSHOT_NENHUM_ITEM_LIDO: "nenhum anúncio lido",
  PROMO_SNAPSHOT_PROGRESSO_INCONSISTENTE: "leitura inconsistente",
  PROMO_SNAPSHOT_SELLER_DIVERGENTE: "a conta foi reconectada a outro vendedor",
  PROMO_SNAPSHOT_SELLER_SUBSTITUIDO: "a conta foi reconectada a outro vendedor",
});

/** Texto curto para o operador; código desconhecido aparece como está (nunca vazio). */
function motivoDaFalha(codigo) {
  if (!codigo) return "erro desconhecido";
  return MOTIVO_DA_FALHA[codigo] || String(codigo);
}

function numeroOuNulo(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} p
 * @param {object|null} p.estado     retorno de estadoSincronizacao (null = tabelas ainda inexistentes)
 * @param {object} p.config          resolvePromoSnapshotConfig
 * @param {string|null} p.clienteSlug
 * @param {{ id:number, createdAt:any, parcial:boolean }|null} [p.legado]  último diagnóstico da tela antiga
 */
function montarFontePromocoes({ estado, config, clienteSlug, legado = null }) {
  const temSnapshot = Boolean(estado && estado.hasSnapshot);
  const piloto = avaliarPiloto(config, clienteSlug);

  let codigoEstado;
  let motivo = null;
  let falha = null;
  if (!piloto.noPiloto) {
    codigoEstado = ESTADO.FORA_DO_PILOTO;
    motivo = piloto.motivo;
  } else if (estado && estado.state === "syncing") {
    codigoEstado = ESTADO.SINCRONIZANDO;
  } else if (estado && estado.state === "failed") {
    codigoEstado = ESTADO.FALHOU;
    motivo = estado.errorCode || null;
    falha = { codigo: estado.errorCode || null, motivo: motivoDaFalha(estado.errorCode), em: estado.lastAttemptAt || null };
  } else if (!temSnapshot) {
    codigoEstado = ESTADO.PRIMEIRA_PENDENTE;
  } else if (estado.snapshotState === "stale") {
    codigoEstado = ESTADO.DESATUALIZADO;
  } else {
    codigoEstado = ESTADO.ATUALIZADO;
  }

  const rotulo = codigoEstado === ESTADO.FALHOU ? `${ROTULO[ESTADO.FALHOU]} · ${falha.motivo}` : ROTULO[codigoEstado];
  const usaLegado = !temSnapshot && Boolean(legado);

  return {
    estado: codigoEstado,
    rotulo,
    motivo,
    atualizando: codigoEstado === ESTADO.SINCRONIZANDO || codigoEstado === ESTADO.DESATUALIZADO,
    falha,
    progresso: codigoEstado === ESTADO.SINCRONIZANDO && estado && estado.total
      ? { processados: numeroOuNulo(estado.processed) || 0, total: numeroOuNulo(estado.total) }
      : null,
    ultimoBom: temSnapshot
      ? {
        runId: estado.snapshotRunId,
        geradoEm: estado.snapshotAt,
        parcial: estado.partial === true,
        itensSemLeitura: Number(estado.itemsWithoutRead) || 0,
        itensHerdados: Number(estado.itemsInherited) || 0,
      }
      : null,
    legado: usaLegado
      ? { diagnosticoId: Number(legado.id), geradoEm: legado.createdAt, parcial: legado.parcial === true }
      : null,
    origemDados: temSnapshot ? "promo_snapshot" : usaLegado ? "diagnostico_legado" : null,
  };
}

module.exports = { montarFontePromocoes, motivoDaFalha, ESTADO, ROTULO };
