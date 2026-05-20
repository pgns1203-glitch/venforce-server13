// server/services/meliAnuncios/otimizadorMeliPrompts.js
// -----------------------------------------------------------------------------
// Prompts do Agente Otimizador Textual de Anúncios Meli.
//
// Reescritos para serem mais rigorosos, evitar invenção e gerar saída útil
// de verdade para um vendedor experiente de Mercado Livre Brasil.
//
// PROMPT_VERSION sobe a cada reescrita relevante — facilita comparar resultados
// antigos x novos nas linhas salvas em meli_anuncio_otimizacoes.
// -----------------------------------------------------------------------------

const PROMPT_VERSION = "meli-otimizador-v2";

// -----------------------------------------------------------------------------
// System prompt — vale para todos os tipos.
// -----------------------------------------------------------------------------
const SYSTEM_BASE = [
  "Você é um agente especialista em otimização de anúncios do Mercado Livre Brasil.",
  "Sua função é melhorar a parte textual dos anúncios (título, campo modelo,",
  "descrição e ficha técnica) a partir dos dados reais fornecidos.",
  "",
  "Você pensa como um vendedor experiente que:",
  "- conhece exatamente como compradores pesquisam no Mercado Livre;",
  "- sabe que título e campo modelo são decisivos para aparecer na busca;",
  "- escreve descrição que vende sem floreio;",
  "- preenche ficha técnica para gerar mais conversão.",
  "",
  "Regras inegociáveis:",
  "- Use APENAS informações presentes nos dados do anúncio. Não invente marca,",
  "  modelo, material, medidas, peso, voltagem, compatibilidade ou benefício.",
  "- Se um campo essencial estiver faltando, gere o melhor possível com o que",
  "  tem e ADICIONE um alerta sinalizando a lacuna.",
  "- Não altere o sentido do produto. Não exagere. Não prometa o que não está",
  "  nos dados (entrega rápida, garantia, qualidade premium...).",
  "- Nunca use emojis, negrito, itálico, HTML, markdown, asteriscos ou cercas",
  "  de código.",
  "- Não use linguagem genérica de IA: nada de 'produto de alta qualidade',",
  "  'tecnologia avançada', 'ideal para você', 'o melhor da categoria'.",
  "- Responda SEMPRE e SOMENTE com JSON válido. Sem cercas de código, sem",
  "  comentários, sem texto antes ou depois do JSON.",
].join("\n");

// -----------------------------------------------------------------------------
// Bloco de dados — versão enxuta (para SEO).
// Não inclui descrição inteira nem atributos vazios — corta tokens à toa.
// -----------------------------------------------------------------------------
function blocoDadosEnxuto(anuncio) {
  let attrs = [];
  try {
    attrs = Array.isArray(anuncio.attributes_json)
      ? anuncio.attributes_json
      : JSON.parse(anuncio.attributes_json || "[]");
  } catch (e) {
    attrs = [];
  }
  const preenchidos = attrs.filter((a) => a && a.value);

  const attrsTxt = preenchidos.length
    ? preenchidos
        .map((a) => "  - " + (a.name || a.id) + ": " + a.value)
        .join("\n")
    : "  (sem atributos preenchidos)";

  return [
    "Dados do anúncio:",
    "- Título atual: " + (anuncio.titulo || "(sem título)"),
    "  (" + (anuncio.titulo ? anuncio.titulo.length : 0) + " caracteres)",
    "- Campo modelo atual: " + (anuncio.modelo || "(vazio)"),
    "- Marca: " + (anuncio.marca || "(não informada)"),
    "- Categoria (id): " + (anuncio.category_id || "(não informada)"),
    "- SKU: " + (anuncio.sku || "(sem SKU)"),
    "- Preço: " + (anuncio.preco != null ? anuncio.preco : "(não informado)"),
    "Atributos preenchidos:",
    attrsTxt,
  ].join("\n");
}

