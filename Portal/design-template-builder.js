// Portal/design-template-builder.js
// -----------------------------------------------------------------------------
// Interface do Construtor Modular de Carrosséis (aba "Construtor").
//
// Este arquivo é a única parte do construtor que conhece o DOM. As regras
// vivem em design-template-builder-model.js (puro) e a persistência em
// design-template-builder-storage.js (puro). O desenho das peças continua
// sendo do renderizador compartilhado — aqui não existe nenhuma função de
// desenho SVG.
//
// O construtor NÃO alcança o estado do editor antigo: tudo o que ele pode
// usar chega por window.VF_DESIGN_TEMPLATE_STUDIO, a superfície estreita que
// design-templates.js publica (toasts, confirmação, upload, editor Fabric,
// armazenamento de imagens, renderizador, clientes).
//
// Nenhuma execução dinâmica e nenhuma injeção de marcação: nada vindo do
// localStorage vira código. Todo texto entra por textContent, e todo nó é
// criado por createElement.
// -----------------------------------------------------------------------------

(function () {
  "use strict";

  const studio = window.VF_DESIGN_TEMPLATE_STUDIO;
  const model = window.VF_DESIGN_TEMPLATE_BUILDER_MODEL;
  const storageLib = window.VF_DESIGN_TEMPLATE_BUILDER_STORAGE;

  // Sem a integração ou sem o núcleo, o construtor não sobe — mas a tela
  // antiga continua inteira. Nada aqui pode derrubar o Estúdio.
  if (!studio || !model || !storageLib) return;

  // Rascunho e biblioteca são assuntos separados, com chaves separadas — e
  // nenhuma delas é a chave do projeto do editor antigo.
  const DRAFT_KEY = "vf-design-template-builder-draft-v1";
  const DEBOUNCE_MS = 220;

  const imageModel = studio.imageModel;
  const imageStorage = studio.imageStorage;

  const library = storageLib.createBuilderLibrary({ localStorage: window.localStorage });

  const byId = (id) => document.getElementById(id);

  /* ── estado ───────────────────────────────────────────────────────────── */

  let projeto = null;
  // Snapshot do estado em que o carrossel foi aberto: é com ele que o botão
  // "Valores iniciais" compara. Não é o padrão do sistema — é o ponto de
  // partida deste projeto.
  let snapshotInicial = null;
  let templateCache = null;
  let paginaSelecionada = 0;
  let modoComparacao = "custom";
  let zoom = 100;
  let debounceTimer = null;
  let idsPersistidos = new Set();
  let avisoDeLayoutEmitido = false;

  function clonar(valor) {
    return JSON.parse(JSON.stringify(valor));
  }

  /* ── rascunho ─────────────────────────────────────────────────────────── */

  // Igual ao editor antigo: o localStorage só recebe o projeto leve (textos,
  // cores, ids de imagem). O base64 vai para o armazenamento de imagens.
  function projetoLeve(origem) {
    const copia = clonar(origem);
    [copia.logo, copia.product.originalImage, copia.product.editedImage].forEach((ref) => {
      if (ref) ref.dataUrl = null;
    });
    return copia;
  }

  function blobsDoProjeto(origem) {
    return [origem.logo, origem.product.originalImage, origem.product.editedImage]
      .filter((ref) => ref && ref.id && ref.dataUrl)
      .map((ref) => ({ id: ref.id, dataUrl: ref.dataUrl }));
  }

  function idsDeImagensDoProjeto(origem) {
    if (!origem) return [];
    return [origem.logo, origem.product.originalImage, origem.product.editedImage]
      .filter((ref) => ref && ref.id)
      .map((ref) => String(ref.id));
  }

  function setStatus(mensagem, modo) {
    const status = byId("dtb-save-status");
    if (!status) return;
    status.textContent = mensagem;
    status.classList.toggle("is-saving", modo === "saving");
    status.classList.toggle("is-error", modo === "error");
  }

  async function persistirImagens(origem) {
    if (!imageStorage) return;
    try {
      for (const blob of blobsDoProjeto(origem)) {
        if (idsPersistidos.has(blob.id)) continue;
        // eslint-disable-next-line no-await-in-loop
        await imageStorage.salvar(blob.id, blob.dataUrl);
        idsPersistidos.add(blob.id);
      }
    } catch (error) {
      const codigo = error && error.codigo;
      studio.showToast(
        codigo === "QUOTA_EXCEDIDA" ? "danger" : "warning",
        codigo === "QUOTA_EXCEDIDA" ? "Armazenamento do navegador cheio" : "Imagens não serão recuperadas",
        codigo === "QUOTA_EXCEDIDA"
          ? "Remova alguma imagem ou libere espaço do site para continuar salvando."
          : "Este navegador bloqueou o armazenamento local de imagens. O carrossel vale para esta sessão."
      );
    }
  }

  function salvarRascunho(comToast) {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(projetoLeve(projeto)));
      setStatus("Rascunho salvo localmente", "saved");
      if (comToast) studio.showToast("success", "Rascunho salvo", "O carrossel foi guardado neste navegador.");
    } catch {
      setStatus("Não foi possível salvar o rascunho", "error");
      studio.showToast("danger", "Armazenamento indisponível", "Libere espaço do site neste navegador e tente novamente.");
      return false;
    }
    persistirImagens(projeto);
    return true;
  }

  function agendarRascunho() {
    setStatus("Salvando rascunho…", "saving");
    if (agendarRascunho.timer) window.clearTimeout(agendarRascunho.timer);
    agendarRascunho.timer = window.setTimeout(() => salvarRascunho(false), 500);
  }

  function carregarRascunho() {
    let bruto = null;
    try {
      bruto = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "null");
    } catch {
      bruto = null;
    }
    if (!bruto) return model.createDefaultProject({ imageModel });
    return model.sanitizeProject(bruto, { imageModel });
  }

  // Depois do boot as imagens são só ids: busca os blobs e redesenha.
  async function hidratarImagens(alvo) {
    if (!imageStorage || !imageModel) return false;
    const referencias = [alvo.logo, alvo.product.originalImage, alvo.product.editedImage];
    let alterou = false;
    for (const ref of referencias) {
      if (!ref || !ref.id || ref.dataUrl) continue;
      // eslint-disable-next-line no-await-in-loop
      const dataUrl = await imageStorage.ler(ref.id);
      if (imageModel.isDataImageUrl(dataUrl)) {
        ref.dataUrl = dataUrl;
        idsPersistidos.add(ref.id);
        alterou = true;
      } else {
        // Blob perdido (limpeza do navegador, outra máquina): a referência
        // vira vazia em vez de apontar para o nada.
        ref.id = null;
      }
    }
    return alterou;
  }

  /* ── template e renderização ──────────────────────────────────────────── */

  function templateAtual() {
    if (!templateCache) {
      templateCache = studio.templateEngine.normalizeTemplateDefinition(
        model.buildTemplateDefinition(projeto)
      );
    }
    return templateCache;
  }

  function invalidarTemplate() {
    templateCache = null;
  }

  function projetoDeRender() {
    const fonte = modoComparacao === "original" && snapshotInicial ? snapshotInicial : projeto;
    return model.toRenderProject(fonte);
  }

  // Peça que não pôde ser montada vira placeholder EXPLÍCITO. Só acontece se
  // um registro salvo apontar um rendererId que esta versão não conhece.
  function svgIndisponivel(nome) {
    const svg = studio.templateRenderer.svg;
    const root = svg.element("svg", {
      viewBox: "0 0 1200 1200", width: 1200, height: 1200,
      role: "img", "aria-label": `Página indisponível: ${nome}`,
    });
    svg.element("rect", { width: 1200, height: 1200, fill: "#f1f2f5" }, root);
    svg.text(root, "Página indisponível", {
      x: 600, y: 580, "text-anchor": "middle", fill: "#1c2430", "font-size": 46, "font-weight": 700,
    });
    svg.text(root, "Este layout não existe nesta versão do estúdio.", {
      x: 600, y: 640, "text-anchor": "middle", fill: "#5c6670", "font-size": 26, "font-weight": 500,
    });
    return root;
  }

  function renderarPagina(indice, modo) {
    const template = templateAtual();
    try {
      return studio.templateRenderer.renderPage({
        template,
        project: projetoDeRender(),
        pageIndex: indice,
        mode: modo,
      });
    } catch (error) {
      if (!avisoDeLayoutEmitido) {
        avisoDeLayoutEmitido = true;
        studio.showToast("danger", "Layout indisponível", error && error.message
          ? error.message
          : "Uma página deste carrossel usa um layout que o estúdio não conhece.");
      }
      const page = template.pages[indice];
      return svgIndisponivel(page ? page.name : "desconhecida");
    }
  }

  function aplicarTokensDaPaleta() {
    const raiz = byId("dtb-token-root");
    if (!raiz) return;
    const palette = studio.derivedPalette(model.normalizePalette(projeto.palette));
    Object.entries({
      "--template-primary": palette.primary,
      "--template-primary-light": palette.primaryLight,
      "--template-secondary": palette.secondary,
      "--template-background": palette.background,
      "--template-text": palette.text,
      "--template-surface": palette.surface,
    }).forEach(([nome, valor]) => raiz.style.setProperty(nome, valor));
  }

  function renderPreview() {
    const template = templateAtual();
    const total = template.pages.length;
    if (paginaSelecionada >= total) paginaSelecionada = Math.max(0, total - 1);

    const main = byId("dtb-main-preview");
    main.replaceChildren(renderarPagina(paginaSelecionada, "preview"));
    main.classList.toggle("is-original", modoComparacao === "original");
    main.style.width = `${zoom}%`;

    const pagina = template.pages[paginaSelecionada];
    byId("dtb-page-number").textContent =
      `PÁGINA ${String(paginaSelecionada + 1).padStart(2, "0")} DE ${String(total).padStart(2, "0")}`;
    byId("dtb-page-name").textContent = pagina ? pagina.name : "—";
    byId("dtb-meta").textContent = `${total} ${total === 1 ? "página" : "páginas"} · 1200 × 1200 px`;
    byId("dtb-title").textContent = projeto.name.trim() || "Criar carrossel modular";

    byId("dtb-prev").disabled = paginaSelecionada === 0;
    byId("dtb-next").disabled = paginaSelecionada >= total - 1;

    byId("dtb-view-original").classList.toggle("is-active", modoComparacao === "original");
    byId("dtb-view-original").setAttribute("aria-pressed", String(modoComparacao === "original"));
    byId("dtb-view-custom").classList.toggle("is-active", modoComparacao === "custom");
    byId("dtb-view-custom").setAttribute("aria-pressed", String(modoComparacao === "custom"));

    const miniaturas = template.pages.map((page, indice) => {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = `dt-thumbnail dtb-thumbnail${paginaSelecionada === indice ? " is-active" : ""}`;
      botao.setAttribute("aria-label", `Abrir página ${indice + 1}: ${page.name}`);
      botao.setAttribute("aria-current", paginaSelecionada === indice ? "true" : "false");
      const arte = document.createElement("span");
      arte.className = "dt-thumb-art";
      arte.appendChild(renderarPagina(indice, "preview"));
      const rotulo = document.createElement("span");
      rotulo.className = "dt-thumbnail__label";
      rotulo.textContent = `${String(indice + 1).padStart(2, "0")} · ${page.name}`;
      botao.append(arte, rotulo);
      botao.addEventListener("click", () => {
        paginaSelecionada = indice;
        renderPreview();
      });
      return botao;
    });
    byId("dtb-thumbnails").replaceChildren(...miniaturas);
  }

  // `imediato` = cores, páginas e ordenação. Texto passa pelo debounce para
  // não regerar 5 SVGs a cada tecla.
  function atualizar(options) {
    const config = options || {};
    if (config.estrutura) invalidarTemplate();
    aplicarTokensDaPaleta();
    if (config.paginas) renderPagesList();

    if (config.imediato === false) {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        invalidarTemplate();
        renderPreview();
      }, DEBOUNCE_MS);
    } else {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      renderPreview();
    }
    agendarRascunho();
  }

  /* ── formulário ───────────────────────────────────────────────────────── */

  // Campos de texto: entram com debounce na prévia.
  const CAMPOS_TEXTO = {
    "dtb-project-name": "name",
    "dtb-client-name": "clienteNome",
    "dtb-brand-name": "marcaNome",
    "dtb-product-name": "product.name",
    "dtb-product-subtitle": "product.subtitle",
    "dtb-main-benefit": "content.mainBenefit",
    "dtb-benefit-1": "content.benefit1",
    "dtb-benefit-2": "content.benefit2",
    "dtb-benefit-3": "content.benefit3",
    "dtb-specs": "content.specs",
    "dtb-package": "content.packageItems",
    "dtb-width": "content.width",
    "dtb-height": "content.height",
    "dtb-depth": "content.depth",
    "dtb-how-to-use": "content.howToUse",
    "dtb-warranty": "content.warranty",
    "dtb-shipping": "content.shipping",
  };

  // Cores e enquadramento: atualização imediata.
  const CAMPOS_IMEDIATOS = {
    "dtb-color-primary": "palette.primary",
    "dtb-color-secondary": "palette.secondary",
    "dtb-color-background": "palette.background",
    "dtb-color-text": "palette.text",
    "dtb-product-scale": "product.placement.scale",
    "dtb-product-x": "product.placement.x",
    "dtb-product-y": "product.placement.y",
  };

  function definirCaminho(caminho, valor) {
    const partes = caminho.split(".");
    let no = projeto;
    for (let i = 0; i < partes.length - 1; i += 1) no = no[partes[i]];
    no[partes[partes.length - 1]] = valor;
  }

  function lerCaminho(origem, caminho) {
    return caminho.split(".").reduce((no, parte) => (no == null ? no : no[parte]), origem);
  }

  function sincronizarCampos() {
    Object.entries(CAMPOS_TEXTO).forEach(([id, caminho]) => {
      const campo = byId(id);
      const valor = lerCaminho(projeto, caminho);
      if (campo && campo.value !== String(valor ?? "")) campo.value = valor ?? "";
    });
    Object.entries(CAMPOS_IMEDIATOS).forEach(([id, caminho]) => {
      const campo = byId(id);
      const valor = lerCaminho(projeto, caminho);
      if (campo && campo.value !== String(valor)) campo.value = valor;
    });
    byId("dtb-segment").value = projeto.segment;
    byId("dtb-style").value = projeto.style;
    byId("dtb-zoom").value = String(zoom);
    byId("dtb-product-scale-value").textContent = `${projeto.product.placement.scale}%`;
    byId("dtb-product-x-value").textContent = `${projeto.product.placement.x}%`;
    byId("dtb-product-y-value").textContent = `${projeto.product.placement.y}%`;
    sincronizarUpload("logo", projeto.logo.dataUrl, projeto.logo.fileName);
    sincronizarProduto();
    sincronizarCliente();
  }

  function sincronizarUpload(tipo, dataUrl, fileName) {
    const estado = byId(`dtb-${tipo}-state`);
    const preview = byId(`dtb-${tipo}-preview`);
    const nome = byId(`dtb-${tipo}-filename`);
    if (!estado) return;
    estado.hidden = !dataUrl;
    if (dataUrl) preview.src = dataUrl;
    else preview.removeAttribute("src");
    nome.textContent = fileName || "Imagem local";
  }

  function fonteDaImagemDoProduto() {
    if (imageModel) return imageModel.resolveProductImageSource(projeto.product);
    return projeto.product.editedImage?.dataUrl || projeto.product.originalImage?.dataUrl || null;
  }

  function sincronizarProduto() {
    const original = projeto.product.originalImage;
    sincronizarUpload("product", fonteDaImagemDoProduto(), original.fileName);

    const editar = byId("dtb-edit-product");
    if (editar) {
      const pode = Boolean(original.dataUrl) && studio.editorDeImagemDisponivel();
      editar.disabled = !pode;
      editar.title = pode
        ? "Abrir o editor de imagem"
        : "O editor precisa da imagem carregada e da biblioteca de edição disponível.";
    }
    const nota = byId("dtb-product-edit-note");
    if (nota) nota.hidden = !projeto.product.editedImage.dataUrl;
    const aviso = byId("dtb-product-lowres");
    if (aviso) {
      aviso.hidden = !(imageModel && original.dataUrl
        && imageModel.isLowResolution(original.width, original.height));
    }
  }

  function sincronizarCliente() {
    const select = byId("dtb-client-select");
    if (!select) return;
    const desejado = projeto.clienteId == null ? "" : String(projeto.clienteId);
    select.value = [...select.options].some((opcao) => opcao.value === desejado) ? desejado : "";
  }

  function preencherSelects() {
    const segmento = byId("dtb-segment");
    segmento.replaceChildren(...model.SEGMENTS.map((valor) => {
      const opcao = document.createElement("option");
      opcao.value = valor;
      opcao.textContent = valor;
      return opcao;
    }));
    const estilo = byId("dtb-style");
    estilo.replaceChildren(...model.STYLES.map((item) => {
      const opcao = document.createElement("option");
      opcao.value = item.id;
      opcao.textContent = item.name;
      return opcao;
    }));
  }

  /* ── seleção de páginas ───────────────────────────────────────────────── */

  function renderPagesList() {
    const lista = byId("dtb-pages-list");
    const descricoes = model.describePages(projeto);
    // Ordem da lista = ordem do carrossel; as não incluídas ficam no fim.
    const ordenadas = descricoes.slice().sort((a, b) => {
      if (a.incluida !== b.incluida) return a.incluida ? -1 : 1;
      return a.posicao - b.posicao;
    });

    lista.replaceChildren(...ordenadas.map((pagina) => {
      const item = document.createElement("li");
      item.className = `dtb-page${pagina.incluida ? " is-on" : ""}`;

      const topo = document.createElement("div");
      topo.className = "dtb-page__head";

      const marcador = document.createElement("label");
      marcador.className = "vf-check dtb-page__check";
      const caixa = document.createElement("input");
      caixa.type = "checkbox";
      caixa.checked = pagina.incluida;
      caixa.disabled = pagina.required;
      caixa.id = `dtb-page-${pagina.id}`;
      caixa.setAttribute("aria-label", `Incluir a página ${pagina.name}`);
      const titulo = document.createElement("span");
      titulo.className = "dtb-page__name";
      titulo.textContent = pagina.incluida
        ? `${String(pagina.posicao + 1).padStart(2, "0")} · ${pagina.name}`
        : pagina.name;
      marcador.append(caixa, titulo);

      const acoes = document.createElement("div");
      acoes.className = "dtb-page__moves";
      const subir = document.createElement("button");
      subir.type = "button";
      subir.className = "vf-btn vf-btn--ghost vf-btn--sm";
      subir.textContent = "Subir";
      subir.disabled = !pagina.podeSubir;
      subir.setAttribute("aria-label", `Mover ${pagina.name} para cima`);
      const descer = document.createElement("button");
      descer.type = "button";
      descer.className = "vf-btn vf-btn--ghost vf-btn--sm";
      descer.textContent = "Descer";
      descer.disabled = !pagina.podeDescer;
      descer.setAttribute("aria-label", `Mover ${pagina.name} para baixo`);
      acoes.append(subir, descer);
      topo.append(marcador, acoes);

      const descricao = document.createElement("p");
      descricao.className = "dtb-page__description";
      descricao.textContent = pagina.description;

      const dados = document.createElement("p");
      dados.className = `dtb-page__data${pagina.semDados ? " is-missing" : ""}`;
      dados.textContent = pagina.semDados
        ? `Faltam dados: ${pagina.dataHint}`
        : `Usa: ${pagina.dataHint}`;

      item.append(topo, descricao, dados);
      if (pagina.required) {
        const fixa = document.createElement("p");
        fixa.className = "dtb-page__locked";
        fixa.textContent = "A capa é obrigatória e não pode ser removida.";
        item.appendChild(fixa);
      }

      caixa.addEventListener("change", () => alternarPagina(pagina.id, caixa.checked));
      subir.addEventListener("click", () => moverPagina(pagina.id, -1));
      descer.addEventListener("click", () => moverPagina(pagina.id, 1));
      return item;
    }));
  }

  function alternarPagina(pageId, incluir) {
    try {
      projeto.pages = model.togglePage(projeto.pages, pageId, incluir);
    } catch (error) {
      studio.showToast("warning", "Página não alterada", error.message);
      renderPagesList();
      return;
    }
    paginaSelecionada = Math.min(paginaSelecionada, Math.max(0, projeto.pages.length - 1));
    atualizar({ estrutura: true, paginas: true });
  }

  function moverPagina(pageId, direcao) {
    const antes = projeto.pages.slice();
    try {
      projeto.pages = model.movePage(projeto.pages, pageId, direcao);
    } catch (error) {
      studio.showToast("warning", "Página não movida", error.message);
      return;
    }
    // A página que estava selecionada continua selecionada, na nova posição.
    const selecionadaId = antes[paginaSelecionada];
    const novaPosicao = projeto.pages.indexOf(selecionadaId);
    if (novaPosicao >= 0) paginaSelecionada = novaPosicao;
    atualizar({ estrutura: true, paginas: true });
  }

  /* ── validação ────────────────────────────────────────────────────────── */

  function mostrarErros(erros) {
    const banner = byId("dtb-errors");
    const lista = byId("dtb-errors-list");
    lista.replaceChildren(...erros.map((erro) => {
      const item = document.createElement("li");
      item.textContent = erro.mensagem;
      return item;
    }));
    banner.hidden = erros.length === 0;
  }

  function validar() {
    const resultado = model.validateProject(projeto);
    mostrarErros(resultado.erros);
    return resultado;
  }

  /* ── upload e edição de imagem ────────────────────────────────────────── */

  function setUploadOcupado(tipo, ocupado) {
    const drop = document.querySelector(`label[for="dtb-${tipo}-file"]`);
    if (drop) drop.classList.toggle("is-loading", ocupado);
    const input = byId(`dtb-${tipo}-file`);
    if (input) input.disabled = ocupado;
  }

  async function aoEscolherImagem(file, tipo) {
    if (!file || !imageModel) return;
    setUploadOcupado(tipo, true);
    try {
      const imagem = await studio.prepararImagem(file, tipo === "product" ? "produto" : "logo");
      const referencia = imageModel.normalizeImageRef({
        id: imageModel.newImageId(tipo === "product" ? "bld-prod" : "bld-logo"),
        dataUrl: imagem.dataUrl,
        fileName: imagem.fileName,
        mimeType: imagem.mimeType,
        width: imagem.width,
        height: imagem.height,
      });

      if (tipo === "product") {
        // Imagem nova zera a edição anterior: os parâmetros antigos não valem
        // para outro arquivo. O enquadramento na peça é mantido.
        projeto.product = {
          ...projeto.product,
          originalImage: referencia,
          editedImage: imageModel.createEmptyImageRef(),
          editing: imageModel.createDefaultEditing(),
        };
      } else {
        projeto.logo = referencia;
      }

      sincronizarCampos();
      atualizar({});
      salvarRascunho(false);
      if (imagem.origem === "local") {
        studio.showToast("warning", "Imagem carregada localmente", "O servidor não respondeu: a imagem não passou pela normalização.");
      } else if (imagem.baixaResolucao) {
        studio.showToast("warning", "Resolução baixa", "A imagem tem menos de 600 px de lado. A arte pode sair sem nitidez.");
      }
    } catch (error) {
      studio.showToast("danger", "Não foi possível usar esta imagem", error?.message || "Tente outro arquivo.");
    } finally {
      setUploadOcupado(tipo, false);
      const input = byId(`dtb-${tipo}-file`);
      if (input) input.value = "";
    }
  }

  function removerImagem(tipo) {
    if (tipo === "logo") {
      projeto.logo = imageModel ? imageModel.createEmptyImageRef() : { id: null, dataUrl: null, fileName: "" };
    } else if (imageModel) {
      projeto.product = { ...projeto.product, ...imageModel.clearProductImage(projeto.product) };
    }
    sincronizarCampos();
    atualizar({});
    salvarRascunho(false);
  }

  async function abrirEditorDeImagem() {
    const original = projeto.product.originalImage;
    if (!original.dataUrl) {
      studio.showToast("warning", "Nenhuma imagem", "Envie a imagem do produto antes de abrir o editor.");
      return;
    }
    const resultado = await studio.abrirEditorDeImagem({
      dataUrl: original.dataUrl,
      fileName: original.fileName,
      width: original.width,
      height: original.height,
      editing: projeto.product.editing,
    });
    if (!resultado) return;

    const antes = projeto.product.editedImage.id;
    projeto.product = {
      ...projeto.product,
      ...imageModel.applyEditingToProduct(projeto.product, resultado.editing, resultado.rendered),
    };
    if (antes && antes !== projeto.product.editedImage.id) idsPersistidos.delete(antes);
    sincronizarCampos();
    atualizar({});
    salvarRascunho(false);
    studio.showToast("success", "Edição aplicada", "As páginas do carrossel já usam a imagem editada.");
  }

  function restaurarImagemOriginal() {
    if (!imageModel) return;
    const antes = projeto.product.editedImage.id;
    projeto.product = { ...projeto.product, ...imageModel.restoreOriginalImage(projeto.product) };
    if (antes) idsPersistidos.delete(antes);
    sincronizarCampos();
    atualizar({});
    salvarRascunho(false);
  }

  /* ── exportação ───────────────────────────────────────────────────────── */

  // SVG -> PNG 1200 × 1200, o mesmo caminho do editor antigo. A peça é
  // renderizada em modo "export": nenhum aviso de edição entra no arquivo.
  function exportarPagina(indice) {
    return new Promise((resolve) => {
      let svg;
      try {
        svg = studio.templateRenderer.renderPage({
          template: templateAtual(),
          project: projetoDeRender(),
          pageIndex: indice,
        });
      } catch {
        studio.showToast("danger", "Não foi possível exportar", "Esta página usa um layout que o estúdio não conhece.");
        resolve(false);
        return;
      }

      const serializado = new XMLSerializer().serializeToString(svg);
      const svgUrl = URL.createObjectURL(new Blob([serializado], { type: "image/svg+xml;charset=utf-8" }));
      const imagem = new Image();
      imagem.onload = () => {
        URL.revokeObjectURL(svgUrl);
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 1200;
          canvas.height = 1200;
          const contexto = canvas.getContext("2d");
          if (!contexto) throw new Error("Canvas indisponível");
          contexto.drawImage(imagem, 0, 0, 1200, 1200);
          canvas.toBlob((blob) => {
            if (!blob) {
              studio.showToast("danger", "Exportação bloqueada", "O navegador não conseguiu gerar o PNG desta página.");
              resolve(false);
              return;
            }
            const nomeProjeto = studio.sanitizeFilename(projeto.name, "carrossel");
            const pagina = templateAtual().pages[indice];
            const nomePagina = studio.sanitizeFilename(pagina ? pagina.name : "pagina", "pagina");
            studio.downloadBlob(blob, `${nomeProjeto}-${String(indice + 1).padStart(2, "0")}-${nomePagina}.png`);
            resolve(true);
          }, "image/png");
        } catch {
          studio.showToast("danger", "Não foi possível exportar", "O navegador impediu a conversão do SVG para PNG.");
          resolve(false);
        }
      };
      imagem.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        studio.showToast("danger", "Não foi possível exportar", "A página não pôde ser carregada para conversão em PNG.");
        resolve(false);
      };
      imagem.src = svgUrl;
    });
  }

  function exigirProjetoValido(acao) {
    const resultado = validar();
    if (!resultado.ok) {
      studio.showToast("warning", `Não foi possível ${acao}`, resultado.erros[0].mensagem);
      ativarPainel(resultado.erros[0].campo.startsWith("pages") ? "pages" : "identity");
    }
    return resultado.ok;
  }

  async function baixarTodas() {
    if (!exigirProjetoValido("baixar as páginas")) return;
    const total = templateAtual().pages.length;
    const botao = byId("dtb-download-all");
    botao.disabled = true;
    let geradas = 0;
    // Downloads sequenciais: o navegador engasga com N cliques simultâneos e
    // uma biblioteca de ZIP seria peso morto para 5 arquivos.
    for (let indice = 0; indice < total; indice += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (await exportarPagina(indice)) geradas += 1;
    }
    botao.disabled = false;
    studio.showToast(
      geradas === total ? "success" : "warning",
      "Download concluído",
      `${geradas} de ${total} páginas foram geradas em 1200 × 1200 px.`
    );
  }

  /* ── biblioteca local ─────────────────────────────────────────────────── */

  function salvarComoTemplate() {
    if (!exigirProjetoValido("salvar o template")) return;
    let registro;
    try {
      registro = library.salvar(projeto);
    } catch (error) {
      studio.showToast("danger", "Não foi possível salvar", error.message);
      return;
    }
    // O id passa a ser o do registro: salvar de novo ATUALIZA este template
    // em vez de criar um segundo.
    projeto.id = registro.id;
    projeto.createdAt = registro.createdAt;
    projeto.updatedAt = registro.updatedAt;
    salvarRascunho(false);
    persistirImagens(projeto);
    renderLocalLibrary();
    studio.showToast("success", "Template salvo", `“${registro.name}” está na biblioteca da equipe.`);
  }

  function mosaicoDoRegistro(registro) {
    const visual = document.createElement("div");
    visual.className = "dt-template-card__visual dtb-card__visual";
    visual.setAttribute("aria-hidden", "true");
    const mosaico = document.createElement("div");
    mosaico.className = "dtb-card__mosaic";
    const paleta = model.normalizePalette(registro.palette);
    // Mosaico com as cores REAIS do template: dá para reconhecer o projeto
    // sem precisar rasterizar cinco peças na listagem.
    registro.pages.slice(0, 5).forEach((_, indice) => {
      const bloco = document.createElement("span");
      bloco.className = "dtb-card__tile";
      bloco.style.background = indice % 2 === 0 ? paleta.background : paleta.primary;
      bloco.style.borderColor = paleta.secondary;
      mosaico.appendChild(bloco);
    });
    visual.appendChild(mosaico);
    return visual;
  }

  function formatarData(iso) {
    const data = new Date(iso);
    if (Number.isNaN(data.getTime())) return "—";
    return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function criarCardLocal(registro) {
    const card = document.createElement("article");
    card.className = "vf-card dt-template-card dtb-card";
    card.dataset.templateId = registro.id;

    const corpo = document.createElement("div");
    corpo.className = "dt-template-card__body dtb-card__body";

    const info = document.createElement("div");
    const marca = document.createElement("span");
    marca.className = "dtb-card__origin";
    marca.textContent = "Criado pela equipe";
    const titulo = document.createElement("h3");
    titulo.className = "dt-template-card__title";
    titulo.textContent = registro.name;

    const meta = document.createElement("div");
    meta.className = "dt-template-card__meta";
    const estilo = model.getStyle(registro.style);
    [
      ["Segmento", registro.segment || "—"],
      ["Estilo", estilo ? estilo.name : "—"],
      ["Páginas", String(registro.pages.length)],
      ["Atualizado", formatarData(registro.updatedAt)],
    ].forEach(([rotulo, valor]) => {
      const item = document.createElement("span");
      const forte = document.createElement("strong");
      forte.textContent = `${rotulo}:`;
      item.append(forte, document.createTextNode(` ${valor}`));
      meta.appendChild(item);
    });
    info.append(marca, titulo, meta);

    const acoes = document.createElement("div");
    acoes.className = "dtb-card__actions";
    const abrir = document.createElement("button");
    abrir.type = "button";
    abrir.className = "vf-btn vf-btn--primary vf-btn--sm";
    abrir.textContent = "Abrir";
    abrir.addEventListener("click", () => abrirTemplateLocal(registro.id));
    const duplicar = document.createElement("button");
    duplicar.type = "button";
    duplicar.className = "vf-btn vf-btn--secondary vf-btn--sm";
    duplicar.textContent = "Duplicar";
    duplicar.addEventListener("click", () => duplicarTemplateLocal(registro.id));
    const excluir = document.createElement("button");
    excluir.type = "button";
    excluir.className = "vf-btn vf-btn--ghost vf-btn--sm";
    excluir.textContent = "Excluir";
    excluir.addEventListener("click", () => excluirTemplateLocal(registro));
    acoes.append(abrir, duplicar, excluir);

    corpo.append(info, acoes);
    card.append(mosaicoDoRegistro(registro), corpo);
    return card;
  }

  let filtroDaBiblioteca = { query: "", segment: "" };

  function normalizarBusca(valor) {
    return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  }

  function renderLocalLibrary() {
    const grid = byId("dt-local-template-grid");
    if (!grid) return;
    const consulta = normalizarBusca(filtroDaBiblioteca.query);
    const segmento = filtroDaBiblioteca.segment || "";
    const registros = library.listar().filter((registro) => {
      const buscavel = normalizarBusca(`${registro.name} ${registro.segment}`);
      return (!consulta || buscavel.includes(consulta)) && (!segmento || registro.segment === segmento);
    });
    grid.replaceChildren(...registros.map(criarCardLocal));
    byId("dt-local-empty").hidden = registros.length > 0;
  }

  // Abrir NÃO altera o registro salvo: trabalhamos numa cópia sanitizada e o
  // original só muda quando a designer clicar em "Salvar como template".
  async function abrirTemplateLocal(id) {
    const registro = library.obter(id);
    if (!registro) {
      studio.showToast("danger", "Template indisponível", "Este template não está mais na biblioteca local.");
      renderLocalLibrary();
      return;
    }
    projeto = model.sanitizeProject(registro, { imageModel });
    await hidratarImagens(projeto);
    snapshotInicial = clonar(projeto);
    paginaSelecionada = 0;
    modoComparacao = "custom";
    invalidarTemplate();
    sincronizarCampos();
    mostrarErros([]);
    renderPagesList();
    studio.showView("builder");
    atualizar({ estrutura: true });
    studio.showToast("success", "Template aberto", `“${registro.name}” foi carregado no construtor.`);
  }

  function duplicarTemplateLocal(id) {
    let copia;
    try {
      copia = library.duplicar(id);
    } catch (error) {
      studio.showToast("danger", "Não foi possível duplicar", error.message);
      return;
    }
    renderLocalLibrary();
    studio.showToast("success", "Template duplicado", `“${copia.name}” foi adicionado à biblioteca.`);
  }

  function excluirTemplateLocal(registro) {
    studio.openConfirmation({
      title: "Excluir este template?",
      description: `“${registro.name}” será removido da biblioteca local deste navegador. Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        if (!library.remover(registro.id)) {
          studio.showToast("warning", "Nada foi removido", "Este template já não estava na biblioteca.");
          return;
        }
        renderLocalLibrary();
        await limparImagensOrfas();
        studio.showToast("success", "Template excluído", `“${registro.name}” saiu da biblioteca local.`);
      },
    });
  }

  // Só apaga blobs que NINGUÉM referencia: nem a biblioteca, nem o rascunho
  // aberto, nem o projeto do editor antigo (que declara os seus na mesma
  // limpeza, pelo provedor registrado abaixo).
  async function limparImagensOrfas() {
    if (!imageStorage) return;
    try {
      const vivos = new Set(library.listarIdsDeImagens().concat(idsDeImagensDoProjeto(projeto)));
      const todos = await imageStorage.listarIds();
      for (const id of todos) {
        // Ids do editor antigo não têm o prefixo do construtor: nunca os
        // tocamos aqui, senão a limpeza de um módulo apagaria o outro.
        if (!String(id).startsWith("bld-") || vivos.has(String(id))) continue;
        // eslint-disable-next-line no-await-in-loop
        await imageStorage.remover(id);
        idsPersistidos.delete(id);
      }
    } catch {
      // Falha de limpeza é inofensiva: sobra blob, nunca falta.
    }
  }

  /* ── abas do painel ───────────────────────────────────────────────────── */

  function ativarPainel(nome, focar) {
    document.querySelectorAll("[data-builder-tab]").forEach((tab) => {
      const ativo = tab.dataset.builderTab === nome;
      tab.classList.toggle("is-active", ativo);
      tab.setAttribute("aria-selected", String(ativo));
      if (ativo && focar) tab.focus();
    });
    document.querySelectorAll("[data-builder-panel]").forEach((painel) => {
      const ativo = painel.dataset.builderPanel === nome;
      painel.hidden = !ativo;
      painel.classList.toggle("is-active", ativo);
    });
  }

  /* ── ações ────────────────────────────────────────────────────────────── */

  function novoProjeto() {
    projeto = model.createDefaultProject({ imageModel });
    snapshotInicial = clonar(projeto);
    paginaSelecionada = 0;
    modoComparacao = "custom";
    invalidarTemplate();
    sincronizarCampos();
    mostrarErros([]);
    renderPagesList();
    studio.showView("builder");
    atualizar({ estrutura: true });
  }

  function restaurar() {
    studio.openConfirmation({
      title: "Restaurar o construtor?",
      description: "O carrossel em edição volta ao conteúdo inicial. Os templates já salvos na biblioteca não são afetados.",
      confirmLabel: "Restaurar",
      onConfirm: () => {
        novoProjeto();
        salvarRascunho(false);
        studio.showToast("success", "Construtor restaurado", "O carrossel voltou ao estado inicial.");
      },
    });
  }

  function gerarPrevia() {
    const resultado = validar();
    invalidarTemplate();
    renderPreview();
    if (resultado.ok) {
      studio.showToast("success", "Prévia atualizada", `O carrossel tem ${templateAtual().pages.length} páginas.`);
    } else {
      studio.showToast("warning", "Prévia com pendências", resultado.erros[0].mensagem);
    }
  }

  /* ── eventos ──────────────────────────────────────────────────────────── */

  function ligarEventos() {
    Object.entries(CAMPOS_TEXTO).forEach(([id, caminho]) => {
      const campo = byId(id);
      if (!campo) return;
      campo.addEventListener("input", (evento) => {
        definirCaminho(caminho, evento.target.value);
        if (id === "dtb-project-name") byId("dtb-title").textContent = evento.target.value.trim() || "Criar carrossel modular";
        if (id === "dtb-client-name") projeto.clienteId = null;
        atualizar({ imediato: false, paginas: true });
      });
    });

    Object.entries(CAMPOS_IMEDIATOS).forEach(([id, caminho]) => {
      const campo = byId(id);
      if (!campo) return;
      campo.addEventListener("input", (evento) => {
        const valor = evento.target.type === "range" ? Number(evento.target.value) : evento.target.value;
        definirCaminho(caminho, valor);
        if (evento.target.type === "range") {
          const saida = byId(`${id}-value`);
          if (saida) saida.textContent = `${valor}%`;
        }
        atualizar({});
      });
    });

    byId("dtb-segment").addEventListener("change", (evento) => {
      projeto.segment = evento.target.value;
      atualizar({ estrutura: true });
    });

    byId("dtb-style").addEventListener("change", (evento) => {
      try {
        projeto = model.applyStyle(projeto, evento.target.value);
      } catch (error) {
        studio.showToast("warning", "Estilo não aplicado", error.message);
        return;
      }
      sincronizarCampos();
      atualizar({});
      studio.showToast("success", "Estilo aplicado", "A paleta inicial mudou. Ajuste as cores como preferir.");
    });

    byId("dtb-client-select").addEventListener("change", (evento) => {
      const valor = evento.target.value;
      if (!valor) {
        projeto.clienteId = null;
      } else {
        const cliente = studio.getClients().find((item) => String(item.id) === valor);
        if (cliente) {
          projeto.clienteId = cliente.id;
          projeto.clienteNome = model.sanitizeText(cliente.nome || cliente.slug || "Cliente", 80);
        }
      }
      sincronizarCampos();
      atualizar({});
    });

    byId("dtb-logo-file").addEventListener("change", (evento) => aoEscolherImagem(evento.target.files?.[0], "logo"));
    byId("dtb-product-file").addEventListener("change", (evento) => aoEscolherImagem(evento.target.files?.[0], "product"));
    byId("dtb-remove-logo").addEventListener("click", () => removerImagem("logo"));
    byId("dtb-remove-product").addEventListener("click", () => removerImagem("product"));
    byId("dtb-edit-product").addEventListener("click", abrirEditorDeImagem);
    byId("dtb-restore-product").addEventListener("click", restaurarImagemOriginal);

    byId("dtb-generate").addEventListener("click", gerarPrevia);
    byId("dtb-reset").addEventListener("click", restaurar);
    byId("dtb-save-draft").addEventListener("click", () => salvarRascunho(true));
    byId("dtb-save-template").addEventListener("click", salvarComoTemplate);
    byId("dtb-back-library").addEventListener("click", () => studio.showView("library"));
    byId("dtb-download-page").addEventListener("click", async () => {
      if (!exigirProjetoValido("baixar a página")) return;
      if (await exportarPagina(paginaSelecionada)) {
        studio.showToast("success", "Página exportada", "PNG gerado em 1200 × 1200 px.");
      }
    });
    byId("dtb-download-all").addEventListener("click", baixarTodas);

    byId("dtb-prev").addEventListener("click", () => {
      paginaSelecionada = Math.max(0, paginaSelecionada - 1);
      renderPreview();
    });
    byId("dtb-next").addEventListener("click", () => {
      paginaSelecionada = Math.min(templateAtual().pages.length - 1, paginaSelecionada + 1);
      renderPreview();
    });
    byId("dtb-view-original").addEventListener("click", () => {
      modoComparacao = "original";
      renderPreview();
    });
    byId("dtb-view-custom").addEventListener("click", () => {
      modoComparacao = "custom";
      renderPreview();
    });
    byId("dtb-zoom").addEventListener("change", (evento) => {
      zoom = Number(evento.target.value) || 100;
      renderPreview();
    });

    const abas = [...document.querySelectorAll("[data-builder-tab]")];
    abas.forEach((tab, indice) => {
      tab.addEventListener("click", () => ativarPainel(tab.dataset.builderTab));
      tab.addEventListener("keydown", (evento) => {
        if (!["ArrowLeft", "ArrowRight"].includes(evento.key)) return;
        evento.preventDefault();
        const passo = evento.key === "ArrowRight" ? 1 : -1;
        const proxima = abas[(indice + passo + abas.length) % abas.length];
        ativarPainel(proxima.dataset.builderTab, true);
      });
    });
  }

  /* ── boot ─────────────────────────────────────────────────────────────── */

  function init() {
    projeto = carregarRascunho();
    snapshotInicial = clonar(projeto);

    preencherSelects();
    ligarEventos();
    sincronizarCampos();
    renderPagesList();
    aplicarTokensDaPaleta();
    renderPreview();
    renderLocalLibrary();
    setStatus("Rascunho salvo localmente", "saved");

    // A biblioteca da equipe segue os mesmos filtros da biblioteca do sistema.
    studio.onBibliotecaRenderizada((filtros) => {
      filtroDaBiblioteca = filtros;
      renderLocalLibrary();
    });

    // O select de clientes reaproveita a lista já buscada pela tela: o
    // endpoint continua sendo chamado uma vez só.
    studio.onClientesCarregados((clientes) => {
      const select = byId("dtb-client-select");
      const aviso = byId("dtb-client-warning");
      if (aviso) aviso.hidden = clientes.length > 0;
      if (!select) return;
      select.replaceChildren();
      const padrao = document.createElement("option");
      padrao.value = "";
      padrao.textContent = "Cliente personalizado";
      select.appendChild(padrao);
      clientes.forEach((cliente) => {
        const opcao = document.createElement("option");
        opcao.value = String(cliente.id);
        opcao.textContent = cliente.nome || cliente.slug || `Cliente ${cliente.id}`;
        select.appendChild(opcao);
      });
      sincronizarCliente();
    });

    studio.onConstrutorAberto(() => renderPreview());
    studio.definirAcaoDeNovoProjeto(novoProjeto);
    // Declara ao editor antigo quais blobs o construtor ainda usa, para que a
    // limpeza de órfãos dele não apague as imagens dos templates da equipe.
    studio.registrarImagensVivas(() => library.listarIdsDeImagens().concat(idsDeImagensDoProjeto(projeto)));

    // As imagens do rascunho chegam depois: nada disso bloqueia a primeira
    // pintura da tela.
    hidratarImagens(projeto).then((alterou) => {
      if (!alterou) return;
      snapshotInicial = clonar(projeto);
      sincronizarCampos();
      renderPreview();
    }).catch(() => {});
  }

  init();
})();
