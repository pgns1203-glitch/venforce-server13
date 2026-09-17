// frontend-react/src/utils/dossie.js
//
// Derivações PURAS do Dossiê Operacional (Cliente 360 V3). Nada aqui inventa
// número: toda função recebe o payload real do bootstrap e devolve uma
// projeção dele. Quando um campo não existe no contrato, o resultado é
// `null` — nunca 0, nunca uma estimativa (mesma regra de utils/numbers.js).
//
// Por que existe: a tela antiga espalhava quatro listas de produto em quatro
// blocos visuais diferentes (ajudaram / prejudicaram / no vermelho / abaixo
// da meta), o que obrigava o usuário a procurar o MESMO produto em quatro
// lugares para montar a história dele. O Dossiê tem UMA tabela de produtos;
// a fusão dessas listas acontece aqui, uma vez, com regra explícita.

import { ehAusente } from "./numbers.js";

// ── Contexto ────────────────────────────────────────────────────────────────

// Mesmos rótulos que o Shell V3 usa na sidebar (Portal/vf-shell.js ::
// MARKETPLACE_LABEL). Reescritos aqui, não importados: o contrato visual é
// compartilhado entre vanilla e React, a implementação não (DESIGN.md, The
// Shared-Contract Rule). Marketplace desconhecido devolve o próprio código —
// nunca some, nunca vira "Mercado Livre" por omissão.
const MARKETPLACE_LABEL = { meli: "Mercado Livre", shopee: "Shopee", tiktok: "TikTok Shop" };

export function rotularMarketplace(codigo) {
  if (!codigo) return null;
  return MARKETPLACE_LABEL[codigo] || codigo;
}

// ── Produtos ────────────────────────────────────────────────────────────────

// Cada lista do payload traz um RECORTE diferente do mesmo produto:
//   ajudaram/prejudicaram → contribuicao, motivoDominante (vêm da ponte)
//   noVermelho/abaixoDaMargem/curvaAEmRisco → a linha financeira completa
//     (unidades, resultado, precoMedio, unitários, margemUnitaria, curvaAbc…)
// A fusão é "primeiro campo definido vence", na ordem abaixo, porque nenhuma
// lista contradiz a outra: elas se complementam pelo mesmo `mlb`.
const ORIGENS = ["ajudaram", "prejudicaram", "noVermelho", "abaixoDaMargem", "curvaAEmRisco"];

function fundirCampos(alvo, item) {
  for (const [chave, valor] of Object.entries(item)) {
    if (valor === null || valor === undefined) continue;
    if (alvo[chave] === null || alvo[chave] === undefined) alvo[chave] = valor;
  }
}

/**
 * Une as listas de produto do payload numa única linha por MLB.
 * `participacao` é a única métrica derivada: faturamento do item ÷ faturamento
 * do fechamento — divisão simples sobre dois números que já estão na tela,
 * não uma segunda regra financeira. Sem denominador, fica `null`.
 */
export function linhasProdutos(dados) {
  const produtos = dados?.produtos;
  if (!produtos) return [];

  const faturamentoTotal = dados?.fechamento?.atual?.faturamento;
  const porMlb = new Map();

  for (const origem of ORIGENS) {
    for (const item of produtos[origem] || []) {
      if (!item?.mlb) continue;
      let linha = porMlb.get(item.mlb);
      if (!linha) {
        linha = { mlb: item.mlb, origens: [] };
        porMlb.set(item.mlb, linha);
      }
      linha.origens.push(origem);
      fundirCampos(linha, item);
    }
  }

  return [...porMlb.values()].map((linha) => {
    const unidades = linha.unidades ?? linha.unidadesAtual ?? null;
    const participacao =
      !ehAusente(linha.faturamento) && !ehAusente(faturamentoTotal) && faturamentoTotal > 0
        ? linha.faturamento / faturamentoTotal
        : null;
    return {
      ...linha,
      unidades,
      participacao,
      contribuicao: linha.contribuicao ?? null,
      resultado: linha.resultado ?? null,
      margem: linha.margem ?? null,
      curvaAbc: linha.curvaAbc ?? null,
      status: statusProduto(linha),
      problema: problemaProduto(linha),
      problemaCurto: problemaProduto(linha, { curto: true }),
    };
  });
}

