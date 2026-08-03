// server/services/cliente360/cliente360ConfiancaEngine.js
// Motor de CONFIANÇA — PURO. Mede a qualidade do resultado em % do FATURAMENTO
// (não em contagem de pedidos) e classifica em confiavel | parcial | insuficiente.
// A faixa é aplicada ao PIOR dos dois períodos, para que a ponte só apareça
// quando ambos os lados são confiáveis.
//
// Regra de negócio:
//   confiavel     → coberturaResultado ≥ 0,90  → ponte normal
//   parcial       → 0,70 ≤ cobertura < 0,90    → ponte com selo "parcial"
//   insuficiente  → cobertura < 0,70           → ponte NÃO é exibida
//
// Reconciliação: quando o total detalhado (itens) diverge do total oficial do
// fechamento e a origem da diferença NÃO é conhecida, a confiança nunca pode ser
// "confiavel" — a divergência é rebaixada para "parcial" e exposta na tela.
// Números nunca são forçados a fechar.
//
// Ads não entra na confiança do resultado operacional: a disponibilidade de Ads é
// reportada em bloco próprio (ads.status) e não degrada a análise operacional.

const { pedidoEntraNoResultado } = require("./cliente360PonteEngine");

const FAIXA_CONFIAVEL = 0.90;
const FAIXA_PARCIAL = 0.70;
// Acima disso (fração do faturamento), a divergência não reconciliada é material.
const DIVERGENCIA_MATERIAL = 0.005;

function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; }
function frac4(v) { return Math.round((Number(v) + Number.EPSILON) * 1e4) / 1e4; }

// Calcula a cobertura de UM período a partir dos pedidos (contrato do fechamento).
// Cancelados e mediações não contam no faturamento base (coerente com a ponte).
function coberturaPeriodo(pedidos) {
  let fatTotal = 0;
  let fatComResultado = 0; // confianca = confiavel
  let fatComCusto = 0;     // custoStatus = real
  let fatComFrete = 0;     // freteStatus = real
  let fatBloqueado = 0;    // confianca = bloqueado
  let pedidosBloqueados = 0;
  let pedidosParciais = 0;
  const pendentesTop = [];

  for (const p of pedidos || []) {
    if (!pedidoEntraNoResultado(p)) continue;
    const v = num(p.valor);
    fatTotal += v;
    if (p.confianca === "confiavel") fatComResultado += v;
    if (p.confianca === "parcial") pedidosParciais++;
    if (p.confianca === "bloqueado") { fatBloqueado += v; pedidosBloqueados++; }
    if (p.custoStatus === "real") fatComCusto += v;
    if (p.freteStatus === "real") fatComFrete += v;

    if (p.confianca !== "confiavel") {
      pendentesTop.push({
        pedidoId: p.pedidoId || p.id,
        data: p.data || null,
        valor: round2(v),
        confianca: p.confianca || null,
        pendencias: Array.isArray(p.pendencias) ? p.pendencias : [],
      });
    }
  }

  const div = (a) => (fatTotal > 0 ? a / fatTotal : 0);
  pendentesTop.sort((a, b) => b.valor - a.valor);

  return {
    faturamento: round2(fatTotal),
    coberturaResultado: frac4(div(fatComResultado)),
    coberturaCusto: frac4(div(fatComCusto)),
    coberturaFrete: frac4(div(fatComFrete)),
    receitaBloqueada: round2(fatBloqueado),
    pedidosBloqueados,
    pedidosParciais,
    pedidosSemConfianca: pendentesTop, // lista completa; o service corta o top-N
  };
}

function classificar(cobertura) {
  if (cobertura >= FAIXA_CONFIAVEL) return "confiavel";
  if (cobertura >= FAIXA_PARCIAL) return "parcial";
  return "insuficiente";
}

