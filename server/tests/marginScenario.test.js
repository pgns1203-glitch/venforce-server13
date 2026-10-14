// server/tests/marginScenario.test.js
// calcularCenario / calcularComposicao — o cenário "e se o preço fosse P'?" do
// núcleo do Motor. Puro: sem banco, sem Mercado Livre. A conta é a do
// computeMargin (uma fórmula só); aqui se confere o que o cenário acrescenta:
// ΔLC, banca, empate de volume, faixa de frete e o veredito.

const assert = require("assert");
const core = require("../services/motorMargem/core");

const { calcularCenario, calcularComposicao, computeMargin, VEREDITOS, MOTIVOS } = core;

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

// Caso da rodada: 94,90 → 89,77 com retorno ML de 3,30. Comissão 14%, imposto 6%.
const ATUAL = { preco: 94.9, custo: 21.35, aliquota: 0.06, taxa_fixa: 0, comissao: 13.29, frete: 10, rebate: 0 };
const COTACAO_89_77 = { comissao: 12.57, frete: 10 };
const META = { margem_alvo: 0.1, margem_minima: 0 };

function promo(extra = {}) {
  return calcularCenario({
    atual: ATUAL,
    cenario: { tipo: "promo", preco: 89.77, rebate: 3.3, status_promocao: "candidate" },
    cotacao: COTACAO_89_77,
    meta: META,
    ...extra,
  });
}

cenario("94,90 → 89,77 com retorno de 3,30: ΔLC negativo, entrar_se_girar, empate ≈ +1,8%", () => {
  const r = promo();
  assert.strictEqual(r.veredito, VEREDITOS.ENTRAR_SE_GIRAR);
  assert.strictEqual(r.motivo, "lc_por_unidade_cai");
  assert.ok(r.delta_lc < 0, `ΔLC deveria ser negativo, veio ${r.delta_lc}`);
  assert.ok(r.empate_volume > 0.017 && r.empate_volume < 0.019, `empate ≈ +1,8%, veio ${r.empate_volume}`);
  assert.strictEqual(r.desconto, 5.13);
  assert.strictEqual(r.ml_banca, 3.3);
  assert.strictEqual(r.seller_banca, 1.83);
  assert.strictEqual(r.flags.mudou_faixa_frete, false);
});

cenario("a conta é a do computeMargin: LC', margem' e imposto' batem com o núcleo", () => {
  const r = promo();
  const esperado = computeMargin({ price: 89.77, cost: 21.35, taxRate: 0.06, fixedFee: 0, commission: 12.57, freight: 10, rebate: 3.3 });
  const atual = computeMargin({ price: 94.9, cost: 21.35, taxRate: 0.06, fixedFee: 0, commission: 13.29, freight: 10 });
  assert.strictEqual(r.cenario.lc, esperado.profit);
  assert.strictEqual(r.cenario.margem_ratio, esperado.margin);
  assert.strictEqual(r.atual.lc, atual.profit);
  assert.strictEqual(r.atual.margem_ratio, atual.margin);
  assert.strictEqual(r.cenario.imposto, Math.round(89.77 * 0.06 * 100) / 100);
  assert.strictEqual(r.delta_lc, Math.round((esperado.profit - atual.profit) * 100) / 100);
  // empate = LC_atual / LC' − 1
  assert.strictEqual(r.empate_volume, Math.round((atual.profit / esperado.profit - 1) * 1e6) / 1e6);
});

cenario("ΔLC ≥ 0 e margem' na meta: entrar (retorno ML cobre o desconto)", () => {
  const r = promo({ cenario: { tipo: "promo", preco: 89.77, rebate: 6, status_promocao: "candidate" } });
  assert.ok(r.delta_lc >= 0, `ΔLC ${r.delta_lc}`);
  assert.strictEqual(r.veredito, VEREDITOS.ENTRAR);
  assert.strictEqual(r.motivo, null);
  assert.ok(r.empate_volume <= 0, "com ΔLC ≥ 0 o empate de volume não pede giro a mais");
});

