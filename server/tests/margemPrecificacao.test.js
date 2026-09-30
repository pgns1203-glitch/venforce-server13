// server/tests/margemPrecificacao.test.js
// Camada SEGURA de precificação da Central de Margem: preview, gates,
// idempotência, concorrência, rollout e auditoria. Tudo com fakes
// (helpers/margemPrecificacaoFakes) — nenhum Postgres, nenhuma chamada real
// ao Mercado Livre, nenhuma escrita real.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/vf-test";

const assert = require("assert");
const avaliacao = require("../services/motorMargem/precificacao/precificacaoAvaliacao");
const service = require("../services/motorMargem/precificacao/precificacaoService");
const { escritaHabilitada, resolvePricingConfig } = require("../services/motorMargem/precificacao/precificacaoConfig");
const { computeMargin } = require("../services/motorMargem/core/marginEngine");
const { motorItem, promo, criarCenario, criarRepoMemoria } = require("./helpers/margemPrecificacaoFakes");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

async function esperaErro(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("era esperado um erro");
}

const ESCRITA_ON = { MARGIN_PRICING_WRITE_CLIENTES: "loja-a", MARGIN_PRICING_SIMULACAO_CACHE_MS: "0" };

function comRepo(c, repo) {
  return { ...c.deps, repo };
}

function gate(r, id) {
  return (r.gates || []).find((g) => g.id === id) || null;
}

async function previewPreco(c, repo, extra = {}) {
  return service.preview(
    { clienteSlug: "loja-a", clienteContaId: 7, itemId: "MLB100", tipo: "PRICE", novoPreco: "114.90", precoVisto: 110.48, user: { id: 9, nome: "Pedro", email: "p@x" }, ...extra },
    comRepo(c, repo)
  );
}

// ── Rollout ────────────────────────────────────────────────────────────────

cenario("rollout: escrita nasce desligada; liga por lista de clientes ou globalmente", () => {
  assert.strictEqual(escritaHabilitada({ clienteSlug: "loja-a" }, {}), false);
  assert.strictEqual(escritaHabilitada({ clienteSlug: "loja-a" }, { MARGIN_PRICING_WRITE_ENABLED: "false" }), false);
  assert.strictEqual(escritaHabilitada({ clienteSlug: "Loja-A" }, { MARGIN_PRICING_WRITE_CLIENTES: "x, loja-a" }), true);
  assert.strictEqual(escritaHabilitada({ clienteSlug: "loja-b" }, { MARGIN_PRICING_WRITE_CLIENTES: "loja-a" }), false);
  assert.strictEqual(escritaHabilitada({ clienteSlug: "qualquer" }, { MARGIN_PRICING_WRITE_ENABLED: "true" }), true);
  assert.strictEqual(resolvePricingConfig({}).previewTtlMinutes, 10);
});

// ── Validação de preço ─────────────────────────────────────────────────────

cenario("preço: ausente, zero, negativo, texto e 3 casas são recusados sem arredondar", () => {
  assert.strictEqual(avaliacao.validarPreco("").codigo, "PRECO_AUSENTE");
  assert.strictEqual(avaliacao.validarPreco(0).codigo, "PRECO_INVALIDO");
  assert.strictEqual(avaliacao.validarPreco(-3).codigo, "PRECO_INVALIDO");
  assert.strictEqual(avaliacao.validarPreco("abc").codigo, "PRECO_INVALIDO");
  assert.strictEqual(avaliacao.validarPreco("114.999").codigo, "PRECO_CASAS_DECIMAIS");
  assert.deepStrictEqual(avaliacao.validarPreco("114,9"), { ok: true, valor: 114.9 });
  assert.deepStrictEqual(avaliacao.validarPreco(99), { ok: true, valor: 99 });
});

cenario("preview com preço inválido: 400 antes de qualquer chamada ao ML", async () => {
  const c = criarCenario();
  const err = await esperaErro(() => previewPreco(c, criarRepoMemoria(), { novoPreco: "0" }));
  assert.strictEqual(err.statusCode, 400);
  assert.strictEqual(err.code, "PRECO_INVALIDO");
  assert.strictEqual(c.chamadas.mlFetch.length, 0);
});

// ── Conta / anúncio ────────────────────────────────────────────────────────

cenario("conta errada: conta de outro cliente é recusada (403) sem ler o ML", async () => {
  const c = criarCenario();
  const err = await esperaErro(() => previewPreco(c, criarRepoMemoria(), { clienteContaId: 99 }));
  assert.strictEqual(err.statusCode, 403);
  assert.strictEqual(c.chamadas.mlFetch.length, 0);
});

