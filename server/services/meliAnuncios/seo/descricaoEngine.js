// server/services/meliAnuncios/seo/descricaoEngine.js
// -----------------------------------------------------------------------------
// Description Engine (SEO ML · F5) — UMA sugestão de DESCRIÇÃO por chamada.
//
// Fluxo (gerarDescricao):
//   ficha factual (montarFicha) → LLM redige o texto e diz quais fatos usou →
//   validação determinística (validarDescricao) → válida ou inválida, com
//   motivos objetivos. Sem score: descrição não recebe nota de nenhum tipo.
//
// Este módulo é puro em relação a infraestrutura: não lê banco, não chama o
// Mercado Livre, não lê env. A descrição atual e a categoria chegam prontas do
// controller; o aiProvider entra como parâmetro (e é simulado nos testes).
// Conta, carteira e escrita são do controller — e escrita não existe aqui:
// "Usar" no front só muda o rascunho, o PATCH /conteudo continua sendo o único
// caminho até o Mercado Livre.
//
// Força das fontes:
//   A. fatos estruturados FORTES  — marca, gênero, material, cor, voltagem,
//      medidas, tipo, linha, fechamento, compatibilidade…
//   B. fatos estruturados SECUNDÁRIOS — os demais atributos com valor.
//   C. contexto FRACO — título atual e descrição atual. Servem para entender e
//      preservar conteúdo, nunca vencem um atributo.
//   D. PROIBIDOS — atributo booleano "Não" e conflitos de GÊNERO (fatosProduto).
//
// A validação não é um verificador semântico: ela pega o que dá para pegar sem
// ambiguidade (contato, URL, linguagem promocional, marca, números, atributo
// negado, cópia da ficha técnica, IDs de fatos) e descarta a geração inteira
// quando algo falha. Os `fatosUsados` são rastreabilidade, não prova.
// -----------------------------------------------------------------------------

const seo = require("./seoText");
const fatosProduto = require("./fatosProduto");
const { AI_TASKS } = require("../../ai/aiTasks");

const {
  ATRIBUTOS_ESTRUTURAIS,
  PALAVRAS_DE_NOME_GENERICAS,
  texto,
  lerAtributos,
  valorAtributo,
  atributoIgnorado,
  marcaGenerica,
  valorBooleano,
  regrasGenero,
} = fatosProduto;

// Limite do Mercado Livre quando a categoria não pôde ser lida: 50.000
// caracteres em texto simples (settings.max_description_length de /categories
// — conferido em categorias reais em 2026-10-01).
const LIMITE_ML_PADRAO = 50000;
// Teto OPERACIONAL: a sugestão nunca passa disso, por maior que seja o limite
// da categoria. Descrição útil é curta; não há o que ganhar enchendo espaço.
const TETO_OPERACIONAL = 2500;
// Quanto da descrição atual vai para o prompt (contexto, não texto a copiar).
const DESCRICAO_ATUAL_MAX_PROMPT = 3000;
// Mínimo de fatos de PRODUTO (marca, modelo, atributos) para valer uma
// descrição. Categoria e título não contam; uma descrição atual real conta 1.
const MIN_FATOS = 2;
const DESCRICAO_ATUAL_MIN_UTIL = 80;
// Quantas linhas "Rótulo: valor" com rótulo da ficha caracterizam cópia da
// ficha técnica (o ML já mostra a ficha ao lado da descrição).
const MAX_LINHAS_DE_FICHA = 3;

// Atributos FORTES além dos estruturais compartilhados (fatosProduto).
const FORTES_EXTRAS = new Set([
  "BRAND", "MODEL", "COLOR", "MAIN_COLOR", "CLOSURE_TYPE", "COMPOSITION",
]);
const FORTE_POR_PADRAO = [
  /(^|_)TYPE$/, /^TYPE_/, /COMPATIB/,
  /(WIDTH|HEIGHT|LENGTH|DEPTH|DIAMETER|WEIGHT|SIZE|VOLUME|THICKNESS)/,
];

function atributoForte(id) {
  return ATRIBUTOS_ESTRUTURAIS.has(id) || FORTES_EXTRAS.has(id) || FORTE_POR_PADRAO.some((re) => re.test(id));
}

