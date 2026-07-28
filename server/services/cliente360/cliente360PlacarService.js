// server/services/cliente360/cliente360PlacarService.js
// PLACAR DO CONSULTOR (Advisory Impact Ledger) — só resultado OPERACIONAL.
// Responde: "desde que assumimos, quanto de resultado operacional esta consultoria
// recuperou?"
//
// Método (conservador e auditável):
//   Para cada ação registrada na competência M, mede o efeito na ponte M→M+1 e
//   credita à consultoria APENAS a parcela do fator ligado à ação:
//     - correção de custo de um produto → melhora da CONTRIBUIÇÃO desse produto
//       cujo motivo dominante voltou a ser favorável (via linha de custo)
//     - reprecificação → linha/contribuição de "preço"
//     - renegociação de frete → "frete"
//     - correção de comissão / imposto / base / mix → respectivo fator
//     - pausa de produto negativo → "produto"
//   O que não tem ação por trás fica em "mercado/outros" e NUNCA é creditado.
//
// ADS NÃO É CREDITADO. Não existe fator "ads" no placar ativo: mudança de verba de
// mídia não é ação operacional comprovável na ponte (que nem contém Ads).
// Registros históricos com fator "ads" NÃO são apagados do banco — eles aparecem
// numa lista "legado" separada, com crédito zero, fora do total.

const periodoUtils = require("./cliente360Periodo");
const acoesRepoDefault = require("./cliente360AcoesRepository");

function round2(v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; }

// Fator da ação → chave de linha/contribuição da ponte operacional.
// Sem entrada para "ads" por decisão de produto (ver cabeçalho).
const FATOR_LINHA = {
  custo: "custo",
  frete: "frete",
  preco: "preco",
  comissao: "comissao",
  imposto: "imposto",
  mix: "mix",
  produto: "volume",   // pausa/retomada de produto aparece como volume/mix
  base: "custo",       // correção de base corrige custo/imposto do item
};

function createPlacarService({
  resultadoService = require("./cliente360ResultadoService"),
  acoesRepo = acoesRepoDefault,
} = {}) {

  // Crédito de uma ação medido na ponte de M→M+1.
  // Ações por produto usam a contribuição individual; ações globais usam a linha.
  function creditarAcao(acao, ponteMedida) {
    const chave = FATOR_LINHA[String(acao.fator || "").toLowerCase()];
    if (!chave || !ponteMedida) return 0;

    // ação com produto → usa a contribuição do produto se ele melhorou pelo fator
    if (acao.mlb) {
      const todos = [
        ...(ponteMedida.produtos?.ajudaram || []),
        ...(ponteMedida.produtos?.prejudicaram || []),
      ];
      const p = todos.find((x) => x.mlb === acao.mlb);
      if (p && p.contribuicao > 0 && p.motivoDominante === chave) return round2(p.contribuicao);
      // produto tocado mas sem melhora atribuível ao fator → sem crédito
      return 0;
    }

    // ação global → usa a linha da ponte, só quando é uma melhora
    const linha = (ponteMedida.linhas || []).find((l) => l.chave === chave);
    if (linha && linha.impacto > 0) return round2(linha.impacto);
    return 0;
  }

  // Placar acumulado do cliente desde `desde` (YYYY-MM).
  async function getPlacar(clienteSlug, { desde = null, marketplace = "meli" } = {}) {
    const slug = String(clienteSlug || "").trim().toLowerCase();
    const acoes = await acoesRepo.listarAcoes(slug, { marketplace, desde });

    // Separa o histórico de Ads: preservado, exibido como legado, nunca somado.
    const operacionais = acoes.filter((a) => !acoesRepo.ehFatorLegado(a.fator));
    const legado = acoes.filter((a) => acoesRepo.ehFatorLegado(a.fator));

    const legadoFormatado = legado.map((a) => ({
      id: a.id,
      competencia: a.competencia,
      fator: a.fator,
      tipo: a.tipo,
      mlb: a.mlb || null,
      titulo: a.titulo || null,
      descricao: a.descricao || null,
      creditoApurado: 0,
      contaNoTotal: false,
      observacao: "Ação de mídia registrada antes da separação Ads × operação. Preservada como histórico; não entra no placar operacional.",
    }));

    if (!operacionais.length) {
      return {
        ok: true,
        cliente: slug,
        desde,
        escopo: "operacional",
        totalRecuperado: 0,
        porFator: {},
        acoes: [],
        legado: legadoFormatado,
        aindaNaMesa: 0,
      };
    }

    // uma ponte medida por competência M+1 necessária
    const compsMedida = [...new Set(operacionais.map((a) => periodoUtils.proximaCompetencia(a.competencia)))];

    const pontes = new Map();
    await Promise.all(compsMedida.map(async (comp) => {
      try {
        const r = await resultadoService.getResultado(slug, { competencia: comp, marketplace });
        pontes.set(comp, r);
      } catch (_) { pontes.set(comp, null); }
    }));

    const porFator = {};
    const detalhe = [];
    let total = 0;

    for (const acao of operacionais) {
      const compMedida = periodoUtils.proximaCompetencia(acao.competencia);
      const resultado = pontes.get(compMedida);
      const ponteMedida = resultado
        ? { linhas: resultado.ponte?.linhas || [], produtos: resultado.produtos }
        : null;

      const credito = resultado ? creditarAcao(acao, ponteMedida) : 0;
      porFator[acao.fator] = round2((porFator[acao.fator] || 0) + credito);
      total = round2(total + credito);

      detalhe.push({
        id: acao.id,
        competencia: acao.competencia,
        competenciaMedida: compMedida,
        fator: acao.fator,
        tipo: acao.tipo,
        mlb: acao.mlb || null,
        titulo: acao.titulo || null,
        descricao: acao.descricao || null,
        creditoApurado: credito,
        contaNoTotal: true,
        medido: !!resultado,
      });
    }

    // "ainda na mesa": recuperável operacional não capturado na competência mais recente
    let aindaNaMesa = 0;
    const ultima = [...compsMedida].sort().slice(-1)[0];
    const r = pontes.get(ultima);
    aindaNaMesa = r?.oportunidades?.totalRecuperavel || 0;

    return {
      ok: true,
      cliente: slug,
      desde,
      escopo: "operacional",
      totalRecuperado: total,
      porFator,
      aindaNaMesa: round2(aindaNaMesa),
      acoes: detalhe,
      legado: legadoFormatado,
      observacao: "Placar ativo considera apenas ações operacionais. Investimento em Ads não é creditado.",
    };
  }

  return { getPlacar, creditarAcao };
}

module.exports = {
  getPlacar: (...a) => createPlacarService().getPlacar(...a),
  createPlacarService,
  FATOR_LINHA,
};