cenario("item de outra conta: gate bloqueia e o Motor nem é consultado", async () => {
  const c = criarCenario({ sellerIdDoItem: "999" });
  const r = await previewPreco(c, criarRepoMemoria());
  assert.strictEqual(r.bloqueado, true);
  assert.strictEqual(gate(r, "anuncio_conta").tom, "block");
  assert.strictEqual(c.chamadas.montarItens, 0);
  assert.strictEqual(r.preview && r.preview.id > 0, true, "a intenção bloqueada também é registrada");
});

cenario("grant inutilizável: 409 GRANT_ML_INDISPONIVEL; token da conta nunca vaza", async () => {
  const c = criarCenario({ grantOk: false });
  const err = await esperaErro(() => previewPreco(c, criarRepoMemoria()));
  assert.strictEqual(err.statusCode, 409);
  assert.strictEqual(err.code, "GRANT_ML_INDISPONIVEL");
});

cenario("toda leitura do ML usa o mlUserId DA CONTA escolhida", async () => {
  const c = criarCenario();
  await previewPreco(c, criarRepoMemoria());
  assert.ok(c.chamadas.mlFetch.length > 0);
  assert.ok(c.chamadas.mlFetch.every((ch) => ch.mlUserId === "555"));
  assert.ok(c.chamadas.cotacao.every((ch) => ch.mlUserId === "555"));
});

cenario("ML 429/404 ao ler o anúncio viram erros tipados, nunca 500 mudo", async () => {
  const c429 = criarCenario({ itemHttpStatus: 429 });
  const e429 = await esperaErro(() => previewPreco(c429, criarRepoMemoria()));
  assert.strictEqual(e429.statusCode, 429);
  assert.strictEqual(e429.code, "ML_RATE_LIMIT");
  const c404 = criarCenario({ itemHttpStatus: 404 });
  const e404 = await esperaErro(() => previewPreco(c404, criarRepoMemoria()));
  assert.strictEqual(e404.code, "ITEM_NAO_ENCONTRADO_ML");
});

// ── Cálculo (backend é autoridade) ─────────────────────────────────────────

cenario("preview de preço: comissão/frete RECOTADOS no novo preço e margem pelo marginEngine", async () => {
  const c = criarCenario();
  const r = await previewPreco(c, criarRepoMemoria());
  assert.strictEqual(c.chamadas.cotacao.length, 1);
  assert.strictEqual(c.chamadas.cotacao[0].precoEfetivo, 114.9);
  const esperadoDepois = computeMargin({ price: 114.9, cost: 50, taxRate: 0.1, fixedFee: 0, commission: 13.79, freight: 20 });
  const esperadoAntes = computeMargin({ price: 110.48, cost: 50, taxRate: 0.1, fixedFee: 0, commission: 13.26, freight: 20 });
  assert.strictEqual(r.proposta.lucro, esperadoDepois.profit);
  assert.strictEqual(r.proposta.margem, esperadoDepois.margin);
  assert.strictEqual(r.atual.lucro, esperadoAntes.profit);
  assert.strictEqual(r.proposta.comissaoFonte, "recotada");
  assert.strictEqual(r.proposta.variacaoPercentual, 4);
  assert.strictEqual(r.bloqueado, false);
});

cenario("frete grátis: cruzar o limiar muda o frete recotado (nunca reusa o frete do preço atual)", async () => {
  const c = criarCenario();
  const r = await previewPreco(c, criarRepoMemoria(), { novoPreco: "78.90" });
  assert.strictEqual(r.proposta.frete, 6.5);
  assert.strictEqual(r.proposta.freteFonte, "recotado");
});

cenario("recotação falhou: comissão cai para a TAXA do Motor (aviso) e frete para o atual (aviso)", async () => {
  const c = criarCenario({ cotacao: () => ({ comissaoValor: null, fretePrevisto: null }) });
  const r = await previewPreco(c, criarRepoMemoria());
  assert.strictEqual(r.proposta.comissao, 13.79);
  assert.strictEqual(r.proposta.comissaoFonte, "taxa");
  assert.strictEqual(gate(r, "comissao").tom, "warn");
  assert.strictEqual(r.proposta.frete, 20);
  assert.strictEqual(gate(r, "frete").tom, "warn");
});

cenario("sem comissão nem taxa: gate bloqueia (margem nova não confiável)", async () => {
  const c = criarCenario({ motor: motorItem({ taxa: null }), cotacao: () => ({ comissaoValor: null, fretePrevisto: 20 }) });
  const r = await previewPreco(c, criarRepoMemoria());
  assert.strictEqual(gate(r, "comissao").tom, "block");
  assert.strictEqual(r.bloqueado, true);
});