function semAcento(s) {
  return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function palavrasDeConteudo(t) {
  return seo.extractTokens(t).filter((x) => !x.stopword);
}

// -----------------------------------------------------------------------------
// Números — "12V", "30 cm", "1,5 L", "2 unidades", "duas unidades".
// Um número só é aceito se aparece nos fatos permitidos ou no contexto
// autorizado (título, descrição atual). Por extenso só conta quando quantifica
// algo ("duas unidades"); "os dois lados" não é medida.
// -----------------------------------------------------------------------------
const NUMEROS_POR_EXTENSO = new Map([
  ["dois", 2], ["duas", 2], ["tres", 3], ["quatro", 4], ["cinco", 5], ["seis", 6],
  ["sete", 7], ["oito", 8], ["nove", 9], ["dez", 10], ["onze", 11], ["doze", 12],
]);
const QUANTIFICADOS = /^(unidades?|pecas?|pares?|itens|item|pacotes?|kits?|camadas?|velocidades?|niveis|nivel|modos?|bolsos?|compartimentos?|lugares?|portas?)$/;

function normalizarNumero(bruto) {
  let s = String(bruto);
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.000 · 1.500,50
  else if (/^\d+,\d+$/.test(s)) s = s.replace(",", ".");                               // 1,5 → 1.5
  else if (!/^\d+(\.\d+)?$/.test(s)) return null;                                       // 1.2.3: não é medida
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : null;
}

function extrairNumeros(t) {
  const encontrados = [];
  const bruto = String(t == null ? "" : t);
  for (const m of bruto.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const n = normalizarNumero(m[0]);
    if (n != null) encontrados.push({ numero: n, trecho: m[0] });
  }
  const palavras = semAcento(bruto).split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < palavras.length - 1; i += 1) {
    const n = NUMEROS_POR_EXTENSO.get(palavras[i]);
    if (n != null && QUANTIFICADOS.test(palavras[i + 1])) {
      encontrados.push({ numero: String(n), trecho: palavras[i] + " " + palavras[i + 1] });
    }
  }
  return encontrados;
}

