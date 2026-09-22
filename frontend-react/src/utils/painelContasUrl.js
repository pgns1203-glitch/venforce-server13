// frontend-react/src/utils/painelContasUrl.js
//
// Filtros do Painel de Contas espelhados na URL (`?ano=&squadId=&busca=`),
// mesmo padrão de periodoUrl.js: `history.replaceState`, nunca `pushState`
// (digitar na busca não pode empilhar uma entrada de histórico por tecla).
//
// Filtro de exibição NÃO é contexto canônico e NÃO é autorização — o servidor
// resolve a carteira por conta própria (painelContasService.listar chama
// resolvePortfolioClientes ANTES de olhar para qualquer filtro). O que vier
// na URL é preferência de leitura, e é por isso que pode ser compartilhada
// num link sem abrir acesso a nada.
//
// Por que URL e não localStorage: ano/squad/busca descrevem O QUE está sendo
// investigado. Sobreviver ao refresh, voltar no histórico e colar o link para
// outra pessoa são exatamente os movimentos de uma investigação. Preferência
// de COLUNAS é outra coisa (é sobre a pessoa, não sobre o dado) e essa sim
// fica em localStorage.

const ANO_MIN = 2000;
const ANO_MAX = 2100;

function anoValido(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > ANO_MIN && n < ANO_MAX ? n : null;
}

export function lerFiltrosDaUrl(search = window.location.search, anoPadrao = new Date().getFullYear()) {
  const q = new URLSearchParams(search || "");
  const squadBruto = q.get("squadId");
  const squadId = squadBruto != null && squadBruto !== "" && Number.isFinite(Number(squadBruto))
    ? Number(squadBruto)
    : null;
  return {
    ano: anoValido(q.get("ano")) ?? anoPadrao,
    squadId,
    busca: q.get("busca") || "",
  };
}

// Só grava o que foge do padrão — uma URL limpa continua limpa enquanto
// nenhum filtro estiver aplicado, e o link compartilhado carrega apenas o
// que a pessoa realmente escolheu.
export function escreverFiltrosNaUrl({ ano, squadId, busca }, anoPadrao = new Date().getFullYear()) {
  const q = new URLSearchParams(window.location.search || "");

  if (ano != null && Number(ano) !== Number(anoPadrao)) q.set("ano", String(ano));
  else q.delete("ano");

  if (squadId != null) q.set("squadId", String(squadId));
  else q.delete("squadId");

  if (busca) q.set("busca", busca);
  else q.delete("busca");

  const texto = q.toString();
  window.history.replaceState({}, "", texto ? `${window.location.pathname}?${texto}` : window.location.pathname);
}