cenario("break-even: preço que zera o LC bloqueia", async () => {
  const c = criarCenario();
  const r = await previewPreco(c, criarRepoMemoria(), { novoPreco: "80.00" });
  assert.ok(r.proposta.lucro < 0);
  assert.strictEqual(gate(r, "break_even").tom, "block");
  assert.strictEqual(r.bloqueado, true);
});

cenario("custo ausente e imposto não declarado bloqueiam; 0% declarado é aceito", async () => {
  const semCusto = await previewPreco(criarCenario({ motor: motorItem({ custo: null }) }), criarRepoMemoria());
  assert.strictEqual(gate(semCusto, "custo").tom, "block");
  const semImposto = await previewPreco(criarCenario({ motor: motorItem({ imposto: null }) }), criarRepoMemoria());
  assert.strictEqual(gate(semImposto, "imposto").tom, "block");
  const zero = await previewPreco(criarCenario({ motor: motorItem({ imposto: 0 }) }), criarRepoMemoria());
  assert.strictEqual(gate(zero, "imposto").tom, "ok");
});

cenario("meta de margem é só AVISO (não existe margem mínima oficial)", async () => {
  const c = criarCenario({ motor: motorItem({ meta: 0.3 }) });
  const r = await previewPreco(c, criarRepoMemoria());
  assert.strictEqual(gate(r, "meta").tom, "warn");
  assert.strictEqual(r.bloqueado, false);
});

cenario("stale: preço visto diferente do preço ao vivo bloqueia com a mensagem pedida", async () => {
  const c = criarCenario();
  const r = await previewPreco(c, criarRepoMemoria(), { precoVisto: 105 });
  assert.strictEqual(gate(r, "preco_confirmado").tom, "block");
  assert.strictEqual(gate(r, "preco_confirmado").titulo, "Preço alterado desde o preview. Atualize e tente novamente.");
});

cenario("preço: variação e promoção ativa bloqueiam a edição do preço base", async () => {
  const comVariacao = await previewPreco(criarCenario({ temVariacao: true }), criarRepoMemoria());
  assert.strictEqual(gate(comVariacao, "variacao").tom, "block");
  const comPromo = await previewPreco(criarCenario({ motor: motorItem({ promo: 99.9 }) }), criarRepoMemoria());
  assert.strictEqual(gate(comPromo, "promocao_ativa").tom, "block");
});

cenario("integridade: UNVALIDATED bloqueia; SUSPECT_DATA avisa", async () => {
  const unv = await previewPreco(criarCenario({ motor: motorItem({ status: "UNVALIDATED" }) }), criarRepoMemoria());
  assert.strictEqual(gate(unv, "integridade").tom, "block");
  const sus = await previewPreco(criarCenario({ motor: motorItem({ status: "SUSPECT_DATA" }) }), criarRepoMemoria());
  assert.strictEqual(gate(sus, "integridade").tom, "warn");
});

cenario("simular: não persiste, não escreve — e respeita o rollout na resposta", async () => {
  const c = criarCenario();
  const repo = criarRepoMemoria();
  const r = await service.simular({ clienteSlug: "loja-a", clienteContaId: 7, itemId: "MLB100", tipo: "PRICE", novoPreco: 114.9, precoVisto: 110.48 }, comRepo(c, repo));
  assert.strictEqual(r.simulado, true);
  assert.strictEqual(repo.linhas.length, 0);
  assert.strictEqual(c.chamadas.atualizarPreco.length, 0);
  assert.strictEqual(r.escrita.habilitada, false);
});

cenario("preview persiste a intenção com preço visto/solicitado/margens/gates e usuário", async () => {
  const c = criarCenario();
  const repo = criarRepoMemoria();
  const r = await previewPreco(c, repo);
  assert.ok(r.preview.id > 0);
  const row = repo.linhas[0];
  assert.strictEqual(row.status, "preview");
  assert.strictEqual(row.precoVisto, 110.48);
  assert.strictEqual(row.precoSolicitado, 114.9);
  assert.strictEqual(row.userNome, "Pedro");
  assert.strictEqual(row.clienteContaId, 7);
  assert.ok(Array.isArray(row.gates) && row.gates.length > 5);
  assert.strictEqual(c.chamadas.atualizarPreco.length, 0);
});

// ── Aplicar: preço ─────────────────────────────────────────────────────────

async function aplicar(c, repo, previewId, key = "chave-idem-0001", extra = {}) {
  return service.aplicar(
    { clienteSlug: "loja-a", clienteContaId: 7, previewId, idempotencyKey: key, user: { id: 9, nome: "Pedro", email: "p@x" }, ...extra },
    comRepo(c, repo)
  );
}

