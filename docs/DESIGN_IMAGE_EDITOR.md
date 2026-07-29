# Editor de imagem do Estúdio de Templates — V1

Editor dedicado à **preparação da fotografia do produto** antes dela entrar nas
7 peças do template. Não é um editor de layout: não há texto, sticker nem
elemento livre — isso continua sendo do gerador SVG.

Branch de origem: `feat/design-image-editor-v1`.

---

## 1. Arquitetura

```
Portal/design-templates.js        coordena a tela (biblioteca, peças, export)
  ├── design-image-model.js       núcleo PURO: schema, migração, limites, histórico
  ├── design-image-storage.js     IndexedDB p/ blobs + fallback controlado
  ├── design-image-api.js         cliente HTTP (normalizar, capacidades, IA)
  └── design-image-editor.js      modal do editor (Fabric.js)

Portal/css/pages/design-image-editor-v2.css   visual (Fundação Global V2)

server/routes/designImageRoutes.js            /design/imagens/*
  └── controllers/designImageController.js
        ├── services/designImage/designImageService.js    (Sharp)
        ├── services/designImage/designImageValidator.js  (magic bytes, limites)
        └── services/ai/imageAiProvider.js                (contrato de IA)
```

O gerador SVG das 7 peças **não foi reescrito**. Ele só passou a ler a imagem
através de dois acessores (`productImageSource` / `productPlacement`).

### O princípio central: ajuste é parâmetro, não pixel

Nada do que o usuário faz no editor gera bitmap enquanto ele edita. Rotação,
recorte, brilho, sombra e fundo são campos de um objeto plano de ~15 chaves.
Pixels só nascem uma vez, no “Aplicar edição” (`canvas.toDataURL()`).

Consequências diretas:

* **desfazer/refazer é barato** — o histórico guarda estados de ~300 bytes,
  nunca cópias de imagem (era um requisito explícito);
* **a imagem original nunca é destruída** — recortar é `crop: {x,y,w,h}` em
  pixels da fonte, reversível a qualquer momento;
* **reabrir o editor restaura exatamente o estado anterior**.

### Palco de 1200 × 1200

O canvas do Fabric tem backstore de **1200 × 1200** (a mesma resolução da peça
exportada) e é reduzido apenas por CSS. O Fabric converte o ponteiro pela razão
entre `getBoundingClientRect()` e `canvas.width`, então arrastar continua exato.
`enableRetinaScaling: false` garante que o backstore não seja multiplicado pelo
devicePixelRatio, e a exportação sai com `multiplier: 1` — 1 px é 1 px.

O formato de saída depende do fundo: **transparente → PNG**, **cor sólida →
JPEG** (bem menor, e a peça é opaca de qualquer jeito).

---

## 2. Bibliotecas escolhidas

| Biblioteca | Versão | Onde | Por quê |
|---|---|---|---|
| Fabric.js | **6.9.1** (fixa) | navegador, via jsDelivr + SRI | traz canvas interativo, filtros (Brightness/Contrast/Saturation/Convolute), `Shadow`, `cropX/cropY` e exportação hi-res num pacote só |
| Sharp | **0.35.3** (fixa, sem `^`) | servidor | libvips: EXIF, resize, alfa e `limitInputPixels` contra decompression bomb |

**Cropper.js não foi adicionado.** O recorte usa o próprio Fabric: um
`fabric.Rect` sobre o palco e `fabric.util.invertTransform` para converter o
retângulo em pixels da fonte. Não valeria carregar uma segunda biblioteca de
canvas para uma funcionalidade que a primeira já entrega.

### Estratégia de dependência no frontend

O Portal não tem bundler nesta tela (HTML + JS vanilla) e o padrão do repositório
para bibliotecas de terceiros já é CDN (`relatorio-publico.html` usa Chart.js
assim). Seguimos o padrão, mas **endurecido**:

```html
<script
  src="https://cdn.jsdelivr.net/npm/fabric@6.9.1/dist/index.min.js"
  integrity="sha384-tJL5KnyuJRcbkoB4qkFwtd3KVVHDCE4PZOeY/QcwVENg7IVB65tqBKSs0UHUZ+k6"
  crossorigin="anonymous"
  referrerpolicy="no-referrer"></script>
```

