// frontend-react/src/utils/financeiro/competencia.js
//
// Competência de uma entrega GRAVADA, comparada por IGUALDADE — espelho de
// server/utils/competenciaCanonica.js (`normalizarCompetencia` /
// `mesmaCompetencia`). Antes a tela usava `String(periodo).includes(...)`,
// e uma entrega "2026-07 a 2026-08" respondia por Julho E por Agosto.
//
// `entregas_cliente.periodo` é texto livre no legado ("Maio 2026"), por isso
// o mês por extenso é aceito NA LEITURA. Intervalo ou texto ambíguo vira
// null: nunca escolhemos um dos lados.

const MESES_PT = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
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

function montar(ano, mes) {
  const a = Number(ano);
  const m = Number(mes);
  if (!Number.isInteger(a) || !Number.isInteger(m) || m < 1 || m > 12 || a < 1970 || a > 9999) return null;
  return `${a}-${String(m).padStart(2, "0")}`;
}

function mesPorExtenso(nome) {
  const chave = String(nome || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return Object.prototype.hasOwnProperty.call(MESES_PT, chave) ? MESES_PT[chave] : null;
}

export function normalizarCompetencia(valor) {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  if (!texto) return null;

  let m = texto.match(/^(\d{4})-(\d{2})$/);
  if (m) return montar(m[1], m[2]);
  m = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (m) return montar(m[1], m[2]);
  m = texto.match(/^(\d{2})\/(\d{4})$/);
  if (m) return montar(m[2], m[1]);
  m = texto.match(/^(\d{4})\/(\d{2})$/);
  if (m) return montar(m[1], m[2]);

  const minusculo = texto.toLowerCase();
  m = minusculo.match(/^([a-zà-ÿ]+)(?:\s+de)?[\s/-]+(\d{4})$/);
  if (m) {
    const mes = mesPorExtenso(m[1]);
    return mes ? montar(m[2], mes) : null;
  }
  m = minusculo.match(/^(\d{4})[\s/-]+([a-zà-ÿ]+)$/);
  if (m) {
    const mes = mesPorExtenso(m[2]);
    return mes ? montar(m[1], mes) : null;
  }
  return null;
}

export function mesmaCompetencia(a, b) {
  const na = normalizarCompetencia(a);
  return na !== null && na === normalizarCompetencia(b);
}
