// server/services/cliente360/cliente360V3BootstrapService.js
//
// GET /operacao/cliente-360-v3/:slug/bootstrap?conta=&periodo=&compararCom=
// — FASE 1 (fundação) de Projeto_cliente360/PROMPT_CLAUDE_CODE_IMPLEMENTACAO_CLIENTE360_V3.
// Contrato recomendado pela auditoria técnica (AUDITORIA_PLANO_IMPLEMENTACAO_
// CLIENTE360_CARRO_CHEFE.md §21/§26/§27 FASE 1): rota nova e aditiva, nunca
// escolhe conta em silêncio, marketplace é DERIVADO da ClienteConta (nunca um
// filtro livre — fecha o gap que a Fase 0 deixou registrado de propósito).
//
// Mesmo padrão de resolução de conta obrigatória de server/services/
// visaoService.js e server/services/financeiroVisaoService.js (cada módulo
// Shell V3 mantém sua própria cópia curta desta validação — precedente
// estabelecido, não duplicação por descuido: ver nota de M10 sobre não
// forçar um refactor cross-módulo por um ganho marginal).
//
// Envelope por bloco mais rico que o de Visão (disponivel/motivo/codigo/
// escopo/fonte/confianca/dados — auditoria §21), porque esta é a FUNDAÇÃO:
// vale estabelecer o contrato-alvo certo agora, não a versão simplificada
// que Visão adotou por razões próprias.
//
// Fase 1 = só contexto + capabilities + resultado (bruto, reaproveitado da
// Fase 0, já account-aware). Ponte/produtos/confiança GANHAM apresentação
// própria na Fase 2 (auditoria §26 "Fase 2 — resultado, ponte e confiança")
// — aqui os dados já vêm corretos dentro de `resultado.dados`, mas o
// frontend da Fase 1 não os renderiza em detalhe ainda (só um resumo breve).

const {
  resolverClientePorIdOuSlug,
  obterConta,
  sanitizarConta,
} = require("../clienteContas/clienteContaService");
const { CODIGOS_CANONICOS } = require("../../utils/erroContextoCanonico");
const { normalizarCompetenciaEstrita } = require("../../utils/competenciaCanonica");
const periodoUtils = require("../../utils/periodoUtils");
const cliente360ResultadoService = require("./cliente360ResultadoService");
const { criarContextKey } = require("./cliente360V3ContextKey");
const { blocoSeguro } = require("./cliente360V3Envelope");

function criarErroHttp(statusCode, mensagem, extra = {}) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

// Idêntico em espírito a resolverContaObrigatoria de visaoService.js: a nova
// 360 nunca escolhe conta em silêncio. clienteContaId é sempre obrigatório
// aqui (a V3 não tem o caminho de "conta única resolve sozinha" da Fase 0 —
// esse caminho existe para não quebrar a V2 legada; a V3 é rota nova, sem
// caller legado para acomodar, então pode exigir a conta explícita desde o
// primeiro request, como a auditoria recomenda).
async function resolverContaObrigatoria({ clienteSlugRaw, clienteContaIdRaw }, deps) {
  const cliente = await deps.resolverClientePorIdOuSlug({ clienteSlug: clienteSlugRaw });

  const clienteContaId = Number(clienteContaIdRaw);
  if (!Number.isInteger(clienteContaId) || clienteContaId <= 0) {
    throw criarErroHttp(400, "conta é obrigatória (?conta=<clienteContaId>).");
  }

  const contaRaw = await deps.obterConta(clienteContaId);
  if (contaRaw.cliente_id !== cliente.id) {
    throw criarErroHttp(403, "Esta conta não pertence ao cliente informado.", {
      code: CODIGOS_CANONICOS.CONTA_NAO_PERTENCE_AO_CLIENTE,
    });
  }
  if (contaRaw.ativo === false) {
    throw criarErroHttp(409, `A conta "${contaRaw.nome}" foi desativada.`, {
      code: CODIGOS_CANONICOS.CONTA_INATIVA,
    });
  }

  return { cliente, conta: deps.sanitizarConta(contaRaw) };
}

// Período CANÔNICO OBRIGATÓRIO (auditoria §21: "período canônico
// obrigatório") — mais estrito que Visão de propósito: Visão aceita período
// ausente e infere o mês atual porque já tinha caller em produção antes
// desta regra existir (comentário em visaoService.js). A V3 é rota nova,
// sem esse legado — pode (e deve, por honestidade) exigir o período
// explicitamente desde o primeiro request, usando os códigos canônicos que
// já existem exatamente para essa distinção (erroContextoCanonico.js).
function resolverPeriodo(periodoRaw) {
  const informado = periodoRaw !== undefined && periodoRaw !== null && String(periodoRaw).trim() !== "";
  if (!informado) {
    throw criarErroHttp(400, "periodo é obrigatório (?periodo=YYYY-MM).", {
      code: CODIGOS_CANONICOS.PERIODO_OBRIGATORIO,
    });
  }
  const competencia = normalizarCompetenciaEstrita(periodoRaw);
  if (!competencia) {
    throw criarErroHttp(400, "periodo inválido: use o formato YYYY-MM.", {
      code: CODIGOS_CANONICOS.PERIODO_INVALIDO,
    });
  }
  return competencia;
}

