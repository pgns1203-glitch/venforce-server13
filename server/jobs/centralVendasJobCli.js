// server/jobs/centralVendasJobCli.js
// Parte comum dos entrypoints de job da Central de Vendas (cron noturno e
// backfill): leitura de argumentos, execução, encerramento do pool e exit
// code. Nenhum Express, nenhum boot do servidor web (index.js tem efeitos de
// boot — migrations, token refresh worker — que um job NÃO deve disparar).

function parseArgs(argv) {
  const args = { dryRun: false, clientes: null, dataReferencia: null, meses: null, concorrencia: null };
  for (const raw of argv) {
    const [chave, ...resto] = String(raw).split("=");
    const valor = resto.join("=");
    switch (chave) {
      case "--dry-run": args.dryRun = true; break;
      case "--clientes": args.clientes = valor.split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--data-referencia": args.dataReferencia = valor; break;
      case "--meses": args.meses = valor; break;
      case "--concorrencia": args.concorrencia = valor; break;
      default: throw new Error(`Argumento desconhecido: ${raw}`);
    }
  }
  return args;
}

function jobHabilitado(env) {
  const valor = String(env.CENTRAL_VENDAS_NOTURNO_ENABLED ?? "").trim().toLowerCase();
  return !(valor === "false" || valor === "0" || valor === "off");
}

// Roda `executar()` e devolve o exit code. Erro estrutural (banco fora,
// argumento inválido, falha ao listar contas) → 1. Sempre encerra o pool
// para o processo terminar sozinho.
async function rodarJob({ executar, exitCodeDoResumo, pool, logger = console }) {
  let codigo = 0;
  try {
    const resumo = await executar();
    codigo = exitCodeDoResumo(resumo);
  } catch (err) {
    const { sanitizeErrorMessage } = require("../services/mlTokenService");
    logger.error(`[cron-central] erro estrutural: ${err?.code ? `${err.code} ` : ""}${sanitizeErrorMessage(String(err?.message || err))}`);
    codigo = 1;
  } finally {
    if (pool && typeof pool.end === "function") {
      await pool.end().catch(() => {});
    }
  }
  return codigo;
}

// Encerramento: exitCode + rede de segurança. Se algum handle esquecido
// (socket keep-alive, timer de módulo) segurar o event loop, o timer
// derruba o processo — um cron pendurado seria pior que um log cortado.
function encerrar(codigo) {
  process.exitCode = codigo;
  setTimeout(() => process.exit(codigo), 10000).unref();
}

module.exports = { parseArgs, jobHabilitado, rodarJob, encerrar };
