// server/services/cliente360/cliente360PonteEngine.js
// Motor de atribuição do RESULTADO OPERACIONAL — PURO (sem I/O, sem SQL, sem ML).
//
// Recebe pedidos no contrato da Fechamento API (Central de Vendas) para dois
// períodos e decompõe a variação do RESULTADO OPERACIONAL em Preço–Volume–Mix +
// componentes de custo, de forma ADITIVA (resíduo ≤ R$ 0,01 por construção).
//
//   resultadoOperacional = faturamento − comissão − frete − custo do produto − imposto
//
// ADS NÃO PARTICIPA DESTE MOTOR. Investimento em Ads é uma despesa mensal da
// conta inteira, sem atribuição confiável por pedido/produto/campanha. Colocá-lo
// na ponte misturaria uma decisão de mídia com a operação e contaminaria a
// explicação de preço, volume, mix e custo. Ads aparece apenas no fechamento
// (bloco descritivo próprio), depois que o resultado operacional já foi explicado.
//
// A única linha "extra" admitida é `ajustes` — diferença de reconciliação entre o
// detalhe (itens) e o total oficial do fechamento — e SÓ quando o chamador
// identificou a origem dela (ver cliente360FechamentoAdapter). Sem origem
// conhecida, a divergência é exposta na confiança, nunca embutida na ponte.
//
// Também expõe a agregação por produto (perfil), que alimenta:
//   - lista de produtos responsáveis (contribuição individual que fecha com a ponte)
//   - motor de recuperação (cliente360RecuperacaoEngine)
//   - simulador what-if (cliente360SimuladorEngine)
//   - estimador de elasticidade (cliente360ElasticidadeEngine)

const EPS = 0.01; // tolerância de fechamento em reais

function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

// Pedidos que entram no resultado. Cancelados saem dos dois lados da ponte;
// com_problema e pendente entram (marcados na cobertura, não removidos).
function pedidoEntraNoResultado(pedido) {
  return pedido && pedido.status !== "cancelado";
}

// ── Agregação por produto (chave = MLB) ─────────────────────────────────────
// Rateia tarifa_venda e frete_seller do pedido para cada item por receitaProduto.
// custo_produto e imposto_interno já vêm por item. Devolve, por MLB:
//   q  (unidades), rec (receita), tarifa, frete, custo, imposto,
//   pu (preço médio), cvu (custo variável unitário), mcu (margem contrib. unit.)
function agregarProdutos(pedidos) {
  const acc = new Map();

  for (const pedido of pedidos || []) {
    if (!pedidoEntraNoResultado(pedido)) continue;

    const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
    const receitaPedido = itens.reduce((s, it) => s + num(it.receitaProduto), 0);
    const tarifaPedido = Math.abs(num(pedido.taxas));
    const fretePedido = Math.abs(num(pedido.frete));

    for (const item of itens) {
      const mlb = item.mlb || item.sku || "(sem-produto)";
      const q = num(item.quantidade);
      const rec = num(item.receitaProduto);
      // rateio proporcional à receita do item dentro do pedido
      const peso = receitaPedido > 0 ? rec / receitaPedido : (itens.length ? 1 / itens.length : 0);
      const tarifa = tarifaPedido * peso;
      const frete = fretePedido * peso;
      const custo = Math.abs(num(item.custoProduto));
      const imposto = Math.abs(num(item.impostoInterno));

      const cur = acc.get(mlb) || {
        mlb,
        titulo: item.titulo || mlb,
        q: 0, rec: 0, tarifa: 0, frete: 0, custo: 0, imposto: 0,
      };
      cur.q += q;
      cur.rec += rec;
      cur.tarifa += tarifa;
      cur.frete += frete;
      cur.custo += custo;
      cur.imposto += imposto;
      if (!cur.titulo || cur.titulo === mlb) cur.titulo = item.titulo || cur.titulo;
      acc.set(mlb, cur);
    }
  }

  // deriva unitários
  for (const p of acc.values()) {
    const q = p.q;
    p.cvTotal = p.tarifa + p.frete + p.custo + p.imposto;
    p.pu = q > 0 ? p.rec / q : 0;
    p.cvu = q > 0 ? p.cvTotal / q : 0;
    p.mcu = p.pu - p.cvu;              // margem de contribuição unitária
    p.mcTotal = p.rec - p.cvTotal;     // = q * mcu
  }

  return acc; // Map<mlb, perfil>
}

