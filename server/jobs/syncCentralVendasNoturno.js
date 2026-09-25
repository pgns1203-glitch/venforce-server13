// server/jobs/syncCentralVendasNoturno.js
// Sincronização automática noturna da Central de Vendas (Render Cron Job).
//
//   npm run sync:central-vendas:noturno
//   node jobs/syncCentralVendasNoturno.js [--dry-run] [--clientes=slug1,slug2] [--data-referencia=YYYY-MM-DD]
//
// Para cada conta Mercado Livre elegível: criarSyncRun → executarSyncRun (o
// MESMO motor do botão manual) → snapshot mensal do Painel a partir do que a
// Central persistiu. Ver centralVendasNoturnoService.
//
// Variáveis (todas opcionais):
//   SYNC_CENTRAL_CONCURRENCY        contas em paralelo (padrão 3, máximo 10)
//   CENTRAL_VENDAS_NOTURNO_ENABLED  "false" desliga o job sem remover o Cron Job (rollback)
//
// ATENÇÃO: usa DATABASE_URL como o serviço web. Nesta máquina de dev,
// server/.env aponta para o banco de PRODUÇÃO — rodar localmente sincroniza
// e grava em produção. Use --dry-run para só listar contas/períodos.

require("dotenv").config();

const { parseArgs, jobHabilitado, rodarJob, encerrar } = require("./centralVendasJobCli");

async function main(argv = process.argv.slice(2), env = process.env) {
  if (!jobHabilitado(env)) {
    console.log("[cron-central] desabilitado (CENTRAL_VENDAS_NOTURNO_ENABLED=false) — nada a fazer");
    return 0;
  }

  const pool = require("../config/database");
  const service = require("../services/centralVendas/centralVendasNoturnoService");

  return rodarJob({
    pool,
    exitCodeDoResumo: service.exitCodeDoResumo,
    executar: async () => {
      const args = parseArgs(argv);
      return service.executarRodadaNoturna({
        env,
        dataReferencia: args.dataReferencia,
        clientes: args.clientes,
        dryRun: args.dryRun,
        origem: "cron-central",
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