* versão **fixa** — nada de `latest`, `@6` ou `@next`;
* **SRI sha384** conferido contra o tarball oficial do npm (`npm pack fabric@6.9.1`;
  o arquivo servido pelo jsDelivr é byte a byte idêntico);
* `crossorigin="anonymous"` (exigido pelo SRI) e `referrerpolicy="no-referrer"`.

O teste `designImageContrato.test.js` falha se alguém trocar por uma versão móvel,
remover o SRI ou acrescentar outra dependência externa à página.

---

## 3. Fluxo dos dados

### Upload

```
arquivo do usuário
  → validação no cliente (design-image-model)      MIME + extensão + tamanho
  → POST /design/imagens/normalizar (multipart)    autenticado
  → Sharp: EXIF, resize ≤1600px, alfa, strip meta
  → data URL de volta
  → product.originalImage  (+ blob no IndexedDB)
```

Se o servidor não responder (`REDE_INDISPONIVEL` / `TIMEOUT`), a tela cai para
leitura local com `FileReader` e um limite menor (2 MB), avisando o usuário por
toast de que a imagem **não** passou pela normalização. Erro de conteúdo (SVG,
MIME divergente, arquivo corrompido) **não** cai para o modo local — o arquivo é
ruim, tentar de novo localmente só esconderia o problema.

### Edição

```
originalImage.dataUrl → editor (Fabric)
  → usuário mexe: só parâmetros mudam
  → "Aplicar edição": canvas.toDataURL() 1200×1200
  → product.editedImage + product.editing  (+ blob no IndexedDB)
  → as 7 peças re-renderizam
```

`resolveProductImageSource()` decide o que as peças usam: `editedImage` quando
existe, senão `originalImage`. **Cancelar não toca no projeto** — a promessa de
`abrir()` resolve `null` e a tela simplesmente não faz nada.

### Modelo de estado (schema V2)

```js
product: {
  name, subtitle,
  originalImage: { id, dataUrl, url, fileName, mimeType, width, height },
  editedImage:   { id, dataUrl, url, fileName, mimeType, width, height },
  editing: {
    crop: null | { x, y, width, height },   // pixels da imagem ORIGINAL
    rotation, flipX, flipY, scale, offsetX, offsetY,
    brightness, contrast, saturation, sharpen,   // -100..100 (nitidez 0..100)
    backgroundColor: "transparent" | "#rrggbb",
    shadow: { enabled, blur, offsetX, offsetY, opacity },
  },
  placement: { scale, x, y },   // enquadramento DENTRO da peça
}
logo: { id, dataUrl, url, fileName, mimeType, width, height }
```

`editing` e `placement` são coisas diferentes de propósito: `editing` é a
preparação da foto, `placement` é onde essa foto cai dentro da arte. Mexer numa
não mexe na outra.

### Migração V1 → V2

Projetos antigos (`product.imageDataUrl`, `product.scale/x/y`, `logoDataUrl` na
raiz) são detectados por `detectSchemaVersion()` e convertidos por
`migrateImagesFromV1()`:

* `product.imageDataUrl` → `originalImage` com id novo;
* `product.scale/x/y` → `placement` (com os limites reaplicados);
* `logoDataUrl` → `logo`;
* o base64 que estava no localStorage é regravado no IndexedDB e o projeto é
  salvo já no formato V2.

**Logo em SVG é descartado na migração** e o usuário recebe um aviso explícito
(ver Segurança). Nenhum outro dado é perdido.

---

## 4. Armazenamento local

| Camada | Guarda | Limite prático |
|---|---|---|
| `localStorage` (`vf-design-template-studio-v1`) | projeto leve: textos, cores, **ids** de imagem | poucos KB |
| IndexedDB (`vf-design-template-studio` / store `imagens`) | os blobs (data URLs) | dezenas de MB |

