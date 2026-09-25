// frontend-react/src/components/painelContas/colunas.js
//
// Fonte ÚNICA das colunas do Painel de Contas: grupo, rótulo, formatação,
// definição em texto e — o ponto sensível — a SEMÂNTICA DE DIREÇÃO de cada
// variação. Fica fora do componente porque o menu de colunas, o cabeçalho em
// dois níveis, a ordenação e as células leem todos a MESMA lista; duplicar
// isso é como uma coluna escondida pelo menu continua sendo ordenada.
//
// ── Direção da variação ──────────────────────────────────────────────────
// `sentido` NUNCA é derivado do sinal matemático. Subir não é bom por
// definição: para um índice de custo sobre receita (ACOS/TACoS) subir é
// exatamente o contrário. Os três valores possíveis:
//
//   "positivo-bom"  → ▲ verde / ▼ vermelho (FAT, LC, MC)
//   "positivo-ruim" → ▲ vermelho / ▼ verde (ACOS, TACoS)
//   "neutro"        → direção mostrada, cor neutra (Invest. Ads)
//
// Isso não é invenção desta tela: é o contrato que o projeto já aplica em
// cliente360v3/dossie/AdsPainel.jsx (TACoS renderizado com `inverso`) e em
// Primitivos.jsx:44-47, cujo próprio comentário diz que gasto de Ads "subir
// não é bom nem ruim por si". Aqui só está nomeado e centralizado.
//
// ── Definições ───────────────────────────────────────────────────────────
// Texto retirado da auditoria oficial (Painel_Controle_Contas_Squads §8/§9/
// §10) e de Portal/relatorio-publico.js — nenhum conceito inventado. COM,
// ATV e NPS não têm fonte de dado persistida e confiável (§10): ficam
// declaradas aqui para não sumirem do produto, sempre sem valor.

export const GRUPOS = [
  { chave: "financeiro", label: "Financeiro", disponivel: true },
  { chave: "ads", label: "Ads", disponivel: true },
  {
    chave: "operacao",
    label: "Operação",
    disponivel: false,
    nota: "Sem fonte de dado auditada nesta versão.",
  },
];

export const COLUNAS = [
  {
    chave: "fat",
    label: "FAT",
    grupo: "financeiro",
    tipo: "moeda",
    sentido: "positivo-bom",
    definicao: "Faturamento — venda total do período.",
  },
  {
    chave: "lc",
    label: "LC",
    grupo: "financeiro",
    tipo: "moeda",
    sentido: "positivo-bom",
    definicao: "Lucro de contribuição — venda total menos imposto, tarifas, frete e custo.",
  },
  {
    chave: "mc",
    label: "MC",
    grupo: "financeiro",
    tipo: "fracao",
    sentido: "positivo-bom",
    definicao: "Margem de contribuição — LC dividido pela venda total.",
  },
  {
    chave: "ads",
    label: "Invest. Ads",
    grupo: "ads",
    tipo: "moeda",
    sentido: "neutro",
    definicao: "Investimento em Ads no período.",
  },
  {
    chave: "acos",
    label: "ACOS",
    grupo: "ads",
    tipo: "fracao",
    sentido: "positivo-ruim",
    definicao: "Investimento em Ads dividido pelo GMV de Ads.",
  },
  {
    chave: "tacos",
    label: "TACoS",
    grupo: "ads",
    tipo: "fracao",
    sentido: "positivo-ruim",
    definicao: "Investimento em Ads dividido pelo faturamento total.",
  },
  {
    chave: "com",
    label: "COM",
    grupo: "operacao",
    tipo: "indisponivel",
    sentido: "neutro",
    definicao: "Comunicação — sem fonte de dado auditada nesta versão.",
  },
  {
    chave: "atv",
    label: "ATV",
    grupo: "operacao",
    tipo: "indisponivel",
    sentido: "neutro",
    definicao: "Atividades — sem fonte de dado auditada nesta versão.",
  },
  {
    chave: "nps",
    label: "NPS",
    grupo: "operacao",
    tipo: "indisponivel",
    sentido: "neutro",
    definicao: "Satisfação — sem fonte de dado auditada nesta versão.",
  },
];

// Grupos ligados por padrão. "operacao" fica de fora porque as três colunas
// são SEMPRE vazias hoje (§10) — três colunas de "—" em toda linha empurram
// as que têm dado para fora da área visível sem entregar nada. O menu de
// colunas devolve o grupo a qualquer momento; a capacidade não foi removida.
export const GRUPOS_PADRAO = ["financeiro", "ads"];

export function colunasVisiveis(gruposAtivos) {
  const ativos = new Set(gruposAtivos);
  return COLUNAS.filter((c) => ativos.has(c.grupo));
}

// Grupos que realmente aparecem no cabeçalho, já com a contagem de colspan.
export function gruposVisiveis(gruposAtivos) {
  const ativos = new Set(gruposAtivos);
  return GRUPOS.filter((g) => ativos.has(g.chave)).map((g) => ({
    ...g,
    colunas: COLUNAS.filter((c) => c.grupo === g.chave),
  }));
}
