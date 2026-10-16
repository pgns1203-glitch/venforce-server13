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
    // Item sem promoção ativa: o preço atual (94,90) é o preço cheio.
    cenario: { tipo: "promo", preco: 89.77, rebate: 3.3, status_promocao: "candidate", preco_cheio: 94.9, preco_cheio_fonte: "margin_snapshot" },
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
  assert.strictEqual(r.preco_cheio, 94.9);
  assert.strictEqual(r.preco_cheio_fonte, "margin_snapshot");
  assert.strictEqual(r.desconto_total, 5.13);
  assert.strictEqual(r.delta_preco_atual, 5.13, "sem promoção ativa, cheio = atual: os dois descontos coincidem");
  assert.strictEqual(r.ml_banca, 3.3);
  assert.strictEqual(r.seller_banca, 1.83);
  assert.strictEqual(r.banca_motivo, null);
  assert.strictEqual(r.banca_aviso, null);
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

cenario("promoção que FORMA o preço de hoje (statusExibicao ATIVA): não bloqueia — cenário = hoje, Δ 0, veredito `ativa`", () => {
  const r = promo({ cenario: { tipo: "promo", preco: 89.77, rebate: 3.3, status_promocao: "started", status_exibicao: "ATIVA" } });
  assert.strictEqual(r.flags.ativa, true);
  assert.strictEqual(r.veredito, VEREDITOS.ATIVA);
  assert.strictEqual(r.motivo, null);
  assert.deepStrictEqual(r.motivos, []);
  assert.strictEqual(r.delta_lc, 0);
  assert.strictEqual(r.delta_preco_atual, 0);
  assert.strictEqual(r.cenario.preco, r.atual.preco, "cenário É a composição de hoje — mesmo preço");
  assert.strictEqual(r.cenario.lc, r.atual.lc);
  assert.strictEqual(promo().flags.ativa, false);
});

cenario("promoção inscrita mas que NÃO forma o preço (status bruto started/active, statusExibicao NÃO APLICADA/ausente): calcula normal, nunca bloqueia por 'já ativa'", () => {
  for (const status of ["started", "active", "ACTIVE"]) {
    const r = promo({ cenario: { tipo: "promo", preco: 89.77, rebate: 3.3, status_promocao: status } });
    assert.strictEqual(r.flags.ativa, false, status);
    assert.notStrictEqual(r.veredito, VEREDITOS.BLOQUEADO, status);
    assert.strictEqual(r.cenario.comissao, 12.57, status);
    assert.strictEqual(r.cenario.frete, 10, status);
    assert.ok(r.cenario.lc !== null, status);
  }
  assert.strictEqual(promo({ cenario: { tipo: "promo", preco: 89.77, rebate: 3.3, status_promocao: "pending" } }).flags.ativa, false);
});

cenario("subir o preço (cenário `preco`) é legítimo: não vira sem_desconto_efetivo", () => {
  const r = calcularCenario({
    atual: ATUAL,
    cenario: { tipo: "preco", preco: 99.9, preco_cheio: 94.9 },
    cotacao: { comissao: 13.99, frete: 10 },
    meta: META,
  });
  assert.strictEqual(r.flags.sem_desconto_efetivo, false);
  assert.ok(r.delta_lc > 0);
  assert.strictEqual(r.veredito, VEREDITOS.ENTRAR);
  assert.ok(r.empate_volume < 0);
  assert.strictEqual(r.desconto_total, -5);
  assert.strictEqual(r.delta_preco_atual, -5);
  // Subir acima do cheio não é "seller banca": o número sai COM o aviso, nunca sem explicação.
  assert.strictEqual(r.seller_banca, -5);
  assert.strictEqual(r.banca_aviso, "preco_acima_do_cheio");
});

// ─── Quem banca: sempre sobre o PREÇO CHEIO, nunca sobre o preço atual (já promocional) ───

