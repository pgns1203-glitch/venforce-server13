// server/utils/competenciaDetectada.js
//
// VenForce V3 P2.6 — BLOCO C / D2: DECLARAR a competência que o fechamento
// realmente processou.
//
// O problema (Squads_migration/VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md §D2):
// `POST /fechamentos/financeiro` não recebe nem infere período — o recorte é
// 100% o conteúdo da planilha enviada. Isso é honesto para a tela legada, em
// que o usuário escolhe o arquivo. Vira problema ao MIGRAR: o Financeiro V3
// tem seletor de competência no cabeçalho e `?periodo=YYYY-MM` na URL, então
// um botão "Processar" ali pareceria operar sobre a competência exibida — e
// não operaria. Processar Julho achando que processou Agosto e publicar o
// resultado para o cliente é dinheiro.
//
// Das duas saídas propostas pela Pessoa 1, esta é a (b) — DECLARAÇÃO:
// o endpoint devolve a competência que efetivamente encontrou nos dados, e o
// frontend confronta com o que está em tela. Escolhida porque não rejeita
// nenhum upload que hoje funciona (zero breaking change no legado) e já elimina
// o risco: o V3 pode avisar antes de salvar.
//
// DE PROPÓSITO fora daqui: qualquer palpite. Se a planilha não tiver coluna de
// data reconhecível, `competencia` é `null` — e `null` significa "não deu para
// determinar", nunca "é o mês atual".
//
// Roda sobre as LINHAS JÁ PARSEADAS (array de objetos com os cabeçalhos da
// própria planilha), não sobre os motores de cálculo. É leitura pura: não toca
// em nenhum número do fechamento.

const { normalizarCompetencia } = require("./competenciaCanonica");

// Nomes de coluna de data nos três marketplaces (MELI, Shopee, TikTok), em
// português e inglês. Comparados sem acento/caixa/pontuação.
const COLUNAS_DE_DATA = [
  "data", "data da venda", "data do pedido", "data de criacao", "data de compra",
  "data do pagamento", "data de liquidacao", "data prevista", "data de aprovacao",
  "data de envio", "dia", "competencia",
  "order create time", "created time", "order paid time", "statement time",
  "date created", "date", "order date", "purchase date", "settlement time",
];

// Valores tipo "2026-08-15", "15/08/2026", "2026-08-15T10:00:00Z", "15-08-2026".
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
const BR_RE = /^(\d{2})[/-](\d{2})[/-](\d{4})(?:[T ].*)?$/;

function chaveNormalizada(nome) {
  return String(nome || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COLUNAS_SET = new Set(COLUNAS_DE_DATA.map(chaveNormalizada));

function ehColunaDeData(nome) {
  return COLUNAS_SET.has(chaveNormalizada(nome));
}

// Devolve "YYYY-MM-DD" ou null. Lê a data LITERALMENTE do texto — não passa
// por `new Date()`, que jogaria o dia (e às vezes o mês) de um lado para o
// outro dependendo do fuso do servidor.
function parseDataDeCelula(valor) {
  if (valor == null) return null;

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    const a = valor.getFullYear();
    const m = String(valor.getMonth() + 1).padStart(2, "0");
    const d = String(valor.getDate()).padStart(2, "0");
    return `${a}-${m}-${d}`;
  }

  // Número solto é quase sempre serial do Excel; sem saber a época da planilha
  // (1900 vs 1904) o palpite erra por anos. Ignorado de propósito.
  if (typeof valor !== "string") return null;

  const texto = valor.trim();
  if (!texto) return null;

  let m = texto.match(ISO_RE);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = texto.match(BR_RE);
  if (m) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  return null;
}

// Analisa as linhas e devolve o que dá para AFIRMAR sobre a competência.
//
// Retorno:
//   {
//     competencia: "YYYY-MM" | null,   // dominante; null = indeterminado
//     dataMin: "YYYY-MM-DD" | null,
//     dataMax: "YYYY-MM-DD" | null,
//     competencias: [{ competencia, linhas }],  // ordenado por volume
//     linhasComData, linhasTotal,
//     multiplasCompetencias: boolean,
//     coluna: "<cabeçalho usado>" | null,
//   }
function detectarCompetenciaDeLinhas(linhas) {
  const vazio = {
    competencia: null, dataMin: null, dataMax: null, competencias: [],
    linhasComData: 0, linhasTotal: 0, multiplasCompetencias: false, coluna: null,
  };
  if (!Array.isArray(linhas) || !linhas.length) return vazio;

  // Descobre a coluna de data olhando a primeira linha que tenha uma.
  let coluna = null;
  for (const linha of linhas) {
    if (!linha || typeof linha !== "object") continue;
    for (const chave of Object.keys(linha)) {
      if (ehColunaDeData(chave) && parseDataDeCelula(linha[chave])) {
        coluna = chave;
        break;
      }
    }
    if (coluna) break;
  }
  if (!coluna) return { ...vazio, linhasTotal: linhas.length };

  const contagem = new Map();
  let dataMin = null;
  let dataMax = null;
  let linhasComData = 0;

  for (const linha of linhas) {
    const data = parseDataDeCelula(linha?.[coluna]);
    if (!data) continue;
    linhasComData += 1;
    if (dataMin === null || data < dataMin) dataMin = data;
    if (dataMax === null || data > dataMax) dataMax = data;
    const comp = normalizarCompetencia(data);
    if (comp) contagem.set(comp, (contagem.get(comp) || 0) + 1);
  }

  const competencias = [...contagem.entries()]
    .map(([competencia, linhasDaComp]) => ({ competencia, linhas: linhasDaComp }))
    .sort((a, b) => (b.linhas - a.linhas) || a.competencia.localeCompare(b.competencia));

  return {
    competencia: competencias.length ? competencias[0].competencia : null,
    dataMin,
    dataMax,
    competencias,
    linhasComData,
    linhasTotal: linhas.length,
    multiplasCompetencias: competencias.length > 1,
    coluna,
  };
}

// Confronta o que foi PEDIDO com o que foi ENCONTRADO. Nunca rejeita nada:
// só descreve, para o frontend decidir se avisa antes de salvar.
//
// `divergente` só é `true` quando existem os DOIS lados — sem período pedido,
// ou sem competência detectada, não há divergência a afirmar (seria inventar
// um alerta a partir de ausência de informação).
function compararCompetencias({ periodoSolicitado, deteccao }) {
  const solicitado = normalizarCompetencia(periodoSolicitado);
  const detectado = deteccao?.competencia || null;

  let divergente = false;
  let motivo = null;

  if (solicitado && detectado) {
    if (solicitado !== detectado) {
      divergente = true;
      motivo = `A planilha e majoritariamente de ${detectado}, mas o periodo pedido foi ${solicitado}.`;
    } else if (deteccao.multiplasCompetencias) {
      divergente = true;
      motivo = "A planilha atravessa mais de uma competencia.";
    }
  } else if (!detectado && solicitado) {
    motivo = "Nao foi possivel determinar a competencia dos dados enviados.";
  }

  return {
    periodoSolicitado: solicitado,
    periodoDetectado: detectado,
    dataMin: deteccao?.dataMin || null,
    dataMax: deteccao?.dataMax || null,
    competencias: deteccao?.competencias || [],
    multiplasCompetencias: !!deteccao?.multiplasCompetencias,
    linhasComData: deteccao?.linhasComData || 0,
    linhasTotal: deteccao?.linhasTotal || 0,
    divergente,
    motivo,
  };
}

module.exports = {
  detectarCompetenciaDeLinhas,
  compararCompetencias,
  parseDataDeCelula,
  ehColunaDeData,
};
