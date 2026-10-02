// server/services/meliAnuncios/seo/tituloEngine.js
// -----------------------------------------------------------------------------
// Title Engine (SEO ML · F3) — sugestões de TÍTULO com score calculado pelo
// código.
//
// Fluxo (gerarTitulos):
//   ficha de fatos (montarFatos) → LLM gera candidatos (só texto) →
//   cada candidato é validado contra os fatos (avaliarTitulo) → inválidos são
//   DESCARTADOS → os válidos com espaço sobrando recebem, no fim, Termos
//   Complementares factuais até o mais perto possível do limite
//   (completarTitulo) → score determinístico → duplicados saem → ordena por
//   score e devolve até 6. O LLM nunca dá nota nem escolhe.
//
// Este módulo é puro em relação a infraestrutura: não lê banco, não chama o
// Mercado Livre, não lê env. O aiProvider entra como parâmetro (e é simulado
// nos testes). Conta, carteira e trava de título são do controller.
//
// Regra central: um título só é aceito se CADA palavra de conteúdo dele for
// sustentada por um fato do anúncio (categoria, marca, modelo, atributos
// estruturados) ou pelo título atual do próprio vendedor. Palavra sem
// evidência ("confortável", uma marca que não é a do produto) descarta o
// candidato — não vira só um desconto. Palavra que CONTRADIZ um atributo
// ("feminino" com Gênero = Meninos, "impermeável" com É impermeável = Não)
// também descarta, mesmo que esteja no título atual.
// -----------------------------------------------------------------------------

const seo = require("./seoText");
const fatosProduto = require("./fatosProduto");
const termosComplementaresEngine = require("./termosComplementaresEngine");
const { AI_TASKS } = require("../../ai/aiTasks");

const LIMITE_PADRAO = 60;
const CANDIDATOS_PEDIDOS = 8;
const MAX_SUGESTOES = 6;
const MIN_SUGESTOES = 4;

// Força da evidência de cada palavra (componente RELEVÂNCIA).
const FORCA_ESTRUTURADO = 1;   // categoria, marca, modelo, valor de atributo, gênero do atributo
const FORCA_FRACA = 0.6;       // título atual do vendedor, nome de atributo

// Regras factuais compartilhadas com os Termos Complementares (F4R): atributos
// ignorados, atributos estruturais, marca genérica, booleano Sim/Não e a
// tabela de GÊNERO. Ver fatosProduto.js.
const {
  ATRIBUTOS_ESTRUTURAIS,
  PALAVRAS_DE_NOME_GENERICAS,
  texto,
  lerAtributos,
  atributoIgnorado,
  marcaGenerica,
  valorBooleano,
  regrasGenero,
} = fatosProduto;

// Conectivo permitido mesmo sem evidência ("Tênis com Cadarço").
const NEUTROS = new Set(["com"]);

// Linguagem promocional: se não estiver no título atual, já é descartada como
// "não comprovada"; se estiver (o vendedor usou), custa pontos de clareza.
const PROMOCIONAIS = new Set([
  "imperdivel", "melhor", "premium", "promocao", "oferta", "barato", "top", "incrivel",
  "perfeito", "exclusivo", "liquidacao", "desconto", "gratis", "frete", "lancamento", "sucesso",
]);

