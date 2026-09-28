const {
  listarBasesComVinculos,
  listarClientesDisponiveis,
  criarVinculoManual,
  desativarVinculoBase,
} = require("../services/baseVinculosService");
// P2.1 — a leitura de bases/vínculos revela quais clientes têm qual base.
// Restringe as linhas à carteira do usuário (admin vê tudo). Fonte única.
const { ehAdmin, clientesAutorizadosSet } = require("../services/squads/authorizationService");

function responderErro(res, err) {
  const status = err?.statusCode || 500;
  const payload = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.code) payload.code = err.code;
  if (err?.contas) payload.contas = err.contas;
  return res.status(status).json(payload);
}

async function listar(req, res) {
  try {
    const user = req.user || {};
    let bases = await listarBasesComVinculos();
    if (!ehAdmin(user)) {
      const permitidos = await clientesAutorizadosSet(user);
      // mantém bases órfãs (sem vínculo) e as que cobrem cliente da carteira
      bases = bases.filter((b) => {
        const clienteId = b.vinculo?.cliente_id ?? null;
        return clienteId == null || permitidos.has(clienteId);
      });
    }
    return res.json({ ok: true, bases });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function listarClientes(req, res) {
  try {
    const user = req.user || {};
    let clientes = await listarClientesDisponiveis();
    if (!ehAdmin(user)) {
      const permitidos = await clientesAutorizadosSet(user);
      clientes = clientes.filter((c) => permitidos.has(c.id));
    }
    return res.json({ ok: true, clientes });
  } catch (err) {
    return responderErro(res, err);
  }
}

// Margin Snapshot (M4): vínculo de Base mudou → enfileira refresh das contas
// afetadas. Fire-and-forget, atrás de MARGIN_SNAPSHOT_BASE_TRIGGER_ENABLED.
function marginTriggers() {
  return require("../services/motorMargem/marginSnapshotTriggers");
}

async function criar(req, res) {
  try {
    const resultado = await criarVinculoManual({
      baseId: req.body?.base_id,
      clienteId: req.body?.cliente_id,
      marketplace: req.body?.marketplace,
      clienteContaId: req.body?.cliente_conta_id ?? null,
      userId: req.user?.id,
    });

    const baseIdVinculada = resultado?.base?.id;
    if (baseIdVinculada) {
      marginTriggers().dispararSemBloquear(() =>
        marginTriggers().enfileirarPorMudancaDeBase({ baseId: baseIdVinculada, requestedBy: req.user?.id ?? null })
      );
    }

    return res.status(201).json({
      ok: true,
      base: resultado.base,
      vinculo: resultado.vinculo,
    });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function remover(req, res) {
  try {
    // As contas afetadas precisam ser lidas ANTES de o vínculo cair (depois
    // dele desativado, a base não aponta mais para ninguém). Só consulta
    // quando o gatilho está ligado; erro aqui nunca impede a desvinculação.
    let contasAfetadas = null;
    if (marginTriggers().baseTriggerHabilitado()) {
      contasAfetadas = await marginTriggers().resolverContasAfetadasPorBase({ baseId: req.params.baseId }).catch(() => null);
    }

    const resultado = await desativarVinculoBase(req.params.baseId);

    if (resultado?.desativado && contasAfetadas && contasAfetadas.length) {
      marginTriggers().dispararSemBloquear(() =>
        marginTriggers().enfileirarPorMudancaDeBase({ baseId: resultado.base?.id ?? null, contas: contasAfetadas, requestedBy: req.user?.id ?? null })
      );
    }

    return res.json({
      ok: true,
      base: resultado.base,
      desativado: resultado.desativado,
      vinculo: resultado.vinculo,
    });
  } catch (err) {
    return responderErro(res, err);
  }
}

module.exports = {
  listar,
  listarClientes,
  criar,
  remover,
};
