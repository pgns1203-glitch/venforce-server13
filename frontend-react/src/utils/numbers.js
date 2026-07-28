// Base de todas as formatações: a regra de honestidade do Portal.
//   null / undefined / NaN  = AUSENTE  → "—"
//   0                        = zero REAL → "R$ 0,00" / "0%"
// Nunca inventar zero para um dado que não existe.
//
// O backend devolve NÚMEROS; toda a formatação pt-BR acontece aqui, no cliente.

export const AUSENTE = "—";

export function ehAusente(valor) {
  if (valor === null || valor === undefined) return true;
  if (typeof valor === "number") return !Number.isFinite(valor);
  return false;
}

// Número puro em pt-BR (sem unidade).
export function formatarNumero(valor, casas = 0) {
  if (ehAusente(valor)) return AUSENTE;
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

// Direção para colorir/rotular: positivo | negativo | neutro | ausente.
// `inverso` serve para métricas em que subir é ruim (custo/faturamento, cancelamentos).
export function direcao(valor, { inverso = false } = {}) {
  if (ehAusente(valor)) return "ausente";
  const n = Number(valor);
  if (n === 0) return "neutro";
  return (inverso ? n < 0 : n > 0) ? "positivo" : "negativo";
}

// Soma tolerante a ausentes: retorna null se QUALQUER parcela for ausente,
// para não fabricar total a partir de dado faltante.
export function somaEstrita(...valores) {
  if (valores.some(ehAusente)) return null;
  return valores.reduce((s, v) => s + Number(v), 0);
}