// Caracteres aceitos num título. Fora disso (★, |, !, emoji) é estrutura
// inválida — o ML também desaconselha pontuação decorativa.
const CARACTERES_VALIDOS = /^[\p{L}\p{N}\s\-.,/+&()'%°ºª"]+$/u;

// Palavras de conteúdo de um texto, com a forma original (para o prompt).
function palavras(textoFonte) {
  return seo.extractTokens(textoFonte).filter((t) => !t.stopword);
}

// -----------------------------------------------------------------------------
// montarFatos — a ficha do que é VERDADE sobre o anúncio.
//
//   {
//     limite,
//     tituloAtual, categoria, marca, modelo,
//     atributos:  [{ id, nome, valor }]          (para o prompt)
//     conceitos:  [{ tipo, termo, peso, familia? }]
//                 tipo: categoria | marca | modelo | atributo
//                 peso: 3 muito alta · 2 alta · 1 média
//     vocabulario: Map(chave → força)            palavras sustentadas
//     proibidos:   Set(chave)                     palavras que contradizem atributo
//     proibidosExibicao: [string]                 as mesmas, para o prompt
//   }
//
// opts: { categoriaNome, limite }
// -----------------------------------------------------------------------------
function montarFatos(anuncio, opts = {}) {
  const a = anuncio || {};
  const limite = Number.isInteger(opts.limite) && opts.limite > 0 ? opts.limite : LIMITE_PADRAO;
  const attrs = lerAtributos(a);
  const porId = new Map(attrs.map((x) => [x.id, x]));

  const vocabulario = new Map();
  const estruturadas = new Set();
  const conceitos = [];
  const chavesConceito = new Set();
  const proibidosBrutos = new Map(); // chave → forma original

  function sustentar(textoFonte, forca) {
    for (const t of palavras(textoFonte)) {
      if ((vocabulario.get(t.key) || 0) < forca) vocabulario.set(t.key, forca);
      if (forca === FORCA_ESTRUTURADO) estruturadas.add(t.key);
    }
  }
  function conceito(tipo, termo, peso, extra = {}) {
    const chave = seo.contentKeys(termo).join(" ");
    if (!chave || chavesConceito.has(chave)) return;
    chavesConceito.add(chave);
    conceitos.push({ tipo, termo, peso, ...extra });
  }

  // Categoria (o "tipo de produto" mais confiável que temos sem chamada extra).
  const categoria = texto(opts.categoriaNome);
  const categoriaUtil = categoria && !marcaGenerica(categoria);
  if (categoriaUtil) {
    sustentar(categoria, FORCA_ESTRUTURADO);
    conceito("categoria", categoria, 3);
  }

  // Marca — só quando é uma marca de verdade.
  const marca = texto((porId.get("BRAND") || {}).value || a.marca);
  const marcaUtil = marca && !marcaGenerica(marca);
  if (marcaUtil) {
    sustentar(marca, FORCA_ESTRUTURADO);
    conceito("marca", marca, 3);
  }

  // Modelo — só quando parece um modelo (até 4 palavras). MODEL com uma
  // lista de palavras-chave (o otimizador legado escrevia isso nele) não é
  // fato: não sustenta claim nenhum.
  const modelo = texto((porId.get("MODEL") || {}).value || a.modelo);
  const nModelo = seo.contentKeys(modelo).length;
  const modeloUtil = modelo && nModelo >= 1 && nModelo <= 4;
  if (modeloUtil) {
    sustentar(modelo, FORCA_ESTRUTURADO);
    conceito("modelo", modelo, 2);
  }

  // Atributos estruturados.
  const atributos = [];
  for (const at of attrs) {
    const id = String(at.id || "");
    const valor = texto(at.value != null ? at.value : at.value_name);
    if (!valor || id === "BRAND" || id === "MODEL" || atributoIgnorado(id)) continue;
    const nome = texto(at.name) || id;
    atributos.push({ id, nome, valor });

    const bool = valorBooleano(valor);
    const palavrasNome = palavras(nome).filter((t) => !PALAVRAS_DE_NOME_GENERICAS.has(t.key));
    if (bool === true) {
      // "Com bolsos: Sim" — a característica é o próprio nome.
      for (const t of palavrasNome) {
        vocabulario.set(t.key, FORCA_ESTRUTURADO);
        estruturadas.add(t.key);
      }
      if (palavrasNome.length) conceito("atributo", palavrasNome.map((t) => t.original).join(" "), 1);
      continue;
    }
    if (bool === false) {
      // "É impermeável: Não" — dizer "impermeável" no título é falso.
      for (const t of palavrasNome) proibidosBrutos.set(t.key, t.original);
      continue;
    }

    sustentar(valor, FORCA_ESTRUTURADO);
    // O nome do atributo sustenta a palavra da dimensão ("Sola", "Cor"), mas
    // é evidência mais fraca que o valor.
    for (const t of palavrasNome) {
      if (!vocabulario.has(t.key)) vocabulario.set(t.key, FORCA_FRACA);
    }

    if (id === "GENDER") {
      // "Meninos e Meninas": une o que cada valor sustenta; só é proibido o
      // que NENHUM deles sustenta (ali, homem/mulher).
      const genero = regrasGenero(valor);
      if (genero) {
        for (const k of genero.sustentadas) {
          vocabulario.set(k, FORCA_ESTRUTURADO);
          estruturadas.add(k);
        }
        for (const k of genero.proibidas) proibidosBrutos.set(k, k);
        conceito("atributo", valor, 2, { familia: Array.from(genero.sustentadas) });
        continue;
      }
    }
    conceito("atributo", valor, ATRIBUTOS_ESTRUTURAIS.has(id) ? 2 : 1);
  }

  // Um proibido que também é fato estruturado (dado contraditório na ficha)
  // não é proibido: na dúvida, vale o fato.
  const proibidos = new Set();
  const proibidosExibicao = [];
  for (const [k, original] of proibidosBrutos) {
    if (estruturadas.has(k)) continue;
    proibidos.add(k);
    proibidosExibicao.push(original);
  }

  // Título atual: evidência fraca e nunca de algo que contradiga um atributo.
  const tituloAtual = texto(a.titulo);
  for (const t of palavras(tituloAtual)) {
    if (proibidos.has(t.key) || vocabulario.has(t.key)) continue;
    vocabulario.set(t.key, FORCA_FRACA);
  }

  return {
    limite,
    tituloAtual,
    categoria: categoriaUtil ? categoria : null,
    marca: marcaUtil ? marca : null,
    modelo: modeloUtil ? modelo : null,
    atributos,
    conceitos,
    vocabulario,
    proibidos,
    proibidosExibicao,
    // Para o complemento pós-geração (Termos Complementares/F4R), que lê os
    // mesmos atributos do anúncio.
    fonte: { anuncio: a, categoriaNome: categoriaUtil ? categoria : null },
  };
}

// -----------------------------------------------------------------------------
// Componentes do score
// -----------------------------------------------------------------------------

// EFICIÊNCIA (15) — pelo que FALTA até o limite, não pela proporção: o ML
// indexa cada palavra do título, então espaço sobrando é indexação perdida.
// Com limite 60: 57–60 = alvo (15) · 55–56 = bom (12) · 50–54 = curto (5) ·
// abaixo de 50 = 0 (penalidade forte). Acima do limite o candidato nem chega
// aqui (é descartado).
function pontuarEficiencia(chars, limite) {
  if (!limite || chars > limite) return 0;
  const falta = limite - chars;
  if (falta <= 3) return 15;
  if (falta <= 5) return 12;
  if (falta <= 10) return 5;
  return 0;
}

function coberturaConceito(c, chavesTitulo) {
  if (c.familia) return c.familia.some((k) => chavesTitulo.has(k)) ? 1 : 0;
  return seo.termCoverage(c.termo, chavesTitulo).coverage;
}

// COBERTURA (35) — quanto dos fatos importantes (peso ≥ 2) o título
// representa, ponderado pelo peso. Sem nenhum fato, 0: não há o que medir.
function pontuarCobertura(fatos, chavesTitulo) {
  let alvo = fatos.conceitos.filter((c) => c.peso >= 2);
  if (!alvo.length) alvo = fatos.conceitos;
  if (!alvo.length) return 0;
  let soma = 0;
  let pesos = 0;
  for (const c of alvo) {
    soma += c.peso * coberturaConceito(c, chavesTitulo);
    pesos += c.peso;
  }
  return Math.round(35 * (soma / pesos));
}

// RELEVÂNCIA (25) — média da força da evidência das palavras usadas.
function pontuarRelevancia(fatos, chavesConteudo) {
  const usadas = chavesConteudo.filter((k) => !NEUTROS.has(k));
  if (!usadas.length) return 0;
  const soma = usadas.reduce((acc, k) => acc + (fatos.vocabulario.get(k) || 0), 0);
  return Math.round(25 * (soma / usadas.length));
}

// ESPECIFICIDADE (10) — fatos concretos (marca, modelo, atributos) cobertos
// por inteiro, contra até 3 disponíveis. Sem fato específico na ficha, 5
// (neutro — igual para todos os candidatos do anúncio).
function pontuarEspecificidade(fatos, chavesTitulo) {
  const especificos = fatos.conceitos.filter((c) => c.tipo !== "categoria");
  if (!especificos.length) return 5;
  const cobertos = especificos.filter((c) => coberturaConceito(c, chavesTitulo) === 1).length;
  const alvo = Math.min(3, especificos.length);
  return Math.round(10 * Math.min(1, cobertos / alvo));
}

// CLAREZA (10) — heurísticas estruturais simples, sem gramática nem LLM.
function pontuarClareza(titulo, fatos, tokens) {
  let pontos = 10;
  const promocionais = tokens.filter((t) => !t.stopword && PROMOCIONAIS.has(t.key)).length;
  pontos -= Math.min(6, 3 * promocionais);

  const separadores = (titulo.match(/[-/,+&]/g) || []).length;
  if (separadores > 2) pontos -= 2;

  const conectivo = (t) => t && (t.stopword || NEUTROS.has(t.key) || t.key === "sem");
  if (conectivo(tokens[0])) pontos -= 2;
  if (tokens.length > 1 && conectivo(tokens[tokens.length - 1])) pontos -= 3;

  const marcaModelo = (fatos.marca || "") + " " + (fatos.modelo || "");
  const gritado = titulo.split(/\s+/).some((w) =>
    /\p{L}{4,}/u.test(w) && w === w.toUpperCase() && w !== w.toLowerCase() && !marcaModelo.includes(w)
  );
  if (gritado) pontos -= 2;

  return Math.max(0, pontos);
}

// REDUNDÂNCIA (5) — palavra repetida, inclusive via plural/gênero/acento
// (seoText). Duas palavras distintas repetidas, ou uma 3 vezes, já é
// repetição artificial e o candidato é descartado antes daqui.
function pontuarRedundancia(repetidas) {
  return Math.max(0, 5 - 3 * repetidas);
}

function contarChaves(chaves) {
  const contagem = new Map();
  for (const k of chaves) contagem.set(k, (contagem.get(k) || 0) + 1);
  return contagem;
}

// -----------------------------------------------------------------------------
// avaliarTitulo — valida e, se válido, pontua.
//   inválido → { valido:false, titulo, motivo, termos? }
//     motivo: VAZIO | EXCEDE_LIMITE | ESTRUTURA_INVALIDA | CONFLITO_ATRIBUTO
//             | NAO_COMPROVADO | REPETICAO
//   válido   → { valido:true, titulo, chars, score, breakdown }
// -----------------------------------------------------------------------------
function avaliarTitulo(tituloBruto, fatos) {
  const titulo = texto(tituloBruto).replace(/\s+/g, " ");
  if (!titulo) return { valido: false, titulo, motivo: "VAZIO" };
  if (titulo.length > fatos.limite) return { valido: false, titulo, motivo: "EXCEDE_LIMITE" };
  if (!CARACTERES_VALIDOS.test(titulo)) return { valido: false, titulo, motivo: "ESTRUTURA_INVALIDA" };

  const tokens = seo.extractTokens(titulo);
  const conteudo = tokens.filter((t) => !t.stopword);
  if (conteudo.length < 2) return { valido: false, titulo, motivo: "ESTRUTURA_INVALIDA" };

  const conflitos = conteudo.filter((t) => fatos.proibidos.has(t.key)).map((t) => t.key);
  if (conflitos.length) return { valido: false, titulo, motivo: "CONFLITO_ATRIBUTO", termos: conflitos };

  const semEvidencia = conteudo
    .filter((t) => !NEUTROS.has(t.key) && !fatos.vocabulario.has(t.key))
    .map((t) => t.key);
  if (semEvidencia.length) return { valido: false, titulo, motivo: "NAO_COMPROVADO", termos: semEvidencia };

  const chavesConteudo = conteudo.map((t) => t.key);
  const contagem = contarChaves(chavesConteudo);
  const repetidas = Array.from(contagem.values()).filter((n) => n > 1);
  if (repetidas.length >= 2 || repetidas.some((n) => n >= 3)) {
    return { valido: false, titulo, motivo: "REPETICAO" };
  }

  const chavesTitulo = new Set(chavesConteudo);
  const breakdown = {
    cobertura: pontuarCobertura(fatos, chavesTitulo),
    relevancia: pontuarRelevancia(fatos, chavesConteudo),
    eficiencia: pontuarEficiencia(titulo.length, fatos.limite),
    especificidade: pontuarEspecificidade(fatos, chavesTitulo),
    clareza: pontuarClareza(titulo, fatos, tokens),
    redundancia: pontuarRedundancia(repetidas.length),
  };
  const score = breakdown.cobertura + breakdown.relevancia + breakdown.eficiencia +
    breakdown.especificidade + breakdown.clareza + breakdown.redundancia;
  return { valido: true, titulo, chars: titulo.length, score, breakdown };
}

// Duas sugestões com as mesmas palavras de conteúdo (só reordenadas, ou com
// outro acento/caixa/plural) são a mesma sugestão.
function assinatura(titulo) {
  return Array.from(new Set(seo.contentKeys(titulo))).sort().join(" ");
}

// -----------------------------------------------------------------------------
// Prompt — o LLM recebe os fatos e só pode REESCREVER com eles. Nada de nota.
// -----------------------------------------------------------------------------
const SYSTEM = [
  "Você escreve títulos de anúncios do Mercado Livre Brasil.",
  "Usa somente fatos fornecidos sobre o produto. Não inventa características, marcas, medidas, materiais, usos ou benefícios.",
  "Responda SOMENTE com JSON válido, sem markdown e sem texto fora do JSON.",
].join("\n");

function montarPrompt(fatos) {
  const linhas = [
    "Tarefa: escrever " + CANDIDATOS_PEDIDOS + " títulos diferentes para este anúncio.",
    "",
    "Fatos comprovados do produto:",
  ];
  if (fatos.categoria) linhas.push("- Categoria: " + fatos.categoria);
  if (fatos.marca) linhas.push("- Marca: " + fatos.marca);
  if (fatos.modelo) linhas.push("- Modelo: " + fatos.modelo);
  for (const at of fatos.atributos) {
    const bool = valorBooleano(at.valor);
    if (bool === false) continue;
    linhas.push("- " + at.nome + ": " + at.valor);
  }
  linhas.push("- Título atual do vendedor: " + (fatos.tituloAtual || "(sem título)"));
  if (fatos.proibidosExibicao.length) {
    linhas.push("", "NÃO é verdade sobre este produto (nunca use): " + fatos.proibidosExibicao.join(", ") + ".");
  }
  linhas.push(
    "",
    "Regras:",
    "- Tamanho: procure ficar entre " + Math.max(1, fatos.limite - 5) + " e " + fatos.limite + " caracteres (o ideal é " +
      Math.max(1, fatos.limite - 3) + " a " + fatos.limite + "). Nunca ultrapasse " + fatos.limite + ".",
    "- Aproveite o espaço só com fatos da lista acima; nunca palavras sem fato. Se os fatos acabarem, pare: " +
      "um título mais curto e verdadeiro é melhor que um longo com material, medida ou característica que não está na lista.",
    "- Use apenas palavras que aparecem nos fatos acima ou no título atual. Pode flexionar singular/plural e masculino/feminino.",
    "- Conectivos permitidos: de, da, do, para, com, e, em.",
    "- Comece pelo que o produto é. Leitura natural, sem lista solta de palavras.",
    "- Não repita palavras. Não use palavras promocionais (imperdível, melhor, premium, oferta, promoção, top).",
    "- Sem emojis, sem símbolos decorativos (|, ★, !), sem CAIXA ALTA.",
    "- Os " + CANDIDATOS_PEDIDOS + " títulos precisam ser realmente diferentes entre si.",
    "",
    "Responda SOMENTE com este JSON:",
    '{ "titulos": ["...", "..."] }'
  );
  return linhas.join("\n");
}

// -----------------------------------------------------------------------------
// Complemento pós-geração — determinístico. O LLM conta caracteres mal; aqui o
// título válido que ainda tem espaço recebe, no fim, os melhores Termos
// Complementares (F4R): fatos estruturados do anúncio que ele ainda não cobre.
// Entre as combinações que cabem, vence a de maior score (relevância e
// cobertura antes do espaço) — chega o mais perto possível do limite sem
// trocar relevância por tamanho. Cada combinação passa de novo por
// avaliarTitulo; nada fora dos fatos entra.
// -----------------------------------------------------------------------------
const CONECTIVOS_MINUSCULOS = new Set(["de", "da", "do", "das", "dos", "para", "com", "e", "em"]);

// Medida solta no fim do título ("63 Cm", "640 G", "7 Cm") é fato, mas não diz
// de quê — não ajuda a busca e confunde quem lê. Só entra sozinha a medida que
// se explica pelo próprio número/unidade e é buscada assim: tensão, potência,
// capacidade, volume, memória/armazenamento, tamanho de tela.
const MEDIDA_PURA = /^\d+([.,]\d+)?\s?[a-zA-Zµ°%"]{1,4}(\s?\/\s?\d+([.,]\d+)?\s?[a-zA-Zµ°%"]{1,4})*$/;
const MEDIDA_QUE_SE_EXPLICA = /VOLTAGE|POWER|WATTAGE|CAPACITY|VOLUME|STORAGE|RAM|MEMORY|SCREEN_SIZE|DISPLAY_SIZE/;

