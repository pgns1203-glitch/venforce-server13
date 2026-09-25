// server/jobs/backfillCentralVendas.js
// Backfill MANUAL da Central de Vendas (Auditoria Sync Noturno §23): meses
// completos retroativos para contas sem histórico. Não faz parte do cron —
// é executado à mão, observado, por lote de clientes.
//
//   npm run sync:central-vendas:backfill -- --meses=3 [--clientes=slug1,slug2] [--concorrencia=1] [--dry-run]
//
// --meses é OBRIGATÓRIO (1 a 12): nunca "todo o histórico" por padrão. O mês
// corrente fica com o cron diário. Concorrência padrão 1 (volume meses ×
// contas é maior que o do cron), no máximo 3.
//
// Mesmo motor do cron e do botão manual (criarSyncRun → executarSyncRun →
// snapshot a partir do persistido). ATENÇÃO: com o server/.env desta máquina
// isto grava em PRODUÇÃO — rode primeiro com --dry-run.

require("dotenv").config();

const { parseArgs, rodarJob, encerrar } = require("./centralVendasJobCli");

const BACKFILL_CONCORRENCIA_PADRAO = 1;
const BACKFILL_CONCORRENCIA_MAXIMA = 3;

async function main(argv = process.argv.slice(2)) {
  const pool = require("../config/database");
  const service = require("../services/centralVendas/centralVendasNoturnoService");

  return rodarJob({
    pool,
    exitCodeDoResumo: service.exitCodeDoResumo,
    executar: async () => {
      const args = parseArgs(argv);
      const hoje = args.dataReferencia || service.hojeNoFuso();
      const concorrencia = Math.min(
        service.resolverConcorrencia(args.concorrencia, BACKFILL_CONCORRENCIA_PADRAO),
        BACKFILL_CONCORRENCIA_MAXIMA
      );
      return service.executarRodada({
        periodos: service.calcularPeriodosBackfill(hoje, args.meses),
        concorrencia,
        clientes: args.clientes,
        dryRun: args.dryRun,
        origem: "backfill-central",
      });
    },
  });
}

if (require.main === module) {
  main().then(encerrar, (err) => {
    console.error("[cron-central] erro fatal:", err?.message || err);
    encerrar(1);
  });
}

module.exports = { main };
