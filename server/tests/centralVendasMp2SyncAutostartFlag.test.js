// server/tests/centralVendasMp2SyncAutostartFlag.test.js
//
// MP2 — a automação do Settlement Report no Sync Worker (seção 29 do spec)
// é OPT-IN via CENTRAL_VENDAS_MP_SETTLEMENT_AUTOSTART, desligada por padrão
// nesta rodada — ver comentário em centralVendasSyncService.js. Isso é o que
// garante que o comportamento do worker fica IDÊNTICO ao pré-MP2 (testes
// 46/47/48: MP1/Resultado Parcial/margem/ledger M6/Claims/Returns/Shipments
// não mudam) enquanto o operador não ligar a flag explicitamente — a prova
// end-to-end completa disso é a suíte inteira (centralVendasMp1Payments*
// .test.js e os demais M1-M10/Claims/Returns/Shipments continuam passando
// sem qualquer alteração nos seus arquivos).
//
// Este arquivo prova a flag em si: default desligada, e ligável via env var
// quando o operador decidir habilitar.

const assert = require("assert");

let checks = 0;
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

function requireFresco(envValue) {
  const anterior = process.env.CENTRAL_VENDAS_MP_SETTLEMENT_AUTOSTART;
  if (envValue === undefined) delete process.env.CENTRAL_VENDAS_MP_SETTLEMENT_AUTOSTART;
  else process.env.CENTRAL_VENDAS_MP_SETTLEMENT_AUTOSTART = envValue;

  delete require.cache[require.resolve("../services/centralVendas/centralVendasSyncService")];
  const mod = require("../services/centralVendas/centralVendasSyncService");

  if (anterior === undefined) delete process.env.CENTRAL_VENDAS_MP_SETTLEMENT_AUTOSTART;
  else process.env.CENTRAL_VENDAS_MP_SETTLEMENT_AUTOSTART = anterior;

  return mod;
}

function run() {
  eq("46/47/48: flag desligada por padrao (env ausente)", requireFresco(undefined).SETTLEMENT_AUTOSTART_ENABLED, false);
  eq("flag desligada com valor explicito 'false'", requireFresco("false").SETTLEMENT_AUTOSTART_ENABLED, false);
  eq("flag desligada com valor vazio", requireFresco("").SETTLEMENT_AUTOSTART_ENABLED, false);
  eq("flag ligavel explicitamente pelo operador ('true')", requireFresco("true").SETTLEMENT_AUTOSTART_ENABLED, true);

  // Recarrega uma ultima vez no estado padrao (env ausente) para nao deixar
  // o modulo cacheado em memoria com a flag ligada para o resto do processo
  // (run-all.js roda cada arquivo em um processo Node separado, mas este
  // mesmo processo ainda executa o "console.log" abaixo).
  requireFresco(undefined);

  console.log(`centralVendasMp2SyncAutostartFlag.test.js: ${checks} verificacoes OK`);
}

run();