`splitProjectForStorage()` separa os dois na hora de salvar. **O localStorage
não recebe mais nenhum base64** — há teste garantindo isso em quatro momentos
diferentes do ciclo de vida.

Outras garantias:

* **nada é reescrito à toa** — um `Set` de ids já persistidos evita regravar o
  mesmo blob a cada autosave (que dispara a cada 350 ms de digitação);
* **coleta de órfãos** — a cada gravação, `limparOrfaos()` apaga do IndexedDB
  todo id que o projeto não referencia mais (imagem trocada, edição descartada,
  template restaurado);
* **fallback em cascata** — IndexedDB → localStorage (com prefixo próprio e teto
  de 1,5 MB por imagem) → memória. Cada degrau avisa o usuário do que ele perde;
* **quota** — `QuotaExceededError` (de qualquer degrau) vira um toast que diz o
  que fazer, e o status de salvamento muda para erro. Não falha em silêncio.

---

## 5. Endpoints

Todos sob `/design/imagens`, com `authMiddleware` + `requireDesignAccess`
(admin/user/membro), como o resto do módulo de design.

### `POST /design/imagens/normalizar`

`multipart/form-data`, campo `imagem` (Multer em memória, 1 arquivo, 10 MB).

```json
{
  "ok": true,
  "imagem": {
    "dataUrl": "data:image/jpeg;base64,...",
    "mimeType": "image/jpeg", "formato": "jpeg",
    "width": 1600, "height": 1200, "bytes": 184320,
    "temTransparencia": false, "redimensionada": true,
    "orientacaoCorrigida": true, "baixaResolucao": false,
    "fileName": "foto.jpg",
    "original": { "width": 3200, "height": 2400, "formato": "jpeg", "bytes": 2400000 }
  }
}
```

O que o Sharp faz: aplica a orientação EXIF e a zera · descarta EXIF/ICC/GPS ·
reduz para no máximo 1600 px no maior lado · **nunca amplia** imagem pequena ·
mantém alfa (saída PNG) ou converte para JPEG quando opaca · rejeita acima de
50 MP (decompression bomb).

### `GET /design/imagens/capacidades`

```json
{ "ok": true, "provider": null, "disponivel": false,
  "motivo": "PROVEDOR_NAO_CONFIGURADO",
  "capacidades": { "removeBackground": false, "improveLighting": false,
                   "generateBackground": false, "removeObject": false, "upscale": false },
  "processamento": { "sharp": true } }
```

### `POST /design/imagens/ia/:operacao`

Hoje sempre `501 PROVEDOR_NAO_CONFIGURADO`. Ver seção 7.

### Erros

Sempre `{ ok: false, erro, codigo }`, sem stack e sem caminho interno.

| código | HTTP | quando |
|---|---|---|
| `ARQUIVO_AUSENTE` | 400 | sem arquivo no campo `imagem` |
| `ARQUIVO_VAZIO` | 400 | 0 bytes |
| `SVG_NAO_SUPORTADO` | 400 | conteúdo é SVG (mesmo renomeado) |
| `CONTEUDO_INVALIDO` | 400 | bytes não são PNG/JPEG/WebP |
| `MIME_DIVERGENTE` | 400 | MIME declarado ≠ conteúdo real |
| `IMAGEM_PEQUENA` | 400 | lado < 32 px |
| `ARQUIVO_GRANDE` | 413 | > 10 MB |
| `IMAGEM_EXCESSIVA` | 413 | > 50 MP decodificados |
| `SHARP_INDISPONIVEL` | 503 | binário nativo ausente na plataforma |

---

## 6. Segurança

**SVG é recusado nos dois uploads (produto e logo).** Um SVG é um documento XML
executável (`<script>`, `<foreignObject>`, `xlink` externo) e este projeto não
tem sanitizador de SVG. O V1 aceitava `image/*`, o que incluía SVG; a restrição é
uma mudança de comportamento **deliberada**, documentada aqui e coberta por
teste. Logos SVG salvos antes são descartados na migração, com aviso na tela.
Reintroduzir SVG exigiria um sanitizador dedicado (DOMPurify em modo SVG ou
rasterização server-side) — fica para a V2.

