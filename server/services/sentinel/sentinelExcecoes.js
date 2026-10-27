// server/services/sentinel/sentinelExcecoes.js
// Pedidos problemáticos (sentinel_pedido_excecoes, migration 20261027).
//
//   retentando — falhou; o checkpoint NÃO avança, o próximo ciclo tenta de novo;
//   quarentena — atingiu SENTINEL_MAX_TENTATIVAS; o checkpoint pode avançar SÓ
//                depois que esta escrita confirmou (quem chama garante);
//   resolvido  — processou com sucesso depois de falhar.
//
// Reprocessamento manual futuro (SEM rota nesta fase):
//   await reabrirExcecao(db, contaId, pedidoId)  → status volta a 'retentando',
//   tentativas = 0; o ciclo seguinte volta a processar o pedido.


function lerInteiroPositivo(valor, padrao) {
  const n = Number.parseInt(valor, 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function maxTentativas(env = process.env) {
  return lerInteiroPositivo(env.SENTINEL_MAX_TENTATIVAS, 3);
}

// Incrementa a tentativa e devolve { status, tentativas }. Lança se a escrita
// falhar — o chamador NÃO pode avançar o checkpoint nesse caso.
async function registrarExcecao(db, contaId, pedidoId, motivo, { limite = maxTentativas() } = {}) {
  const r = await db.query(
    `INSERT INTO sentinel_pedido_excecoes (cliente_conta_id, pedido_id, motivo, tentativas, status)
     -- Só grava se a Conta existe; FOR KEY SHARE serializa com o purge (sem FK aqui:
     -- é isto que impede exceção órfã herdável por uma conta futura com o mesmo id).
     SELECT cc.id, $2, $3, 1, CASE WHEN 1 >= $4::int THEN 'quarentena' ELSE 'retentando' END
       FROM cliente_contas cc WHERE cc.id = $1 FOR KEY SHARE
     ON CONFLICT (cliente_conta_id, pedido_id) DO UPDATE SET
       motivo = EXCLUDED.motivo,
       tentativas = CASE WHEN sentinel_pedido_excecoes.status = 'resolvido' THEN 1
                         ELSE sentinel_pedido_excecoes.tentativas + 1 END,
       primeiro_erro_em = CASE WHEN sentinel_pedido_excecoes.status = 'resolvido' THEN NOW()
                               ELSE sentinel_pedido_excecoes.primeiro_erro_em END,
       ultimo_erro_em = NOW(),
       status = CASE WHEN (CASE WHEN sentinel_pedido_excecoes.status = 'resolvido' THEN 1
                                ELSE sentinel_pedido_excecoes.tentativas + 1 END) >= $4
                     THEN 'quarentena' ELSE 'retentando' END
     RETURNING status, tentativas`,
    [contaId, String(pedidoId), String(motivo || "erro").slice(0, 500), limite]
  );
  return r.rows[0];
}

async function marcarResolvido(db, contaId, pedidoId) {
  await db.query(
    `UPDATE sentinel_pedido_excecoes SET status = 'resolvido'
      WHERE cliente_conta_id = $1 AND pedido_id = $2 AND status = 'retentando'`,
    [contaId, String(pedidoId)]
  );
}

async function reabrirExcecao(db, contaId, pedidoId) {
  const r = await db.query(
    `UPDATE sentinel_pedido_excecoes SET status = 'retentando', tentativas = 0
      WHERE cliente_conta_id = $1 AND pedido_id = $2 AND status = 'quarentena'
      RETURNING pedido_id`,
    [contaId, String(pedidoId)]
  );
  return r.rowCount > 0;
}

// { quarentena:Set, retentando:Set } da conta (uma query por conta e ciclo).
async function carregarExcecoesAbertas(db, contaId) {
  const r = await db.query(
    `SELECT pedido_id, status FROM sentinel_pedido_excecoes
      WHERE cliente_conta_id = $1 AND status IN ('retentando', 'quarentena')`,
    [contaId]
  );
  const out = { quarentena: new Set(), retentando: new Set() };
  for (const row of r.rows) out[row.status].add(String(row.pedido_id));
  return out;
}

module.exports = { registrarExcecao, marcarResolvido, reabrirExcecao, carregarExcecoesAbertas, maxTentativas };
