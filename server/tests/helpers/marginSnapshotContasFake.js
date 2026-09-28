// server/tests/helpers/marginSnapshotContasFake.js
// Fake de clienteContaService (resolverClientePorIdOuSlug + obterConta) para
// os testes da API do Margin Snapshot. Mesmos erros HTTP do service real.
//
//   loja-a (id 1): contas 5 e 6 (MELI ativas), 8 (Shopee), 9 (MELI inativa)
//   loja-b (id 2): conta 7 (MELI ativa)
//
// Não é executado como teste (run-all.js só roda *.test.js na raiz de tests/).

function erroHttp(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const CLIENTES = {
  "loja-a": { id: 1, slug: "loja-a", nome: "Loja A", ativo: true },
  "loja-b": { id: 2, slug: "loja-b", nome: "Loja B", ativo: true },
};

const CONTAS = {
  5: { id: 5, cliente_id: 1, marketplace: "meli", nome: "Loja A — principal", ativo: true },
  6: { id: 6, cliente_id: 1, marketplace: "meli", nome: "Loja A — outlet", ativo: true },
  7: { id: 7, cliente_id: 2, marketplace: "meli", nome: "Loja B", ativo: true },
  8: { id: 8, cliente_id: 1, marketplace: "shopee", nome: "Loja A — Shopee", ativo: true },
  9: { id: 9, cliente_id: 1, marketplace: "meli", nome: "Loja A — antiga", ativo: false },
};

const clienteContaServiceFake = {
  async resolverClientePorIdOuSlug({ clienteSlug }) {
    const c = CLIENTES[clienteSlug];
    if (!c) throw erroHttp(404, "Cliente não encontrado.");
    return c;
  },
  async obterConta(id) {
    const c = CONTAS[Number(id)];
    if (!c) throw erroHttp(404, "Conta não encontrada.");
    return c;
  },
};

module.exports = { CLIENTES, CONTAS, clienteContaServiceFake };