Demais pontos tratados:

* **MIME spoofing** — o formato é decidido pelos *magic numbers*; o MIME
  declarado só precisa concordar. `.exe` renomeado para `.png` é rejeitado.
* **Decompression bomb** — `limitInputPixels: 50e6` no Sharp e checagem
  independente das dimensões antes do resize.
* **Nome de arquivo malicioso** — path traversal, controle e unicode invisível
  são removidos no cliente e de novo no servidor. O nome só é exibido; nunca
  vira caminho de disco.
* **Data URL inválida** — regex estrita (`png|jpeg|webp` + base64) na entrada e
  na saída do editor; `javascript:` e `data:image/svg+xml` não passam.
* **Canvas contaminado** — tudo que entra na exportação é data URL de mesma
  origem ou gerada localmente. O Fabric carrega com `crossOrigin: "anonymous"`.
* **Upload autenticado** — nenhuma rota nova é anônima.
* **Sem segredos no frontend** — o navegador só fala com o servidor VenForce.
* **Logs** — nunca recebem conteúdo de imagem; erros previstos (`codigo`) nem
  chegam a `console.error`.

---

## 7. IA: contrato pronto, provedor ausente

`server/services/ai/imageAiProvider.js` espelha o `aiProvider.js` de texto. O mapa
`PROVIDERS` está **vazio de propósito**: nenhuma operação é simulada.

Operações previstas: `removeBackground`, `improveLighting`, `generateBackground`,
`removeObject`, `upscale`.

No frontend, a seção de IA do editor só aparece quando
`GET /design/imagens/capacidades` confirma a capacidade. Sem provedor, ela nem
entra no DOM visível — nada de botão que finge funcionar.

### Como plugar Photoroom / Cloudinary / remove.bg depois

1. Criar `server/services/ai/photoroomImageClient.js` expondo:
   ```js
   module.exports = {
     PROVIDER: "photoroom",
     capacidades: () => ({ removeBackground: true, upscale: true, /* ... */ }),
     executar: async (operacao, { buffer, mimeType, opcoes }) => ({ dataUrl, width, height }),
   };
   ```
2. Registrar no mapa `PROVIDERS` do `imageAiProvider.js`.
3. Definir as variáveis de ambiente.

Rota, controller, detecção de capacidade e interface já estão prontos.

O fluxo continua sendo:
`frontend → endpoint autenticado VenForce → service interno → provedor externo → retorno`.
A chave **nunca** passa pelo navegador.

### Variáveis de ambiente

Todas opcionais; sem elas o módulo funciona com o editor local e o Sharp.

```
IMAGE_AI_PROVIDER=          # vazio = nenhum provedor (padrão)
# quando for plugar um provedor, algo como:
# PHOTOROOM_API_KEY=
# PHOTOROOM_API_URL=
```

---

## 8. Ambiente e riscos de armazenamento no Render

`npm install` em `server/` já traz o Sharp (binário pré-compilado para
linux-x64/arm64 — o mesmo do Render). O carregamento é **preguiçoso**: se o
binário faltar, o endpoint responde `503 SHARP_INDISPONIVEL` em vez de derrubar
o servidor inteiro no boot.

**Nada é gravado em disco.** O disco do Render é efêmero: some a cada deploy e a
cada reinício de instância. O endpoint processa em memória e devolve — nunca
finge que o arquivo ficou salvo. Quem guarda é o navegador (IndexedDB).

Isso significa que hoje **o projeto vive só no navegador do usuário**: limpar os
dados do site, trocar de máquina ou usar outro navegador começa do zero. É uma
limitação consciente da V1 (o V1 anterior já era assim, só que pior — com
base64 no localStorage). Persistir de verdade exige storage externo (S3/R2/
Cloudinary) + tabela de projetos, que é item de V2.

---

## 9. Limitações conhecidas da V1

1. **Projeto não sincroniza entre dispositivos** — vive no navegador.
2. **Recorte é axis-aligned na fonte** e acontece com a imagem em pé: ao entrar
   no modo recorte, rotação e espelho são neutralizados e devolvidos depois.
   Foi a escolha que deixa a conversão retângulo → pixels exata e previsível.