// Só atributos que DEFINEM o produto entram no fim do título. Atributo
// acessório também é fato, mas solto no fim vira ruído: "Sem Validade"
// (PRODUCT_FEATURES), "Livre" (HAZMAT_TRANSPORTABILITY), "plástico" do
// LID_MATERIAL (é a tampa), valor-lixo de GIFTABLE. O nome da categoria
// também fica de fora ("Manuais" como categoria de cortina): o tipo do
// produto já é o começo do título.
const ATRIBUTOS_DO_COMPLEMENTO = new Set([
  ...ATRIBUTOS_ESTRUTURAIS,
  "COLOR", "MAIN_COLOR", "SIZE", "MATERIALS",
  "VOLUME_CAPACITY", "NET_VOLUME", "STORAGE_CAPACITY", "RAM_MEMORY", "SCREEN_SIZE", "DISPLAY_SIZE", "WATTAGE",
]);

function termoServeNoTitulo(t) {
  if (t.fonte === "marca") return true;
  if (t.fonte !== "atributo" || !ATRIBUTOS_DO_COMPLEMENTO.has(t.attributeId)) return false;
  if (!MEDIDA_PURA.test(texto(t.termo))) return true;
  return MEDIDA_QUE_SE_EXPLICA.test(t.attributeId);
}