// Caso real: preço atual 112,42 (já com uma promoção ativa), nova promoção a 110,25 com
// retorno ML de 6,62 e preço cheio 141,90. O desconto de verdade é 31,65 sobre o cheio.
const ATUAL_EM_PROMO = { preco: 112.42, custo: 40, aliquota: 0.06, taxa_fixa: 0, comissao: 15.74, frete: 18.9, rebate: 0 };
function promoSobreCheio(extra = {}) {
  return calcularCenario({
    atual: ATUAL_EM_PROMO,
    cenario: { tipo: "promo", preco: 110.25, rebate: 6.62, status_promocao: "candidate", preco_cheio: 141.9, preco_cheio_fonte: "margin_snapshot", ...extra },
    cotacao: { comissao: 15.44, frete: 18.9 },
    meta: META,
  });
}

cenario("quem banca: 112,42 atual · P' 110,25 · retorno 6,62 · cheio 141,90 → seller banca ≥ 0 e coerente com o desconto sobre o cheio", () => {
  const r = promoSobreCheio();
  assert.strictEqual(r.preco_cheio, 141.9);
  assert.strictEqual(r.desconto_total, 31.65);
  assert.strictEqual(r.ml_banca, 6.62);
  assert.strictEqual(r.seller_banca, 25.03);
  assert.ok(r.seller_banca >= 0);
  assert.strictEqual(r.desconto_total, Math.round((r.ml_banca + r.seller_banca) * 100) / 100, "desconto_total = ML banca + seller banca");
  assert.strictEqual(r.desconto_ratio, Math.round((31.65 / 141.9) * 1e6) / 1e6);
  assert.strictEqual(r.banca_aviso, null);
  assert.strictEqual(r.banca_motivo, null);
});

cenario("quem banca: a queda contra o preço ATUAL é um campo à parte (delta_preco_atual) e não entra na banca", () => {
  const r = promoSobreCheio();
  assert.strictEqual(r.delta_preco_atual, 2.17, "112,42 − 110,25");
  // Com a fórmula antiga (desconto = atual − P' = 2,17) o seller banca daria 2,17 − 6,62 = −4,45.
  assert.notStrictEqual(r.seller_banca, -4.45);
});

cenario("quem banca: preço cheio ausente → seller banca e desconto null + motivo sem_preco_cheio (nunca cai no preço atual)", () => {
  const r = promoSobreCheio({ preco_cheio: undefined, preco_cheio_fonte: undefined });
  assert.strictEqual(r.preco_cheio, null);
  assert.strictEqual(r.seller_banca, null);
  assert.strictEqual(r.desconto_total, null);
  assert.strictEqual(r.desconto_ratio, null);
  assert.strictEqual(r.banca_motivo, "sem_preco_cheio");
  assert.strictEqual(r.ml_banca, 6.62, "o retorno ML não depende do cheio");
  assert.strictEqual(r.delta_preco_atual, 2.17);
  assert.notStrictEqual(r.veredito, VEREDITOS.BLOQUEADO, "o LC não depende do preço cheio: o veredito segue");
  assert.ok(!r.motivos.includes("sem_preco_cheio"), "não é bloqueio");
});

cenario("quem banca: preço cheio 0 ou negativo é tratado como ausente", () => {
  for (const cheio of [0, -10, null, "abc"]) {
    const r = promoSobreCheio({ preco_cheio: cheio });
    assert.strictEqual(r.seller_banca, null, String(cheio));
    assert.strictEqual(r.banca_motivo, "sem_preco_cheio", String(cheio));
  }
});

cenario("quem banca: retorno ML maior que o desconto sobre o cheio sai COM aviso (negativo nunca é silencioso)", () => {
  const r = promoSobreCheio({ preco_cheio: 114, rebate: 6.62 });
  assert.strictEqual(r.desconto_total, 3.75);
  assert.strictEqual(r.seller_banca, -2.87);
  assert.strictEqual(r.banca_aviso, "retorno_maior_que_desconto");
});

