// server/utils/competenciaCanonica.js
//
// VenForce V3 P2.6 — BLOCO C (período explícito) e BLOCO G (normalização de
// `relatorios[].periodo`).
//
// Este módulo é a ÚNICA fonte de verdade sobre "que competência é essa".
// Existe por causa de duas dívidas reais encontradas na auditoria P2.6:
//
//   1. COMPETÊNCIA IMPLÍCITA — `periodoUtils.resolverPeriodo`/
//      `rangeFromCompetencia` caem em `competenciaAtual()` quando a entrada
//      é ausente OU inválida. Pedir `?periodo=lixo` operava o MÊS ATUAL em
//      silêncio: o usuário pede Julho e o backend responde Agosto. Aqui isso
//      é sempre um erro 400 explícito — nunca um fallback.
//
//   2. COMPARAÇÃO POR SUBSTRING — `String(e.periodo).includes(competencia)`
//      fazia "2026-07 a 2026-08" casar com Julho E com Agosto, ou seja, a
//      MESMA entrega respondia por duas competências. `mesmaCompetencia`
//      compara igualdade exata depois de normalizar os dois lados.
//
// Honestidade acima de completude (BLOCO G): o que não dá para inferir com
// segurança vira `null`, NUNCA um período fabricado. Um `periodo: null` num
// relatório legado é uma resposta correta; um período inventado não é.
//
// Formatos aceitos na normalização (todos ancorados — a string inteira tem
// que casar, senão é `null`):
//   YYYY-MM            competência canônica
//   YYYY-MM-DD         data ISO → competência do mês
//   YYYY-MM-DDTHH:...  timestamp ISO → competência do mês (ver TIMEZONE)
//   MM/YYYY            formato BR legado
//   YYYY/MM
//   Date               objeto Date válido (componentes LOCAIS)
//
// TIMEZONE: de uma STRING a competência é lida LITERALMENTE do texto, sem
// passar por `new Date()`. Isso é deliberado: converter "2026-07-31T23:00:00Z"
// para Date e ler o mês jogaria a competência para Agosto (ou não) dependendo
// do fuso do servidor. O texto já diz 2026-07 — é isso que vale. De um objeto
// `Date` usamos os componentes LOCAIS, coerentes com `periodoUtils.ymd()`.

const { CODIGOS_CANONICOS } = require("./erroContextoCanonico");

const COMPETENCIA_RE = /^(\d{4})-(\d{2})$/;
const DATA_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
const BR_MES_ANO_RE = /^(\d{2})\/(\d{4})$/;
const ANO_BARRA_MES_RE = /^(\d{4})\/(\d{2})$/;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function montar(ano, mes) {
  const a = Number(ano);
  const m = Number(mes);
  if (!Number.isInteger(a) || !Number.isInteger(m)) return null;
  if (m < 1 || m > 12) return null;
  if (a < 1970 || a > 9999) return null;
  return `${a}-${pad2(m)}`;
}

function criarErroHttp(statusCode, mensagem, code) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

// Normaliza qualquer representação conhecida para "YYYY-MM".
// Retorna null quando não é possível inferir com segurança — nunca chuta.
function normalizarCompetencia(valor) {
  if (valor == null) return null;

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    // Componentes locais, coerentes com periodoUtils.ymd().
    return montar(valor.getFullYear(), valor.getMonth() + 1);
  }

  // Number/boolean/objeto não são representações de competência aceitas:
  // 202607 é ambíguo demais para adivinhar.
  if (typeof valor !== "string") return null;

  const texto = valor.trim();
  if (!texto) return null;

  let m = texto.match(COMPETENCIA_RE);
  if (m) return montar(m[1], m[2]);

  m = texto.match(DATA_ISO_RE);
  if (m) return montar(m[1], m[2]);

  m = texto.match(BR_MES_ANO_RE);
  if (m) return montar(m[2], m[1]);

  m = texto.match(ANO_BARRA_MES_RE);
  if (m) return montar(m[1], m[2]);

  return null;
}

// Competência OBRIGATÓRIA de request. Distingue "não mandou" de "mandou
// errado" para o frontend conseguir dar a mensagem certa.
function exigirCompetencia(valor, { campo = "periodo" } = {}) {
  const bruto = valor instanceof Date ? valor : String(valor ?? "").trim();
  if (!(valor instanceof Date) && !bruto) {
    throw criarErroHttp(400, `${campo} é obrigatório no formato YYYY-MM.`, CODIGOS_CANONICOS.PERIODO_OBRIGATORIO);
  }
  const competencia = normalizarCompetencia(valor);
  if (!competencia) {
    throw criarErroHttp(400, `${campo} inválido: use o formato YYYY-MM.`, CODIGOS_CANONICOS.PERIODO_INVALIDO);
  }
  return competencia;
}

// Igualdade EXATA de competência. Substitui o `.includes()` que deixava uma
// entrega de intervalo responder por dois meses. `null` nunca casa — nem com
// outro `null`: ausência de competência não é "a mesma competência".
function mesmaCompetencia(a, b) {
  const na = normalizarCompetencia(a);
  const nb = normalizarCompetencia(b);
  if (!na || !nb) return false;
  return na === nb;
}

// Range [dateFrom, dateTo] do mês inteiro da competência, em YYYY-MM-DD.
// Diferente de `periodoUtils.rangeFromCompetencia`, NÃO tem fallback para o
// mês atual: entrada inválida é erro 400.
function rangeDaCompetencia(valor, { campo = "periodo" } = {}) {
  const competencia = exigirCompetencia(valor, { campo });
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    competencia,
    dateFrom: `${competencia}-01`,
    dateTo: `${competencia}-${pad2(ultimoDia)}`,
  };
}

module.exports = {
  normalizarCompetencia,
  exigirCompetencia,
  mesmaCompetencia,
  rangeDaCompetencia,
};