// "240 GB" já está em "ssd 240gb": a cobertura por palavra não vê (240gb é
// uma palavra só), a forma compacta vê.
const compacto = (s) => s.toLocaleLowerCase("pt-BR").replace(/[\s.,]/g, "");
function jaNoTitulo(termo, titulo) {
  return /\d/.test(termo) && compacto(titulo).includes(compacto(termo));
}

// Palavra que é sigla/código/nome próprio na grafia original (JSN, GG,
// TP-Link, 110V) mantém a caixa em qualquer estilo.
function caixaPropria(w) {
  return w !== w.toLocaleLowerCase("pt-BR") && w.slice(1) !== w.slice(1).toLocaleLowerCase("pt-BR");
}

// O título base está em estilo de título ("Lixeira Plástica Quadrada") ou
// em frase ("Adaptador de rede usb para rj45")? Decide pela maioria das
// palavras de conteúdo depois da primeira.
function estiloDeTitulo(titulo) {
  const ws = titulo.split(" ").slice(1).filter((w) => /^\p{L}/u.test(w) && !CONECTIVOS_MINUSCULOS.has(w.toLowerCase()));
  if (!ws.length) return true;
  const maiusculas = ws.filter((w) => w.charAt(0) !== w.charAt(0).toLocaleLowerCase("pt-BR")).length;
  return maiusculas * 2 >= ws.length;
}