// Totais operacionais de um período. `ajustes` é o efeito líquido, já
// IDENTIFICADO, da reconciliação com o total oficial do fechamento (R$).
// Nenhuma referência a Ads aqui — Ads é aplicado depois, no fechamento.
function totaisDoPeriodo(mapProdutos, ajustes = 0) {
  let rec = 0, tarifa = 0, frete = 0, custo = 0, imposto = 0, q = 0;
  for (const p of mapProdutos.values()) {
    rec += p.rec; tarifa += p.tarifa; frete += p.frete;
    custo += p.custo; imposto += p.imposto; q += p.q;
  }
  const ajuste = num(ajustes);
  const resultadoDetalhe = rec - tarifa - frete - custo - imposto;
  const resultadoOperacional = resultadoDetalhe + ajuste;

  return {
    faturamento: round2(rec),
    unidades: q,
    comissao: round2(tarifa),
    frete: round2(frete),
    custo: round2(custo),
    imposto: round2(imposto),
    ajustes: round2(ajuste),
    resultadoOperacionalDetalhe: round2(resultadoDetalhe),
    resultadoOperacional: round2(resultadoOperacional),
    margemOperacional: rec > 0 ? resultadoOperacional / rec : null,
  };
}

// ── Decomposição PVM ────────────────────────────────────────────────────────
// Universos:
//   comparável = q0>0 e q1>0   → decomposição completa
//   entradas   = q0=0 e q1>0   → + Σ q1·mcu1
//   saídas     = q0>0 e q1=0   → − Σ q0·mcu0
//
// Aditividade (conjunto comparável):
//   Σq1·mcu1 − Σq0·mcu0 = [Σq1·mcu0 − Σq0·mcu0]           (volume + mix)
//                       + [Σq1·(mcu1 − mcu0)]             (preço + comissão + frete + custo + imposto)
function decompor(map0, map1, ajustes0 = 0, ajustes1 = 0) {
  const mlbs = new Set([...map0.keys(), ...map1.keys()]);

  const comparaveis = [];
  const entradas = [];
  const saidas = [];
  for (const mlb of mlbs) {
    const a = map0.get(mlb);
    const b = map1.get(mlb);
    const q0 = a ? a.q : 0;
    const q1 = b ? b.q : 0;
    if (q0 > 0 && q1 > 0) comparaveis.push({ mlb, a, b });
    else if (q0 === 0 && q1 > 0) entradas.push({ mlb, b });
    else if (q0 > 0 && q1 === 0) saidas.push({ mlb, a });
  }

  const Q0 = comparaveis.reduce((s, x) => s + x.a.q, 0);
  const Q1 = comparaveis.reduce((s, x) => s + x.b.q, 0);
  const mc0Total = comparaveis.reduce((s, x) => s + x.a.q * x.a.mcu, 0);
  const mcu0Bar = Q0 > 0 ? mc0Total / Q0 : 0;

  // Σq1·mcu0 (mesmo preço/custo do período 0, volumes do período 1)
  const sum_q1_mcu0 = comparaveis.reduce((s, x) => s + x.b.q * x.a.mcu, 0);

  const volume = (Q1 - Q0) * mcu0Bar;
  const mix = sum_q1_mcu0 - Q1 * mcu0Bar;

  // Efeitos unitários (preço e cada custo), ponderados pelo volume do período 1
  let preco = 0, comissao = 0, frete = 0, custo = 0, imposto = 0;
  for (const { a, b } of comparaveis) {
    const q1 = b.q;
    const pu0 = a.pu, pu1 = b.pu;
    const t0 = a.q > 0 ? a.tarifa / a.q : 0, t1 = b.q > 0 ? b.tarifa / b.q : 0;
    const f0 = a.q > 0 ? a.frete / a.q : 0, f1 = b.q > 0 ? b.frete / b.q : 0;
    const c0 = a.q > 0 ? a.custo / a.q : 0, c1 = b.q > 0 ? b.custo / b.q : 0;
    const i0 = a.q > 0 ? a.imposto / a.q : 0, i1 = b.q > 0 ? b.imposto / b.q : 0;
    preco += q1 * (pu1 - pu0);
    comissao += -q1 * (t1 - t0);
    frete += -q1 * (f1 - f0);
    custo += -q1 * (c1 - c0);
    imposto += -q1 * (i1 - i0);
  }

  const impEntradas = entradas.reduce((s, x) => s + x.b.q * x.b.mcu, 0);
  const impSaidas = -saidas.reduce((s, x) => s + x.a.q * x.a.mcu, 0);
  const impAjustes = num(ajustes1) - num(ajustes0);

  const linhas = [
    { chave: "volume", label: "Volume", impacto: volume },
    { chave: "mix", label: "Mix de produtos", impacto: mix },
    { chave: "preco", label: "Preço médio", impacto: preco },
    { chave: "comissao", label: "Comissão", impacto: comissao },
    { chave: "frete", label: "Frete", impacto: frete },
    { chave: "custo", label: "Custo do produto", impacto: custo },
    { chave: "imposto", label: "Imposto", impacto: imposto },
    { chave: "entradas", label: "Produtos novos", impacto: impEntradas },
    { chave: "saidas", label: "Produtos que pararam", impacto: impSaidas },
    { chave: "ajustes", label: "Ajustes de fechamento", impacto: impAjustes },
  ];

  return { linhas, comparaveis, entradas, saidas, Q0, Q1, mcu0Bar };
}