cenario("rollout OFF: aplicar responde 403 e NÃO toca o ML nem a linha", async () => {
  const c = criarCenario();
  const repo = criarRepoMemoria();
  const p = await previewPreco(c, repo);
  const err = await esperaErro(() => aplicar(c, repo, p.preview.id));
  assert.strictEqual(err.statusCode, 403);
  assert.strictEqual(err.code, "ESCRITA_DESABILITADA");
  assert.strictEqual(c.chamadas.atualizarPreco.length, 0);
  assert.strictEqual(repo.linhas[0].status, "preview");
});

cenario("sucesso: reavalia ao vivo, escreve 1x com a conta certa, audita, loga e agenda snapshot do item", async () => {
  const c = criarCenario({ env: ESCRITA_ON });
  const repo = criarRepoMemoria();
  const p = await previewPreco(c, repo);
  const montarAntes = c.chamadas.montarItens;
  const r = await aplicar(c, repo, p.preview.id);
  await new Promise((res) => setImmediate(res)); // refresh do snapshot roda em background
  assert.strictEqual(r.ok, true);
  assert.strictEqual(c.chamadas.montarItens, montarAntes + 1, "o aplicar relê o Motor ao vivo");
  assert.strictEqual(c.chamadas.atualizarPreco.length, 1);
  assert.deepStrictEqual(c.chamadas.atualizarPreco[0], { clienteId: 3, itemId: "MLB100", novoPreco: 114.9, mlUserId: "555" });
  const row = repo.linhas[0];
  assert.strictEqual(row.status, "aplicado");
  assert.strictEqual(row.precoConfirmado, 114.9);
  assert.strictEqual(row.precoAnterior, 110.48);
  assert.strictEqual(row.snapshotStatus, "atualizado");
  assert.strictEqual(c.chamadas.logs.length, 1);
  assert.strictEqual(c.chamadas.logs[0].status, "sucesso");
  assert.strictEqual(c.chamadas.logs[0].detalhes.clienteContaId, 7);
  assert.strictEqual(c.chamadas.snapshot.length, 1);
  assert.deepStrictEqual(c.chamadas.snapshot[0], { clienteSlug: "loja-a", clienteId: 3, clienteContaId: 7, itemId: "MLB100" });
  assert.strictEqual(c.chamadas.camposConfirmados.length, 1);
  assert.strictEqual(r.aplicacao.usuario.nome, "Pedro");
});

cenario("sem leitura persistida ligada: aplica, mas não dispara refresh de snapshot (status nao_aplicavel)", async () => {
  const c = criarCenario({ env: ESCRITA_ON, snapshotLigado: false });
  const repo = criarRepoMemoria();
  const p = await previewPreco(c, repo);
  const r = await aplicar(c, repo, p.preview.id);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(c.chamadas.snapshot.length, 0);
  assert.strictEqual(repo.linhas[0].snapshotStatus, "nao_aplicavel");
  assert.strictEqual(r.aplicacao.snapshotStatus, "nao_aplicavel");
});

cenario("o valor confirmado é o da RESPOSTA do ML, nunca o enviado", async () => {
  const c = criarCenario({ env: ESCRITA_ON, respostaPreco: () => ({ ok: true, preco: 114.89 }) });
  const repo = criarRepoMemoria();
  const p = await previewPreco(c, repo);
  const r = await aplicar(c, repo, p.preview.id);
  assert.strictEqual(r.aplicacao.precoConfirmado, 114.89);
  assert.strictEqual(r.divergente, true);
});

cenario("idempotência: mesma chave 2x = 1 escrita; a 2ª resposta é replay", async () => {
  const c = criarCenario({ env: ESCRITA_ON });
  const repo = criarRepoMemoria();
  const p = await previewPreco(c, repo);
  const a = await aplicar(c, repo, p.preview.id, "retry-rede-01");
  const b = await aplicar(c, repo, p.preview.id, "retry-rede-01");
  assert.strictEqual(a.ok, true);
  assert.strictEqual(b.replay, true);
  assert.strictEqual(b.aplicacao.id, a.aplicacao.id);
  assert.strictEqual(c.chamadas.atualizarPreco.length, 1);
});

cenario("duplo clique concorrente com chaves diferentes: 1 escrita, o outro é recusado", async () => {
  const c = criarCenario({ env: ESCRITA_ON });
  const repo = criarRepoMemoria();
  const p = await previewPreco(c, repo);
  const resultados = await Promise.allSettled([aplicar(c, repo, p.preview.id, "clique-a-0001"), aplicar(c, repo, p.preview.id, "clique-b-0002")]);
  assert.strictEqual(c.chamadas.atualizarPreco.length, 1);
  const rejeitado = resultados.find((x) => x.status === "rejected");
  assert.ok(rejeitado, "um dos cliques precisa ser recusado");
  assert.strictEqual(rejeitado.reason.statusCode, 409);
});