// Forma de exibição do termo: a grafia original do fato (os Termos
// Complementares devolvem minúsculas: "110v" volta a ser "110V") e o estilo
// do título que ele completa — inicial maiúscula num título em estilo de
// título, minúscula num título em frase. Marca e siglas mantêm a grafia.
function formaDeTitulo(termo, fontes, opts = {}) {
  const alvo = termo.toLocaleLowerCase("pt-BR");
  let original = termo;
  for (const f of fontes) {
    const i = f.toLocaleLowerCase("pt-BR").indexOf(alvo);
    if (i >= 0) { original = f.slice(i, i + termo.length); break; }
  }
  if (opts.marca) return original;
  const titulo = opts.estiloTitulo !== false;
  return original.split(" ").map((w, i) => {
    if (!w || caixaPropria(w)) return w;
    if (/\d/.test(w)) return w;
    if (!titulo || (i > 0 && CONECTIVOS_MINUSCULOS.has(w.toLowerCase()))) return w.toLocaleLowerCase("pt-BR");
    return w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1).toLocaleLowerCase("pt-BR");
  }).join(" ");
}

function fontesDeGrafia(fatos) {
  const a = (fatos.fonte && fatos.fonte.anuncio) || {};
  const out = [];
  if (fatos.marca) out.push(fatos.marca);
  if (fatos.categoria) out.push(fatos.categoria);
  for (const at of lerAtributos(a)) {
    const v = texto(at.value != null ? at.value : at.value_name);
    if (v) out.push(v);
    if (at.name) out.push(texto(at.name));
  }
  return out;
}