// Contribuição individual por produto — a soma sobre todos os produtos fecha com
// a variação do resultado operacional do DETALHE (sem a linha de ajustes, que não
// pertence a nenhum produto).
// comparável: contrib = q1·(mcu1−mcu0) + (q1 − q0)·mcu0
//   (o 1º termo agrega preço+comissão+frete+custo+imposto do produto; o 2º é
//    volume+mix do produto, e Σ(q1−q0)·mcu0 = agregado volume+mix — fecha exato)
// entrada:    contrib = q1·mcu1
// saída:      contrib = −q0·mcu0
function contribuicoesPorProduto(dec) {
  const { comparaveis, entradas, saidas } = dec;
  const out = [];

  for (const { mlb, a, b } of comparaveis) {
    const efeitoUnit = b.q * (b.mcu - a.mcu);
    const efeitoVolMix = (b.q - a.q) * a.mcu;
    const contrib = efeitoUnit + efeitoVolMix;

    // motivo dominante = maior componente em módulo dentro do produto.
    // Ads jamais entra aqui: não há atribuição de mídia por produto.
    const t0 = a.q > 0 ? a.tarifa / a.q : 0, t1 = b.q > 0 ? b.tarifa / b.q : 0;
    const f0 = a.q > 0 ? a.frete / a.q : 0, f1 = b.q > 0 ? b.frete / b.q : 0;
    const c0 = a.q > 0 ? a.custo / a.q : 0, c1 = b.q > 0 ? b.custo / b.q : 0;
    const i0 = a.q > 0 ? a.imposto / a.q : 0, i1 = b.q > 0 ? b.imposto / b.q : 0;
    const comps = {
      volume: (b.q - a.q) * a.mcu,
      preco: b.q * (b.pu - a.pu),
      comissao: -b.q * (t1 - t0),
      frete: -b.q * (f1 - f0),
      custo: -b.q * (c1 - c0),
      imposto: -b.q * (i1 - i0),
    };
    const motivoDominante = Object.entries(comps)
      .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0][0];

    out.push({
      mlb, titulo: b.titulo, tipo: "comparavel",
      contribuicao: round2(contrib),
      faturamento: round2(b.rec), resultado: round2(b.mcTotal),
      margem: b.rec > 0 ? b.mcTotal / b.rec : null,
      motivoDominante,
      unidadesAnterior: a.q, unidadesAtual: b.q,
      precoAnterior: round2(a.pu), precoAtual: round2(b.pu),
      componentes: {
        volume: round2(comps.volume),
        preco: round2(comps.preco),
        comissao: round2(comps.comissao),
        frete: round2(comps.frete),
        custo: round2(comps.custo),
        imposto: round2(comps.imposto),
      },
      // Unitários dos dois períodos — alimentam o detalhe expansível da ponte
      // ("custo era R$ 150, virou R$ 180, em 88 unidades").
      unitarios: {
        preco: { anterior: round2(a.pu), atual: round2(b.pu) },
        comissao: { anterior: round2(t0), atual: round2(t1) },
        frete: { anterior: round2(f0), atual: round2(f1) },
        custo: { anterior: round2(c0), atual: round2(c1) },
        imposto: { anterior: round2(i0), atual: round2(i1) },
        margem: { anterior: round2(a.mcu), atual: round2(b.mcu) },
      },
    });
  }
  for (const { mlb, b } of entradas) {
    out.push({
      mlb, titulo: b.titulo, tipo: "entrada",
      contribuicao: round2(b.q * b.mcu),
      faturamento: round2(b.rec), resultado: round2(b.mcTotal),
      margem: b.rec > 0 ? b.mcTotal / b.rec : null,
      motivoDominante: "produto_novo",
      unidadesAnterior: 0, unidadesAtual: b.q,
      precoAnterior: null, precoAtual: round2(b.pu),
      componentes: null,
    });
  }
  for (const { mlb, a } of saidas) {
    out.push({
      mlb, titulo: a.titulo, tipo: "saida",
      contribuicao: round2(-a.q * a.mcu),
      faturamento: 0, resultado: 0, margem: null,
      motivoDominante: "produto_saiu",
      unidadesAnterior: a.q, unidadesAtual: 0,
      precoAnterior: round2(a.pu), precoAtual: null,
      componentes: null,
    });
  }
  return out;
}

