// frontend-react/src/utils/painelContasUrl.js
//
// Filtros do Painel de Contas espelhados na URL
// (`?competencia=&squadId=&busca=&status=&marketplace=&legado=`), mesmo padrão
// de periodoUrl.js: `history.replaceState`, nunca `pushState` (digitar na busca
// não pode empilhar uma entrada de histórico por tecla).
//
// Filtro de exibição NÃO é contexto canônico e NÃO é autorização — o servidor
// resolve a carteira por conta própria (painelContasService.listar chama
// resolvePortfolioClientes ANTES de olhar para qualquer filtro). O que vier
// na URL é preferência de leitura, e é por isso que pode ser compartilhada
// num link sem abrir acesso a nada.
//
// Por que URL e não localStorage: competência/squad/status descrevem O QUE está
// sendo investigado. Sobreviver ao refresh, voltar no histórico e colar o link
// para outra pessoa são exatamente os movimentos de uma investigação.
// Preferência de COLUNAS é outra coisa (é sobre a pessoa, não sobre o dado) e
// essa sim fica em localStorage.

export const STATUS_FILTRO = ["todos", "com_dados", "sem_dados", "parcial", "manual", "automatico", "atencao"];

export const FILTROS_PADRAO = Object.freeze({
  competencia: null, // resolvida para a competência corrente em São Paulo
  squadId: null,
  busca: "",
  status: "todos",
  marketplace: null,
  mostrarLegado: false,
});

function competenciaValida(valor) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(valor || ""));
  return Boolean(m) && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

export function lerFiltrosDaUrl(search = window.location.search, competenciaPadrao) {
  const q = new URLSearchParams(search || "");
  const squadBruto = q.get("squadId");
  const status = q.get("status");
  const marketplace = q.get("marketplace");
  return {
    competencia: competenciaValida(q.get("competencia")) ? q.get("competencia") : competenciaPadrao,
    squadId: squadBruto != null && squadBruto !== "" && Number.isFinite(Number(squadBruto)) ? Number(squadBruto) : null,
    busca: q.get("busca") || "",
    status: STATUS_FILTRO.includes(status) ? status : "todos",
    marketplace: marketplace && /^[a-z0-9_-]+$/i.test(marketplace) ? marketplace.toLowerCase() : null,
    mostrarLegado: q.get("legado") === "1",
  };
}

// Só grava o que foge do padrão — uma URL limpa continua limpa enquanto
// nenhum filtro estiver aplicado, e o link compartilhado carrega apenas o
// que a pessoa realmente escolheu.
export function escreverFiltrosNaUrl(filtros, competenciaPadrao) {
  const { competencia, squadId, busca, status, marketplace, mostrarLegado } = filtros;
  const q = new URLSearchParams(window.location.search || "");
  const definir = (chave, valor) => (valor ? q.set(chave, String(valor)) : q.delete(chave));

  q.delete("ano"); // contrato antigo (lista por ano) não volta a sujar a URL
  definir("competencia", competencia && competencia !== competenciaPadrao ? competencia : null);
  definir("squadId", squadId != null ? squadId : null);
  definir("busca", busca || null);
  definir("status", status && status !== "todos" ? status : null);
  definir("marketplace", marketplace || null);
  definir("legado", mostrarLegado ? "1" : null);

  const texto = q.toString();
  window.history.replaceState({}, "", texto ? `${window.location.pathname}?${texto}` : window.location.pathname);
}
