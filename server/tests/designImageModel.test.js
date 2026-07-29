// server/tests/designImageModel.test.js
// Núcleo do editor de imagem do Estúdio de Templates, exercitado sem navegador:
// migração V1 -> V2, validação de arquivo, limites dos ajustes, desfazer/refazer,
// restaurar original, cancelar sem efeito colateral, aplicar edição, coleta de
// órfãos e as três camadas do armazenamento local (IndexedDB, localStorage,
// memória) — incluindo quota estourada e IndexedDB indisponível.

const assert = require("assert");
const model = require("../../Portal/design-image-model");
const storageLib = require("../../Portal/design-image-storage");
const apiLib = require("../../Portal/design-image-api");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

/* ── fixtures ─────────────────────────────────────────────────────────── */

// PNG 1x1 transparente de verdade (não é placeholder).
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const JPEG_FAKE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAg=";

function projetoV1() {
  return {
    version: 1,
    templateId: "portable-charger-complete-v1",
    clienteNome: "Cliente Antigo",
    product: {
      name: "Produto",
      imageDataUrl: PNG_1X1,
      fileName: "foto.png",
      scale: 130,
      x: 40,
      y: 70,
    },
    logoDataUrl: JPEG_FAKE,
    logoFileName: "logo.jpg",
  };
}

let contador = 0;
const idDeterministico = (prefix) => `${prefix}-${++contador}`;

/* ── fake de IndexedDB ────────────────────────────────────────────────── */

