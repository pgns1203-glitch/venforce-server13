// server/services/ai/imageAiProvider.js
// -----------------------------------------------------------------------------
// Contrato de provedor de IA para IMAGEM (remover fundo, upscale, etc).
//
// Espelha a ideia do aiProvider.js (texto): os services nunca falam com o
// provedor externo direto, falam com esta camada. Hoje NENHUM provedor está
// implementado — só o contrato e a detecção de capacidade existem.
//
// Regra dura: nada aqui simula resultado. Se não há provedor configurado, as
// operações respondem PROVEDOR_NAO_CONFIGURADO e o frontend esconde o botão.
// Fingir que o fundo foi removido seria pior do que não ter o recurso.
//
// Para adicionar Photoroom / Cloudinary / remove.bg no futuro:
//   1. criar server/services/ai/photoroomImageClient.js expondo
//      { PROVIDER, capacidades(), executar(operacao, { buffer, mimeType, opcoes }) };
//   2. registrar no mapa PROVIDERS abaixo;
//   3. definir IMAGE_AI_PROVIDER=photoroom e a chave correspondente no ambiente.
// Nada mais muda: rota, controller e frontend já estão prontos.
// -----------------------------------------------------------------------------

// Operações previstas. A ordem também é a ordem de exibição no editor.
const OPERACOES = [
  "removeBackground",
  "improveLighting",
  "generateBackground",
  "removeObject",
  "upscale",
];

// Nenhum provedor implementado ainda — mapa vazio de propósito.
const PROVIDERS = {};

function capacidadesVazias() {
  return OPERACOES.reduce((acc, operacao) => {
    acc[operacao] = false;
    return acc;
  }, {});
}

function nomeProvedorConfigurado() {
  const nome = String(process.env.IMAGE_AI_PROVIDER || "").trim().toLowerCase();
  return nome || null;
}

function getProvider() {
  const nome = nomeProvedorConfigurado();
  if (!nome) return null;
  return PROVIDERS[nome] || null;
}

function operacaoValida(operacao) {
  return OPERACOES.includes(String(operacao || ""));
}

// Estado que o frontend consulta para decidir o que mostrar.
// Sempre devolve todas as chaves — nunca um objeto parcial.
function capacidades() {
  const provider = getProvider();
  if (!provider || typeof provider.capacidades !== "function") {
    return {
      disponivel: false,
      provider: null,
      motivo: nomeProvedorConfigurado()
        ? "PROVEDOR_DESCONHECIDO"
        : "PROVEDOR_NAO_CONFIGURADO",
      capacidades: capacidadesVazias(),
    };
  }

  const suportadas = provider.capacidades() || {};
  const resultado = capacidadesVazias();
  OPERACOES.forEach((operacao) => {
    resultado[operacao] = suportadas[operacao] === true;
  });

  return {
    disponivel: Object.values(resultado).some(Boolean),
    provider: provider.PROVIDER || nomeProvedorConfigurado(),
    motivo: null,
    capacidades: resultado,
  };
}

function erroIa(codigo, mensagem, statusCode) {
  const error = new Error(mensagem);
  error.codigo = codigo;
  error.statusCode = statusCode || 501;
  return error;
}

// Executa uma operação de IA. Lança erro padronizado quando não dá.
// entrada: { buffer, mimeType, opcoes }
async function executar(operacao, entrada) {
  if (!operacaoValida(operacao)) {
    throw erroIa("OPERACAO_DESCONHECIDA", "Operação de IA não reconhecida.", 400);
  }

  const estado = capacidades();
  if (!estado.disponivel) {
    throw erroIa(
      "PROVEDOR_NAO_CONFIGURADO",
      "Nenhum provedor de IA de imagem está configurado neste ambiente.",
      501
    );
  }
  if (!estado.capacidades[operacao]) {
    throw erroIa(
      "OPERACAO_NAO_SUPORTADA",
      "O provedor configurado não oferece esta operação.",
      501
    );
  }

  const provider = getProvider();
  return provider.executar(operacao, entrada || {});
}

module.exports = {
  OPERACOES,
  capacidadesVazias,
  capacidades,
  executar,
  operacaoValida,
  nomeProvedorConfigurado,
};