// ── Detalhe expansível de cada linha ────────────────────────────────────────
// Cada linha da ponte carrega o que a interface precisa para explicar o número
// sem o usuário abrir uma planilha: a frase em português, a fórmula e os
// produtos responsáveis com os unitários antes/depois.
//
// Nenhuma entrada aqui para Ads: a ponte não tem linha de mídia.
const EXPLICACAO_LINHA = {
  volume: {
    descricao: "O total de unidades vendidas mudou, mantida a margem unitária do período anterior.",
    formula: "(unidades atuais − unidades anteriores) × margem unitária média anterior",
  },
  mix: {
    descricao: "A proporção entre produtos mudou — vendeu-se mais dos itens de margem alta ou baixa.",
    formula: "Σ (unidades atuais × margem unitária anterior) − unidades atuais totais × margem unitária média anterior",
  },
  preco: {
    descricao: "O preço médio praticado mudou nos produtos comparáveis.",
    formula: "Σ unidades atuais × (preço atual − preço anterior)",
  },
  comissao: {
    descricao: "A comissão por unidade mudou (categoria, tipo de anúncio ou faixa de preço).",
    formula: "− Σ unidades atuais × (comissão unitária atual − comissão unitária anterior)",
  },
  frete: {
    descricao: "O frete por unidade mudou (mudança de logística, faixa de peso ou subsídio).",
    formula: "− Σ unidades atuais × (frete unitário atual − frete unitário anterior)",
  },
  custo: {
    descricao: "O custo unitário dos produtos comparáveis mudou.",
    formula: "− Σ unidades atuais × (custo unitário atual − custo unitário anterior)",
  },
  imposto: {
    descricao: "O imposto por unidade mudou.",
    formula: "− Σ unidades atuais × (imposto unitário atual − imposto unitário anterior)",
  },
  entradas: {
    descricao: "Produtos que não vendiam no período anterior e passaram a vender.",
    formula: "+ Σ unidades atuais × margem unitária atual (só produtos que entraram)",
  },
  saidas: {
    descricao: "Produtos que vendiam no período anterior e pararam.",
    formula: "− Σ unidades anteriores × margem unitária anterior (só produtos que saíram)",
  },
  ajustes: {
    descricao: "Diferença de reconciliação com origem identificada no fechamento (linhas financeiras sem produto).",
    formula: "ajuste identificado atual − ajuste identificado anterior",
  },
};

// Produtos responsáveis por uma linha, com o antes/depois do unitário daquele fator.
function produtosDaLinha(chave, contribs, limite = 6) {
  if (chave === "entradas") {
    return contribs
      .filter((p) => p.tipo === "entrada")
      .sort((a, b) => Math.abs(b.contribuicao) - Math.abs(a.contribuicao))
      .slice(0, limite)
      .map((p) => ({
        mlb: p.mlb, titulo: p.titulo, impacto: p.contribuicao,
        unidadesAnterior: 0, unidadesAtual: p.unidadesAtual, unitario: null,
      }));
  }
  if (chave === "saidas") {
    return contribs
      .filter((p) => p.tipo === "saida")
      .sort((a, b) => Math.abs(b.contribuicao) - Math.abs(a.contribuicao))
      .slice(0, limite)
      .map((p) => ({
        mlb: p.mlb, titulo: p.titulo, impacto: p.contribuicao,
        unidadesAnterior: p.unidadesAnterior, unidadesAtual: 0, unitario: null,
      }));
  }
  if (chave === "volume" || chave === "mix") {
    // volume e mix são efeitos agregados; mostra quem mais mudou de quantidade
    return contribs
      .filter((p) => p.tipo === "comparavel" && p.unidadesAtual !== p.unidadesAnterior)
      .sort((a, b) => Math.abs(b.componentes.volume) - Math.abs(a.componentes.volume))
      .slice(0, limite)
      .map((p) => ({
        mlb: p.mlb, titulo: p.titulo, impacto: p.componentes.volume,
        unidadesAnterior: p.unidadesAnterior, unidadesAtual: p.unidadesAtual, unitario: null,
      }));
  }

  return contribs
    .filter((p) => p.componentes && p.componentes[chave])
    .sort((a, b) => Math.abs(b.componentes[chave]) - Math.abs(a.componentes[chave]))
    .slice(0, limite)
    .map((p) => ({
      mlb: p.mlb,
      titulo: p.titulo,
      impacto: p.componentes[chave],
      unidadesAnterior: p.unidadesAnterior,
      unidadesAtual: p.unidadesAtual,
      unitario: p.unitarios?.[chave] || null,
    }));
}

