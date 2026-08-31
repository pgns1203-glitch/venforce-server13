// server/utils/competenciaCanonica.js
//
// VenForce V3 P2.6 — BLOCO C (período explícito) e BLOCO G (normalização de
// `relatorios[].periodo`).
//
// Este módulo é a ÚNICA fonte de verdade sobre "que competência é essa".
// Existe por causa de três dívidas reais encontradas na auditoria P2.6:
//
//   1. COMPETÊNCIA IMPLÍCITA — `periodoUtils.rangeFromCompetencia` cai em
//      `competenciaAtual()` quando a entrada é ausente OU inválida. Pedir
//      `?periodo=lixo` operava o MÊS ATUAL em silêncio: o usuário pede Julho
//      e o backend responde Agosto. Aqui isso é sempre um 400 explícito.
//
//   2. COMPARAÇÃO POR SUBSTRING — `String(e.periodo).includes(competencia)`
//      fazia "2026-07 a 2026-08" casar com Julho E com Agosto, ou seja, a
//      MESMA entrega respondia por duas competências. `mesmaCompetencia`
//      compara igualdade exata depois de normalizar os dois lados.
//
//   3. ESCRITA E LEITURA EM FORMATOS DIFERENTES — `entregas_cliente.periodo`
//      é VARCHAR(100) livre, sem validação na escrita, e o Portal grava texto
//      em português ("Maio 2026" — o placeholder literal de
//      Portal/financeiro.html). NENHUM caminho de código gravava `YYYY-MM`,
//      enquanto os leitores exigiam `YYYY-MM`. Resultado: praticamente todo
//      relatório real aparecia sem período. Por isso o mês por extenso em
//      português é um formato de ENTRADA reconhecido aqui: é o formato que os
//      dados legados realmente têm. Isso é INFERÊNCIA A PARTIR DO DADO, não
//      invenção — o texto já diz qual é o mês.
//
// Honestidade acima de completude (BLOCO G): o que continua sem dar para
// inferir com segurança vira `null`, NUNCA um período fabricado. Um
// `periodo: null` num relatório legado é uma resposta correta; um período
// inventado não é. Em especial, um intervalo ("2026-07 a 2026-08") é
// ambíguo por definição e vira `null` — nunca escolhemos um dos lados.
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

// Mês por extenso em português — o formato REAL dos dados legados de
// entregas_cliente (ver cabeçalho, item 3). Aceita "Maio 2026", "maio/2026",
// "maio de 2026" e as formas sem acento que aparecem em dado digitado à mão.
const MESES_PT = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, "março": 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};
const MES_EXTENSO_RE = /^([a-zà-ÿ]+)(?:\s+de)?[\s/-]+(\d{4})$/;
const ANO_MES_EXTENSO_RE = /^(\d{4})[\s/-]+([a-zà-ÿ]+)$/;

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

function mesPorExtenso(nome) {
  // Remove diacriticos: "marco" e "ço" chegam na mesma chave.
  const chave = String(nome || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return Object.prototype.hasOwnProperty.call(MESES_PT, chave) ? MESES_PT[chave] : null;
}

// NÚCLEO CANÔNICO — só os formatos que o CONTRATO da API aceita:
// YYYY-MM, YYYY-MM-DD, timestamp ISO e Date. Nada de texto por extenso:
// numa entrada de request, ser tolerante é justamente o que reintroduz a
// ambiguidade que este módulo existe para eliminar. Retorna null se não casar.
function normalizarCompetenciaEstrita(valor) {
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

// NORMALIZAÇÃO DE DADO ARMAZENADO (legado) — o núcleo canônico MAIS o mês por
// extenso em português, que é o formato que `entregas_cliente.periodo` de fato
// tem em produção. Usada para LER o que já está gravado, nunca para validar
// um parâmetro de request (para isso existe `exigirCompetencia`, estrito).
// Continua devolvendo null para tudo que for ambíguo — nunca fabrica período.
function normalizarCompetencia(valor) {
  const canonico = normalizarCompetenciaEstrita(valor);
  if (canonico) return canonico;
  if (typeof valor !== "string") return null;

  const baixo = valor.trim().toLowerCase();
  if (!baixo) return null;

  let m = baixo.match(MES_EXTENSO_RE);
  if (m) {
    const mes = mesPorExtenso(m[1]);
    return mes ? montar(m[2], mes) : null;
  }

  m = baixo.match(ANO_MES_EXTENSO_RE);
  if (m) {
    const mes = mesPorExtenso(m[2]);
    return mes ? montar(m[1], mes) : null;
  }

  return null;
}

// Competência OBRIGATÓRIA de request. Distingue "não mandou" de "mandou
// errado" para o frontend conseguir dar a mensagem certa.
function exigirCompetencia(valor, { campo = "periodo" } = {}) {
  const ehData = valor instanceof Date;
  if (!ehData && !String(valor ?? "").trim()) {
    throw criarErroHttp(400, `${campo} é obrigatório no formato YYYY-MM.`, CODIGOS_CANONICOS.PERIODO_OBRIGATORIO);
  }
  const competencia = normalizarCompetenciaEstrita(valor);
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
  normalizarCompetenciaEstrita,
  exigirCompetencia,
  mesmaCompetencia,
  rangeDaCompetencia,
};
