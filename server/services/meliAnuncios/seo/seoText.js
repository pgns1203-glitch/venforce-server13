// server/services/meliAnuncios/seo/seoText.js
// -----------------------------------------------------------------------------
// Primitivas textuais de SEO para anúncios Mercado Livre (fase F2).
//
// Camada PURA e DETERMINÍSTICA: sem banco, sem rede, sem env, sem IA, sem
// estado. Serve de base para os futuros Title/Model Engines responderem:
//   - quais tokens existem num texto;
//   - quais tokens são equivalentes para COMPARAÇÃO;
//   - se um termo (palavra ou expressão) já está coberto por um título;
//   - quanto de um termo é realmente novo em relação ao título.
//
// Tudo aqui é para COMPARAR. Nada do que sai normalizado é para exibir: o
// texto original de cada token é preservado em `original`.
//
// Princípio que guia cada regra: FALSO NEGATIVO é aceitável, FALSO POSITIVO
// não. Duas palavras só viram a mesma chave quando a regra é segura; na
// dúvida, ficam diferentes. Não há semântica aqui (infantil ≠ criança,
// menino ≠ garoto) — sinônimos e conceitos são outra camada, futura.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Stopwords — lista pequena de propósito.
//
// Só artigos, preposições e contrações que não carregam atributo de produto.
// NÃO entram: "sem" ("sem fio" ≠ "fio"), "não", "mais", "menos", números.
//
// "com" também NÃO entra: "com" e "sem" são um par de polaridade. Descartar
// só um deles fazia "com fio" (e "com tampa", "com açúcar") ficar 100%
// coberto por "sem fio" — o oposto do produto. Ou os dois contam, ou nenhum;
// "sem" precisa contar, então "com" conta também.
//
// Stopwords continuam existindo em extractTokens (marcadas), só são ignoradas
// quando se compara conteúdo (cobertura, dedupe).
// -----------------------------------------------------------------------------
const STOPWORDS = new Set([
  "a", "o", "as", "os", "e",
  "de", "da", "do", "das", "dos",
  "em", "no", "na", "nos", "nas",
  "ao", "aos",
  "para", "por",
]);

// -----------------------------------------------------------------------------
// Compostos lexicais que CONTÊM uma stopword — viram UM token só.
//
// Sem isso, o filtro de stopwords destrói a identidade do produto:
// "para-choque" virava só "choque" (coberto por "Protetor Contra Choque"),
// "dia a dia" virava "dia". Lista pequena e explícita, não NLP.
//
// A chave do composto é a concatenação ("parachoque", "diaadia"), então
// "para-choque" e "parachoque" são a mesma coisa, inclusive no plural
// ("para-choques" → "parachoque").
//
// "para" + X só vira composto com HÍFEN (a grafia fechada, "parachoque", já é
// um token só). Separado por ESPAÇO, NUNCA: "luva para choque elétrico",
// "bota para lama", "protetor para sol" são frases normais, e "para" fica
// como palavra funcional. O preço é um falso negativo ("para choque" escrito
// sem hífen ≠ "parachoque") — aceito: falso positivo é pior.
// -----------------------------------------------------------------------------
const COMPOSTOS_PARA = new Set([
  // chave do 2º elemento (singular)
  "choque",
  "brisa",
  "lama",
  "sol",
  "sois", // "sóis" é curto demais para a regra -óis; plural explícito
  "raio",
  "queda",
]);

// -----------------------------------------------------------------------------
// Invariáveis — palavras que terminam em -s no SINGULAR (ou que não têm
// singular útil). Sem esta lista as regras de plural as mutilariam
// ("tenis" → "tenil", "onibus" → "onibu"). Comparadas já sem acento.
// -----------------------------------------------------------------------------
const INVARIAVEIS = new Set([
  "tenis", "lapis", "pires", "onibus", "virus", "bonus", "campus", "status",
  "lotus", "atlas", "gas", "gratis", "iris", "oasis", "chassis", "jeans",
  "oculos", "simples", "mais", "menos", "demais", "jamais", "depois", "apos",
  "atras", "tras", "pais", "cais", "tres", "seis", "dois", "reis",
]);

// -----------------------------------------------------------------------------
// Gênero — SÓ por lista explícita (forma feminina singular → masculina).
// Um "-a ↔ -o" genérico juntaria bolso/bolsa, porto/porta, cesto/cesta,
// menino/menina. Aqui entram apenas adjetivos em que as duas formas são o
// mesmo atributo de produto.
// -----------------------------------------------------------------------------
const GENERO = new Map([
  ["masculina", "masculino"],
  ["feminina", "feminino"],
  ["branca", "branco"],
  ["preta", "preto"],
  ["vermelha", "vermelho"],
  ["amarela", "amarelo"],
  ["roxa", "roxo"],
  ["nova", "novo"],
  ["usada", "usado"],
  ["pequena", "pequeno"],
]);