function enriquecerLinha(linha, contribs) {
  const explicacao = EXPLICACAO_LINHA[linha.chave];
  if (!explicacao) return linha; // "outros" já carrega a própria composição
  return {
    ...linha,
    descricao: explicacao.descricao,
    formula: explicacao.formula,
    produtos: produtosDaLinha(linha.chave, contribs),
  };
}

// ── API pública ─────────────────────────────────────────────────────────────
// pedidos0/pedidos1 = arrays no contrato da Fechamento API (Central de Vendas).
// ajustes0/ajustes1 = ajustes de fechamento IDENTIFICADOS (R$) de cada período.
// materialidade = fração de |delta| abaixo da qual a linha vira "Outros".
function montarPonte(pedidos0, pedidos1, { ajustes0 = 0, ajustes1 = 0, materialidade = 0.02 } = {}) {
  const map0 = agregarProdutos(pedidos0);
  const map1 = agregarProdutos(pedidos1);

  const tot0 = totaisDoPeriodo(map0, ajustes0);
  const tot1 = totaisDoPeriodo(map1, ajustes1);

  const dec = decompor(map0, map1, ajustes0, ajustes1);
  const delta = tot1.resultadoOperacional - tot0.resultadoOperacional;

  const somaLinhas = dec.linhas.reduce((s, l) => s + l.impacto, 0);
  const residuo = delta - somaLinhas;

  // marca materialidade e agrupa não-materiais em "Outros" (composição explícita)
  const limiar = Math.abs(delta) * materialidade;
  const materiais = [];
  const composicaoOutros = [];
  let outros = 0;
  for (const l of dec.linhas) {
    if (Math.abs(l.impacto) >= limiar || limiar === 0) {
      materiais.push({ ...l, impacto: round2(l.impacto), material: true });
    } else {
      outros += l.impacto;
      if (Math.abs(l.impacto) > 0) {
        composicaoOutros.push({ chave: l.chave, label: l.label, impacto: round2(l.impacto) });
      }
    }
  }
  if (Math.abs(outros) > EPS) {
    // "Outros" NUNCA é caixa-preta: leva a composição exata das linhas agrupadas.
    materiais.push({
      chave: "outros",
      label: "Outros",
      impacto: round2(outros),
      material: false,
      descricao: "Fatores individualmente imateriais, agrupados. A composição exata está abaixo.",
      formula: composicaoOutros.map((c) => c.label).join(" + "),
      composicao: composicaoOutros,
      produtos: [],
    });
  }
  // ordena: positivas desc, depois negativas por módulo desc
  materiais.sort((a, b) => {
    if ((a.impacto >= 0) !== (b.impacto >= 0)) return a.impacto >= 0 ? -1 : 1;
    return Math.abs(b.impacto) - Math.abs(a.impacto);
  });

  const contribs = contribuicoesPorProduto(dec);
  const fecha = Math.abs(residuo) <= EPS;

  return {
    base: "resultadoOperacional",
    inicio: tot0.resultadoOperacional,
    fim: tot1.resultadoOperacional,
    delta: round2(delta),
    residuo: round2(residuo),
    fecha,
    // Quando não fecha, a divergência é declarada — nunca absorvida por um
    // ajuste artificial nem escondida dentro de "Outros".
    divergencia: fecha
      ? null
      : {
          valor: round2(residuo),
          fonte: "decomposicao_pvm",
          mensagem:
            "A soma dos fatores não reconstrói a variação do resultado operacional. Os números são exibidos como estão.",
        },
    linhas: materiais.map((l) => enriquecerLinha(l, contribs)),
    linhasBrutas: dec.linhas.map((l) => ({ ...l, impacto: round2(l.impacto) })),
    totais: { anterior: tot0, atual: tot1 },
    produtos: contribs,
    _perfis: { map0, map1 }, // consumido pelos motores de recuperação/simulador
  };
}

module.exports = {
  montarPonte,
  agregarProdutos,
  totaisDoPeriodo,
  decompor,
  contribuicoesPorProduto,
  produtosDaLinha,
  enriquecerLinha,
  pedidoEntraNoResultado,
  EXPLICACAO_LINHA,
  round2,
  num,
  EPS,
};