//   → { avaliado, termos:[string] }  (termos vazio = nada coube / nada a somar)
function completarTitulo(avaliado, fatos) {
  const sem = { avaliado, termos: [] };
  if (!fatos.fonte || !fatos.fonte.anuncio) return sem;
  if (fatos.limite - avaliado.chars < 2) return sem;

  const analise = termosComplementaresEngine.gerarTermosComplementares({
    anuncio: fatos.fonte.anuncio,
    tituloReferencia: avaliado.titulo,
    categoriaNome: fatos.fonte.categoriaNome,
  });
  if (!analise.ok || !analise.termos.length) return sem;

  // Todas as combinações dos termos (≤ MAX_TERMOS = 8 → ≤ 256), na ordem de
  // TERM_SCORE. Vence a de maior score do título; empate: relevância,
  // cobertura e só então o espaço aproveitado. Guloso termo a termo parava
  // cedo ("Casual" ocupava o espaço onde "Molekinho" levaria a 55).
  const fontes = fontesDeGrafia(fatos);
  const estiloTitulo = estiloDeTitulo(avaliado.titulo);
  const formas = analise.termos
    .filter((t) => termoServeNoTitulo(t) && !jaNoTitulo(t.termo, avaliado.titulo))
    .map((t) => formaDeTitulo(t.termo, fontes, { estiloTitulo, marca: t.fonte === "marca" }));
  if (!formas.length) return sem;
  let melhor = avaliado;
  let melhorTermos = [];
  for (let mask = 1; mask < (1 << formas.length); mask++) {
    const escolhidos = formas.filter((_, i) => mask & (1 << i));
    const tentativa = avaliado.titulo + " " + escolhidos.join(" ");
    if (tentativa.length > fatos.limite) continue;
    const r = avaliarTitulo(tentativa, fatos);
    if (!r.valido || compararAvaliados(r, melhor) >= 0) continue;
    melhor = r;
    melhorTermos = escolhidos;
  }
  if (!melhorTermos.length) return sem;
  return { avaliado: melhor, termos: melhorTermos };
}

