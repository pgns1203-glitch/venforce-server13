// frontend-react/src/utils/fullAccountStatus.js
//
// Classificação de status de UMA cliente_conta Mercado Livre — mesma
// regra/vocabulário de Portal/clientes-contas-resumo.js::classificarStatusConta
// (a fonte usada por Portal/clientes.js):
//   grant == null            -> sem_grant / "Aguardando grant" (○)
//   grant existe + valid     -> conectado / "Conectado" (●)
//   grant existe + problema  -> atencao   / "Grant com problema" (⚠)
//
// Reescrita aqui — em vez de carregar o script clássico do Portal dentro do
// bundle React/Vitest — porque os dois runtimes não compartilham módulo (um
// é `<script>` clássico global, o outro é ESM). A REGRA é a mesma,
// propositalmente idêntica; qualquer mudança de vocabulário/critério deve
// ser replicada nos dois lugares.
export function classificarStatusConta(conta) {
  if (!conta || !conta.grant) {
    return { code: "sem_grant", label: "Aguardando grant", symbol: "○" };
  }
  const status = String(conta.grant.token_status || "valid").toLowerCase();
  if (status === "valid") {
    return { code: "conectado", label: "Conectado", symbol: "●" };
  }
  return { code: "atencao", label: "Grant com problema", symbol: "⚠" };
}