cenario("concorrência: 2 pessoas, 2 previews do MESMO item — enquanto um aplica, o outro recebe APLICACAO_EM_ANDAMENTO", async () => {
  const c = criarCenario({ env: ESCRITA_ON });
  const repo = criarRepoMemoria();
  const p1 = await previewPreco(c, repo);
  const p2 = await previewPreco(c, repo, { novoPreco: "115.90" });
  let liberar;
  const trava = new Promise((resolve) => { liberar = resolve; });
  c.estado.respostaPreco = async (p) => { await trava; return { ok: true, preco: p.novoPreco }; };
  const primeiro = aplicar(c, repo, p1.preview.id, "pessoa-a-0001");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const err = await esperaErro(() => aplicar(c, repo, p2.preview.id, "pessoa-b-0002"));
  assert.strictEqual(err.code, "APLICACAO_EM_ANDAMENTO");
  liberar();
  const r1 = await primeiro;
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(c.chamadas.atualizarPreco.length, 1);
});

cenario("stale no aplicar: preço mudou no ML depois do preview → recusado PRECO_ALTERADO, zero escrita", async () => {
  const c = criarCenario({ env: ESCRITA_ON });
  const repo = criarRepoMemoria();
  const p = await previewPreco(c, repo);
  c.estado.motor = motorItem({ preco: 112.0 });
  const r = await aplicar(c, repo, p.preview.id);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.codigo, "PRECO_ALTERADO");
  assert.strictEqual(repo.linhas[0].status, "recusado");
  assert.strictEqual(c.chamadas.atualizarPreco.length, 0);
  assert.strictEqual(c.chamadas.logs[0].status, "erro");
});

cenario("gate bloqueado no preview nunca vira escrita (break-even)", async () => {
  const c = criarCenario({ env: ESCRITA_ON });
  const repo = criarRepoMemoria();
  const p = await previewPreco(c, repo, { novoPreco: "80.00" });
  const r = await aplicar(c, repo, p.preview.id);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.codigo, "GATE_BREAK_EVEN");
  assert.strictEqual(c.chamadas.atualizarPreco.length, 0);
});

cenario("ML 429 → recusado (sem retry cego); 400 → falhou; 500 → falhou", async () => {
  for (const [codigo, esperado] of [["too_many_requests", "recusado"], ["item.price.invalid", "falhou"], ["ML_HTTP_500", "falhou"]]) {
    const c = criarCenario({ env: ESCRITA_ON, respostaPreco: () => ({ ok: false, codigo, motivo: "recusado pelo ML" }) });
    const repo = criarRepoMemoria();
    const p = await previewPreco(c, repo);
    const r = await aplicar(c, repo, p.preview.id);
    assert.strictEqual(r.ok, false, codigo);
    assert.strictEqual(repo.linhas[0].status, esperado, codigo);
    assert.strictEqual(repo.linhas[0].erroCodigo, codigo);
    assert.strictEqual(c.chamadas.atualizarPreco.length, 1, "uma única tentativa");
  }
  const c500 = criarCenario({ env: ESCRITA_ON, respostaPreco: () => ({ ok: false, codigo: "ML_HTTP_500", motivo: "x" }) });
  const repo500 = criarRepoMemoria();
  const p500 = await previewPreco(c500, repo500);
  await aplicar(c500, repo500, p500.preview.id);
  assert.strictEqual(repo500.linhas[0].mlStatus, 500);
});

cenario("resposta do ML sem preço → falhou (resultado incerto), nunca 'aplicado' com o valor enviado", async () => {
  const c = criarCenario({ env: ESCRITA_ON, respostaPreco: () => ({ ok: false, codigo: "PRECO_CONFIRMACAO_FALHOU", motivo: "sem confirmação" }) });
  const repo = criarRepoMemoria();
  const p = await previewPreco(c, repo);
  const r = await aplicar(c, repo, p.preview.id);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(repo.linhas[0].status, "falhou");
  assert.strictEqual(repo.linhas[0].precoConfirmado, null);
});