// -----------------------------------------------------------------------------
// Bloco de dados — versão completa (para descrição e ficha técnica).
// Inclui descrição atual (truncada) e TODOS os atributos (vazios indicam
// lacuna a preencher na ficha técnica).
// -----------------------------------------------------------------------------
function blocoDadosCompleto(anuncio, descricaoAtual) {
  let attrs = [];
  try {
    attrs = Array.isArray(anuncio.attributes_json)
      ? anuncio.attributes_json
      : JSON.parse(anuncio.attributes_json || "[]");
  } catch (e) {
    attrs = [];
  }

  const attrsTxt = attrs.length
    ? attrs
        .map(
          (a) =>
            "  - " + (a.name || a.id || "?") + ": " + (a.value || "(vazio)")
        )
        .join("\n")
    : "  (nenhum atributo informado)";

  let desc = String(descricaoAtual || anuncio.descricao_atual || "").trim();
  if (desc.length > 1500) desc = desc.slice(0, 1500) + "\n[...truncado]";

  return [
    "Dados do anúncio:",
    "- Título atual: " + (anuncio.titulo || "(sem título)"),
    "- Campo modelo atual: " + (anuncio.modelo || "(vazio)"),
    "- Marca: " + (anuncio.marca || "(não informada)"),
    "- Categoria (id): " + (anuncio.category_id || "(não informada)"),
    "- SKU: " + (anuncio.sku || "(sem SKU)"),
    "- Preço: " + (anuncio.preco != null ? anuncio.preco : "(não informado)"),
    "Atributos (atuais):",
    attrsTxt,
    "Descrição atual:",
    desc ? desc : "  (sem descrição)",
  ].join("\n");
}

// =============================================================================
// SEO — 3 opções de título + campo modelo + score.
// =============================================================================
function promptSeo(anuncio) {
  return [
    "Tarefa: gerar 3 opções de TÍTULO Mercado Livre e o campo MODELO ideal.",
    "",
    "Como pensar (raciocínio interno antes de escrever a saída):",
    "1. Identifique exatamente o que o produto é (categoria principal).",
    "2. Liste 2-3 palavras-chave que um comprador realmente digitaria no",
    "   Mercado Livre para encontrar este produto.",
    "3. Construa cada título começando pela palavra-chave principal.",
    "4. Inclua diferenciais reais (tamanho, cor, kit, função) SOMENTE se",
    "   estiverem nos dados fornecidos.",
    "5. Use estratégias diferentes nas 3 opções:",
    "   - Opção 1: mais técnica/específica (modelo, especificação).",
    "   - Opção 2: mais comercial (benefício direto ao comprador).",
    "   - Opção 3: equilíbrio entre técnica e comercial.",
    "",
    "Regras do título (rígidas):",
    "- Máximo 60 caracteres por título. NUNCA ultrapassar.",
    "- Alvo: entre 55 e 60 caracteres sempre que houver informação para isso.",
    "- Não cortar palavras. Se 60 estourar, encurte uma palavra inteira.",
    "- Não usar caixa alta agressiva. 'Kit Puxador' está OK; 'KIT PUXADOR' não.",
    "- Não repetir a mesma palavra dentro do mesmo título.",
    "- Não usar pontuação decorativa (***, !!!, ★, ►, |, /).",
    "- Não inventar marca. Use a marca apenas se estiver no campo Marca ou",
    "  visível nos atributos.",
    "- As 3 opções devem ser claramente diferentes entre si — não pequenas",
    "  variações da mesma frase.",
    "",
    "Regras do campo modelo:",
    "- Lista de palavras-chave curtas relacionadas ao produto, separadas",
    "  por espaço (sem vírgula).",
    "- Termos que ajudam o Mercado Livre a indexar e ranquear o anúncio.",
    "- Não repetir o título inteiro. Complementa, não duplica.",
    "- Entre 30 e 60 caracteres no total.",
    "- Não inventar termos sem relação direta com o produto.",
    "",
    "Score SEO (0 a 100):",
    "- Avalia a MELHOR das 3 opções considerando: clareza, palavras-chave,",
    "  aproveitamento do limite de caracteres, ausência de invenção,",
    "  diferenciação em relação ao título atual.",
    "- Use 80-100 só para títulos realmente fortes.",
    "- Use 50-70 quando faltam dados.",
    "- Use abaixo de 50 quando o melhor possível ainda é fraco.",
    "",
    "Motivo:",
    "- 1 a 2 linhas explicando qual estratégia você usou na sugestão",
    "  principal e por que ela funciona neste anúncio.",
    "",
    "Alertas:",
    "- Liste lacunas relevantes (ex.: 'marca não informada — sugestões usam",
    "  apenas a categoria genérica', 'sem dimensões na ficha técnica').",
    "",
    blocoDadosEnxuto(anuncio),
    "",
    "Responda SOMENTE com este JSON, sem nada antes ou depois:",
    "{",
    '  "titulo_sugerido": "",',
    '  "titulo_sugerido_chars": 0,',
    '  "titulos_alternativos": ["", "", ""],',
    '  "modelo_sugerido": "",',
    '  "score_seo": 0,',
    '  "motivo": "",',
    '  "alertas": []',
    "}",
  ].join("\n");
}

