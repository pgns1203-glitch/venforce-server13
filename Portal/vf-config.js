// Portal/vf-config.js
//
// Ponto único de resolução de ambiente para o Shell V3 (F0.1A).
//
// Contrato:
//   <meta name="vf-api-base" content="https://..."> quando presente na
//   página → usa esse valor.
//   Senão, usa o MESMO fallback de produção já hardcoded hoje em ~30
//   arquivos do Portal (ex.: Portal/dashboard.js:2, Portal/bases.js:2,
//   Portal/ads.js:3, Portal/fechamento.js): "https://venforce-server.onrender.com".
//
// Não lê token, não faz fetch, não conhece Cliente/Squad/contexto
// operacional. Só resolve API_BASE.
//
// ES Module. Também espelhado em window.VF.config para os scripts
// clássicos das páginas ainda não migradas — a fonte canônica continua
// sendo este módulo, window.VF é só a ponte de leitura.

export const API_BASE_FALLBACK = "https://venforce-server.onrender.com";

const META_NAME = "vf-api-base";

export function resolveApiBase(doc) {
  const source = doc || (typeof document !== "undefined" ? document : null);
  if (source && typeof source.querySelector === "function") {
    const meta = source.querySelector(`meta[name="${META_NAME}"]`);
    const content = meta && typeof meta.getAttribute === "function" ? meta.getAttribute("content") : null;
    if (content && content.trim()) return content.trim().replace(/\/+$/, "");
  }
  return API_BASE_FALLBACK;
}

export const config = {
  apiBase: resolveApiBase(),
};

if (typeof window !== "undefined") {
  window.VF = window.VF || {};
  window.VF.config = config;
}