// -----------------------------------------------------------------------------
// montarFicha — a ficha do que é VERDADE sobre o anúncio (e do que é proibido).
//
// opts: {
//   categoriaNome,
//   limiteCategoria,          settings.max_description_length (null = não lido)
//   descricaoAtual,           texto lido ao vivo do ML (ou null)
//   descricaoEstado,          "ok" | "sem_descricao" | "erro" (mesmo contrato do detalhe)
// }
//
//   {
//     limite, alvo:{ min, max },
//     categoria, tituloAtual, marca, modelo,
//     descricaoAtual: { estado, texto },
//     fatos:     [{ id, label, value, grupo: "forte"|"secundario" }]
//     proibidos: [{ id, label, value, motivo, chaves:[[key…]…], exibir:[string] }]
//     idsConhecidos: Set, nomesAutorizados: Set(key), vocabularioFraco: Set(key),
//     numerosPermitidos: Set,
//     nFatosProduto, suficiente
//   }
// -----------------------------------------------------------------------------
function montarFicha(anuncio, opts = {}) {
  const a = anuncio || {};
  const attrs = lerAtributos(a);
  const porId = new Map(attrs.map((x) => [String(x.id || ""), x]));

  const limiteCategoria = Number.isInteger(opts.limiteCategoria) && opts.limiteCategoria > 0
    ? opts.limiteCategoria : LIMITE_ML_PADRAO;
  const limite = Math.min(limiteCategoria, TETO_OPERACIONAL);

  const fatos = [];
  const proibidosBrutos = [];
  const afirmadas = new Set(); // chaves que algum fato AFIRMA (resolve contradição na ficha)

  function fato(id, label, value, grupo) {
    fatos.push({ id, label, value, grupo });
    for (const t of palavrasDeConteudo(value)) afirmadas.add(t.key);
  }

  const categoria = texto(opts.categoriaNome);
  const categoriaUtil = categoria && !marcaGenerica(categoria) ? categoria : null;

  const marca = texto(valorAtributo(porId.get("BRAND")) || a.marca);
  const marcaUtil = marca && !marcaGenerica(marca) ? marca : null;
  if (marcaUtil) fato("brand", "Marca", marcaUtil, "forte");

  // MODEL é dado factual (F4R), mas o legado gravou listas de palavras-chave
  // nele. Só entra quando parece um modelo de verdade: até 4 palavras, sem
  // vírgula/ponto e vírgula, até 40 caracteres. Fora disso, nem vai ao prompt.
  const modelo = texto(valorAtributo(porId.get("MODEL")) || a.modelo);
  const nModelo = seo.contentKeys(modelo).length;
  const modeloUtil = modelo && nModelo >= 1 && nModelo <= 4 && modelo.length <= 40 && !/[,;|]/.test(modelo)
    ? modelo : null;
  if (modeloUtil) fato("model", "Modelo", modeloUtil, "forte");

  let nAtributos = 0;
  for (const at of attrs) {
    const idMl = String(at.id || "");
    const valor = valorAtributo(at);
    if (!valor || idMl === "BRAND" || idMl === "MODEL" || atributoIgnorado(idMl)) continue;
    const id = "attr:" + idMl;
    const label = texto(at.name) || idMl;
    const bool = valorBooleano(valor);
    const chavesNome = palavrasDeConteudo(label).filter((t) => !PALAVRAS_DE_NOME_GENERICAS.has(t.key));

    if (bool === false) {
      // "É impermeável: Não" — afirmar "impermeável" é falso.
      if (chavesNome.length) {
        proibidosBrutos.push({
          id, label, value: valor, motivo: "ATRIBUTO_NEGADO",
          chaves: [chavesNome.map((t) => t.key)],
          exibir: [chavesNome.map((t) => t.original).join(" ")],
        });
      }
      continue;
    }

    nAtributos += 1;
    if (bool === true) {
      fatos.push({ id, label, value: valor, grupo: "secundario" });
      for (const t of chavesNome) afirmadas.add(t.key);
      continue;
    }
    fato(id, label, valor, atributoForte(idMl) ? "forte" : "secundario");

    if (idMl === "GENDER") {
      const genero = regrasGenero(valor);
      if (genero && genero.proibidas.size) {
        const proibidas = Array.from(genero.proibidas);
        proibidosBrutos.push({
          id, label, value: valor, motivo: "CONFLITO_GENERO",
          chaves: proibidas.map((k) => [k]),
          exibir: proibidas,
        });
      }
    }
  }

  // Uma palavra proibida que outro fato AFIRMA (ficha contraditória) deixa de
  // ser proibida: na dúvida vale o fato — mesma regra do Title Engine.
  const proibidos = [];
  for (const p of proibidosBrutos) {
    const idx = p.chaves.map((seq, i) => i).filter((i) => !p.chaves[i].every((k) => afirmadas.has(k)));
    if (!idx.length) continue;
    proibidos.push({ ...p, chaves: idx.map((i) => p.chaves[i]), exibir: idx.map((i) => p.exibir[i]) });
  }

  const tituloAtual = texto(a.titulo);
  // Mesmo contrato do detalhe/F1: "erro" (não deu para ler) ≠ "sem_descricao".
  const textoLido = texto(opts.descricaoAtual);
  const descricaoAtual = opts.descricaoEstado === "erro"
    ? { estado: "erro", texto: null }
    : textoLido ? { estado: "ok", texto: textoLido } : { estado: "sem_descricao", texto: null };

  // IDs que o LLM pode citar em fatosUsados.
  const idsConhecidos = new Set(fatos.map((f) => f.id));
  for (const p of proibidos) idsConhecidos.add(p.id);
  if (categoriaUtil) idsConhecidos.add("categoria");
  if (tituloAtual) idsConhecidos.add("contexto:titulo");
  if (descricaoAtual.texto) idsConhecidos.add("contexto:descricao_atual");

  // Nomes próprios: dois níveis. `nomesAutorizados` vem SÓ dos fatos
  // estruturados (marca, modelo seguro, linha e demais valores/rótulos de
  // atributos, categoria) e libera um nome em qualquer posição.
  // `vocabularioFraco` vem do título e da descrição atual: libera palavra
  // comum, mas nunca um nome em posição de marca quando há BRAND estruturada
  // — fato estruturado vence contexto fraco. O MODEL legado fora do padrão
  // não entra em nenhum dos dois.
  const fontesFortes = [categoriaUtil];
  for (const f of fatos) fontesFortes.push(f.label, f.value);
  for (const p of proibidos) fontesFortes.push(p.label);
  const fontesFracas = [tituloAtual, descricaoAtual.texto];
  const nomesAutorizados = new Set();
  const vocabularioFraco = new Set();
  const numerosPermitidos = new Set();
  // Palavras que o contexto fraco usa em minúscula: palavra comum, não nome.
  const vocabularioComum = new Set();
  for (const [fontes, destino] of [[fontesFortes, nomesAutorizados], [fontesFracas, vocabularioFraco]]) {
    for (const fonte of fontes) {
      if (!fonte) continue;
      for (const t of seo.extractTokens(fonte)) {
        destino.add(t.key);
        if (destino === vocabularioFraco && !/^\p{Lu}/u.test(t.original)) vocabularioComum.add(t.key);
      }
      for (const n of extrairNumeros(fonte)) numerosPermitidos.add(n.numero);
    }
  }

  const nFatosProduto = (marcaUtil ? 1 : 0) + (modeloUtil ? 1 : 0) + nAtributos;
  const descricaoUtil = !!(descricaoAtual.texto && descricaoAtual.texto.length >= DESCRICAO_ATUAL_MIN_UTIL);
  const suficiente = nFatosProduto + (descricaoUtil ? 1 : 0) >= MIN_FATOS;

  // Faixa operacional proporcional ao que existe para dizer.
  const peso = nFatosProduto + (descricaoUtil ? 2 : 0);
  let alvo = peso <= 3 ? { min: 300, max: 700 } : peso <= 7 ? { min: 500, max: 1200 } : { min: 800, max: 2000 };
  if (alvo.max > limite) alvo = { min: Math.min(alvo.min, Math.floor(limite / 2)), max: limite };

  return {
    limite,
    alvo,
    categoria: categoriaUtil,
    tituloAtual,
    marca: marcaUtil,
    modelo: modeloUtil,
    descricaoAtual,
    fatos,
    proibidos,
    idsConhecidos,
    nomesAutorizados,
    vocabularioFraco,
    vocabularioComum,
    numerosPermitidos,
    nFatosProduto,
    suficiente,
  };
}