cenario("preview expirado → PREVIEW_EXPIRADO, zero escrita", async () => {
  let agora = Date.now();
  const repo = criarRepoMemoria({ agora: () => agora });
  const c = criarCenario({ env: ESCRITA_ON });
  c.deps.now = () => new Date(agora);
  const p = await previewPreco(c, repo);
  agora += 11 * 60000;
  const err = await esperaErro(() => aplicar(c, repo, p.preview.id, "expirou-0001", {}));
  assert.strictEqual(err.code, "PREVIEW_EXPIRADO");
  assert.strictEqual(repo.linhas[0].status, "recusado");
  assert.strictEqual(c.chamadas.atualizarPreco.length, 0);
});

cenario("preview de outra conta não é aplicável (404) e chave inválida é 400", async () => {
  const c = criarCenario({ env: ESCRITA_ON });
  const repo = criarRepoMemoria();
  const p = await previewPreco(c, repo);
  repo.linhas[0].clienteContaId = 8;
  const e404 = await esperaErro(() => aplicar(c, repo, p.preview.id));
  assert.strictEqual(e404.statusCode, 404);
  const e400 = await esperaErro(() => aplicar(c, repo, p.preview.id, "curta"));
  assert.strictEqual(e400.code, "IDEMPOTENCY_KEY_INVALIDA");
  assert.strictEqual(c.chamadas.atualizarPreco.length, 0);
});

cenario("exceção durante a escrita → falhou (incerto) e o item é liberado", async () => {
  const c = criarCenario({ env: ESCRITA_ON, respostaPreco: () => { throw new Error("socket hang up"); } });
  const repo = criarRepoMemoria();
  const p = await previewPreco(c, repo);
  const r = await aplicar(c, repo, p.preview.id);
  assert.strictEqual(r.codigo, "ESCRITA_EXCECAO");
  assert.strictEqual(repo.linhas[0].status, "falhou");
});

// ── Promoções ──────────────────────────────────────────────────────────────

function cenarioPromo(extra = {}) {
  return criarCenario({ motor: motorItem({ preco: 149.9 }), ...extra });
}

async function previewPromo(c, repo, promotionId = "P-DEAL-1", extra = {}) {
  return service.preview(
    { clienteSlug: "loja-a", clienteContaId: 7, itemId: "MLB100", tipo: "PROMOTION", promotionId, precoVisto: 149.9, ...extra },
    comRepo(c, repo)
  );
}

cenario("promoção DEAL elegível: preço sugerido, desconto, ML banca (rebate) e seller banca; PARTICIPAR", async () => {
  const c = cenarioPromo();
  const r = await previewPromo(c, criarRepoMemoria());
  assert.strictEqual(r.proposta.preco, 129.9);
  assert.strictEqual(r.promocao.descontoReais, 20);
  assert.strictEqual(r.promocao.mlBanca, 5.2);
  assert.strictEqual(r.promocao.sellerBanca, 14.8);
  assert.strictEqual(r.promocao.meliPercentage, 3.47);
  assert.strictEqual(r.promocao.sellerPercentage, 9.87);
  assert.strictEqual(r.promocao.escrita.acao, "PARTICIPAR");
  assert.strictEqual(r.proposta.rebate, 5.2);
  const esperado = computeMargin({ price: 129.9, cost: 50, taxRate: 0.1, fixedFee: 0, commission: 15.59, freight: 20, rebate: 5.2 });
  assert.strictEqual(r.proposta.lucro, esperado.profit);
  assert.strictEqual(r.bloqueado, false);
});

cenario("SELLER_CAMPAIGN ativa (aplicada) → ALTERAR; NÃO APLICADA e PROGRAMADA → só simulação", async () => {
  const ativa = await previewPromo(cenarioPromo({ promocoes: [promo({ id: "S1", tipo: "SELLER_CAMPAIGN", status: "started", statusExibicao: "ATIVA" })] }), criarRepoMemoria(), "S1");
  assert.strictEqual(ativa.promocao.escrita.acao, "ALTERAR");
  const naoAplicada = await previewPromo(cenarioPromo({ promocoes: [promo({ id: "S2", tipo: "SELLER_CAMPAIGN", status: "started", statusExibicao: "NÃO APLICADA" })] }), criarRepoMemoria(), "S2");
  assert.strictEqual(naoAplicada.promocao.escrita.suportada, false);
  assert.strictEqual(gate(naoAplicada, "promocao_escrita").tom, "block");
  const programada = await previewPromo(cenarioPromo({ promocoes: [promo({ id: "D3", status: "pending", statusExibicao: "PROGRAMADA" })] }), criarRepoMemoria(), "D3");
  assert.strictEqual(programada.promocao.escrita.suportada, false);
});