// Status vem do que o BACKEND já classificou (em qual lista o item caiu), não
// de um limiar recalculado aqui. `curvaA` + problema é destacado porque é o
// caso mais caro da operação: item que representa faturamento e destrói margem.
export function statusProduto(linha) {
  const origens = linha.origens || [];
  if (origens.includes("noVermelho")) {
    return { chave: "vermelho", label: "No vermelho", tom: "danger", ordem: 0 };
  }
  if (origens.includes("abaixoDaMargem")) {
    return { chave: "abaixo", label: "Abaixo do alvo", tom: "warning", ordem: 1 };
  }
  if (origens.includes("prejudicaram")) {
    return { chave: "puxou_baixo", label: "Prejudicou", tom: "neutral", ordem: 2 };
  }
  if (origens.includes("ajudaram")) {
    return { chave: "puxou_cima", label: "Ajudou", tom: "success", ordem: 3 };
  }
  return { chave: "sem_alerta", label: "Sem alerta", tom: "empty", ordem: 4 };
}

// Problema legível do item — o motivo que o backend já registrou, nunca um
// diagnóstico escrito aqui.
const MOTIVO_RISCO = {
  resultado_negativo: "Preço não cobre os custos variáveis",
  margem_abaixo_alvo: "Margem positiva, abaixo do alvo",
};

const MOTIVO_DOMINANTE = {
  volume: "volume", preco: "preço", comissao: "comissão", frete: "frete",
  custo: "custo", imposto: "imposto", produto_novo: "produto novo",
  produto_saiu: "parou de vender",
};

const MOTIVO_RISCO_CURTO = {
  resultado_negativo: "Preço < custo variável",
  margem_abaixo_alvo: "Abaixo do alvo",
};

// `curto` é para célula de tabela (uma linha, sem quebrar a altura da grade);
// a versão longa vive no drawer, onde há espaço para explicar.
export function problemaProduto(linha, { curto = false } = {}) {
  if (linha.motivoRisco) {
    const mapa = curto ? MOTIVO_RISCO_CURTO : MOTIVO_RISCO;
    return mapa[linha.motivoRisco] || linha.motivoRisco;
  }
  if (linha.motivoDominante) {
    const fator = MOTIVO_DOMINANTE[linha.motivoDominante] || linha.motivoDominante;
    return curto ? `Fator: ${fator}` : `Fator dominante: ${fator}`;
  }
  return null;
}

// Tendência por item: unidades e unitário ANTES × DEPOIS. Existe só para os
// produtos que a ponte nomeia — o contrato da 360 não traz série histórica por
// produto, e inventar uma a partir de um único período seria mentira. Quem não
// está na ponte devolve `null` e a UI diz por quê.
export function tendenciaPorMlb(ponte) {
  const mapa = new Map();
  for (const linha of ponte?.linhas || []) {
    for (const p of linha.produtos || []) {
      const atual = mapa.get(p.mlb) || { mlb: p.mlb, fatores: [] };
      atual.fatores.push({ chave: linha.chave, label: linha.label, impacto: p.impacto });
      if (atual.unidadesAnterior == null && p.unidadesAnterior != null) atual.unidadesAnterior = p.unidadesAnterior;
      if (atual.unidadesAtual == null && p.unidadesAtual != null) atual.unidadesAtual = p.unidadesAtual;
      if (!atual.unitario && p.unitario) atual.unitario = p.unitario;
      mapa.set(p.mlb, atual);
    }
  }
  return mapa;
}

// ── Ordenação e modos da tabela de produtos ─────────────────────────────────

function comparar(a, b, dir) {
  const ausenteA = ehAusente(a);
  const ausenteB = ehAusente(b);
  if (ausenteA && ausenteB) return 0;
  if (ausenteA) return 1;   // ausente vai sempre para o fim, nos dois sentidos
  if (ausenteB) return -1;
  return dir === "asc" ? a - b : b - a;
}

export const MODOS_PRODUTOS = [
  { chave: "impacto", label: "Impacto", ordem: { campo: "contribuicaoAbs", dir: "desc" } },
  { chave: "abc", label: "ABC", ordem: { campo: "faturamento", dir: "desc" } },
  { chave: "margem", label: "Margem", ordem: { campo: "margem", dir: "asc" } },
  { chave: "problemas", label: "Problemas", ordem: { campo: "severidade", dir: "asc" } },
];

