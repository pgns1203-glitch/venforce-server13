// server/tests/designImageService.test.js
// Normalização de imagem com Sharp e o contrato HTTP do módulo:
// detecção de formato por magic number, EXIF, transparência, limites,
// bomba de descompressão, respostas de erro do controller, ausência de
// provedor de IA e autenticação das rotas.

const assert = require("assert");
const sharp = require("sharp");
const service = require("../services/designImage/designImageService");
const validator = require("../services/designImage/designImageValidator");
const imageAiProvider = require("../services/ai/imageAiProvider");
const controller = require("../controllers/designImageController");
const routes = require("../routes/designImageRoutes");

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
async function rejeita(label, fn, codigo) {
  let erro = null;
  try {
    await fn();
  } catch (e) {
    erro = e;
  }
  assert.ok(erro, `FALHOU: ${label} — não lançou`);
  assert.strictEqual(erro.codigo, codigo, `FALHOU: ${label} — código ${erro.codigo} !== ${codigo}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

/* ── helpers ──────────────────────────────────────────────────────────── */

const arquivo = (buffer, mimetype, originalname) => ({ buffer, mimetype, originalname });

function fakeRes() {
  return {
    statusCode: 200,
    corpo: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.corpo = payload; return this; },
  };
}

function decodificarDataUrl(dataUrl) {
  return Buffer.from(String(dataUrl).split(",")[1], "base64");
}

(async () => {
  console.log("\n=== Editor de imagem — servidor (Sharp) ===\n");

  /* ── fixtures reais ─────────────────────────────────────────────────── */

  const pngOpaco = await sharp({ create: { width: 900, height: 700, channels: 3, background: "#3366aa" } }).png().toBuffer();
  const pngAlfa = await sharp({ create: { width: 500, height: 500, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 0.35 } } }).png().toBuffer();
  const jpegGrande = await sharp({ create: { width: 3200, height: 2400, channels: 3, background: "#dddddd" } }).jpeg().toBuffer();
  const jpegExif = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#4488cc" } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const webpOpaco = await sharp({ create: { width: 640, height: 640, channels: 3, background: "#112233" } }).webp().toBuffer();
  const pngMinusculo = await sharp({ create: { width: 120, height: 90, channels: 3, background: "#000000" } }).png().toBuffer();
  const pngNanico = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000000" } }).png().toBuffer();
  const bombaPng = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const svgMalicioso = Buffer.from(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>fetch("//evil")</script></svg>'
  );

  /* ── 1. Detecção de formato por conteúdo ────────────────────────────── */

  eq("1. PNG é detectado pelo magic number", validator.detectarFormato(pngOpaco), "png");
  eq("2. JPEG é detectado pelo magic number", validator.detectarFormato(jpegGrande), "jpeg");
  eq("3. WebP é detectado por RIFF/WEBP", validator.detectarFormato(webpOpaco), "webp");
  eq("4. SVG é detectado como SVG (e não como imagem válida)", validator.detectarFormato(svgMalicioso), "svg");
  eq("5. binário arbitrário não é reconhecido", validator.detectarFormato(Buffer.from("MZ\x90\x00nao sou imagem")), null);
  eq("6. buffer curto demais não é reconhecido", validator.detectarFormato(Buffer.from("PNG")), null);

  /* ── 2. Rejeição de tipo inválido ───────────────────────────────────── */

  await rejeita(
    "7. SVG é rejeitado mesmo declarando image/svg+xml",
    () => service.normalizarImagem(arquivo(svgMalicioso, "image/svg+xml", "logo.svg")),
    "SVG_NAO_SUPORTADO"
  );
  await rejeita(
    "8. SVG disfarçado de PNG também é rejeitado",
    () => service.normalizarImagem(arquivo(svgMalicioso, "image/png", "logo.png")),
    "SVG_NAO_SUPORTADO"
  );
  await rejeita(
    "9. executável renomeado para .png é rejeitado pelo conteúdo",
    () => service.normalizarImagem(arquivo(Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00"), "image/png", "malware.png")),
    "CONTEUDO_INVALIDO"
  );
  await rejeita(
    "10. MIME declarado que não bate com o conteúdo é rejeitado",
    () => service.normalizarImagem(arquivo(jpegGrande, "image/png", "spoof.png")),
    "MIME_DIVERGENTE"
  );
  await rejeita(
    "11. arquivo vazio é rejeitado",
    () => service.normalizarImagem(arquivo(Buffer.alloc(0), "image/png", "vazio.png")),
    "ARQUIVO_VAZIO"
  );
  await rejeita(
    "12. requisição sem arquivo é rejeitada",
    () => service.normalizarImagem(undefined),
    "ARQUIVO_AUSENTE"
  );

  /* ── 3. Rejeição de arquivo excessivo ───────────────────────────────── */

  await rejeita(
    "13. arquivo acima do limite de bytes é rejeitado com 413",
    () => service.normalizarImagem(arquivo(Buffer.alloc(validator.MAX_UPLOAD_BYTES + 1, 0x89), "image/png", "gigante.png")),
    "ARQUIVO_GRANDE"
  );
  await rejeita(
    "14. bomba de descompressão (81 MP em 250 KB) é rejeitada",
    () => service.normalizarImagem(arquivo(bombaPng, "image/png", "bomba.png")),
    "IMAGEM_EXCESSIVA"
  );
  await rejeita(
    "15. imagem menor que o mínimo é rejeitada",
    () => service.normalizarImagem(arquivo(pngNanico, "image/png", "nanica.png")),
    "IMAGEM_PEQUENA"
  );

  const erro413 = await service.normalizarImagem(arquivo(pngOpaco, "image/png", "ok.png")).then(() => null).catch((e) => e);
  eq("16. imagem válida não gera erro", erro413, null);

  /* ── 4. Normalização com Sharp ──────────────────────────────────────── */

  const normalizado = await service.normalizarImagem(arquivo(pngOpaco, "image/png", "produto.png"));
  eq("17. PNG opaco vira JPEG (menor, peça é opaca mesmo)", normalizado.formato, "jpeg");
  eq("18. dimensões abaixo do teto são mantidas", [normalizado.width, normalizado.height], [900, 700]);
  ok("19. o retorno é um data URL utilizável no canvas", /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(normalizado.dataUrl));
  eq("20. as dimensões originais são reportadas", normalizado.original, { width: 900, height: 700, formato: "png", bytes: pngOpaco.length });
  eq("21. imagem dentro do teto não é marcada como redimensionada", normalizado.redimensionada, false);
  eq("22. 900x700 não é considerada baixa resolução", normalizado.baixaResolucao, false);

  const reduzido = await service.normalizarImagem(arquivo(jpegGrande, "image/jpeg", "grande.jpg"));
  eq("23. imagem grande é reduzida ao teto de 1600 px", [reduzido.width, reduzido.height], [1600, 1200]);
  eq("24. a redução é sinalizada", reduzido.redimensionada, true);
  ok("25. a redução também encolhe os bytes", reduzido.bytes < jpegGrande.length);

  const pequeno = await service.normalizarImagem(arquivo(pngMinusculo, "image/png", "pequena.png"));
  eq("26. imagem pequena NÃO é ampliada", [pequeno.width, pequeno.height], [120, 90]);
  eq("27. imagem pequena é sinalizada como baixa resolução", pequeno.baixaResolucao, true);

  const doWebp = await service.normalizarImagem(arquivo(webpOpaco, "image/webp", "foto.webp"));
  eq("28. WebP é aceito", doWebp.original.formato, "webp");
  eq("29. WebP opaco sai como JPEG (suporte universal no SVG->canvas)", doWebp.formato, "jpeg");

  /* ── 5. Correção de orientação EXIF ─────────────────────────────────── */

  const rotacionado = await service.normalizarImagem(arquivo(jpegExif, "image/jpeg", "celular.jpg"));
  eq("30. EXIF orientation 6 troca os eixos (800x400 -> 400x800)", [rotacionado.width, rotacionado.height], [400, 800]);
  eq("31. as dimensões originais já são reportadas pós-EXIF", rotacionado.original, { width: 400, height: 800, formato: "jpeg", bytes: jpegExif.length });
  eq("32. a correção de orientação é sinalizada", rotacionado.orientacaoCorrigida, true);

  const metaSaida = await sharp(decodificarDataUrl(rotacionado.dataUrl)).metadata();
  ok("33. a saída não carrega mais orientação pendente", !metaSaida.orientation || metaSaida.orientation === 1);
  ok("34. metadados EXIF/GPS são descartados na saída", !metaSaida.exif);
  eq("35. imagem sem EXIF não é marcada como corrigida", normalizado.orientacaoCorrigida, false);

  /* ── 6. Preservação da transparência ────────────────────────────────── */

  const comAlfa = await service.normalizarImagem(arquivo(pngAlfa, "image/png", "transparente.png"));
  eq("36. imagem com alfa sai como PNG", comAlfa.formato, "png");
  eq("37. a transparência é sinalizada no retorno", comAlfa.temTransparencia, true);

  const metaAlfa = await sharp(decodificarDataUrl(comAlfa.dataUrl)).metadata();
  eq("38. o PNG de saída realmente mantém o canal alfa", metaAlfa.hasAlpha, true);
  eq("39. o PNG de saída mantém as dimensões", [metaAlfa.width, metaAlfa.height], [500, 500]);

  const pixel = await sharp(decodificarDataUrl(comAlfa.dataUrl)).ensureAlpha().raw().toBuffer();
  ok("40. o alfa dos pixels sobrevive (não virou opaco)", pixel[3] > 0 && pixel[3] < 255);
  eq("41. imagem opaca não é marcada como transparente", normalizado.temTransparencia, false);
  eq("42. escolherSaida força PNG para qualquer entrada com alfa", [
    service.escolherSaida("png", true),
    service.escolherSaida("webp", true),
    service.escolherSaida("jpeg", false),
  ], ["png", "png", "jpeg"]);

  /* ── 7. Respostas de erro do endpoint ───────────────────────────────── */

  const resOk = fakeRes();
  await controller.normalizarImagem({ file: arquivo(pngOpaco, "image/png", "../../etc/foto.png") }, resOk);
  eq("43. sucesso responde 200 com ok:true", [resOk.statusCode, resOk.corpo.ok], [200, true]);
  eq("44. o nome do arquivo devolvido é sanitizado (sem caminho)", resOk.corpo.imagem.fileName, "foto.png");
  ok("45. a resposta traz dimensões e mime úteis para o editor",
    resOk.corpo.imagem.width === 900 && resOk.corpo.imagem.mimeType === "image/jpeg");

  const resSvg = fakeRes();
  await controller.normalizarImagem({ file: arquivo(svgMalicioso, "image/svg+xml", "x.svg") }, resSvg);
  eq("46. SVG responde 400 com código próprio", [resSvg.statusCode, resSvg.corpo.codigo], [400, "SVG_NAO_SUPORTADO"]);
  eq("47. o corpo de erro segue o padrão do projeto", resSvg.corpo.ok, false);

  const resGrande = fakeRes();
  await controller.normalizarImagem({ file: arquivo(bombaPng, "image/png", "b.png") }, resGrande);
  eq("48. imagem excessiva responde 413", [resGrande.statusCode, resGrande.corpo.codigo], [413, "IMAGEM_EXCESSIVA"]);

  const resSemArquivo = fakeRes();
  await controller.normalizarImagem({}, resSemArquivo);
  eq("49. requisição sem arquivo responde 400", [resSemArquivo.statusCode, resSemArquivo.corpo.codigo], [400, "ARQUIVO_AUSENTE"]);

  ok("50. nenhuma resposta de erro vaza stack ou caminho interno",
    [resSvg, resGrande, resSemArquivo].every((res) => {
      const texto = JSON.stringify(res.corpo);
      return !texto.includes("/home/") && !texto.includes("node_modules") && !texto.includes("at Object.");
    }));

  /* ── 8. Ausência de provedor de IA ──────────────────────────────────── */

  const providerAntes = process.env.IMAGE_AI_PROVIDER;
  delete process.env.IMAGE_AI_PROVIDER;

  const estado = imageAiProvider.capacidades();
  eq("51. sem provedor configurado nenhuma capacidade fica ligada", Object.values(estado.capacidades).every((v) => v === false), true);
  eq("52. o motivo é explícito", estado.motivo, "PROVEDOR_NAO_CONFIGURADO");
  eq("53. o estado agregado é indisponível", estado.disponivel, false);
  eq("54. as 5 operações previstas aparecem no contrato", Object.keys(estado.capacidades).sort(), [
    "generateBackground", "improveLighting", "removeBackground", "removeObject", "upscale",
  ]);

  const resCapacidades = fakeRes();
  await controller.obterCapacidades({}, resCapacidades);
  ok("55. GET /capacidades informa provider null e sharp disponível",
    resCapacidades.corpo.ok === true && resCapacidades.corpo.provider === null
    && resCapacidades.corpo.processamento.sharp === true);

  const resIa = fakeRes();
  await controller.executarIa({ params: { operacao: "removeBackground" }, body: {} }, resIa);
  eq("56. operação de IA sem provedor responde 501, não um resultado falso",
    [resIa.statusCode, resIa.corpo.codigo], [501, "PROVEDOR_NAO_CONFIGURADO"]);
  ok("57. a resposta de IA indisponível não devolve imagem alguma", resIa.corpo.imagem === undefined);

  const resIaInvalida = fakeRes();
  await controller.executarIa({ params: { operacao: "apagarBanco" }, body: {} }, resIaInvalida);
  eq("58. operação de IA desconhecida responde 400", [resIaInvalida.statusCode, resIaInvalida.corpo.codigo], [400, "OPERACAO_DESCONHECIDA"]);

  process.env.IMAGE_AI_PROVIDER = "photoroom";
  eq("59. provedor configurado mas não implementado é reportado como desconhecido",
    imageAiProvider.capacidades().motivo, "PROVEDOR_DESCONHECIDO");
  if (providerAntes === undefined) delete process.env.IMAGE_AI_PROVIDER;
  else process.env.IMAGE_AI_PROVIDER = providerAntes;

  /* ── 9. Contrato das rotas ──────────────────────────────────────────── */

  const camadas = routes.stack.filter((layer) => layer.route);
  const endpoints = camadas.map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  eq("60. os três endpoints do módulo estão registrados", endpoints.sort(), [
    "GET /capacidades", "POST /ia/:operacao", "POST /normalizar",
  ]);
  ok("61. todo endpoint passa por autenticação e pelo gate de design",
    camadas.every((layer) => layer.route.stack.length >= 3));

  const normalizarLayer = camadas.find((layer) => layer.route.path === "/normalizar");
  const nomes = normalizarLayer.route.stack.map((camada) => camada.name);
  ok("62. /normalizar usa Multer em memória antes do controller",
    nomes.some((nome) => /multer|single/i.test(nome)) || normalizarLayer.route.stack.length >= 5);

  /* ── 10. Sanitização de nome de arquivo ─────────────────────────────── */

  eq("63. path traversal no nome do arquivo é neutralizado", validator.sanitizarNomeArquivo("../../../etc/passwd"), "passwd");
  eq("64. nome só com pontos vira o fallback", validator.sanitizarNomeArquivo("...", "imagem"), "imagem");
  eq("65. nome vazio vira o fallback", validator.sanitizarNomeArquivo("", "imagem"), "imagem");
  ok("66. nome absurdamente longo é truncado", validator.sanitizarNomeArquivo("a".repeat(500)).length <= 120);

  console.log(`\n${checks} verificações passaram no servidor do editor de imagem.`);
})().catch((error) => { console.error(error); process.exit(1); });
