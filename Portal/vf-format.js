// Portal/vf-format.js
//
// Formatação canônica do Shell V3 (F0.1B): escaping e formatação de
// exibição — moeda, número, percentual, data. Consolida o padrão já
// dominante no Portal (Intl.NumberFormat/toLocaleString "pt-BR",
// escaping sem DOM já usado em Portal/central-margem.js:80-87).
//
// Formatting != cálculo: nenhuma regra de negócio financeira aqui.
//
// Não depende de DOM para formatar, não depende de backend, não conhece
// contexto operacional. Testável isoladamente em Node puro.
//
// ES Module. Também espelhado em window.VF.format para as páginas
// clássicas ainda não migradas — a fonte canônica continua sendo este
// módulo, window.VF é só a ponte de leitura.

const AUSENTE = "—";

function numeroOuNulo(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function escapeHTML(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function moeda(value) {
  const n = numeroOuNulo(value);
  if (n === null) return AUSENTE;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

// decimals: casas decimais fixas — é o que uma coluna numérica de tabela
// operacional precisa (mesmo alinhamento em toda a coluna).
export function numero(value, decimals = 0) {
  const n = numeroOuNulo(value);
  if (n === null) return AUSENTE;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// value é fração (0.105 → "10,5%"), mesma convenção de Portal/dashboard.js.
export function percentual(value, decimals = 1) {
  const n = numeroOuNulo(value);
  if (n === null) return AUSENTE;
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function data(value, options) {
  if (value === null || value === undefined || value === "") return AUSENTE;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return AUSENTE;
  return d.toLocaleString("pt-BR", options || { dateStyle: "short", timeStyle: "short" });
}

export const format = { escapeHTML, moeda, numero, percentual, data };

if (typeof window !== "undefined") {
  window.VF = window.VF || {};
  window.VF.format = format;
}