export function aplicarModo(linhas, modo, ordenacao) {
  const base = modo === "problemas"
    ? linhas.filter((l) => l.status.chave === "vermelho" || l.status.chave === "abaixo")
    : [...linhas];

  const regra = ordenacao || MODOS_PRODUTOS.find((m) => m.chave === modo)?.ordem;
  if (!regra) return base;

  const valor = (l) => {
    switch (regra.campo) {
      case "contribuicaoAbs": return ehAusente(l.contribuicao) ? null : Math.abs(l.contribuicao);
      case "severidade": return l.status.ordem;
      default: return l[regra.campo];
    }
  };
  return base.sort((a, b) => comparar(valor(a), valor(b), regra.dir));
}

// ── Oportunidades ───────────────────────────────────────────────────────────

const PRIORIDADE = {
  critico: { label: "Alta", tom: "danger", ordem: 0 },
  atencao: { label: "Média", tom: "warning", ordem: 1 },
  info: { label: "Baixa", tom: "neutral", ordem: 2 },
};

export function linhasOportunidades(oportunidades) {
  const lista = oportunidades?.oportunidades || [];
  const contaveis = lista
    .filter((o) => o.contaNoTotal)
    .map((o, i) => ({
      ...o,
      id: `${o.fator}-${i}`,
      itens: o.produtos?.length ?? null,
      prioridade: PRIORIDADE[o.severidade] || PRIORIDADE.info,
    }))
    .sort((a, b) => (b.recuperavelEstimado ?? 0) - (a.recuperavelEstimado ?? 0));

  const alertas = lista.filter((o) => !o.contaNoTotal).map((o, i) => ({ ...o, id: `alerta-${i}` }));
  return { contaveis, alertas };
}

// ── Margem (Motor de Margem) ────────────────────────────────────────────────

export const STATUS_MARGEM = {
  HEALTHY: { label: "Saudável", tom: "success" },
  LOW_MARGIN: { label: "Margem baixa", tom: "warning" },
  LOSS: { label: "Prejuízo", tom: "danger" },
  SUSPECT_DATA: { label: "Dado suspeito", tom: "danger" },
  RECONCILING: { label: "Reconciliando", tom: "neutral" },
  UNVALIDATED: { label: "Sem validação", tom: "empty" },
};

// Confiança do Motor de Margem chega como enum em inglês; a tela é em pt-BR.
// Valor desconhecido devolve o próprio código — nunca vira "Alta" por omissão.
const CONFIANCA_MARGEM = { high: "Alta", medium: "Média", low: "Baixa" };

export function rotularConfiancaMargem(valor) {
  if (!valor) return null;
  return CONFIANCA_MARGEM[valor] || valor;
}

// Contagem por status + itens que o Motor não encontrou no catálogo
// (`identidade: "missing"` — tipicamente item sem custo cadastrado). Não é uma
// média de margem: a média aritmética de margens por item NÃO é a margem da
// operação, e publicar as duas lado a lado ensinaria o número errado.
export function resumoMargem(margemDados) {
  if (!margemDados?.aplicavel) return null;
  const itens = Object.entries(margemDados.porMlb || {}).map(([mlb, info]) => ({ mlb, ...info }));
  const contagem = {};
  let semIdentidade = 0;
  for (const item of itens) {
    if (item.identidade === "missing") { semIdentidade += 1; continue; }
    contagem[item.status] = (contagem[item.status] || 0) + 1;
  }
  return { total: itens.length, contagem, semIdentidade, itens };
}

// ── Saúde ───────────────────────────────────────────────────────────────────

// Uma dimensão de saúde pode BLOQUEAR números da tela (grant caído = Ads e
// métricas ao vivo indisponíveis). O Dossiê promove esses casos para a faixa
// de bloqueio do topo em vez de escondê-los lá embaixo (§21 do brief).
export function bloqueiosDeSaude(saude) {
  const bloqueios = [];
  const grant = saude?.grantBase;
  if (grant?.disponivel && grant.dados && grant.dados.grantConectado === false) {
    bloqueios.push({
      chave: "grant",
      titulo: "Conexão com o Mercado Livre caiu",
      descricao: "Ads e qualquer métrica ao vivo desta conta ficam indisponíveis até reconectar.",
      acaoLabel: "Reconectar",
      acaoDestino: "clientes.html",
    });
  }
  if (grant?.disponivel && grant.dados && grant.dados.baseVinculada === false) {
    bloqueios.push({
      chave: "base",
      titulo: "Nenhuma base de custo vinculada",
      descricao: "Sem base, custo e margem por produto não são apurados nesta operação.",
      acaoLabel: "Vincular base",
      acaoDestino: "bases.html",
    });
  }
  return bloqueios;
}