cenario("ΔLC ≥ 0 mas margem' abaixo da meta: não é entrar — entrar_se_girar com o motivo", () => {
  const r = promo({
    cenario: { tipo: "promo", preco: 89.77, rebate: 6, status_promocao: "candidate" },
    meta: { margem_alvo: 0.9, margem_minima: 0 },
  });
  assert.ok(r.delta_lc >= 0);
  assert.strictEqual(r.veredito, VEREDITOS.ENTRAR_SE_GIRAR);
  assert.strictEqual(r.motivo, "margem_abaixo_da_meta");
});

cenario("LC' ≤ 0: nao_entrar e empate de volume null", () => {
  const sem = calcularCenario({
    atual: { ...ATUAL, custo: 75 },
    cenario: { tipo: "promo", preco: 89.77, rebate: 0, status_promocao: "candidate" },
    cotacao: COTACAO_89_77,
    meta: META,
  });
  assert.ok(sem.cenario.lc <= 0, `LC' ${sem.cenario.lc}`);
  assert.strictEqual(sem.veredito, VEREDITOS.NAO_ENTRAR);
  assert.strictEqual(sem.motivo, "lc_nao_positivo");
  assert.strictEqual(sem.empate_volume, null);
});

cenario("LC atual ≤ 0 e LC' > 0: empate de volume null (não existe base de comparação)", () => {
  // custo alto o bastante para o LC atual ser ≤ 0, mas o retorno ML torna o LC' positivo
  const atual = { ...ATUAL, custo: 66 };
  const r = calcularCenario({
    atual,
    cenario: { tipo: "promo", preco: 89.77, rebate: 8, status_promocao: "candidate" },
    cotacao: COTACAO_89_77,
    meta: META,
  });
  assert.ok(r.atual.lc <= 0, `LC atual ${r.atual.lc}`);
  assert.ok(r.cenario.lc > 0, `LC' ${r.cenario.lc}`);
  assert.strictEqual(r.empate_volume, null);
  assert.ok(r.delta_lc > 0);
});

cenario("comissão' indisponível: bloqueado com motivo, sem estimar (nem pela taxa atual)", () => {
  const r = promo({ cotacao: { comissao: null, frete: 10 } });
  assert.strictEqual(r.veredito, VEREDITOS.BLOQUEADO);
  assert.strictEqual(r.motivo, MOTIVOS.COMISSAO_INDISPONIVEL);
  assert.deepStrictEqual(r.motivos, [MOTIVOS.COMISSAO_INDISPONIVEL]);
  assert.strictEqual(r.cenario.comissao, null);
  assert.strictEqual(r.cenario.lc, null);
  assert.strictEqual(r.cenario.margem_ratio, null);
  assert.strictEqual(r.delta_lc, null);
  assert.strictEqual(r.empate_volume, null);
  // o que é conhecido continua aparecendo
  assert.strictEqual(r.cenario.imposto, Math.round(89.77 * 0.06 * 100) / 100);
  assert.ok(r.atual.lc !== null);
});

cenario("frete' indisponível: bloqueado; frete combinável (não aplicável) é zero DECLARADO, não ausência", () => {
  const sem = promo({ cotacao: { comissao: 12.57, frete: null } });
  assert.strictEqual(sem.veredito, VEREDITOS.BLOQUEADO);
  assert.strictEqual(sem.motivo, MOTIVOS.FRETE_INDISPONIVEL);
  assert.strictEqual(sem.flags.mudou_faixa_frete, null);

  const combinavel = calcularCenario({
    atual: { ...ATUAL, frete: null },
    cenario: { tipo: "promo", preco: 89.77, rebate: 3.3, status_promocao: "candidate" },
    cotacao: { comissao: 12.57, frete: null, frete_aplicavel: false },
    meta: META,
  });
  assert.notStrictEqual(combinavel.veredito, VEREDITOS.BLOQUEADO);
  assert.strictEqual(combinavel.cenario.frete, 0);
  assert.strictEqual(combinavel.atual.frete, 0);
  assert.strictEqual(combinavel.flags.mudou_faixa_frete, false);
});