3. **Sem IA** — só o contrato.
4. **Sem “remover fundo” local** — nem chroma key nem varinha mágica.
5. **Nitidez é uma convolução 3×3 simples**, não unsharp mask com raio.
6. **Um objeto só** — a foto do produto. Sem texto, sticker ou camadas.
7. **SVG não é aceito** em nenhum dos dois uploads.
8. **Um template no catálogo** (`portable-charger-complete-v1`) — inalterado.
9. **A peça “Compra segura” não usa a foto do produto** (é assim por design do
   template): a edição aparece em 6 das 7 peças.
10. **A imagem editada é sempre 1200 × 1200**, mesmo que o produto ocupe pouco
    dela. É o preço do WYSIWYG.

---

## 10. Testes

Rodam com o `npm test` do `server/` (Node puro, sem framework novo):

| arquivo | verificações | cobre |
|---|---|---|
| `designImageModel.test.js` | 92 | migração V1, validação de arquivo, limites, undo/redo, restaurar, cancelar, aplicar, órfãos, IndexedDB + fallback + quota, cliente HTTP |
| `designImageService.test.js` | 66 | magic bytes, EXIF, transparência, resize, bomba, respostas de erro, IA ausente, autenticação das rotas |
| `designImageFrontend.test.js` | 52 | a tela real num DOM mínimo: migração, 7 peças, editar/cancelar/restaurar, upload degradado, recarregar, reset |
| `designImageContrato.test.js` | 70 | ids JS × HTML, SRI/versão fixa, ordem dos scripts, ARIA, higiene de runtime, matemática dos filtros, tokens V2, ausência de segredos |

### Verificação headless (manual, fora do `npm test`)

`server/tests/manual/` traz dois scripts que rodam o editor com o **Fabric.js de
verdade** em jsdom + node-canvas. Eles dependem de pacotes que não são
dependência do projeto (`canvas`, `jsdom`, `fabric`) — as instruções de uso estão
no cabeçalho de cada arquivo.

* `designImageEditorHeadless.js` — 44 verificações: abrir, girar, espelhar,
  brilho/saturação/nitidez, desfazer/refazer, fundo, sombra, recorte 1:1,
  comparar, aplicar → **PNG 1200×1200 com alfa**, reabrir, cancelar → `null`,
  fundo sólido → **JPEG 1200×1200**.
* `designTemplatesHeadless.js` — 28 verificações: projeto V1 migrado, editar pela
  tela, edição nas 7 peças, **exportação das 7 peças em PNG 1200×1200**,
  restaurar original e reexportar.

Limitação do harness: o librsvg embutido no node-canvas não rasteriza
`<image href="data:...">` dentro de um SVG (navegadores rasterizam). Por isso a
presença da imagem editada nas peças é verificada no **SVG serializado** — que é
exatamente o que o navegador recebe — e não nos pixels do PNG.

---

## 11. Plano recomendado para a V2

1. **Persistir o projeto no servidor** — tabela `design_projetos` + storage
   externo (S3/R2). Resolve o risco do Render efêmero e libera colaboração.
2. **Remover fundo** — plugar um provedor pelo contrato já pronto; o botão e a
   detecção de capacidade não precisam de mudança.
3. **Aceitar SVG com sanitização** — DOMPurify em modo SVG no cliente +
   rasterização com Sharp no servidor.
4. **Presets por marketplace** — recortes e fundos padrão de ML/Shopee.
5. **Recorte com rotação livre** — hoje o modo recorte neutraliza a rotação.
6. **Unsharp mask com raio** no lugar da convolução 3×3.
7. **Aplicar em lote** — mesma edição para várias fotos do mesmo anúncio.
8. **Puxar imagens de `/design/anuncios/:itemId/imagens`** direto para o editor
   (o endpoint já existe).
9. **Web Worker para os filtros** se o palco crescer além de 1200 px.
10. **Mais templates** no catálogo — a V1 mexeu no editor, não no catálogo.
