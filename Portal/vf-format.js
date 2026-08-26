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

// "há 2 h", "há 20 min", "ontem" — Shell V3 (F0.5) e Carteira (F1.1) usam
// isto para "última sync". Adicionado nesta unidade porque é formatação de
// exibição igual às demais deste arquivo, não regra de negócio.
export function desde(value, agora) {
  if (value === null || value === undefined || value === "") return "nunca";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return AUSENTE;
  const ms = (agora instanceof Date ? agora.getTime() : Date.now()) - t;
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  return new Date(value).toLocaleDateString("pt-BR");
}

// Busca sem acento, case-insensitive — Shell V3 (dropdown de Cliente) e
// Carteira (F1.1) usam a mesma normalização.
export function normalizarBusca(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .trim();
}

// Iniciais para avatar (rodapé do Shell) — "Pedro Gomes" → "PG".
export function iniciais(nome) {
  const base = String(nome || "").trim();
  if (!base) return "V";
  const partes = base.split(/\s+/);
  if (partes.length === 1) return partes[0][0].toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export const format = { escapeHTML, moeda, numero, percentual, data, desde, normalizarBusca, iniciais };

if (typeof window !== "undefined") {
  window.VF = window.VF || {};
  window.VF.format = format;
}