// Implementa só o que o storage usa: open/upgrade, transaction, put/get/
// delete/getAllKeys, e os callbacks onsuccess/onerror/oncomplete/onabort.
function criarFakeIndexedDb(opcoes) {
  const config = opcoes || {};
  const dados = new Map();

  function agendar(fn) {
    setTimeout(fn, 0);
  }

  function criarRequest(executar) {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    agendar(() => {
      try {
        req.result = executar();
        if (req.onsuccess) req.onsuccess();
      } catch (error) {
        req.error = error;
        if (req.onerror) req.onerror();
      }
    });
    return req;
  }

  const store = {
    put(registro) {
      return criarRequest(() => {
        if (config.quotaAoGravar) {
          const erro = new Error("quota");
          erro.name = "QuotaExceededError";
          throw erro;
        }
        dados.set(registro.id, registro);
        return registro.id;
      });
    },
    get(id) { return criarRequest(() => dados.get(id)); },
    delete(id) { return criarRequest(() => { dados.delete(id); return undefined; }); },
    getAllKeys() { return criarRequest(() => [...dados.keys()]); },
  };

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => store,
    transaction() {
      const tx = { error: null, oncomplete: null, onerror: null, onabort: null, objectStore: () => store };
      // A transação só completa depois dos requests: dois ticks de macrotask.
      agendar(() => agendar(() => {
        if (config.quotaAoGravar) {
          const erro = new Error("quota");
          erro.name = "QuotaExceededError";
          tx.error = erro;
          if (tx.onabort) tx.onabort();
          return;
        }
        if (tx.oncomplete) tx.oncomplete();
      }));
      return tx;
    },
    close() {},
  };

  return {
    _dados: dados,
    open() {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      agendar(() => {
        if (config.falhaAoAbrir) {
          req.error = new Error("sem indexeddb");
          if (req.onerror) req.onerror();
          return;
        }
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}

function criarFakeLocalStorage(opcoes) {
  const config = opcoes || {};
  const mapa = new Map();
  return {
    get length() { return mapa.size; },
    key(index) { return [...mapa.keys()][index] ?? null; },
    getItem(chave) { return mapa.has(chave) ? mapa.get(chave) : null; },
    setItem(chave, valor) {
      if (config.quota) {
        const erro = new Error("quota");
        erro.name = "QuotaExceededError";
        throw erro;
      }
      mapa.set(chave, String(valor));
    },
    removeItem(chave) { mapa.delete(chave); },
    _mapa: mapa,
  };
}

/* ── suíte ────────────────────────────────────────────────────────────── */

(async () => {
  console.log("\n=== Editor de imagem — núcleo ===\n");

  /* 1. Migração do schema V1 */

  eq("1. schema V1 é detectado pela ausência de version >= 2", model.detectSchemaVersion(projetoV1()), 1);
  eq("2. schema V2 é detectado", model.detectSchemaVersion({ version: 2 }), 2);
  eq("3. projeto inexistente não tem schema", model.detectSchemaVersion(null), null);

  contador = 0;
  const migrado = model.migrateImagesFromV1(projetoV1(), { makeId: idDeterministico });
  eq("4. imagem V1 vira originalImage com id próprio", migrado.product.originalImage.id, "prod-1");
  eq("5. base64 do V1 é preservado na migração", migrado.product.originalImage.dataUrl, PNG_1X1);
  eq("6. nome do arquivo sobrevive à migração", migrado.product.originalImage.fileName, "foto.png");
  eq("7. escala/posição do V1 viram placement", migrado.product.placement, { scale: 130, x: 40, y: 70 });
  eq("8. projeto migrado começa sem imagem editada", migrado.product.editedImage.id, null);
  eq("9. projeto migrado começa com ajustes neutros", model.isNeutralEditing(migrado.product.editing), true);
  eq("10. logo do V1 é migrado", migrado.logo.dataUrl, JPEG_FAKE);

  const v1SemImagem = projetoV1();
  v1SemImagem.product.imageDataUrl = null;
  v1SemImagem.logoDataUrl = null;
  const migradoVazio = model.migrateImagesFromV1(v1SemImagem, { makeId: idDeterministico });
  eq("11. projeto V1 sem imagem migra sem inventar id", migradoVazio.product.originalImage.id, null);

  const v1ComSvg = projetoV1();
  v1ComSvg.logoDataUrl = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
  const migradoSvg = model.migrateImagesFromV1(v1ComSvg, { makeId: idDeterministico });
  ok("12. logo SVG antigo é descartado e sinalizado", migradoSvg.logo.dataUrl === null && migradoSvg.logoDescartado === true);

  const v1ForaDeFaixa = projetoV1();
  v1ForaDeFaixa.product.scale = 9999;
  v1ForaDeFaixa.product.x = -50;
  eq(
    "13. placement fora de faixa é grampeado na migração",
    model.migrateImagesFromV1(v1ForaDeFaixa, { makeId: idDeterministico }).product.placement,
    { scale: 145, x: 20, y: 70 }
  );

  /* 2. Validação de arquivo */

  ok("14. PNG dentro do limite é aceito", model.validateImageFile({ name: "a.png", type: "image/png", size: 1024 }).ok);
  eq(
    "15. SVG é recusado com código próprio",
    model.validateImageFile({ name: "a.svg", type: "image/svg+xml", size: 10 }).codigo,
    "SVG_NAO_SUPORTADO"
  );
  eq(
    "16. GIF (fora da lista) é recusado",
    model.validateImageFile({ name: "a.gif", type: "image/gif", size: 10 }).codigo,
    "TIPO_INVALIDO"
  );
  eq(
    "17. extensão que não bate com o MIME é recusada",
    model.validateImageFile({ name: "malware.exe", type: "image/png", size: 10 }).codigo,
    "EXTENSAO_INVALIDA"
  );
  eq(
    "18. arquivo acima de 8 MB é recusado no modo servidor",
    model.validateImageFile({ name: "a.png", type: "image/png", size: 9 * 1024 * 1024 }).codigo,
    "ARQUIVO_GRANDE"
  );
  ok(
    "19. 3 MB passa no modo servidor e falha no modo local",
    model.validateImageFile({ name: "a.png", type: "image/png", size: 3 * 1024 * 1024 }).ok === true
    && model.validateImageFile({ name: "a.png", type: "image/png", size: 3 * 1024 * 1024 }, { mode: "local" }).ok === false
  );
  eq(
    "20. arquivo vazio é recusado",
    model.validateImageFile({ name: "a.png", type: "image/png", size: 0 }).codigo,
    "ARQUIVO_VAZIO"
  );
  eq("21. nome de arquivo com caminho é reduzido ao nome", model.sanitizeFileName("../../etc/foto.png"), "foto.png");
  ok("22. data URL inválida é recusada", !model.isDataImageUrl("javascript:alert(1)") && !model.isDataImageUrl("data:image/svg+xml;base64,AAA"));
  ok("23. resolução baixa é sinalizada abaixo de 600 px", model.isLowResolution(400, 1200) && !model.isLowResolution(800, 900));

  /* 3. Limites de brilho, contraste e saturação */

  const extremo = model.normalizeEditing({
    brightness: 5000, contrast: -5000, saturation: 999, sharpen: -10,
    scale: 100000, rotation: 725, backgroundColor: "javascript:alert(1)",
    shadow: { enabled: true, blur: 9999, offsetX: -9999, offsetY: 9999, opacity: 500 },
  });
  eq("24. brilho é grampeado em +100", extremo.brightness, 100);
  eq("25. contraste é grampeado em -100", extremo.contrast, -100);
  eq("26. saturação é grampeada em +100", extremo.saturation, 100);
  eq("27. nitidez nunca fica negativa", extremo.sharpen, 0);
  eq("28. escala é grampeada em 400%", extremo.scale, 400);
  eq("29. rotação dá a volta em 360°", extremo.rotation, 5);
  eq("30. cor de fundo inválida vira transparente", extremo.backgroundColor, "transparent");
  eq("31. sombra é grampeada em todos os eixos", extremo.shadow, { enabled: true, blur: 100, offsetX: -100, offsetY: 100, opacity: 100 });
  eq("32. rotação negativa é normalizada para 0..360", model.normalizeRotation(-90), 270);
  eq("33. crop degenerado é descartado", model.normalizeCrop({ x: 0, y: 0, width: 0, height: 10 }), null);
  eq("34. crop válido é arredondado para inteiros", model.normalizeCrop({ x: 1.4, y: 2.6, width: 10.2, height: 20.7 }), { x: 1, y: 3, width: 10, height: 21 });

  /* 4. Desfazer e refazer */

  let historico = model.createHistory(model.createDefaultEditing());
  ok("35. histórico novo não permite desfazer nem refazer", !model.canUndo(historico) && !model.canRedo(historico));

  historico = model.historyPush(historico, { ...model.createDefaultEditing(), brightness: 25 });
  historico = model.historyPush(historico, { ...model.createDefaultEditing(), brightness: 25, contrast: 40 });
  eq("36. estado atual é o último empilhado", model.historyCurrent(historico).contrast, 40);
  ok("37. desfazer volta um passo", model.historyCurrent(model.historyUndo(historico)).contrast === 0
    && model.historyCurrent(model.historyUndo(historico)).brightness === 25);
  ok("38. refazer devolve o passo desfeito",
    model.historyCurrent(model.historyRedo(model.historyUndo(historico))).contrast === 40);

  const semMudanca = model.historyPush(historico, model.historyCurrent(historico));
  eq("39. empilhar o mesmo estado não cria entrada", semMudanca.entries.length, historico.entries.length);

  const ramificado = model.historyPush(model.historyUndo(historico), { ...model.createDefaultEditing(), saturation: 10 });
  ok("40. nova edição depois de desfazer descarta o futuro", !model.canRedo(ramificado) && ramificado.entries.length === 3);

  let limitado = model.createHistory(model.createDefaultEditing(), { limit: 4 });
  for (let i = 1; i <= 10; i += 1) {
    limitado = model.historyPush(limitado, { ...model.createDefaultEditing(), brightness: i });
  }
  ok("41. histórico respeita o limite e mantém o estado atual",
    limitado.entries.length === 4 && model.historyCurrent(limitado).brightness === 10);

  const pesoHistorico = JSON.stringify(limitado);
  ok("42. histórico não guarda imagem (nenhum data URL nas entradas)",
    !pesoHistorico.includes("data:image") && pesoHistorico.length < 4000);

  /* 5. Restauração da imagem original */

  const produtoEditado = model.normalizeProductImages({
    originalImage: { id: "orig-1", dataUrl: PNG_1X1, fileName: "foto.png", mimeType: "image/png", width: 900, height: 900 },
    editedImage: { id: "edit-1", dataUrl: JPEG_FAKE, mimeType: "image/jpeg", width: 1200, height: 1200 },
    editing: { brightness: 40, crop: { x: 0, y: 0, width: 100, height: 100 } },
    placement: { scale: 120, x: 45, y: 55 },
  });

  const restaurado = model.restoreOriginalImage(produtoEditado);
  ok("43. restaurar limpa a imagem editada", restaurado.editedImage.id === null && restaurado.editedImage.dataUrl === null);
  ok("44. restaurar zera os ajustes", model.isNeutralEditing(restaurado.editing));
  eq("45. restaurar preserva o arquivo original", restaurado.originalImage.dataUrl, PNG_1X1);
  eq("46. restaurar preserva o enquadramento na peça", restaurado.placement, { scale: 120, x: 45, y: 55 });
  eq("47. a fonte volta a ser a imagem original", model.resolveProductImageSource(restaurado), PNG_1X1);

  /* 6. Cancelamento sem alterar o projeto */

  const sessao = model.createEditingSession(produtoEditado);
  const snapshotAntes = JSON.stringify(produtoEditado);
  ok("48. sessão nova não tem alterações pendentes", !model.sessionHasChanges(sessao));

  sessao.history = model.historyPush(sessao.history, { ...model.sessionEditing(sessao), brightness: -80 });
  ok("49. mexer na sessão marca alterações pendentes", model.sessionHasChanges(sessao));
  eq("50. cancelar (descartar a sessão) não muda o produto", JSON.stringify(produtoEditado), snapshotAntes);

  /* 7. Aplicação da imagem editada */

  contador = 0;
  const aplicado = model.applyEditingToProduct(
    produtoEditado,
    { ...model.createDefaultEditing(), brightness: 30 },
    { dataUrl: PNG_1X1, width: 1200, height: 1200 },
    { makeId: idDeterministico }
  );
  eq("51. aplicar gera imagem editada com id novo", aplicado.editedImage.id, "edit-1");
  eq("52. aplicar registra as dimensões da peça", [aplicado.editedImage.width, aplicado.editedImage.height], [1200, 1200]);
  eq("53. as 7 peças passam a usar a imagem editada", model.resolveProductImageSource(aplicado), PNG_1X1);
  eq("54. a imagem original continua intacta após aplicar", aplicado.originalImage.dataUrl, PNG_1X1);
  eq("55. aplicar preserva o enquadramento na peça", aplicado.placement, { scale: 120, x: 45, y: 55 });
  eq("56. aplicar guarda os parâmetros usados", aplicado.editing.brightness, 30);

  const aplicadoNeutro = model.applyEditingToProduct(
    produtoEditado,
    model.createDefaultEditing(),
    { dataUrl: PNG_1X1, width: 1200, height: 1200 },
    { makeId: idDeterministico }
  );
  ok("57. edição neutra descarta a imagem derivada", aplicadoNeutro.editedImage.id === null
    && model.resolveProductImageSource(aplicadoNeutro) === PNG_1X1);

  const semOriginal = model.applyEditingToProduct(
    model.createDefaultProduct(),
    { ...model.createDefaultEditing(), brightness: 30 },
    { dataUrl: PNG_1X1, width: 1200, height: 1200 }
  );
  ok("58. aplicar sem imagem original não cria nada", semOriginal.editedImage.id === null && model.isNeutralEditing(semOriginal.editing));

  const limpo = model.clearProductImage(aplicado);
  ok("59. remover imagem limpa original, editada e ajustes",
    limpo.originalImage.id === null && limpo.editedImage.id === null && model.isNeutralEditing(limpo.editing));

  /* 8. Separação leve/pesado e órfãos */

  const projetoCompleto = {
    version: 2,
    product: aplicado,
    logo: model.normalizeImageRef({ id: "logo-1", dataUrl: JPEG_FAKE, mimeType: "image/jpeg" }),
    content: { benefit: "texto" },
  };
  const separado = model.splitProjectForStorage(projetoCompleto);
  ok("60. o projeto leve não carrega nenhum data URL", !JSON.stringify(separado.leve).includes("data:image"));
  eq("61. os blobs saem separados com seus ids", separado.blobs.map((b) => b.id).sort(), ["edit-1", "logo-1", "orig-1"]);
  ok("62. o projeto leve mantém os ids para reidratar",
    separado.leve.product.originalImage.id === "orig-1" && separado.leve.logo.id === "logo-1");
  ok("63. o projeto original não é mutado pela separação", projetoCompleto.product.originalImage.dataUrl === PNG_1X1);
  eq("64. collectImageIds lista só o que está vivo", model.collectImageIds(projetoCompleto).sort(), ["edit-1", "logo-1", "orig-1"]);
  eq(
    "65. órfãos são os ids guardados que ninguém referencia",
    model.collectOrphanIds(projetoCompleto, ["orig-1", "edit-1", "logo-1", "velho-1", "velho-2"]).sort(),
    ["velho-1", "velho-2"]
  );

  /* 9. Armazenamento — IndexedDB */

  const comIdb = storageLib.createImageStorage({
    indexedDB: criarFakeIndexedDb(),
    localStorage: criarFakeLocalStorage(),
  });
  eq("66. com IndexedDB disponível é ele que é usado", await comIdb.tipo(), "indexeddb");
  await comIdb.salvar("orig-1", PNG_1X1);
  await comIdb.salvar("velho-1", JPEG_FAKE);
  eq("67. o blob salvo é lido de volta igual", await comIdb.ler("orig-1"), PNG_1X1);
  eq("68. id inexistente devolve null sem lançar", await comIdb.ler("nao-existe"), null);
  eq("69. limparOrfaos apaga só o que não está vivo", (await comIdb.limparOrfaos(["orig-1"])).sort(), ["velho-1"]);
  eq("70. o blob vivo continua lá depois da limpeza", await comIdb.ler("orig-1"), PNG_1X1);
  eq("71. remover apaga o blob", await (async () => { await comIdb.remover("orig-1"); return comIdb.ler("orig-1"); })(), null);
  eq("72. armazenamento com IndexedDB é persistente", await comIdb.persistente(), true);

  /* 10. Armazenamento — quota estourada */

  const comQuota = storageLib.createImageStorage({
    indexedDB: criarFakeIndexedDb({ quotaAoGravar: true }),
    localStorage: criarFakeLocalStorage(),
  });
  let codigoQuota = null;
  try {
    await comQuota.salvar("x", PNG_1X1);
  } catch (error) {
    codigoQuota = error.codigo;
  }
  eq("73. quota estourada vira erro QUOTA_EXCEDIDA", codigoQuota, "QUOTA_EXCEDIDA");

  /* 11. Armazenamento — IndexedDB indisponível */

  const local = criarFakeLocalStorage();
  const semIdb = storageLib.createImageStorage({
    indexedDB: criarFakeIndexedDb({ falhaAoAbrir: true }),
    localStorage: local,
  });
  eq("74. sem IndexedDB o fallback é o localStorage", await semIdb.tipo(), "localstorage");
  await semIdb.salvar("orig-2", PNG_1X1);
  eq("75. o fallback lê e escreve normalmente", await semIdb.ler("orig-2"), PNG_1X1);
  ok("76. o fallback usa prefixo próprio no localStorage",
    [...local._mapa.keys()].every((chave) => chave.startsWith(storageLib.FALLBACK_PREFIX)));
  eq("77. listarIds no fallback devolve os ids sem prefixo", await semIdb.listarIds(), ["orig-2"]);
  ok("78. a seleção do backend registra o motivo da queda", semIdb.avisos().length > 0);

  let codigoGrande = null;
  try {
    await semIdb.salvar("gigante", `data:image/png;base64,${"A".repeat(storageLib.FALLBACK_MAX_BYTES + 10)}`);
  } catch (error) {
    codigoGrande = error.codigo;
  }
  eq("79. no fallback a imagem grande é recusada com aviso claro", codigoGrande, "IMAGEM_GRANDE_DEMAIS");

  /* 12. Armazenamento — nada disponível */

  const semNada = storageLib.createImageStorage({ indexedDB: null, localStorage: null });
  eq("80. sem IndexedDB e sem localStorage sobra a memória", await semNada.tipo(), "memoria");
  eq("81. o modo memória não se diz persistente", await semNada.persistente(), false);
  await semNada.salvar("m-1", PNG_1X1);
  eq("82. o modo memória ainda serve a sessão atual", await semNada.ler("m-1"), PNG_1X1);

  const localComQuota = storageLib.createImageStorage({
    indexedDB: null,
    localStorage: criarFakeLocalStorage({ quota: true }),
  });
  eq("83. localStorage que recusa tudo cai para memória", await localComQuota.tipo(), "memoria");

  /* 13. Cliente HTTP */

  const capacidadesVazias = apiLib.normalizarCapacidades(null);
  eq("84. capacidades ausentes viram todas falsas", Object.values(capacidadesVazias).every((v) => v === false), true);
  eq("85. capacidades desconhecidas são ignoradas",
    Object.keys(apiLib.normalizarCapacidades({ removeBackground: true, hackear: true })).includes("hackear"), false);
  eq("86. algumaCapacidadeAtiva reflete o estado", apiLib.algumaCapacidadeAtiva({ removeBackground: true }), true);

  const chamadas = [];
  const apiOk = apiLib.createDesignImageApi({
    baseUrl: "https://servidor.exemplo",
    getToken: () => "token-123",
    fetch: async (url, init) => {
      chamadas.push({ url, headers: init.headers, method: init.method });
      return { ok: true, status: 200, json: async () => ({ ok: true, imagem: { dataUrl: PNG_1X1, width: 800, height: 600 } }) };
    },
    FormData: class { constructor() { this.campos = []; } append(k, v) { this.campos.push([k, v]); } },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
  });
  const normalizada = await apiOk.normalizar({ name: "a.png", size: 10, type: "image/png" });
  eq("87. normalizar devolve a imagem do servidor", normalizada.dataUrl, PNG_1X1);
  eq("88. a chamada vai para o endpoint certo", chamadas[0].url, "https://servidor.exemplo/design/imagens/normalizar");
  eq("89. o token do Portal é enviado no Authorization", chamadas[0].headers.Authorization, "Bearer token-123");

  const apiErro = apiLib.createDesignImageApi({
    baseUrl: "",
    fetch: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, erro: "SVG não é aceito", codigo: "SVG_NAO_SUPORTADO" }) }),
    FormData: class { append() {} },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
  });
  let erroApi = null;
  try {
    await apiErro.normalizar({ name: "a.svg", size: 10, type: "image/svg+xml" });
  } catch (error) {
    erroApi = error;
  }
  ok("90. erro do servidor preserva código e mensagem",
    erroApi && erroApi.codigo === "SVG_NAO_SUPORTADO" && erroApi.status === 400 && erroApi.message === "SVG não é aceito");

  const apiOffline = apiLib.createDesignImageApi({
    baseUrl: "",
    fetch: async () => { throw new TypeError("Failed to fetch"); },
    FormData: class { append() {} },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
  });
  let erroRede = null;
  try {
    await apiOffline.normalizar({ name: "a.png", size: 10, type: "image/png" });
  } catch (error) {
    erroRede = error;
  }
  eq("91. servidor fora do ar vira REDE_INDISPONIVEL (a tela cai para o modo local)", erroRede && erroRede.codigo, "REDE_INDISPONIVEL");

  const estadoIa = await apiOffline.capacidadesIa();
  ok("92. endpoint de IA indisponível não lança e devolve tudo desligado",
    estadoIa.disponivel === false && Object.values(estadoIa.capacidades).every((v) => v === false));

  console.log(`\n${checks} verificações passaram no núcleo do editor de imagem.`);
})().catch((error) => { console.error(error); process.exit(1); });
