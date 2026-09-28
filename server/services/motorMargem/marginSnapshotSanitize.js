// server/services/motorMargem/marginSnapshotSanitize.js
// Margin Snapshot — redação de segredos em texto livre (M4/M8).
//
// Mensagens de erro do ML/rede podem, em tese, ecoar cabeçalho ou query com
// token. Tudo que sai do worker para log, `error_message`, `last_error` ou
// resposta HTTP passa por aqui: token de acesso do ML (APP_USR-…), refresh
// token (TG-…), `Bearer …` e pares access_token=/refresh_token=/client_secret=
// viram [REDACTED]. Truncado para nunca carregar stack gigante.

// Valores inteiros viram [REDACTED].
const PADROES_VALOR = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bAPP_USR-[A-Za-z0-9\-_]+/g,
  /\bTG-[A-Za-z0-9\-_]+/g,
];

// `chave=valor` / `chave: valor`: mantém a chave (útil no diagnóstico),
// redige só o valor.
const PADRAO_CHAVE_VALOR = /\b(access_token|refresh_token|client_secret|authorization|password|api_key)(["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi;

function redigirSegredos(texto, limite = 2000) {
  if (texto === null || texto === undefined) return null;
  let saida = String(texto);
  for (const padrao of PADROES_VALOR) saida = saida.replace(padrao, "[REDACTED]");
  saida = saida.replace(PADRAO_CHAVE_VALOR, (_casamento, chave, separador) => `${chave}${separador}[REDACTED]`);
  return saida.slice(0, limite);
}

module.exports = { redigirSegredos };