// < 0 quando `a` vem antes de `b`: score, relevância, cobertura e então o
// aproveitamento do espaço (mais longo). Mesmo critério da lista final.
function compararAvaliados(a, b) {
  return b.score - a.score ||
    b.breakdown.relevancia - a.breakdown.relevancia ||
    b.breakdown.cobertura - a.breakdown.cobertura ||
    b.chars - a.chars;
}

// Recorte — o LLM, pedido a chegar perto do limite, passa dele com frequência
// (smoke F12: 134 de 400 candidatos). Em vez de descartar, tira palavras do FIM
// (o prompt pede o que o produto é primeiro) até caber, e não deixa conectivo
// ou separador solto no fim. Só remove — nunca acrescenta nem troca palavra.
// O resultado passa por avaliarTitulo como qualquer candidato.
// Também o número que ficou órfão da unidade cortada ("poliéster 1" de
// "poliéster 1,6 m"; "2 x" de "2 x 3 m").
const SOLTOS_NO_FIM = /\s+(?:de|da|do|das|dos|para|com|e|em|x|[-/,+&]|\d+(?:[.,]\d+)?)$/i;
function recortarAoLimite(titulo, limite) {
  let t = texto(titulo).replace(/\s+/g, " ");
  if (t.length <= limite) return t;
  while (t.length > limite && t.includes(" ")) t = t.slice(0, t.lastIndexOf(" "));
  let antes;
  do { antes = t; t = t.replace(SOLTOS_NO_FIM, ""); } while (t !== antes);
  return t.length <= limite ? t : null;
}

function textoDoCandidato(c) {
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && typeof c.titulo === "string") return c.titulo;
  return null;
}

