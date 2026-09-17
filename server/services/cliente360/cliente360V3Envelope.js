// server/services/cliente360/cliente360V3Envelope.js
//
// V3 FASE 1 — contrato de envelope por bloco da nova Cliente 360 V3 (prompt
// master, seção "Envelope padrão por bloco"). Toda resposta de bloco (boot
// ou lazy) usa este formato — nunca um valor "pelado".
//
// disponivel=false NUNCA é substituído por zero/vazio silencioso; o motivo
// (texto) e o codigo (máquina) explicam a ausência. `escopo` declara sobre
// que universo o bloco fala: "account" (dado real desta ClienteConta),
// "client_legacy" (dado pré-conta, cliente_conta_id NULL), "mixed_legacy"
// (mistura declarada) ou "not_applicable" (bloco não se aplica aqui).
//
// blocoSeguro() é o único ponto que decide "essa produção falhou": qualquer
// bloco (nesta fase ou nas seguintes) que precise compor dados a partir de
// um motor/serviço que pode lançar usa este wrapper, para que uma falha em
// UM bloco nunca derrube o bootstrap inteiro (Aceite Fase 1: "bootstrap
// funciona com falha parcial").

function envelopeDisponivel({ escopo, fonte = null, confianca = null, dados }) {
  return {
    disponivel: true,
    motivo: null,
    codigo: null,
    escopo,
    fonte,
    confianca,
    dados,
  };
}

function envelopeIndisponivel({ motivo, codigo = null, escopo = "not_applicable" }) {
  return {
    disponivel: false,
    motivo,
    codigo,
    escopo,
    fonte: null,
    confianca: null,
    dados: null,
  };
}

async function blocoSeguro(produtor, { escopo, fonteNome = null, fonteVersao = null, confianca = null } = {}) {
  try {
    const dados = await produtor();
    return envelopeDisponivel({
      escopo,
      fonte: fonteNome ? { nome: fonteNome, versao: fonteVersao, geradoEm: new Date().toISOString() } : null,
      confianca,
      dados,
    });
  } catch (err) {
    return envelopeIndisponivel({
      motivo: err?.message || "Erro interno ao montar este bloco.",
      codigo: err?.code || "ERRO_BLOCO",
      escopo,
    });
  }
}

module.exports = { envelopeDisponivel, envelopeIndisponivel, blocoSeguro };