cenario("ALTERAR oferta ativa para o MESMO preço é bloqueado (PUT inócuo); preço diferente passa", async () => {
  const promos = [promo({ id: "S1", tipo: "SELLER_CAMPAIGN", status: "started", statusExibicao: "ATIVA", precoFinal: 149.9 })];
  const igual = await previewPromo(cenarioPromo({ promocoes: promos }), criarRepoMemoria(), "S1");
  assert.strictEqual(gate(igual, "promocao_preco").tom, "block");
  const diferente = await previewPromo(cenarioPromo({ promocoes: promos }), criarRepoMemoria(), "S1", { novoPreco: "139.90" });
  assert.strictEqual(gate(diferente, "promocao_preco").tom, "ok");
});

cenario("tipo sem escrita (SMART): simula com retorno ML, mas bloqueia 'Somente simulação'", async () => {
  const c = cenarioPromo({ promocoes: [promo({ id: "SM1", tipo: "SMART", precoFinal: 139.9, subsidioMl: 7.5, meliPercentage: 5, sellerPercentage: 1.67 })] });
  const r = await previewPromo(c, criarRepoMemoria(), "SM1");
  assert.strictEqual(r.promocao.escrita.suportada, false);
  assert.strictEqual(gate(r, "promocao_escrita").titulo, "Somente simulação");
  assert.strictEqual(r.proposta.rebate, 7.5);
  assert.ok(r.proposta.margem !== null);
});

cenario("nenhuma promoção / promoção inexistente: bloqueia sem escrever", async () => {
  const r = await previewPromo(cenarioPromo({ promocoes: [] }), criarRepoMemoria(), "P-X");
  assert.strictEqual(gate(r, "promocao_disponivel").tom, "block");
});

cenario("promoção desaparece depois do preview → recusado, zero escrita", async () => {
  const c = cenarioPromo({ env: ESCRITA_ON });
  const repo = criarRepoMemoria();
  const p = await previewPromo(c, repo);
  c.estado.promocoes = [];
  const r = await aplicar(c, repo, p.preview.id, "promo-some-01");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.codigo, "GATE_PROMOCAO_DISPONIVEL");
  assert.strictEqual(c.chamadas.aplicarPromocao.length, 0);
});

cenario("promoção DEAL: aplicar chama o serviço de escrita existente 1x com a conta certa", async () => {
  const c = cenarioPromo({ env: ESCRITA_ON });
  const repo = criarRepoMemoria();
  const p = await previewPromo(c, repo);
  const r = await aplicar(c, repo, p.preview.id, "promo-ok-0001", { promotionId: "P-DEAL-1" });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(c.chamadas.aplicarPromocao[0], { clienteId: 3, itemId: "MLB100", mlUserId: "555", promotionId: "P-DEAL-1", precoNovo: 129.9 });
  assert.strictEqual(repo.linhas[0].promotionAcao, "PARTICIPAR");
  assert.strictEqual(c.chamadas.camposConfirmados.length, 0, "promoção não mexe no preço base local");
});

cenario("promoção: aplicar por rota de OUTRA promoção é recusado", async () => {
  const c = cenarioPromo({ env: ESCRITA_ON });
  const repo = criarRepoMemoria();
  const p = await previewPromo(c, repo);
  const err = await esperaErro(() => aplicar(c, repo, p.preview.id, "promo-outra-1", { promotionId: "P-OUTRA" }));
  assert.strictEqual(err.code, "PREVIEW_DE_OUTRA_PROMOCAO");
});

cenario("promoção: resposta sem preço → falhou PROMOCAO_CONFIRMACAO_FALHOU", async () => {
  const c = cenarioPromo({ env: ESCRITA_ON, respostaPromocao: () => ({ ok: true, metodo: "POST", precoConfirmado: null }) });
  const repo = criarRepoMemoria();
  const p = await previewPromo(c, repo);
  const r = await aplicar(c, repo, p.preview.id, "promo-semp-01");
  assert.strictEqual(r.codigo, "PROMOCAO_CONFIRMACAO_FALHOU");
  assert.strictEqual(repo.linhas[0].status, "falhou");
});

cenario("lista de promoções do drawer: margem/LC por promoção, escrita suportada só p/ DEAL/SELLER_CAMPAIGN", async () => {
  const c = cenarioPromo({
    promocoes: [
      promo({ id: "D1" }),
      promo({ id: "SM1", tipo: "SMART", status: "candidate", statusExibicao: "ELEGÍVEL", precoFinal: 139.9 }),
      promo({ id: "PD", tipo: "PRICE_DISCOUNT", status: "started", statusExibicao: "ATIVA", precoFinal: null }),
    ],
  });
  const r = await service.promocoes({ clienteSlug: "loja-a", clienteContaId: 7, itemId: "MLB100" }, c.deps);
  assert.strictEqual(r.promocoes.length, 3);
  const [d1, sm1, pd] = r.promocoes;
  assert.strictEqual(d1.escrita.acao, "PARTICIPAR");
  assert.ok(d1.margem !== null && d1.lucro !== null);
  assert.strictEqual(sm1.escrita.suportada, false);
  assert.strictEqual(pd.margem, null, "sem preço final do ML, nunca inventa margem");
  assert.strictEqual(r.atual.preco, 149.9);
  assert.strictEqual(r.escritaHabilitada, false);
  assert.strictEqual(c.chamadas.aplicarPromocao.length, 0);
});