cenario("quem banca: todo seller banca negativo carrega aviso; todo não negativo, não", () => {
  for (const cheio of [105, 110.25, 112.42, 120, 141.9, 200]) {
    for (const rebate of [0, 3, 6.62, 40]) {
      const r = promoSobreCheio({ preco_cheio: cheio, rebate });
      if (r.seller_banca !== null && r.seller_banca < 0) assert.ok(r.banca_aviso, `cheio ${cheio} · retorno ${rebate}: banca negativa sem aviso`);
      else assert.strictEqual(r.banca_aviso, null, `cheio ${cheio} · retorno ${rebate}`);
    }
  }
});

cenario("quem banca: bloqueado de verdade (cotação ausente) mantém a banca calculável e o motivo do bloqueio", () => {
  const r = calcularCenario({
    atual: ATUAL_EM_PROMO,
    cenario: { tipo: "promo", preco: 110.25, rebate: 6.62, status_promocao: "candidate", preco_cheio: 141.9 },
    cotacao: {},
    meta: META,
  });
  assert.strictEqual(r.veredito, VEREDITOS.BLOQUEADO);
  assert.strictEqual(r.seller_banca, 25.03, "a banca só depende de cheio, P' e retorno");
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

cenario("promoção sem preço sugerido pelo ML: promocao_sem_preco, nunca preço inventado", () => {
  const r = promo({ cenario: { tipo: "promo", preco: null, rebate: 0, status_promocao: "candidate" } });
  assert.strictEqual(r.veredito, VEREDITOS.BLOQUEADO);
  assert.strictEqual(r.motivo, MOTIVOS.PROMOCAO_SEM_PRECO);
  assert.strictEqual(r.cenario.lc, null);
});

cenario("limite de cotações por requisição: bloqueado com limite_de_cotacoes_excedido (não estima)", () => {
  const r = promo({ cotacao: { comissao: null, frete: null, limite_excedido: true } });
  assert.strictEqual(r.veredito, VEREDITOS.BLOQUEADO);
  assert.strictEqual(r.motivo, MOTIVOS.LIMITE_DE_COTACOES);
});

cenario("resultadoBloqueado: mesmo formato do cálculo, todo número null", () => {
  const r = core.resultadoBloqueado(MOTIVOS.SEM_SNAPSHOT_PROMOCOES);
  assert.strictEqual(r.veredito, VEREDITOS.BLOQUEADO);
  assert.strictEqual(r.motivo, "sem_snapshot_promocoes");
  assert.deepStrictEqual(r.motivos, ["sem_snapshot_promocoes"]);
  assert.strictEqual(r.cenario.lc, null);
  assert.strictEqual(r.delta_lc, null);
  assert.strictEqual(r.empate_volume, null);
  assert.strictEqual(r.flags.mudou_faixa_frete, null);
  assert.deepStrictEqual(Object.keys(r).sort(), Object.keys(promo()).sort());
});

cenario("calcularAtual: a mesma composição do bloco `atual` do cenário, com o retorno ML em andamento", () => {
  const a = core.calcularAtual({ atual: { ...ATUAL, preco: 89.77, comissao: 12.57, rebate: 3.3 } });
  const esperado = computeMargin({ price: 89.77, cost: 21.35, taxRate: 0.06, fixedFee: 0, commission: 12.57, freight: 10, rebate: 3.3 });
  assert.strictEqual(a.atual.lc, esperado.profit);
  assert.strictEqual(a.atual.margem_ratio, esperado.margin);
  assert.deepStrictEqual(a.bloqueios, []);
  const dentro = calcularCenario({
    atual: { ...ATUAL, preco: 89.77, comissao: 12.57, rebate: 3.3 },
    cenario: { tipo: "preco", preco: 84.9 }, cotacao: { comissao: 11.9, frete: 10 }, meta: META,
  });
  assert.deepStrictEqual(dentro.atual, a.atual);
  const sem = core.calcularAtual({ atual: { ...ATUAL, custo: null } });
  assert.deepStrictEqual(sem.bloqueios, [MOTIVOS.CUSTO_AUSENTE]);
  assert.strictEqual(sem.atual.lc, null);
});

cenario("calcularComposicao com base e meta: ΔLC, Δ margem e Δ meta em pp vêm do núcleo", () => {
  const base = { preco: 100, custo: 40, aliquota: 0.06, taxa_fixa: 0, comissao: 16.5, freight: undefined, frete: 23.4 };
  const alt = { ...base, frete: 18.7 };
  const r = calcularComposicao(alt, { base, meta_margem: 0.12 });
  // Frete menor melhora a MC: (23,40 − 18,70) / 100 = +4,7 pp; ΔLC = +4,70.
  assert.strictEqual(r.delta_lc, 4.7);
  assert.strictEqual(r.delta_margem_pp, 4.7);
  // margem' = 18,8% contra meta 12% → +6,8 pp
  assert.strictEqual(r.delta_meta_pp, 6.8);
  const semBase = calcularComposicao(alt);
  assert.strictEqual(semBase.delta_lc, null);
  assert.strictEqual(semBase.delta_margem_pp, null);
  assert.strictEqual(semBase.delta_meta_pp, null);
  // meta fora da faixa nunca vira número; base incompleta idem
  assert.strictEqual(calcularComposicao(alt, { base, meta_margem: 12 }).delta_meta_pp, null);
  assert.strictEqual(calcularComposicao(alt, { base: { preco: 100 } }).delta_lc, null);
  assert.strictEqual(calcularComposicao({ preco: 100 }, { base }).delta_lc, null);
});

// ─── Efeitos: "de onde saiu a diferença no lucro" (caso 55,19 → 48,21) ───────

cenario("efeitos: cada componente decompõe o ΔLC, ordenados pelo tamanho, soma = ΔLC exatamente", () => {
  const r = calcularCenario({
    atual: { preco: 55.19, custo: 22.42, aliquota: 0.11, taxa_fixa: 0, comissao: 5.63, frete: 8.15, rebate: 0 },
    cenario: { tipo: "preco", preco: 48.21 },
    cotacao: { comissao: 5.54, frete: 6.85 },
    meta: META,
  });
  assert.strictEqual(r.atual.lc, 12.92);
  assert.strictEqual(r.cenario.lc, 8.1);
  assert.strictEqual(r.delta_lc, -4.82);
  const soma = r.efeitos.reduce((s, e) => s + e.valor, 0);
  assert.strictEqual(Math.round(soma * 100) / 100, r.delta_lc, "a soma dos efeitos TEM que fechar o ΔLC");
  // Frete caiu 8,15 → 6,85: efeito +1,30 (ajuda o lucro) — o exemplo da tela.
  const frete = r.efeitos.find((e) => e.chave === "frete");
  assert.strictEqual(frete.valor, 1.3);
  // Ordenado pelo tamanho (maior efeito absoluto primeiro): preço é o maior.
  for (let i = 1; i < r.efeitos.length; i += 1) assert.ok(Math.abs(r.efeitos[i - 1].valor) >= Math.abs(r.efeitos[i].valor), "fora de ordem");
  assert.strictEqual(r.efeitos[0].chave, "preco");
  // Custo e retorno ML não mudaram: não entram como barra (nada pra mostrar).
  assert.ok(!r.efeitos.some((e) => e.chave === "custo" || e.chave === "rebate"));
});

cenario("efeitos: sem ΔLC (bloqueado ou faltando dado), não há barras", () => {
  const bloqueado = calcularCenario({
    atual: { preco: 94.9, custo: 21.35, aliquota: 0.06, taxa_fixa: 0, comissao: 13.29, frete: 10, rebate: 0 },
    cenario: { tipo: "preco", preco: 89.77 },
    cotacao: { comissao: null, frete: 10 },
    meta: META,
  });
  assert.deepStrictEqual(bloqueado.efeitos, []);
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