// =============================================================================
// Descrição — blocos padronizados.
// =============================================================================
function promptDescricao(anuncio, descricaoAtual) {
  return [
    "Tarefa: gerar uma DESCRIÇÃO completa para o anúncio Mercado Livre,",
    "dividida em blocos padronizados.",
    "",
    "Estrutura obrigatória, nesta ordem exata, separada por UMA linha em branco:",
    "",
    "DESCRIÇÃO PRINCIPAL",
    "- 4 a 7 linhas de texto corrido, comercial e claro.",
    "- Mostre o que é o produto, pra quem serve e qual problema resolve.",
    "- Não enrole. Comece pelo mais importante (pirâmide invertida).",
    "",
    "DESTAQUES DO PRODUTO",
    "- Bullets iniciados com '• ' (caractere bullet seguido de espaço).",
    "- 4 a 7 itens.",
    "- Cada item é uma frase curta sobre uma característica ou benefício real.",
    "",
    "COMO USAR",
    "- Bullets com '• '. 3 a 5 itens.",
    "- Passos práticos de uso.",
    "- Se não fizer sentido para a categoria, escreva apenas:",
    "  '• Produto pronto para uso conforme características do fabricante.'",
    "",
    "ESPECIFICAÇÕES",
    "- Bullets com '• '.",
    "- Use APENAS dados da ficha técnica fornecida. Não invente.",
    "- Formato: '• Campo: valor'.",
    "- Se faltarem dados importantes, encerre o bloco com:",
    "  '• Demais especificações conforme ficha técnica do anúncio.'",
    "",
    "BENEFÍCIOS",
    "- Bullets com '• '. 3 a 5 itens.",
    "- Foque no que o comprador GANHA, não no produto em si.",
    "- Proibido: 'alta qualidade', 'tecnologia avançada', 'o melhor da",
    "  categoria', 'ideal para você' sem evidência nos dados.",
    "",
    "EXPERIÊNCIA DE COMPRA",
    "- 2 a 4 linhas de texto corrido, tom natural.",
    "- Não prometa prazo, garantia ou suporte específico sem dado.",
    "- Foque em facilidade de pedido, embalagem cuidadosa, atendimento.",
    "",
    "Regras gerais:",
    "- Sem HTML, sem emoji, sem negrito, sem markdown, sem asterisco.",
    "- Os títulos de bloco vão em CAIXA ALTA, em linha sozinha.",
    "- Não repita frases entre os blocos.",
    "- Não copie o título do anúncio inteiro dentro da descrição.",
    "- Máximo 2500 caracteres no total da descrição.",
    "- Use português brasileiro, comercial e direto.",
    "",
    "Melhorias:",
    "- Liste o que melhorou em relação à descrição atual. Se não havia",
    "  descrição, escreva 'Descrição criada do zero a partir dos dados.'",
    "",
    "Alertas:",
    "- Liste lacunas que impediram texto melhor (ex.: 'marca não informada',",
    "  'sem dimensões cadastradas', 'descrição atual genérica').",
    "",
    blocoDadosCompleto(anuncio, descricaoAtual),
    "",
    "Responda SOMENTE com este JSON, sem nada antes ou depois:",
    "{",
    '  "descricao_sugerida": "",',
    '  "melhorias": [],',
    '  "alertas": []',
    "}",
  ].join("\n");
}