// ── Histórico / auditoria ──────────────────────────────────────────────────

cenario("histórico: só tentativas reais (aplicado/recusado/falhou) com usuário, conta e antes/depois", async () => {
  const c = criarCenario({ env: ESCRITA_ON });
  const repo = criarRepoMemoria();
  const p1 = await previewPreco(c, repo);
  await aplicar(c, repo, p1.preview.id, "hist-ok-0001");
  await previewPreco(c, repo, { novoPreco: "80.00", precoVisto: 114.9 }); // preview que nunca foi aplicado
  const h = await service.historico({ clienteSlug: "loja-a", clienteContaId: 7, itemId: "MLB100" }, comRepo(c, repo));
  assert.strictEqual(h.historico.length, 1);
  const e = h.historico[0];
  assert.strictEqual(e.status, "aplicado");
  assert.strictEqual(e.usuario.nome, "Pedro");
  assert.strictEqual(e.precoAnterior, 110.48);
  assert.strictEqual(e.precoConfirmado, 114.9);
  assert.ok(e.margemAntes !== null && e.margemDepois !== null);
});

// ── Rotas ──────────────────────────────────────────────────────────────────

cenario("rotas: toda rota exige auth + automações + carteira; as de escrita são só as de aplicar", () => {
  const router = require("../routes/margemPrecificacaoRoutes");
  const rotas = router.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, methods: Object.keys(l.route.methods), n: l.route.stack.length }));
  assert.ok(rotas.length >= 8);
  for (const r of rotas) assert.strictEqual(r.n, 4, `${r.path} precisa de 3 middlewares + handler`);
  const aplicar = rotas.filter((r) => /aplicar$/.test(r.path)).map((r) => r.path).sort();
  assert.deepStrictEqual(aplicar, ["/:clienteSlug/precificacao/aplicar", "/:clienteSlug/promocoes/:promotionId/aplicar"]);
});

cenario("controller: erro tipado vira status + payload; aplicar recusado responde 200 ok:false", async () => {
  const { createMargemPrecificacaoController } = require("../controllers/margemPrecificacaoController");
  const ctrl = createMargemPrecificacaoController({
    service: {
      preview: async () => { throw avaliacao.erroHttp(400, "PRECO_INVALIDO", "x"); },
      aplicar: async () => ({ ok: false, codigo: "PRECO_ALTERADO" }),
    },
  });
  const res = () => ({ statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  const r1 = res();
  await ctrl.preview({ params: { clienteSlug: "loja-a" }, body: {}, query: {} }, r1);
  assert.strictEqual(r1.statusCode, 400);
  assert.strictEqual(r1.body.codigo, "PRECO_INVALIDO");
  const r2 = res();
  await ctrl.aplicar({ params: { clienteSlug: "loja-a" }, body: { previewId: 1 }, query: {}, headers: {}, socket: {} }, r2);
  assert.strictEqual(r2.statusCode, 200);
  assert.strictEqual(r2.body.ok, false);
});

cenario("defaults reais: tipos com escrita da Central = os do serviço de escrita de /anuncios", () => {
  const { TIPOS_COM_ESCRITA } = require("../services/meliAnuncios/meliPromocoesEscritaService");
  assert.deepStrictEqual([...TIPOS_COM_ESCRITA].sort(), ["DEAL", "SELLER_CAMPAIGN"]);
  const r = avaliacao.escritaDaPromocao(promo({ tipo: "LIGHTNING" }), TIPOS_COM_ESCRITA);
  assert.strictEqual(r.suportada, false);
});

async function main() {
  let falhas = 0;
  for (const caso of casos) {
    try {
      service._cacheContexto.clear();
      await caso.fn();
      console.log(`  ✓ ${caso.nome}`);
    } catch (err) {
      falhas += 1;
      console.error(`  ✗ ${caso.nome}\n    ${err.stack || err.message}`);
    }
  }
  if (falhas > 0) {
    console.error(`margemPrecificacao: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`margemPrecificacao: ok (${casos.length} cenários)`);
  }
}

main();