cenario("faixa de frete: frete' ≠ frete ⇒ mudou_faixa_frete=true, e o frete' entra na conta", () => {
  const r = promo({ cotacao: { comissao: 12.57, frete: 0 } });
  assert.strictEqual(r.flags.mudou_faixa_frete, true);
  assert.strictEqual(r.atual.frete, 10);
  assert.strictEqual(r.cenario.frete, 0);
  const mesmo = promo();
  assert.strictEqual(mesmo.flags.mudou_faixa_frete, false);
  // o frete menor melhora o LC' em exatamente a diferença
  assert.strictEqual(Math.round((r.cenario.lc - mesmo.cenario.lc) * 100) / 100, 10);
});

cenario("P' ≥ P em promoção: sem_desconto_efetivo, bloqueado (e o número continua visível)", () => {
  const igual = promo({ cenario: { tipo: "promo", preco: 94.9, rebate: 0, status_promocao: "candidate" } });
  assert.strictEqual(igual.flags.sem_desconto_efetivo, true);
  assert.strictEqual(igual.veredito, VEREDITOS.BLOQUEADO);
  assert.strictEqual(igual.motivo, MOTIVOS.SEM_DESCONTO_EFETIVO);
  const maior = promo({ cenario: { tipo: "promo", preco: 99.9, rebate: 0, status_promocao: "candidate" } });
  assert.strictEqual(maior.flags.sem_desconto_efetivo, true);
  assert.strictEqual(maior.motivo, MOTIVOS.SEM_DESCONTO_EFETIVO);
  assert.ok(maior.cenario.preco === 99.9);
  assert.strictEqual(promo().flags.sem_desconto_efetivo, false);
});

cenario("promoção já ativa (started/active): flag ativa e bloqueado — não é oportunidade", () => {
  for (const status of ["started", "active", "ACTIVE"]) {
    const r = promo({ cenario: { tipo: "promo", preco: 89.77, rebate: 3.3, status_promocao: status } });
    assert.strictEqual(r.flags.ativa, true, status);
    assert.strictEqual(r.veredito, VEREDITOS.BLOQUEADO);
    assert.strictEqual(r.motivo, MOTIVOS.PROMOCAO_ATIVA);
  }
  assert.strictEqual(promo().flags.ativa, false);
  assert.strictEqual(promo({ cenario: { tipo: "promo", preco: 89.77, rebate: 3.3, status_promocao: "pending" } }).flags.ativa, false);
});

cenario("subir o preço (cenário `preco`) é legítimo: não vira sem_desconto_efetivo", () => {
  const r = calcularCenario({
    atual: ATUAL,
    cenario: { tipo: "preco", preco: 99.9 },
    cotacao: { comissao: 13.99, frete: 10 },
    meta: META,
  });
  assert.strictEqual(r.flags.sem_desconto_efetivo, false);
  assert.ok(r.delta_lc > 0);
  assert.strictEqual(r.veredito, VEREDITOS.ENTRAR);
  assert.ok(r.empate_volume < 0);
  assert.strictEqual(r.desconto, -5);
  assert.strictEqual(r.seller_banca, -5);
});

cenario("preço igual ao atual no cenário `preco`: bloqueado, sem inventar variação", () => {
  const r = calcularCenario({ atual: ATUAL, cenario: { tipo: "preco", preco: 94.9 }, cotacao: { comissao: 13.29, frete: 10 }, meta: META });
  assert.strictEqual(r.veredito, VEREDITOS.BLOQUEADO);
  assert.strictEqual(r.motivo, MOTIVOS.PRECO_IGUAL_AO_ATUAL);
});

cenario("rebate ambíguo / indisponível na composição atual: flag e bloqueado", () => {
  const amb = promo({ flags: { rebate_ambiguo: true } });
  assert.strictEqual(amb.flags.rebate_ambiguo, true);
  assert.strictEqual(amb.veredito, VEREDITOS.BLOQUEADO);
  assert.strictEqual(amb.motivo, MOTIVOS.REBATE_AMBIGUO);
  const indisp = promo({ flags: { rebate_atual_indisponivel: true } });
  assert.strictEqual(indisp.motivo, MOTIVOS.REBATE_ATUAL_INDISPONIVEL);
  assert.strictEqual(promo().flags.rebate_ambiguo, false);
});

