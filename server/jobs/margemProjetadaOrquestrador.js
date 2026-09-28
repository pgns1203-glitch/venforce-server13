// server/jobs/margemProjetadaOrquestrador.js
// -----------------------------------------------------------------------------
// Orquestrador MANUAL sequencial da carteira para a margem projetada global.
// NÃO tem scheduler, NÃO é Render Cron, NÃO liga sozinho — precisa ser
// invocado explicitamente. Toda a lógica de descoberta/classificação/
// processamento vive em
// server/services/motorMargem/margemProjetadaOrquestradorService.js; este
// arquivo só lê argv, aplica a barreira de segurança contra rodar a carteira
// inteira sem querer, e formata a saída.
//
// Uso:
//   node server/jobs/margemProjetadaOrquestrador.js --plano [--clientes=slug1,slug2]
//   node server/jobs/margemProjetadaOrquestrador.js --clientes=slug1,slug2
//   node server/jobs/margemProjetadaOrquestrador.js --all
//
// Opções:
//   --plano             Só descoberta/classificação. NÃO chama o Mercado
//                        Livre, NÃO sincroniza, NÃO calcula margem, NÃO
//                        grava. Lista quem seria processado e por que as
//                        demais contas foram ignoradas.
//   --clientes=a,b,c    Restringe a estes slugs (mesmo formato do job de
//                        Central de Vendas). Pode ser combinado com --plano.
//   --all               Processa TODA a carteira elegível. Único jeito de
//                        rodar sem filtro — sem --clientes e sem --all, a CLI
//                        recusa a execução (barreira contra rodar a carteira
//                        inteira por acidente antes de existir um scheduler).
//   --json              Imprime também o resumo completo em JSON.
//
// Exatamente uma forma de escopo é obrigatória: --clientes=... OU --all
// (--plano sozinho também exige uma das duas, para descrever QUAL universo
// está sendo planejado).
// -----------------------------------------------------------------------------

require("dotenv").config();

const { encerrar } = require("./centralVendasJobCli");

function parseArgs(argv) {
  const args = { plano: false, all: false, clientes: null, json: false };
  for (const raw of argv) {
    const [chave, ...resto] = String(raw).split("=");
    const valor = resto.join("=");
    switch (chave) {
      case "--plano": args.plano = true; break;
      case "--all": args.all = true; break;
      case "--clientes": args.clientes = valor.split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--json": args.json = true; break;
      default: throw Object.assign(new Error(`Argumento desconhecido: ${raw}`), { codigo: "ARGUMENTO_DESCONHECIDO" });
    }
  }
  return args;
}

// Barreira PASSO 15: sem --clientes e sem --all, recusa — nunca processa
// (nem em modo --plano) a carteira inteira "por engano" de um argv vazio.
function validarEscopo(args) {
  if (args.all && args.clientes) {
    throw Object.assign(
      new Error("Informe --clientes=... OU --all, nunca os dois."),
      { codigo: "ESCOPO_AMBIGUO" }
    );
  }
  if (!args.all && !args.clientes) {
    throw Object.assign(
      new Error("Escopo obrigatório: informe --clientes=slug1,slug2 ou --all explicitamente. Sem filtro, esta CLI recusa a execução (proteção contra rodar a carteira inteira por acidente)."),
      { codigo: "ESCOPO_OBRIGATORIO" }
    );
  }
}

function formatarRelatorio(r) {
  const linhas = [];
  linhas.push(`Modo: ${r.plano ? "PLANO (nenhuma escrita, nenhuma chamada ao ML)" : "REAL"}`);
  linhas.push(`Início: ${r.inicio}  Fim: ${r.fim}  Duração: ${r.duracaoMs}ms`);
  linhas.push("");
  linhas.push(`Contas descobertas: ${r.totalDescobertas}`);
  linhas.push(`Contas elegíveis: ${r.elegiveis}`);
  linhas.push(`Contas ignoradas: ${r.ignoradas}`);
  for (const [motivo, qtd] of Object.entries(r.ignoradasPorMotivo || {})) {
    linhas.push(`  ${motivo} .......... ${qtd}`);
  }
  if (r.plano) {
    linhas.push("");
    linhas.push("Contas que SERIAM processadas:");
    for (const c of r.contasElegiveisPlano || []) {
      linhas.push(`  ${c.clienteSlug}#${c.clienteContaId} (external_account_id=${c.externalAccountId || "?"})`);
    }
    return linhas.join("\n");
  }
  linhas.push("");
  linhas.push(`Sucessos: ${r.sucessos}`);
  linhas.push(`Parciais: ${r.parciais}`);
  linhas.push(`Falhas: ${r.falhas}`);
  linhas.push("");
  linhas.push("Resultado por conta:");
  for (const res of r.resultados || []) {
    const rotulo = `${res.clienteSlug}#${res.clienteContaId}`;
    if (res.status === "sucesso" || res.status === "parcial") {
      linhas.push(
        `  ${rotulo} ${res.status} (${res.duracaoMs}ms) — sync: enc=${res.sync?.totalEncontrados ?? "?"} salvos=${res.sync?.totalSalvos ?? "?"}`
          + ` — margem: itens=${res.margem?.itensProcessados ?? "?"} criados=${res.margem?.snapshotsCriados ?? "?"}`
          + ` atualizados=${res.margem?.snapshotsAtualizados ?? "?"} falhos=${res.margem?.snapshotsFalhos ?? "?"}`
      );
    } else {
      const retry = res.erro?.retryAfter != null ? ` (retryAfter=${res.erro.retryAfter}s)` : "";
      linhas.push(`  ${rotulo} FALHA (${res.duracaoMs}ms) — ${res.erro?.code ? `${res.erro.code}: ` : ""}${res.erro?.message || "erro desconhecido"}${retry}`);
    }
  }
  return linhas.join("\n");
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const pool = deps.pool || require("../config/database");
  const service = deps.service || require("../services/motorMargem/margemProjetadaOrquestradorService");

  try {
    const args = parseArgs(argv);
    validarEscopo(args);

    const resumo = await service.executarRodada(
      { clientes: args.all ? null : args.clientes, plano: args.plano },
      deps.depsOverride || {}
    );

    console.log(formatarRelatorio(resumo));
    if (args.json) {
      console.log("\n--- JSON ---");
      console.log(JSON.stringify(resumo, null, 2));
    }
    return service.exitCodeDoResumo(resumo);
  } catch (err) {
    console.error(`[margem-projetada-orquestrador] erro${err.codigo ? ` [${err.codigo}]` : ""}: ${err.message}`);
    return 1;
  } finally {
    if (pool && typeof pool.end === "function") {
      await pool.end().catch(() => {});
    }
  }
}

if (require.main === module) {
  main().then(encerrar, (err) => {
    console.error("[margem-projetada-orquestrador] erro fatal:", err?.message || err);
    encerrar(1);
  });
}

module.exports = { parseArgs, validarEscopo, formatarRelatorio, main };