// -----------------------------------------------------------------------------
// Linguagem proibida — frases já sem acento e em minúsculas. Um termo que é
// VALOR de um fato estruturado (linha "Premium", por exemplo) deixa de ser
// promocional para aquele anúncio.
// -----------------------------------------------------------------------------
const LINGUAGEM_PROIBIDA = [
  // hipérbole / publicidade genérica
  "imperdivel", "incrivel", "incriveis", "incomparavel", "sensacional", "espetacular", "fantastico",
  "fantastica", "maravilhoso", "maravilhosa", "revolucionario", "revolucionaria", "perfeito", "perfeita",
  "perfeitos", "perfeitas", "descubra", "nao perca", "aproveite", "garanta ja", "garanta o seu",
  "garanta a sua", "garanta os seus", "garanta as suas", "compre ja", "compre agora", "corra",
  "ultimas unidades", "oferta", "promocao", "desconto", "liquidacao", "queima de estoque",
  "o melhor", "a melhor", "os melhores", "as melhores", "melhor escolha", "melhor custo", "melhor preco",
  "alta qualidade", "excelente qualidade", "qualidade superior", "qualidade premium", "top de linha",
  "sucesso de vendas", "mais vendido", "mais vendida", "lancamento", "premium", "exclusivo", "exclusiva",
  // logística e políticas (a descrição não promete frete, prazo, troca)
  "frete", "envio", "enviamos", "despachamos", "postagem", "pronta entrega", "entrega rapida",
  "entrega imediata", "entrega gratis", "prazo de entrega", "prazo de envio", "mesmo dia",
  "garantia", "devolucao", "reembolso", "troca gratis", "nota fiscal",
  // linguagem de chatbot
  "como assistente", "como uma ia", "modelo de linguagem", "espero que", "segue a descricao",
  "aqui esta", "certamente",
];
const CONTATO_EXTERNO = [
  "whatsapp", "whats", "zap", "instagram", "facebook", "telegram", "tiktok", "youtube",
  "ligue", "entre em contato", "fale conosco", "chame no", "mande mensagem",
];
// Voz do vendedor — com acento, porque "nos" sem acento é contração (em + os).
const VOZ_DA_LOJA = /(^|[^\p{L}])(nós|nosso|nossa|nossos|nossas|conosco)(?=[^\p{L}]|$)/iu;

function contemFrase(normalizado, frase) {
  const re = new RegExp("(^|[^a-z0-9])" + frase.replace(/ /g, "\\s+") + "(?=[^a-z0-9]|$)");
  return re.test(normalizado);
}

const RE_URL = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|br|io|shop|store|link|ly|me)\b)/i;
const RE_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const RE_TELEFONE = /(\+?55[\s-]?)?\(?\b\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}\b/;
const RE_HANDLE = /(^|\s)@[\w.]{2,}/;
const RE_HTML = /<\/?[a-z][^>]*>/i;
const RE_MARKDOWN = /\*\*|__|^\s{0,3}#{1,6}\s/m;
const RE_EMOJI = /\p{Extended_Pictographic}/u;

// Palavras genéricas de seção que podem aparecer com maiúscula no meio da
// linha sem serem nome próprio ("Conteúdo da Embalagem").
const PALAVRAS_DE_SECAO = new Set([
  "conteudo", "embalagem", "caracteristica", "uso", "indicacao", "observacao", "importante",
  "cuidado", "aplicacao", "modo", "como", "usar", "detalhe", "informacao", "produto",
]);

// -----------------------------------------------------------------------------
// Nomes próprios / marca — sem reconhecedor de entidades. Uma palavra vira
// CANDIDATA a nome comercial em qualquer posição (início, meio, fim, depois de
// quebra de linha ou pontuação) quando:
//   1. está em POSIÇÃO DE MARCA: depois de "marca", "da", "pela", "pelo",
//      "produto", "fabricante", "grife", "linha" ("Produto da Nike") ou antes
//      de "apresenta", "oferece", "traz", "desenvolveu/desenvolvido",
//      "fabrica", "produz", "modelo", "ideal"… ("Nike oferece", "Samsung
//      ideal para"). Depois de "marca", vale até em minúsculas;
//   2. tem maiúscula fora do início de frase ("no estilo Nike Air");
//   3. está TODA em maiúsculas ("NIKE");
//   4. abre a frase com maiúscula e tem grafia estrangeira (k/w/y, final em
//      consoante que o português não usa, "ph", "th", "pp"…: Nike, Samsung,
//      Olympikus). Palavra portuguesa comum abrindo frase ("Este", "Ideal",
//      "Desenvolvido", "Possui", "Com") não é candidata.
// Candidata autorizada = todas as chaves em `nomesAutorizados` (fatos
// estruturados) ou palavras de seção. O contexto fraco (título/descrição
// atual) autoriza sem restrição só quando NÃO há BRAND estruturada; com BRAND,
// nunca libera marca explícita, caixa alta ou grafia estrangeira — a descrição
// antiga nunca libera "Nike" num anúncio de BRAND = Molekinho.
// Não autorizada em posição de marca com BRAND → MARCA_CONFLITANTE; o resto →
// NOME_NAO_COMPROVADO.
// -----------------------------------------------------------------------------
const ANTES_DA_MARCA = new Set(["marca", "marcas", "da", "pela", "pelo", "produto", "produtos", "fabricante", "grife", "linha"]);
const DEPOIS_DA_MARCA = new Set([
  "apresenta", "oferece", "traz", "desenvolveu", "desenvolvido", "desenvolvida", "lanca", "lancou",
  "fabrica", "fabricado", "fabricada", "produz", "produzido", "produzida", "criou", "assina",
  "garante", "modelo", "linha", "ideal",
]);
// Palavras de uso corrente no português com grafia "estrangeira".
const EMPRESTIMOS_COMUNS = new Set([
  "kit", "kits", "design", "led", "leds", "show", "web", "wifi", "fitness", "notebook", "mouse",
  "smartphone", "smartwatch", "online", "light", "top", "spray", "skate", "short", "shorts", "jeans",
]);