cenario("insumo ausente da composição atual: bloqueado com o motivo certo", () => {
  assert.strictEqual(promo({ atual: { ...ATUAL, custo: null } }).motivo, MOTIVOS.CUSTO_AUSENTE);
  assert.strictEqual(promo({ atual: { ...ATUAL, aliquota: null } }).motivo, MOTIVOS.ALIQUOTA_AUSENTE);
  assert.strictEqual(promo({ atual: { ...ATUAL, comissao: null } }).motivo, MOTIVOS.COMISSAO_ATUAL_AUSENTE);
  assert.strictEqual(promo({ atual: { ...ATUAL, frete: null } }).motivo, MOTIVOS.FRETE_ATUAL_AUSENTE);
  assert.strictEqual(promo({ atual: { ...ATUAL, preco: null } }).motivo, MOTIVOS.PRECO_ATUAL_AUSENTE);
  assert.strictEqual(promo({ atual: { sem_snapshot: true } }).motivo, MOTIVOS.SEM_SNAPSHOT_MARGEM);
  // alíquota em escala errada (15 em vez de 0,15) nunca é convertida
  const fora = promo({ atual: { ...ATUAL, aliquota: 15 } });
  assert.strictEqual(fora.veredito, VEREDITOS.BLOQUEADO);
  assert.strictEqual(fora.motivo, MOTIVOS.ALIQUOTA_FORA_DA_FAIXA);
  assert.strictEqual(fora.cenario.lc, null);
});

cenario("composição atual incompleta não impede de mostrar o cenário, e vice-versa", () => {
  const r = promo({ atual: { ...ATUAL, comissao: null } });
  assert.strictEqual(r.atual.lc, null);
  assert.ok(r.cenario.lc !== null);
  assert.strictEqual(r.delta_lc, null);
  assert.strictEqual(r.empate_volume, null);
});

cenario("preço do cenário inválido, retorno negativo e meta fora da faixa nunca viram número", () => {
  for (const preco of [0, -3, null, "x"]) {
    const r = promo({ cenario: { tipo: "preco", preco } });
    assert.strictEqual(r.veredito, VEREDITOS.BLOQUEADO);
    assert.strictEqual(r.motivo, MOTIVOS.PRECO_CENARIO_INVALIDO);
  }
  assert.strictEqual(promo({ cenario: { tipo: "promo", preco: 89.77, rebate: -1, status_promocao: "candidate" } }).motivo, MOTIVOS.REBATE_INVALIDO);
  for (const margem_alvo of [10, 1, 0, null, -0.1]) {
    assert.strictEqual(promo({ meta: { margem_alvo } }).motivo, MOTIVOS.META_INVALIDA, String(margem_alvo));
  }
  assert.strictEqual(promo({ meta: { margem_alvo: 0.1, margem_minima: 5 } }).motivo, MOTIVOS.MARGEM_MINIMA_INVALIDA);
});

cenario("margem mínima parametrizável: abaixo dela é nao_entrar mesmo com LC' positivo", () => {
  const r = promo({ meta: { margem_alvo: 0.1, margem_minima: 0.9 } });
  assert.ok(r.cenario.lc > 0);
  assert.strictEqual(r.veredito, VEREDITOS.NAO_ENTRAR);
  assert.strictEqual(r.motivo, "margem_abaixo_do_minimo");
});

cenario("taxa fixa da Base entra igual nos dois lados e fica declarada quando ausente", () => {
  const com = promo({ atual: { ...ATUAL, taxa_fixa: 2 } });
  const sem = promo({ atual: { ...ATUAL, taxa_fixa: 0 } });
  assert.strictEqual(com.atual.taxa_fixa, 2);
  assert.strictEqual(com.cenario.taxa_fixa, 2);
  assert.strictEqual(Math.round((sem.cenario.lc - com.cenario.lc) * 100) / 100, 2);
  const ausente = promo({ atual: { ...ATUAL, taxa_fixa: null } });
  assert.ok(ausente.assumido.includes("fixedFee"), "taxa fixa ausente vira zero DECLARADO em `assumido`");
});

