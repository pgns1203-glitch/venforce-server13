// server/tests/clienteContasGuards.test.js
//
// Verificações estáticas (mesmo padrão de mlGrantScope.test.js) para as
// proteções da Fase 1 que vivem em server/index.js e na migration
// versionada — coisas que não compensa levantar um servidor inteiro para
// testar ponta a ponta:
//  - DELETE /clientes/:slug bloqueia com dependências, não apaga em silêncio;
//  - DELETE /clientes/:slug/ml-token (legado) bloqueia quando há 2+ grants;
//  - as novas rotas de cliente-contas exigem admin;
//  - a migration é aditiva (não apaga linhas de ml_tokens, não faz DROP).

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const indexJs = read("index.js");

{
  const offset = indexJs.indexOf('app.delete("/clientes/:slug/ml-token"');
  ok("rota legada de desconexão ML existe", offset >= 0);
  const trecho = indexJs.slice(offset, offset + 1400);
  ok("desconexão legada verifica quantidade de grants antes de apagar", trecho.includes("MULTIPLE_ML_GRANTS"));
  ok("desconexão legada bloqueia com 409 quando há mais de um grant", /status\(409\)/.test(trecho) && trecho.includes("MULTIPLE_ML_GRANTS"));
}

{
  const offset = indexJs.indexOf('app.delete("/clientes/:slug"');
  ok("rota de exclusão de cliente existe", offset >= 0);
  const trecho = indexJs.slice(offset, offset + 1600);
  ok("exclusão de cliente verifica dependências antes do hard delete", trecho.includes("verificarDependenciasCliente"));
  ok("exclusão de cliente bloqueia com 409 quando há dependências", trecho.includes("CLIENTE_COM_DEPENDENCIAS"));
}

ok("server/index.js monta as rotas de cliente-contas", indexJs.includes('require("./routes/clienteContasRoutes")') && indexJs.includes("clienteContasRoutes"));

const clienteContasRoutes = read("routes/clienteContasRoutes.js");

// Leitura de metadados operacionais é liberada às roles internas
// (admin/user/membro); mutações continuam admin-only. Checa o middleware
// declarado logo após cada `router.<verbo>("<rota>"` — mesma técnica de
// mlGrantScope.test.js para as rotas /admin/ml-tokens.
function middlewareDaRota(routesSrc, verbo, rotaLiteral) {
  const offset = routesSrc.indexOf(`router.${verbo}(${rotaLiteral}`);
  assert.ok(offset >= 0, `rota não encontrada: ${verbo} ${rotaLiteral}`);
  const fimLinha = routesSrc.indexOf(");", offset);
  assert.ok(fimLinha > offset, `fim da declaração não encontrado: ${verbo} ${rotaLiteral}`);
  return routesSrc.slice(offset, fimLinha);
}

for (const [verbo, rota] of [
  ["get", '"/clientes/:cliente/contas"'],
  ["get", '"/cliente-contas/:id"'],
  ["get", '"/cliente-contas/:id/base"'],
]) {
  const trecho = middlewareDaRota(clienteContasRoutes, verbo, rota);
  ok(`leitura ${verbo.toUpperCase()} ${rota} usa requireAutomacoesAccess (admin/user/membro)`, trecho.includes("requireAutomacoesAccess"));
  ok(`leitura ${verbo.toUpperCase()} ${rota} NÃO exige requireAdmin`, !trecho.includes("requireAdmin"));
}

for (const [verbo, rota] of [
  ["post", '"/clientes/:cliente/contas"'],
  ["patch", '"/cliente-contas/:id"'],
  ["patch", '"/cliente-contas/:id/principal"'],
  ["put", '"/cliente-contas/:id/base"'],
  ["delete", '"/cliente-contas/:id/ml-grant"'],
]) {
  const trecho = middlewareDaRota(clienteContasRoutes, verbo, rota);
  ok(`mutação ${verbo.toUpperCase()} ${rota} exige requireAdmin`, trecho.includes("requireAdmin"));
}

const migration = read("sql/migrations/20260817_cliente_contas_foundation.sql");
ok("migration não apaga nem recria ml_tokens", !/DROP\s+TABLE\s+ml_tokens|TRUNCATE\s+ml_tokens/i.test(migration));
ok("migration não faz UPDATE de access_token/refresh_token/expires_at/token_status", !/access_token\s*=|refresh_token\s*=|expires_at\s*=|token_status\s*=/i.test(migration));
ok("migration adiciona cliente_conta_id de forma aditiva (ADD COLUMN IF NOT EXISTS)", /ALTER TABLE ml_tokens\s+ADD COLUMN IF NOT EXISTS cliente_conta_id/i.test(migration));
ok("migration cria cliente_contas com CREATE TABLE IF NOT EXISTS (idempotente)", /CREATE TABLE IF NOT EXISTS cliente_contas/i.test(migration));
ok("migration registra conflitos de ml_user_id em vez de resolver sozinha", migration.includes("ml_user_id_duplicado_entre_clientes") && migration.includes("cliente_contas_pendencias"));
ok("migration registra vínculos de base ambíguos em vez de escolher", migration.includes("base_vinculo_ambiguo"));
ok("migration não força NOT NULL em cliente_conta_id (permanece opcional na Fase 1)", !/cliente_conta_id[\s\S]{0,40}SET NOT NULL/i.test(migration));

console.log(`\n✓ clienteContasGuards: ${checks} verificações`);