function pareceEstrangeira(palavra) {
  const s = semAcento(palavra).replace(/[^a-z]/g, "");
  if (s.length < 3 || EMPRESTIMOS_COMUNS.has(s)) return false;
  return /[kwy]/.test(s) || /(ph|th|sh|ck|pp|tt|ff|gg|dd|bb|oo)/.test(s) || /[bcdfghjkpqtvx]$/.test(s);
}

function palavrasDaDescricao(textoDesc) {
  const palavras = [];
  for (const linha of String(textoDesc).split(/\n/)) {
    const semMarcador = linha.replace(/^\s*[-•*–]\s*/, "");
    const re = /([.!?:;,()"“”])|([\p{L}\p{N}][\p{L}\p{N}'’&-]*)/gu;
    let inicioDeFrase = true;
    let colado = false; // só espaço entre esta palavra e a anterior
    let m;
    while ((m = re.exec(semMarcador))) {
      if (m[1]) {
        if (/[.!?:;]/.test(m[1])) inicioDeFrase = true;
        colado = false;
        continue;
      }
      palavras.push({ palavra: m[2], inicio: inicioDeFrase, coladaNaAnterior: colado });
      inicioDeFrase = false;
      colado = true;
    }
    // quebra de linha separa palavras
    if (palavras.length) palavras[palavras.length - 1].fimDeLinha = true;
  }
  for (const p of palavras) p.chaves = seo.extractTokens(p.palavra).map((t) => ({ key: t.key, stop: t.stopword }));
  palavras.forEach((p, i) => {
    p.anterior = p.coladaNaAnterior ? palavras[i - 1] : null;
    p.proxima = !p.fimDeLinha && palavras[i + 1] && palavras[i + 1].coladaNaAnterior ? palavras[i + 1] : null;
  });
  return palavras;
}

function analisarNomes(textoDesc, ficha) {
  const conflitantes = [];
  const naoComprovados = [];
  const chave = (p) => (p && p.chaves.length === 1 ? p.chaves[0].key : null);
  const autorizadaForte = (p) => p.chaves.every((c) => ficha.nomesAutorizados.has(c.key) || PALAVRAS_DE_SECAO.has(c.key));
  const naFraca = (p) => p.chaves.every((c) => ficha.vocabularioFraco.has(c.key) || ficha.nomesAutorizados.has(c.key) || PALAVRAS_DE_SECAO.has(c.key));
  const comum = (p) => p.chaves.every((c) => ficha.vocabularioComum.has(c.key) || ficha.nomesAutorizados.has(c.key) || PALAVRAS_DE_SECAO.has(c.key));

  for (const p of palavrasDaDescricao(textoDesc)) {
    const w = p.palavra;
    if (!/^\p{L}/u.test(w) || !p.chaves.length || p.chaves.every((c) => c.stop)) continue;
    const maiuscula = /^\p{Lu}/u.test(w);
    const caixaAlta = w.length >= 2 && w === w.toUpperCase() && w !== w.toLowerCase();
    const depoisDeMarca = chave(p.anterior) === "marca" || chave(p.anterior) === "marcas";
    const marcaExplicita = depoisDeMarca || ((maiuscula || caixaAlta) && ANTES_DA_MARCA.has(chave(p.anterior)));
    const antesDeVerbo = (maiuscula || caixaAlta) && DEPOIS_DA_MARCA.has(chave(p.proxima)) && !DEPOIS_DA_MARCA.has(chave(p));
    const posicaoDeMarca = marcaExplicita || antesDeVerbo;
    const estrangeira = pareceEstrangeira(w);
    const candidata = posicaoDeMarca || (maiuscula && !p.inicio) || caixaAlta || (maiuscula && p.inicio && estrangeira);
    if (!candidata || autorizadaForte(p)) continue;

    // Contexto fraco: sem BRAND, autoriza o que está no título/descrição atual.
    // Com BRAND, nunca autoriza marca explícita, caixa alta ou grafia
    // estrangeira; antes de verbo ("Tênis ideal"), só palavra que o contexto
    // usa em minúscula (palavra comum, não nome).
    let fracaVale;
    if (!ficha.marca) fracaVale = naFraca(p);
    else if (marcaExplicita || estrangeira || caixaAlta) fracaVale = false;
    else if (antesDeVerbo) fracaVale = comum(p);
    else fracaVale = naFraca(p);
    if (fracaVale) continue;
    if (ficha.marca && (posicaoDeMarca || (p.inicio && estrangeira))) conflitantes.push(w);
    else naoComprovados.push(w);
  }
  const unicos = (xs) => Array.from(new Set(xs));
  return { conflitantes: unicos(conflitantes), naoComprovados: unicos(naoComprovados).filter((w) => !conflitantes.includes(w)) };
}

// Afirmação de atributo proibido. Negada logo antes ("não é impermeável",
// "sem bolsos") é a informação correta e passa.
function afirmacoesProibidas(textoDesc, ficha) {
  if (!ficha.proibidos.length) return [];
  const tokens = seo.extractTokens(textoDesc);
  const conteudo = tokens.map((t, i) => ({ t, i })).filter((x) => !x.t.stopword);
  const achados = [];
  for (const p of ficha.proibidos) {
    for (let s = 0; s < p.chaves.length; s += 1) {
      const seq = p.chaves[s];
      for (let j = 0; j + seq.length <= conteudo.length; j += 1) {
        if (!seq.every((k, d) => conteudo[j + d].t.key === k)) continue;
        const antes = tokens.slice(Math.max(0, conteudo[j].i - 3), conteudo[j].i).map((t) => t.key);
        if (antes.includes("nao") || antes.includes("sem")) continue;
        achados.push({ id: p.id, termo: p.exibir[s] });
      }
    }
  }
  return achados;
}

function linhasDeFicha(textoDesc, ficha) {
  const rotulos = new Set(ficha.fatos.map((f) => semAcento(f.label).trim()));
  let n = 0;
  let cabecalho = false;
  for (const linha of String(textoDesc).split(/\n/)) {
    const l = semAcento(linha).replace(/^\s*[-•*–]\s*/, "").trim();
    if (/^(especificacoes|especificacoes tecnicas|ficha tecnica|dados tecnicos)\s*:?$/.test(l)) cabecalho = true;
    const m = /^([^:]{2,40}):\s*\S/.exec(l);
    if (m && rotulos.has(m[1].trim())) n += 1;
  }
  return { n, cabecalho };
}

// -----------------------------------------------------------------------------
// validarDescricao — pura e determinística (mesma entrada, mesma saída; não
// altera a ficha).
//   { valida:true,  descricao, chars, fatosUsados:[id] }
//   { valida:false, descricao, problemas:[{ codigo, detalhe, termos? }] }
// Códigos: VAZIA · EXCEDE_LIMITE · FORMATACAO_INVALIDA · URL · EMAIL ·
//   TELEFONE · CONTATO_EXTERNO · LINGUAGEM_PROIBIDA · VOZ_DA_LOJA ·
//   MARCA_CONFLITANTE · NOME_NAO_COMPROVADO · ATRIBUTO_PROIBIDO ·
//   NUMERO_NAO_COMPROVADO · COPIA_FICHA_TECNICA · FATOS_USADOS_INVALIDOS ·
//   FATO_DESCONHECIDO
// -----------------------------------------------------------------------------
function normalizarTexto(bruto) {
  return String(bruto == null ? "" : bruto)
    .replace(/\r\n?/g, "\n")
    .split("\n").map((l) => l.replace(/[ \t]+$/g, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function validarDescricao(descricaoBruta, fatosUsados, ficha) {
  const descricao = normalizarTexto(descricaoBruta);
  const problemas = [];
  const add = (codigo, detalhe, termos) => problemas.push(termos && termos.length ? { codigo, detalhe, termos } : { codigo, detalhe });

  if (!descricao) {
    return { valida: false, descricao, problemas: [{ codigo: "VAZIA", detalhe: "A IA devolveu uma descrição vazia." }] };
  }
  if (descricao.length > ficha.limite) {
    add("EXCEDE_LIMITE", "A descrição tem " + descricao.length + " caracteres; o limite é " + ficha.limite + ".");
  }
  if (RE_HTML.test(descricao) || RE_MARKDOWN.test(descricao) || RE_EMOJI.test(descricao)) {
    add("FORMATACAO_INVALIDA", "A descrição do Mercado Livre é texto simples: sem HTML, markdown ou emoji.");
  }

  const normalizado = semAcento(descricao);
  if (RE_URL.test(descricao)) add("URL", "A descrição não pode ter links ou endereços de site.");
  if (RE_EMAIL.test(descricao)) add("EMAIL", "A descrição não pode ter e-mail.");
  if (RE_TELEFONE.test(descricao)) add("TELEFONE", "A descrição não pode ter telefone.");
  const contato = CONTATO_EXTERNO.filter((f) => contemFrase(normalizado, f));
  if (contato.length || RE_HANDLE.test(descricao)) {
    add("CONTATO_EXTERNO", "A descrição não pode direcionar para contato fora do Mercado Livre.", contato);
  }

  const valoresDosFatos = semAcento(ficha.fatos.map((f) => f.value).join(" | "));
  const proibida = LINGUAGEM_PROIBIDA.filter((f) => contemFrase(normalizado, f) && !contemFrase(valoresDosFatos, f));
  const exclamacoes = (descricao.match(/!/g) || []).length;
  if (exclamacoes > 1) proibida.push("excesso de exclamações");
  if (proibida.length) {
    add("LINGUAGEM_PROIBIDA", "Linguagem promocional, de logística/garantia ou de chatbot.", proibida);
  }
  const voz = VOZ_DA_LOJA.exec(descricao);
  if (voz) add("VOZ_DA_LOJA", "A descrição fala do produto, não da loja (sem \"nós\"/\"nossa\").", [voz[2]]);

  const nomes = analisarNomes(descricao, ficha);
  if (nomes.conflitantes.length) {
    add("MARCA_CONFLITANTE", "A descrição cita uma marca diferente de " + ficha.marca + ".", nomes.conflitantes);
  }
  if (nomes.naoComprovados.length) {
    add("NOME_NAO_COMPROVADO", "Nome próprio (marca, linha ou modelo) que não está nos dados do anúncio.", nomes.naoComprovados);
  }

  const negados = afirmacoesProibidas(descricao, ficha);
  if (negados.length) {
    add("ATRIBUTO_PROIBIDO", "A descrição afirma algo que a ficha do anúncio nega.",
      Array.from(new Set(negados.map((x) => x.termo))));
  }

  const numeros = extrairNumeros(descricao).filter((n) => !ficha.numerosPermitidos.has(n.numero));
  if (numeros.length) {
    add("NUMERO_NAO_COMPROVADO", "Número ou medida que não está nos dados do anúncio.",
      Array.from(new Set(numeros.map((n) => n.trecho))));
  }

  const ficha_ = linhasDeFicha(descricao, ficha);
  if (ficha_.cabecalho || ficha_.n > MAX_LINHAS_DE_FICHA) {
    add("COPIA_FICHA_TECNICA", "A descrição repete a ficha técnica em lista; ela deve complementar os atributos.");
  }

  let usados = [];
  if (!Array.isArray(fatosUsados) || fatosUsados.some((x) => typeof x !== "string")) {
    add("FATOS_USADOS_INVALIDOS", "A IA não informou a lista de fatos usados.");
  } else {
    usados = Array.from(new Set(fatosUsados.map((x) => x.trim()).filter(Boolean)));
    const desconhecidos = usados.filter((id) => !ficha.idsConhecidos.has(id));
    if (desconhecidos.length) add("FATO_DESCONHECIDO", "A IA citou fatos que não foram enviados.", desconhecidos);
  }

  if (problemas.length) return { valida: false, descricao, problemas };
  return { valida: true, descricao, chars: descricao.length, fatosUsados: usados };
}

// -----------------------------------------------------------------------------
// Prompt — fatos com ID, proibidos, contexto fraco e regras de estilo.
// Nada de score, ranking, keywords ou volume de busca.
// -----------------------------------------------------------------------------
const SYSTEM = [
  "Você redige descrições de anúncios do Mercado Livre Brasil.",
  "Escreve só com os fatos fornecidos. SE UMA INFORMAÇÃO NÃO ESTIVER NOS FATOS OU NO CONTEXTO AUTORIZADO, NÃO INVENTE.",
  "Responda SOMENTE com JSON válido, sem markdown e sem texto fora do JSON. Não explique o raciocínio.",
].join("\n");

function linhaFato(f) {
  return "- [" + f.id + "] " + f.label + ": " + String(f.value).slice(0, 160);
}

function montarPrompt(ficha) {
  const fortes = ficha.fatos.filter((f) => f.grupo === "forte");
  const secundarios = ficha.fatos.filter((f) => f.grupo === "secundario");
  const linhas = ["Tarefa: escrever UMA descrição para este anúncio.", ""];

  linhas.push("FATOS PRINCIPAIS (estruturados, confiáveis):");
  if (ficha.categoria) linhas.push("- [categoria] Categoria: " + ficha.categoria);
  for (const f of fortes) linhas.push(linhaFato(f));
  if (!fortes.length && !ficha.categoria) linhas.push("- (nenhum)");
  if (secundarios.length) {
    linhas.push("", "FATOS COMPLEMENTARES (estruturados, menos centrais):");
    for (const f of secundarios.slice(0, 40)) linhas.push(linhaFato(f));
  }

  if (ficha.proibidos.length) {
    linhas.push("", "PROIBIDO AFIRMAR (a ficha do anúncio nega ou contradiz):");
    for (const p of ficha.proibidos) {
      linhas.push("- [" + p.id + "] " + p.label + " = " + p.value + " → nunca escreva: " + p.exibir.join(", "));
    }
  }

  linhas.push("", "CONTEXTO (mais fraco que os fatos; se contradizer um fato, siga o fato):");
  linhas.push("- [contexto:titulo] Título atual: " + (ficha.tituloAtual || "(sem título)"));
  const d = ficha.descricaoAtual;
  if (d.texto) {
    const corpo = d.texto.length > DESCRICAO_ATUAL_MAX_PROMPT ? d.texto.slice(0, DESCRICAO_ATUAL_MAX_PROMPT) + "…" : d.texto;
    linhas.push("- [contexto:descricao_atual] Descrição atual do vendedor (pode reaproveitar informação concreta e útil; " +
      "ignore promessas de frete, prazo, garantia, contato e linguagem promocional):");
    linhas.push('"""', corpo, '"""');
  } else {
    linhas.push("- Descrição atual: (o anúncio não tem descrição hoje)");
  }

  linhas.push(
    "",
    "Como escrever:",
    "- Comece dizendo o que o produto é e para que serve. Depois, se houver fatos para isso: uso/aplicação, " +
      "características que ajudam a decidir a compra, conteúdo da embalagem e uma observação importante. " +
      "Não force todas as partes: pule a que não tiver fato.",
    "- A ficha técnica já aparece no anúncio. NÃO a copie em lista (nada de \"Marca: …\", \"Cor: …\" um por linha, " +
      "nem bloco \"ESPECIFICAÇÕES\"). Cite uma característica quando ela explica uso, compatibilidade ou benefício.",
    "- Tamanho: entre " + ficha.alvo.min + " e " + ficha.alvo.max + " caracteres. Poucos fatos = texto curto. " +
      "Nunca encha espaço. Máximo absoluto: " + ficha.limite + " caracteres.",
    "- Tom comercial, claro, objetivo e natural, em português do Brasil. Frases curtas. No máximo 2 ou 3 títulos de seção.",
    "- Texto simples: sem HTML, markdown, emoji ou CAIXA ALTA. Letra maiúscula só no início de frase e em nomes que aparecem nos fatos.",
    "- Não use: hipérboles (incrível, imperdível, perfeito, o melhor, qualidade incomparável, descubra), " +
      "\"nós\"/\"nossa loja\", frete, prazo, envio, garantia, troca, links, telefone, e-mail, redes sociais ou contato externo.",
    "- Números e medidas: só os que aparecem nos fatos ou no contexto acima. Não invente dimensões, quantidades nem voltagem.",
    "- Marca e modelo: só os dos fatos. Não cite outras marcas, linhas ou modelos.",
    "",
    "Responda SOMENTE com este JSON:",
    '{ "descricao": "texto da descrição, com \\n entre parágrafos", "fatosUsados": ["ids entre colchetes dos fatos que você usou"] }'
  );
  return linhas.join("\n");
}

// -----------------------------------------------------------------------------
// gerarDescricao — uma chamada ao LLM e a validação. Nunca lança.
//   { ok:true,  descricao, chars, limite, fatosUsados:[{ id, label, value }] }
//   { ok:false, codigo, motivo, problemas? }
//     codigo: FATOS_INSUFICIENTES · DESCRICAO_ATUAL_INDISPONIVEL · IA_ERRO ·
//             AI_RESPONSE_TRUNCATED · JSON_INVALIDO · (demais do provider) ·
//             RESPOSTA_INVALIDA · DESCRICAO_INVALIDA
// -----------------------------------------------------------------------------
async function gerarDescricao({ ficha, aiProvider }) {
  // Não dá para saber o que o anúncio tem hoje: uma sugestão poderia apagar
  // conteúdo real (e o front bloqueia a edição nesse estado). Não gasta IA.
  if (ficha.descricaoAtual.estado === "erro") {
    return {
      ok: false, codigo: "DESCRICAO_ATUAL_INDISPONIVEL",
      motivo: "Não foi possível ler a descrição atual no Mercado Livre. Tente novamente em instantes.",
    };
  }
  if (!ficha.suficiente) {
    return {
      ok: false, codigo: "FATOS_INSUFICIENTES",
      motivo: "Este anúncio tem poucos dados confiáveis para uma descrição útil. Preencha a ficha técnica e tente de novo.",
    };
  }

  let ia;
  try {
    ia = await aiProvider.gerarJSON({
      task: AI_TASKS.SEO_DESCRIPTION,
      system: SYSTEM,
      prompt: montarPrompt(ficha),
      maxTokens: 1800,
      temperature: 0.6,
    });
  } catch (err) {
    return { ok: false, codigo: "IA_ERRO", motivo: "Falha ao consultar a IA." };
  }
  if (!ia || !ia.ok) {
    const codigo = (ia && ia.codigo) || "IA_ERRO";
    const motivo = codigo === "AI_RESPONSE_TRUNCATED"
      ? "A resposta da IA veio cortada. Tente gerar novamente."
      : (ia && ia.erro) || "Falha ao gerar a descrição com a IA.";
    return { ok: false, codigo, motivo };
  }
  const d = ia.data;
  if (!d || typeof d !== "object" || typeof d.descricao !== "string") {
    return { ok: false, codigo: "RESPOSTA_INVALIDA", motivo: "A IA não devolveu a descrição no formato esperado." };
  }

  const v = validarDescricao(d.descricao, d.fatosUsados, ficha);
  if (!v.valida) {
    return {
      ok: false,
      codigo: "DESCRICAO_INVALIDA",
      motivo: "A descrição gerada não passou na validação: " + v.problemas.map((p) => p.detalhe).join(" ") +
        " Tente gerar novamente.",
      problemas: v.problemas,
    };
  }

  const porId = new Map(ficha.fatos.map((f) => [f.id, f]));
  return {
    ok: true,
    descricao: v.descricao,
    chars: v.chars,
    limite: ficha.limite,
    fatosUsados: v.fatosUsados.map((id) => {
      const f = porId.get(id);
      if (f) return { id, label: f.label, value: f.value };
      if (id === "categoria") return { id, label: "Categoria", value: ficha.categoria };
      if (id === "contexto:titulo") return { id, label: "Título atual", value: null };
      if (id === "contexto:descricao_atual") return { id, label: "Descrição atual", value: null };
      const p = ficha.proibidos.find((x) => x.id === id);
      return { id, label: p ? p.label : id, value: p ? p.value : null };
    }),
  };
}

module.exports = {
  montarFicha,
  montarPrompt,
  validarDescricao,
  gerarDescricao,
  extrairNumeros,
  SYSTEM,
  LIMITE_ML_PADRAO,
  TETO_OPERACIONAL,
  MIN_FATOS,
};