cenario("insumos hipotéticos (simulação avançada): custo/alíquota do cenário mudam só o lado do cenário", () => {
  const r = calcularCenario({
    atual: ATUAL,
    cenario: { tipo: "insumos", preco: 94.9, custo: 25.35, rebate: 0 },
    cotacao: { comissao: 13.29, frete: 10 },
    meta: META,
  });
  assert.notStrictEqual(r.veredito, VEREDITOS.BLOQUEADO, "insumos com o mesmo preço não é 'preço igual'");
  assert.strictEqual(r.delta_lc, -4);
  assert.strictEqual(r.atual.custo, 21.35);
  assert.strictEqual(r.cenario.custo, 25.35);
  const aliq = calcularCenario({
    atual: ATUAL,
    cenario: { tipo: "insumos", preco: 94.9, aliquota: 15 },
    cotacao: { comissao: 13.29, frete: 10 },
    meta: META,
  });
  assert.strictEqual(aliq.motivo, MOTIVOS.ALIQUOTA_FORA_DA_FAIXA);
});

cenario("calcularComposicao: mesma conta, ausentes declarados, nunca zero silencioso", () => {
  const c = calcularComposicao({ preco: 94.9, custo: 21.35, aliquota: 0.06, taxa_fixa: 0, comissao: 13.29, frete: 10 });
  const esperado = computeMargin({ price: 94.9, cost: 21.35, taxRate: 0.06, fixedFee: 0, commission: 13.29, freight: 10 });
  assert.strictEqual(c.computavel, true);
  assert.strictEqual(c.lc, esperado.profit);
  assert.strictEqual(c.margem_ratio, esperado.margin);
  assert.strictEqual(c.estrito, true);
  const parcial = calcularComposicao({ preco: 94.9, custo: 21.35, aliquota: 0.06 });
  assert.deepStrictEqual(parcial.assumido.sort(), ["commission", "fixedFee", "freight"]);
  assert.strictEqual(parcial.estrito, false);
  const semCusto = calcularComposicao({ preco: 94.9, aliquota: 0.06 });
  assert.strictEqual(semCusto.computavel, false);
  assert.strictEqual(semCusto.lc, null);
  assert.strictEqual(semCusto.margem_ratio, null);
  assert.deepStrictEqual(semCusto.faltando, ["cost"]);
  // retorno ML entra uma vez, como no núcleo
  const comRebate = calcularComposicao({ preco: 89.77, custo: 21.35, aliquota: 0.06, taxa_fixa: 0, comissao: 12.57, frete: 10, rebate: 3.3 });
  assert.strictEqual(comRebate.lc, core.computeMargin({ price: 89.77, cost: 21.35, taxRate: 0.06, fixedFee: 0, commission: 12.57, freight: 10, rebate: 3.3 }).profit);
});

cenario("margens e alíquota saem sempre como fração 0–1 (nunca percentual)", () => {
  const r = promo();
  for (const lado of [r.atual, r.cenario]) {
    assert.ok(lado.margem_ratio > -1 && lado.margem_ratio < 1, `margem ${lado.margem_ratio}`);
  }
  assert.ok(r.meta.margem_alvo === 0.1);
  assert.ok(Math.abs(r.delta_margem_ratio) < 1);
});

(async () => {
  let falhas = 0;
  for (const { nome, fn } of casos) {
    try {
      await fn();
      console.log(`  ✓ ${nome}`);
    } catch (err) {
      falhas += 1;
      console.log(`  ✗ ${nome}\n    ${err.message}\n    ${(err.stack.split("\n").find((l) => l.includes(".test.js")) || "").trim()}`);
    }
  }
  if (falhas) {
    console.log(`marginScenario: ${falhas} de ${casos.length} cenários falharam`);
    process.exit(1);
  }
  console.log(`marginScenario: ok (${casos.length} cenários)`);
})();