// Tamanho mínimo (sem acento) para as regras de plural com sufixo longo.
// Palavras curtas são justamente onde os plurais irregulares e as colisões
// moram: mães (de mãe) ≠ mão, caos ≠ cão, mais ≠ mal, dois, reis.
const MIN_PLURAL = 5;
// Para "-s" simples o piso é menor (casas, kits), mas siglas de 3 letras
// ficam de fora: pcs (peças) ≠ pc, gps ≠ gp.
const MIN_S = 4;

const VOGAIS = "aeiou";

// Marcas diacríticas de acento (agudo, circunflexo, til, grave...). A
// cedilha (U+0327) fica de fora: "ç" não indica sílaba tônica.
function temAcento(lowerNfc) {
  return /[̀-̨̦-ͯ]/.test(lowerNfc.normalize("NFD"));
}

function semAcento(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function texto(v) {
  return v == null ? "" : String(v);
}

// "1,5" e "1.5" são o mesmo número: vírgula decimal vira ponto.
function protegerDecimais(s) {
  return s.replace(/(\d)[.,](?=\d)/g, "$1.");
}

// Ponto só sobrevive entre dígitos ("2.5"); fora disso é pontuação.
function removerPontosSoltos(s) {
  return s.replace(/\.(?!\d)|(?<!\d)\./g, "");
}

// -----------------------------------------------------------------------------
// normalizeToken — um token para comparação: minúsculo, sem acento, só
// [a-z0-9] (e ponto decimal). "TÊNIS," → "tenis"; "1,5L" → "1.5l".
// -----------------------------------------------------------------------------
function normalizeToken(token) {
  const s = protegerDecimais(texto(token).normalize("NFC").toLowerCase());
  return removerPontosSoltos(semAcento(s).replace(/[^a-z0-9.]/g, ""));
}

// -----------------------------------------------------------------------------
// Plural — regras por sufixo, da mais específica para a mais genérica.
//
// Quando um sufixo casa, a decisão é DESSA regra: se a guarda dela falhar, a
// palavra fica como está (não "cai" para uma regra mais genérica). É isso que
// impede, p.ex., "dois" (-ois curto) de virar "doi" pela regra de "-s".
//
// `base` já está sem acento; `lower` é o original minúsculo (com acento),
// usado só onde o acento decide a regra (-eis).
// -----------------------------------------------------------------------------
function singularizar(base, lower) {
  // -ões / -ães / -ãos → -ão  (botões, alemães, irmãos). Piso de tamanho
  // exclui mães (de mãe), pães/cães (curtos demais para arriscar), caos, mãos.
  for (const suf of ["oes", "aes", "aos"]) {
    if (base.endsWith(suf)) return base.length >= MIN_PLURAL ? base.slice(0, -3) + "ao" : base;
  }

  // -ais → -al (anuais, metais). "mais", "pais", "cais" estão nas invariáveis
  // e ainda assim o piso de tamanho os protegeria.
  if (base.endsWith("ais")) return base.length >= MIN_PLURAL ? base.slice(0, -3) + "al" : base;

  // -eis: o acento decide.
  //   -éis (acento no e)       → -el   papéis, anéis, hotéis
  //   -veis                    → -vel  ajustáveis, móveis, removíveis (com ou sem acento)
  //   -eis com acento antes    → -il   portáteis, fáceis, úteis (paroxítonas em -il)
  //   -eis sem acento nenhum   → -el   (entrada digitada sem acento: "papeis")
  if (base.endsWith("eis")) {
    if (base.length < MIN_PLURAL) return base;
    if (lower.endsWith("éis")) return base.slice(0, -3) + "el";
    if (base.endsWith("veis")) return base.slice(0, -3) + "el";
    if (temAcento(lower)) return base.slice(0, -3) + "il";
    return base.slice(0, -3) + "el";
  }

  // -óis → -ol (faróis, lençóis, anzóis). Escolha consciente: "heróis" vira
  // "herol" (falso negativo com "herói"), não um falso positivo.
  if (base.endsWith("ois")) return base.length >= MIN_PLURAL ? base.slice(0, -3) + "ol" : base;

  // -uis → -ul (azuis).
  if (base.endsWith("uis")) return base.length >= MIN_PLURAL ? base.slice(0, -3) + "ul" : base;

  // -is → -il (infantis, fuzis, barris). Só sem acento: singulares em -is
  // costumam ser acentuados (tênis, lápis, íris, grátis) — e os comuns sem
  // acento estão nas invariáveis.
  if (base.endsWith("is")) {
    return base.length >= MIN_PLURAL && !temAcento(lower) ? base.slice(0, -2) + "il" : base;
  }

  // -ns → -m (homens, jardins, nuvens, marrons, atuns). "jeans" é invariável;
  // "vans", "tons", "bons" ficam de fora pelo piso.
  if (base.endsWith("ns")) return base.length >= MIN_PLURAL ? base.slice(0, -2) + "m" : base;

  // -res / -zes:
  //   vogal antes do r/z  → tira "-es"  (cores → cor, luzes → luz, motores)
  //   consoante antes     → tira só "-s" (livres → livre, padres, bronzes)
  if (base.endsWith("res") || base.endsWith("zes")) {
    if (base.length < MIN_PLURAL) return base;
    const antes = base[base.length - 4];
    return VOGAIS.includes(antes) ? base.slice(0, -2) : base.slice(0, -1);
  }

  // -s simples (meninos, casas, chaves, pneus, bases, kits, leds, shorts).
  // "-ses" cai aqui e perde só o "s": bases → base (não "bas"), classes.
  if (base.endsWith("s")) return base.length >= MIN_S ? base.slice(0, -1) : base;

  return base;
}

// -----------------------------------------------------------------------------
// reduceMorphology — chave de comparação de UM token: normalizado, no
// singular (regras acima) e no masculino (lista GENERO). Tokens com dígito
// não passam por morfologia ("110v", "1.5l", "10").
// -----------------------------------------------------------------------------
function reduceMorphology(token) {
  const lower = texto(token).normalize("NFC").toLowerCase();
  const base = normalizeToken(lower);
  if (!base || !/^[a-z]+$/.test(base)) return base;
  if (INVARIAVEIS.has(base)) return base;
  const singular = singularizar(base, lower);
  return GENERO.get(singular) || singular;
}

function isStopword(token) {
  const n = normalizeToken(token);
  return n !== "" && STOPWORDS.has(n);
}

// -----------------------------------------------------------------------------
// extractTokens — tokens de um texto, em ordem, com o original preservado.
//   [{ original, normalized, key, stopword }]
// Separadores: espaço, pontuação, hífen, barra, underline. O ponto só
// sobrevive entre dígitos ("2.5"); vírgula decimal vira ponto ("1,5").
// Compostos lexicais (COMPOSTOS_PARA, "dia a dia") saem como UM token:
//   { original: "para-choque", normalized: "para choque", key: "parachoque" }
// -----------------------------------------------------------------------------
function tokensSimples(text) {
  const s = protegerDecimais(texto(text).normalize("NFC"));
  const out = [];
  let fimAnterior = 0;
  for (const m of s.matchAll(/[\p{L}\p{N}.]+/gu)) {
    let separador = s.slice(fimAnterior, m.index);
    fimAnterior = m.index + m[0].length;
    for (const bruto of m[0].split(/\.(?!\d)|(?<!\d)\./)) {
      const normalized = normalizeToken(bruto);
      if (!normalized) { separador += "."; continue; }
      out.push({ original: bruto, normalized, separador });
      separador = ".";
    }
  }
  return out;
}

function hifen(separador) {
  return separador.trim() === "-";
}

// Quantos tokens simples a partir de `i` formam um composto (0 = nenhum).
function tamanhoComposto(t, i) {
  const a = t[i];
  const b = t[i + 1];
  if (!b) return 0;
  if (a.normalized === "para") {
    return hifen(b.separador) && COMPOSTOS_PARA.has(reduceMorphology(b.original)) ? 2 : 0;
  }
  const c = t[i + 2];
  if (a.normalized === "dia" && b.normalized === "a" && c && c.normalized === "dia") return 3;
  return 0;
}

function extractTokens(text) {
  const t = tokensSimples(text);
  const out = [];
  for (let i = 0; i < t.length; ) {
    const n = tamanhoComposto(t, i);
    if (n) {
      const partes = t.slice(i, i + n);
      out.push({
        original: partes.map((p, j) => (j ? p.separador : "") + p.original).join(""),
        normalized: partes.map((p) => p.normalized).join(" "),
        key: reduceMorphology(partes.map((p) => p.original).join("")),
        stopword: false,
      });
      i += n;
      continue;
    }
    out.push({
      original: t[i].original,
      normalized: t[i].normalized,
      key: reduceMorphology(t[i].original),
      stopword: STOPWORDS.has(t[i].normalized),
    });
    i += 1;
  }
  return out;
}

function tokenize(text) {
  return extractTokens(text).map((t) => t.normalized);
}

function normalizeText(text) {
  return tokenize(text).join(" ");
}

// Chaves de CONTEÚDO (sem stopwords), únicas, na ordem em que aparecem.
function contentKeys(text) {
  const vistos = new Set();
  const out = [];
  for (const t of extractTokens(text)) {
    if (t.stopword || vistos.has(t.key)) continue;
    vistos.add(t.key);
    out.push(t.key);
  }
  return out;
}

// Chave de comparação de um texto inteiro (todos os tokens, inclusive
// stopwords). Para uma palavra só, é a chave dela.
function comparisonKey(text) {
  return extractTokens(text).map((t) => t.key).join(" ");
}

function areEquivalent(a, b) {
  const ka = comparisonKey(a);
  return ka !== "" && ka === comparisonKey(b);
}

// Conjunto de chaves de conteúdo de um título — calcule uma vez e reaproveite
// ao comparar vários termos contra o mesmo título.
function titleKeySet(title) {
  return new Set(contentKeys(title));
}

function comoConjunto(title) {
  return title instanceof Set ? title : titleKeySet(title);
}

// -----------------------------------------------------------------------------
// tokenCoveredByTitle — o token (depois de normalizado e reduzido) aparece no
// título? `title` pode ser o texto ou o Set de titleKeySet.
// -----------------------------------------------------------------------------
function tokenCoveredByTitle(token, title) {
  const key = reduceMorphology(token);
  return key !== "" && comoConjunto(title).has(key);
}

// -----------------------------------------------------------------------------
// termCoverage — quanto de um termo (palavra ou expressão) o título já cobre.
//
// Conta tokens de CONTEÚDO do termo, sem repetição ("dia a dia" = 1 token).
//   {
//     totalTokens, coveredTokens,
//     coverage,            // coveredTokens / totalTokens (0..1)
//     uncoveredTokens,     // formas normalizadas dos tokens não cobertos
//     tokens: [{ original, normalized, key, covered }],
//   }
// Termo sem conteúdo (vazio ou só stopwords): totalTokens 0 e coverage 1 —
// não há nada nele que o título deixe de cobrir.
// -----------------------------------------------------------------------------
function termCoverage(term, title) {
  const chavesTitulo = comoConjunto(title);
  const vistos = new Set();
  const tokens = [];
  for (const t of extractTokens(term)) {
    if (t.stopword || vistos.has(t.key)) continue;
    vistos.add(t.key);
    tokens.push({ original: t.original, normalized: t.normalized, key: t.key, covered: chavesTitulo.has(t.key) });
  }
  const totalTokens = tokens.length;
  const coveredTokens = tokens.filter((t) => t.covered).length;
  return {
    totalTokens,
    coveredTokens,
    coverage: totalTokens === 0 ? 1 : coveredTokens / totalTokens,
    uncoveredTokens: tokens.filter((t) => !t.covered).map((t) => t.normalized),
    tokens,
  };
}

// -----------------------------------------------------------------------------
// termComplementarity — medida TEXTUAL (não é score de SEO): 1 − cobertura.
//   0 → o título já cobre o termo inteiro
//   1 → nada do termo está no título
// -----------------------------------------------------------------------------
function termComplementarity(term, title) {
  const c = termCoverage(term, title);
  return c.totalTokens === 0 ? 0 : (c.totalTokens - c.coveredTokens) / c.totalTokens;
}

// -----------------------------------------------------------------------------
// dedupeTerms — agrupa termos equivalentes, preservando o original.
//   [{ canonical, display, variants }]
// `canonical` = chaves de conteúdo em ordem ("tenis infantil"); `display` = a
// primeira variante vista; ordem dos grupos = ordem da primeira aparição.
// Sensível à ordem das palavras ("tênis infantil" ≠ "infantil tênis") —
// conservador. Termos sem conteúdo são ignorados.
// -----------------------------------------------------------------------------
function dedupeTerms(terms) {
  if (!Array.isArray(terms)) return [];
  const grupos = new Map();
  for (const termo of terms) {
    const original = texto(termo).trim();
    const canonical = contentKeys(original).join(" ");
    if (!canonical) continue;
    if (!grupos.has(canonical)) grupos.set(canonical, { canonical, display: original, variants: [] });
    grupos.get(canonical).variants.push(original);
  }
  return Array.from(grupos.values());
}

module.exports = {
  normalizeText,
  tokenize,
  normalizeToken,
  reduceMorphology,
  isStopword,
  extractTokens,
  contentKeys,
  comparisonKey,
  areEquivalent,
  titleKeySet,
  tokenCoveredByTitle,
  termCoverage,
  termComplementarity,
  dedupeTerms,
  STOPWORDS,
  INVARIAVEIS,
  GENERO,
};