// Deriva os alertas de dado faltante que a interface precisa exibir.
function montarAlertas(cobertura, reconciliacao) {
  const alertas = [];
  if (cobertura.coberturaCusto < FAIXA_CONFIAVEL) {
    alertas.push({
      chave: "custo_insuficiente",
      severidade: cobertura.coberturaCusto < FAIXA_PARCIAL ? "critico" : "atencao",
      mensagem: `${((1 - cobertura.coberturaCusto) * 100).toFixed(0)}% do faturamento está sem custo real.`,
    });
  }
  if (cobertura.coberturaFrete < FAIXA_CONFIAVEL) {
    alertas.push({
      chave: "frete_insuficiente",
      severidade: cobertura.coberturaFrete < FAIXA_PARCIAL ? "critico" : "atencao",
      mensagem: `${((1 - cobertura.coberturaFrete) * 100).toFixed(0)}% do faturamento está sem frete real.`,
    });
  }
  if (reconciliacao && reconciliacao.status === "divergente") {
    alertas.push({
      chave: "reconciliacao_divergente",
      severidade: "atencao",
      fonte: "fechamento_api",
      mensagem: `O detalhe por item diverge do total do fechamento em R$ ${Math.abs(reconciliacao.diferenca).toFixed(2)} sem origem identificada.`,
    });
  }
  return alertas;
}

// pedidos0/pedidos1 = arrays dos dois períodos.
// reconciliacao = saída do adapter de fechamento para o período ATUAL (opcional).
// ponte         = saída de montarPonte (opcional): se a decomposição não fecha
//                 dentro de R$ 0,01, a confiança cai e a divergência é declarada.
function avaliarConfianca(
  pedidos0,
  pedidos1,
  { geradoEm = null, topPedidos = 15, reconciliacao = null, ponte = null } = {}
) {
  const anterior = coberturaPeriodo(pedidos0);
  const atual = coberturaPeriodo(pedidos1);

  // faixa pelo PIOR período
  const piorCobertura = Math.min(anterior.coberturaResultado, atual.coberturaResultado);
  let nivel = classificar(piorCobertura);

  // Divergência sem origem identificada nunca pode ser vendida como "confiavel".
  const divergenciaMaterial =
    reconciliacao &&
    reconciliacao.status === "divergente" &&
    (reconciliacao.faturamentoFechamento > 0
      ? Math.abs(reconciliacao.diferenca) / reconciliacao.faturamentoFechamento > DIVERGENCIA_MATERIAL
      : Math.abs(reconciliacao.diferenca) > 0);

  if (divergenciaMaterial && nivel === "confiavel") nivel = "parcial";

  // Ponte que não fecha é divergência de motor, não de dado: também rebaixa.
  const alertas = montarAlertas(atual, reconciliacao);
  if (ponte && ponte.fecha === false) {
    if (nivel === "confiavel") nivel = "parcial";
    alertas.push({
      chave: "ponte_nao_fecha",
      severidade: "critico",
      fonte: "decomposicao_pvm",
      mensagem: `A decomposição do resultado deixou um resíduo de R$ ${Math.abs(ponte.residuo).toFixed(2)}. Nenhum ajuste artificial foi criado para fechar a conta.`,
    });
  }

  return {
    nivel,                                  // confiavel | parcial | insuficiente
    exibirPonte: nivel !== "insuficiente",
    motivoOcultarPonte:
      nivel === "insuficiente"
        ? "Cobertura de custo/frete abaixo do mínimo em pelo menos um dos períodos."
        : null,
    coberturaResultado: atual.coberturaResultado,
    coberturaCusto: atual.coberturaCusto,
    coberturaFrete: atual.coberturaFrete,
    receitaBloqueada: atual.receitaBloqueada,
    pedidosBloqueados: atual.pedidosBloqueados,
    pedidosParciais: atual.pedidosParciais,
    reconciliacao: reconciliacao || null,
    divergenciaPonte: ponte && ponte.fecha === false ? ponte.divergencia : null,
    alertas,
    geradoEm,
    // detalhe por período para o frontend
    porPeriodo: {
      anterior: {
        coberturaResultado: anterior.coberturaResultado,
        coberturaCusto: anterior.coberturaCusto,
        coberturaFrete: anterior.coberturaFrete,
        receitaBloqueada: anterior.receitaBloqueada,
      },
      atual: {
        coberturaResultado: atual.coberturaResultado,
        coberturaCusto: atual.coberturaCusto,
        coberturaFrete: atual.coberturaFrete,
        receitaBloqueada: atual.receitaBloqueada,
      },
    },
    // pedidos que derrubam a confiança do período atual (para o drawer)
    pedidosDerrubando: atual.pedidosSemConfianca.slice(0, topPedidos),
  };
}

module.exports = {
  avaliarConfianca,
  coberturaPeriodo,
  classificar,
  FAIXA_CONFIAVEL,
  FAIXA_PARCIAL,
  DIVERGENCIA_MATERIAL,
};