// =============================================================================
// Ficha técnica — sugestões cautelosas com nível de confiança.
// =============================================================================
function promptFichaTecnica(anuncio, descricaoAtual) {
  return [
    "Tarefa: analisar a FICHA TÉCNICA atual do anúncio e sugerir melhorias",
    "ou preenchimento de campos faltantes.",
    "",
    "Como pensar:",
    "1. Liste os atributos atuais. Para cada um vazio, tente inferir do",
    "   título, descrição ou outros atributos — com cuidado.",
    "2. Para atributos preenchidos com valor estranho ou genérico, sugira",
    "   melhoria com confiança 'media' ou 'baixa'.",
    "3. Atributos preenchidos corretamente: NÃO inclua na resposta.",
    "4. Priorize atributos importantes (marca, modelo, material, cor,",
    "   tamanho, peso, voltagem, quantidade, dimensões).",
    "",
    "Para cada sugestão, retorne:",
    "- campo: nome do atributo (use o name dos dados quando houver).",
    "- valor_atual: o valor atualmente preenchido ou '(vazio)'.",
    "- valor_sugerido: sua sugestão. Se não puder inferir com segurança,",
    "  use '(deixar manual)'.",
    "- confianca:",
    "    'alta'  = dado claro no título/descrição/outros atributos.",
    "    'media' = inferência razoável mas não explícita.",
    "    'baixa' = inferência fraca, exige conferência humana.",
    "- motivo: 1 linha explicando de onde veio a sugestão.",
    "- precisa_revisao: true se o gestor precisa conferir antes de aplicar.",
    "",
    "Regras inegociáveis:",
    "- Não invente material, medida, peso, voltagem, compatibilidade ou marca.",
    "- Se a inferência for fraca: confianca 'baixa' e precisa_revisao=true.",
    "- Se não houver dado nenhum: valor_sugerido='(deixar manual)' e",
    "  precisa_revisao=true.",
    "- Não substitua um valor atual correto sem motivo claro.",
    "- Máximo 12 sugestões — foque nos atributos mais importantes.",
    "",
    "Alertas:",
    "- Liste limitações estruturais (ex.: 'categoria genérica impede inferir",
    "  atributos específicos', 'descrição vaga não permite identificar",
    "  material').",
    "",
    blocoDadosCompleto(anuncio, descricaoAtual),
    "",
    "Responda SOMENTE com este JSON, sem nada antes ou depois:",
    "{",
    '  "ficha_tecnica_sugerida": [',
    "    {",
    '      "campo": "",',
    '      "valor_atual": "",',
    '      "valor_sugerido": "",',
    '      "confianca": "alta",',
    '      "motivo": "",',
    '      "precisa_revisao": true',
    "    }",
    "  ],",
    '  "alertas": []',
    "}",
  ].join("\n");
}

// -----------------------------------------------------------------------------
// Resolve o prompt pelo tipo. Retorna null se o tipo não for suportado.
// -----------------------------------------------------------------------------
function montarPrompt(tipo, anuncio, extras) {
  extras = extras || {};
  switch (tipo) {
    case "seo":
      return promptSeo(anuncio);
    case "descricao":
      return promptDescricao(anuncio, extras.descricaoAtual);
    case "ficha_tecnica":
      return promptFichaTecnica(anuncio, extras.descricaoAtual);
    default:
      return null;
  }
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_BASE,
  montarPrompt,
  promptSeo,
  promptDescricao,
  promptFichaTecnica,
};