// compararCom é OPCIONAL mas VALIDADO quando informado (auditoria §21:
// "comparação opcional validada") — nunca aceito como lixo silencioso.
function resolverCompararCom(compararComRaw, competencia) {
  const informado = compararComRaw !== undefined && compararComRaw !== null && String(compararComRaw).trim() !== "";
  if (!informado) return periodoUtils.competenciaAnteriorDe(competencia);

  const normalizado = normalizarCompetenciaEstrita(compararComRaw);
  if (!normalizado) {
    throw criarErroHttp(400, "compararCom inválido: use o formato YYYY-MM.", {
      code: CODIGOS_CANONICOS.PERIODO_INVALIDO,
    });
  }
  return normalizado;
}

// Envelope uniforme por bloco: cliente360V3Envelope.js (auditoria §21) — é o
// módulo CANÔNICO, reaproveitado aqui em vez de reimplementado inline. Nunca
// lança para fora, nunca inventa dado quando a fonte falha ou não existe.
async function obterBootstrap({ clienteSlugRaw, clienteContaIdRaw, competenciaRaw, compararComRaw }, deps = {}) {
  const d = {
    resolverClientePorIdOuSlug,
    obterConta,
    sanitizarConta,
    getResultado: cliente360ResultadoService.getResultado,
    ...deps,
  };

  const { cliente, conta } = await resolverContaObrigatoria({ clienteSlugRaw, clienteContaIdRaw }, d);
  const competencia = resolverPeriodo(competenciaRaw);
  const compararCom = resolverCompararCom(compararComRaw, competencia);

  // ContextKey explícito (master prompt Fase 1, "ContextKey"; auditoria §21:
  // "o resolvedor retorna contextKey/versão") — usa o mesmo algoritmo
  // canônico do frontend (cliente360V3ContextKey.js). O frontend usa isto
  // como checagem extra além do próprio AbortController/seq — uma resposta
  // cujo contextKey não bate com o contexto atual é descartada mesmo que
  // chegue sem erro e sem ter sido abortada a tempo.
  const contextKey = criarContextKey({
    clienteId: cliente.id,
    clienteContaId: conta.id,
    periodo: competencia,
    compararCom,
  });

  // Capabilities: hoje só a derivação de marketplace a partir da
  // ClienteConta (nunca aceito como filtro livre nesta rota — fecha o gap
  // registrado no relatório da Fase 0, "Gaps conhecidos"). Cresce nas fases
  // seguintes (Full/Ads por capability, admin) sem mudar o formato do
  // envelope.
  const capabilitiesPromise = blocoSeguro(
    async () => ({ marketplace: conta.marketplace, isMeli: conta.marketplace === "meli" }),
    { escopo: "account", fonteNome: "cliente_conta_service" }
  );

  // Resultado: reaproveita cliente360ResultadoService.getResultado, já
  // account-aware desde a Fase 0 — nenhum cálculo novo. O payload completo
  // (fechamento/ponte/produtos/confiança/oportunidades/simulação) já viaja
  // aqui, mesmo padrão de Visão para o bloco `resultado` (não achatado no
  // servidor); a apresentação rica desses dados é explicitamente Fase 2 —
  // a página da Fase 1 só usa um resumo breve.
  const resultadoPromise = blocoSeguro(
    () => d.getResultado(cliente.slug, {
      clienteContaId: conta.id,
      marketplace: conta.marketplace,
      competencia,
      compararCom,
    }),
    { escopo: "account", fonteNome: "cliente360_resultado_service" }
  );

  const [capabilities, resultado] = await Promise.all([capabilitiesPromise, resultadoPromise]);

  if (resultado.disponivel) {
    // Confiança no nível do envelope é a MESMA já calculada dentro de
    // getResultado (confiancaEngine) — só reexposta na forma que o
    // contrato-alvo da auditoria pede, nunca recalculada.
    resultado.confianca = { tipo: "dados", nivel: resultado.dados?.confianca?.nivel ?? null };
    resultado.fonte.geradoEm = resultado.dados?.fechamento?.origem?.geradoEm ?? null;
  }

  return {
    contexto: {
      clienteId: cliente.id,
      clienteSlug: cliente.slug,
      clienteContaId: conta.id,
      marketplace: conta.marketplace,
      competencia,
      compararCom,
      contextKey,
    },
    capabilities,
    resultado,
  };
}

module.exports = { obterBootstrap, resolverContaObrigatoria, resolverPeriodo, resolverCompararCom };