// -----------------------------------------------------------------------------
// gerarTitulos — uma chamada ao LLM, validação, score, dedupe, ordenação.
//
// Retorno (nunca lança):
//   { ok:true, limite, sugestoes:[{ titulo, chars, score, breakdown }],
//     recebidos, descartadas, motivosDescarte:{ MOTIVO: n }, aviso? }
//   { ok:false, codigo, motivo, recebidos?, descartadas?, motivosDescarte? }
// -----------------------------------------------------------------------------
async function gerarTitulos({ fatos, aiProvider }) {
  let ia;
  try {
    ia = await aiProvider.gerarJSON({
      task: AI_TASKS.SEO_TITLE,
      system: SYSTEM,
      prompt: montarPrompt(fatos),
      maxTokens: 1200,
      temperature: 0.7,
    });
  } catch (err) {
    return { ok: false, codigo: "IA_ERRO", motivo: "Falha ao consultar a IA." };
  }
  if (!ia || !ia.ok) {
    return {
      ok: false,
      codigo: (ia && ia.codigo) || "IA_ERRO",
      motivo: (ia && ia.erro) || "Falha ao gerar títulos com a IA.",
    };
  }
  const brutos = ia.data && Array.isArray(ia.data.titulos) ? ia.data.titulos : null;
  if (!brutos) {
    return { ok: false, codigo: "RESPOSTA_INVALIDA", motivo: "A IA não devolveu a lista de títulos." };
  }

  const motivosDescarte = {};
  const descartar = (motivo) => { motivosDescarte[motivo] = (motivosDescarte[motivo] || 0) + 1; };

  const validos = [];
  let recortados = 0;
  for (const bruto of brutos) {
    const t = textoDoCandidato(bruto);
    if (t == null) { descartar("ESTRUTURA_INVALIDA"); continue; }
    let r = avaliarTitulo(t, fatos);
    if (!r.valido && r.motivo === "EXCEDE_LIMITE") {
      const recortado = recortarAoLimite(t, fatos.limite);
      if (recortado) {
        r = avaliarTitulo(recortado, fatos);
        if (r.valido) recortados += 1;
      }
    }
    if (!r.valido) { descartar(r.motivo); continue; }
    const c = completarTitulo(r, fatos);
    validos.push(c.termos.length ? { ...c.avaliado, complemento: c.termos } : r);
  }

  // Ordena por score; empate: relevância, cobertura, aproveitamento do espaço
  // (mais longo) e, por fim, a ordem do LLM. Só então tira duplicados — fica a
  // versão de maior score de cada um.
  const ordenados = validos
    .map((r, i) => ({ r, i }))
    .sort((a, b) => compararAvaliados(a.r, b.r) || a.i - b.i)
    .map((x) => x.r);
  const vistos = new Set();
  const unicos = [];
  for (const r of ordenados) {
    const sig = assinatura(r.titulo);
    if (vistos.has(sig)) { descartar("DUPLICADO"); continue; }
    vistos.add(sig);
    unicos.push(r);
  }

  const sugestoes = unicos.slice(0, MAX_SUGESTOES).map((r) => {
    const s = { titulo: r.titulo, chars: r.chars, score: r.score, breakdown: r.breakdown };
    if (r.complemento) s.complemento = r.complemento;
    return s;
  });
  const descartadas = Object.values(motivosDescarte).reduce((a, n) => a + n, 0);

  if (!sugestoes.length) {
    return {
      ok: false,
      codigo: "SEM_SUGESTOES_VALIDAS",
      motivo: "Nenhum título gerado passou na validação dos fatos do anúncio. Tente gerar novamente.",
      recebidos: brutos.length,
      descartadas,
      motivosDescarte,
    };
  }

  const resultado = {
    ok: true,
    limite: fatos.limite,
    sugestoes,
    recebidos: brutos.length,
    descartadas,
    motivosDescarte,
    recortados,
  };
  if (sugestoes.length < MIN_SUGESTOES) {
    resultado.aviso = "Só " + sugestoes.length + (sugestoes.length === 1 ? " sugestão passou" : " sugestões passaram") +
      " na validação dos fatos do anúncio.";
  }
  return resultado;
}

module.exports = {
  montarFatos,
  avaliarTitulo,
  pontuarEficiencia,
  completarTitulo,
  formaDeTitulo,
  recortarAoLimite,
  montarPrompt,
  gerarTitulos,
  SYSTEM,
  LIMITE_PADRAO,
  CANDIDATOS_PEDIDOS,
  MAX_SUGESTOES,
};
