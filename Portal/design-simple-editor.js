// Portal/design-simple-editor.js
// -----------------------------------------------------------------------------
// Editor Reduzido da Biblioteca de Templates: canvas Fabric.js, painel de
// páginas, painel de objetos (design-simple-layers.js) e propriedades
// básicas. Não é um editor completo (sem grupos complexos, máscaras, edição
// vetorial de nós, IA) — só o necessário para ajustar um template importado
// ou migrado antes de reutilizá-lo.
//
// Como o resto da tela (design-studio-workspace.js), este módulo fala
// diretamente com o DOM por id: só faz sentido dentro de design-templates.html.
// A parte PURA (que specs de propriedade cada tipo de objeto mostra, os
// defaults de um objeto inserido, o payload de "salvar versão") fica em
// funções isoladas, exportadas para teste em Node — o resto (Fabric.Canvas
// real, FileReader, drag) só roda no navegador.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_SIMPLE_EDITOR = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Propriedades customizadas preservadas pelo Fabric ao serializar
  // (canvas.toJSON(VF_PROPS) / obj.toObject(VF_PROPS)).
  const VF_PROPS = ["vfId", "vfName", "vfType", "vfLocked", "vfHidden"];
  const THUMBNAIL_MAX_SIDE = 320;

  /* ── specs de propriedades por tipo (PURO) ────────────────────────────── */

  const COMMON_FIELDS = [
    { key: "left", label: "Posição X", kind: "number" },
    { key: "top", label: "Posição Y", kind: "number" },
    { key: "width", label: "Largura", kind: "number", derived: true },
    { key: "height", label: "Altura", kind: "number", derived: true },
    { key: "angle", label: "Rotação", kind: "number" },
    { key: "opacity", label: "Opacidade", kind: "range", min: 0, max: 1, step: 0.05 },
  ];

  const TEXT_FIELDS = [
    { key: "text", label: "Conteúdo", kind: "textarea" },
    { key: "fontSize", label: "Tamanho", kind: "number" },
    { key: "fontFamily", label: "Fonte", kind: "select", options: ["Manrope", "Hanken Grotesk", "Arial", "Georgia"] },
    { key: "fontWeight", label: "Peso", kind: "select", options: ["400", "500", "600", "700", "800"] },
    { key: "textAlign", label: "Alinhamento", kind: "select", options: ["left", "center", "right"] },
    { key: "fill", label: "Cor", kind: "color" },
  ];

  const SHAPE_FIELDS = [
    { key: "fill", label: "Preenchimento", kind: "color" },
    { key: "stroke", label: "Contorno", kind: "color" },
    { key: "strokeWidth", label: "Espessura do contorno", kind: "number" },
  ];

  // cropX/cropY: recorte básico (Fabric usa esses dois campos junto com
  // width/height, já presentes em COMMON_FIELDS, para mostrar só uma janela
  // da imagem original). "Substituir"/"restaurar proporção" são ações, não
  // campos — entram como botões no painel, ver renderProperties.
  const IMAGE_FIELDS = [
    { key: "cropX", label: "Recorte X", kind: "number" },
    { key: "cropY", label: "Recorte Y", kind: "number" },
  ];

  // Presentes em todo objeto, mas tratados à parte no input handler
  // (visibilidade é `object.set("visible", ...)`; bloqueio também trava
  // seleção/edição, então passa por design-simple-layers.js).
  const VISIBILITY_FIELDS = [
    { key: "visible", label: "Visível", kind: "checkbox" },
    { key: "locked", label: "Bloqueado", kind: "checkbox" },
  ];

  const TEXT_TYPES = new Set(["textbox", "text", "i-text"]);
  const SHAPE_TYPES = new Set(["rect", "circle"]);

  // object: representação simples { type, vfType }. Devolve a lista de campos
  // que o painel de propriedades deve mostrar para esse objeto.
  function propertyFieldsFor(object) {
    const type = String((object && object.type) || "").toLowerCase();
    const fields = COMMON_FIELDS.slice();
    if (TEXT_TYPES.has(type)) return fields.concat(TEXT_FIELDS, VISIBILITY_FIELDS);
    if (SHAPE_TYPES.has(type)) return fields.concat(SHAPE_FIELDS, VISIBILITY_FIELDS);
    if (type === "image") return fields.concat(IMAGE_FIELDS, VISIBILITY_FIELDS);
    return fields.concat(VISIBILITY_FIELDS);
  }

  // Objeto inserido pela barra "Inserção básica" — sempre com metadados vf*.
  function buildInsertedObject(kind, options) {
    const opts = options || {};
    const base = {
      vfId: opts.vfId,
      vfLocked: false,
      vfHidden: false,
      left: Number.isFinite(opts.left) ? opts.left : 80,
      top: Number.isFinite(opts.top) ? opts.top : 80,
      opacity: 1,
      angle: 0,
    };
    if (kind === "text") {
      return { ...base, type: "textbox", vfType: "text", vfName: "Texto", text: "Novo texto", fontSize: 42, fontFamily: "Manrope", fontWeight: "600", fill: "#21162C", width: 320 };
    }
    if (kind === "rect") {
      return { ...base, type: "rect", vfType: "rect", vfName: "Retângulo", width: 220, height: 140, fill: "#5A2A8F" };
    }
    if (kind === "circle") {
      return { ...base, type: "circle", vfType: "circle", vfName: "Círculo", radius: 90, fill: "#F2B84B" };
    }
    if (kind === "image" || kind === "logo") {
      return {
        ...base, type: "image", vfType: kind === "logo" ? "logo" : "image",
        vfName: kind === "logo" ? "Logo" : "Imagem", src: opts.src || null,
        width: opts.width || 300, height: opts.height || 300,
      };
    }
    throw new Error(`Tipo de inserção desconhecido: "${kind}".`);
  }

  // Monta o payload de "Salvar versão": grava a página ativa (canvas atual)
  // de volta no documento antes de enviar para o backend.
  function buildSaveState(document_, activePageId, activeFabricJson, thumbnail) {
    const pages = document_.pages.map((page) => (
      page.id === activePageId ? { ...page, fabricJson: activeFabricJson } : page
    ));
    const updated = { ...document_, pages, updatedAt: new Date().toISOString() };
    return { document: updated, thumbnail: thumbnail || null };
  }

  /* ── orquestração no navegador ─────────────────────────────────────────── */

  function createSimpleEditor(deps) {
    const config = deps || {};
    const documentModel = config.documentModel;
    const legacyMigrationLib = config.legacyMigrationLib;
    const layersLib = config.layersLib;
    const exportLib = config.exportLib;
    const workspace = config.workspace;
    if (!documentModel) throw new Error("createSimpleEditor precisa de documentModel.");

    const byId = (id) => document.getElementById(id);
    const layers = layersLib ? layersLib.createSimpleLayers({ documentModel }) : null;

    const state = {
      document: null,
      context: null,
      activePageId: null,
      canvas: null,
      selectedLayerId: null,
      dirty: false,
      loadingPage: false,
    };

function setStatus(text, kind) {
      state.dirty = kind === "dirty" || kind === "saving";
      const el = byId("dse-status");
      if (!el) return;
      el.textContent = text;
      el.classList.remove("is-dirty", "is-saving", "is-error");
      if (kind) el.classList.add(`is-${kind}`);
    }

    function markDirty() {
      setStatus("Alterações não salvas", "dirty");
    }

    function fabricLib() {
      return (typeof window !== "undefined" && window.fabric) || null;
    }

    /* ── páginas ───────────────────────────────────────────────────────── */

    function activePage() {
      return state.document.pages.find((page) => page.id === state.activePageId) || state.document.pages[0];
    }

    // Congela o estado atual do canvas de volta na página ativa do
    // documento em memória — chamado antes de trocar de página ou salvar.
    function commitCanvasToDocument() {
      if (!state.canvas) return;
      const fabricJson = state.canvas.toJSON(VF_PROPS);
      state.document = {
        ...state.document,
        pages: state.document.pages.map((page) => (
          page.id === state.activePageId ? { ...page, fabricJson } : page
        )),
      };
    }

    async function loadPageIntoCanvas(page) {
      if (!state.canvas) return;

      state.loadingPage = true;
      try {
        state.canvas.clear();
        state.canvas.setDimensions({ width: page.width, height: page.height });
        state.canvas.backgroundColor = page.background || "#ffffff";

        const fabricJson = page.fabricJson || { version: "6.9.1", objects: [] };
        if (Array.isArray(fabricJson.objects) && fabricJson.objects.length) {
          await state.canvas.loadFromJSON(fabricJson);
        }

        state.canvas.getObjects().forEach((object) => {
          if (object.vfLocked) object.set({ selectable: false, evented: false });
          if (object.vfHidden) object.set("visible", false);
        });

        state.canvas.requestRenderAll();
      } finally {
        state.loadingPage = false;
      }
    }

    function updateEmptyCanvasMessage() {
      const message = byId("dse-empty-canvas-message");
      if (!message || !state.canvas) return;
      message.hidden = state.canvas.getObjects().length > 0;
    }

    async function renderLoadedPage() {
      await loadPageIntoCanvas(activePage());
      renderPagesList();
      renderLayers();
      renderProperties(null);
      updateEmptyCanvasMessage();
    }

    async function selectPage(pageId) {
      commitCanvasToDocument();
      state.activePageId = pageId;
      await renderLoadedPage();
    }

    function renderPagesList() {
      const list = byId("dse-pages-list");
      if (!list) return;
      list.replaceChildren(...state.document.pages.map((page, index) => {
        const item = document.createElement("li");
        item.className = `dse-page-item${page.id === state.activePageId ? " is-active" : ""}`;
        item.addEventListener("click", () => {
          runEditorTask(() => selectPage(page.id), "Não foi possível abrir a página");
        });

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "dse-page-item__name";
        nameInput.value = page.name || `Página ${index + 1}`;
        nameInput.addEventListener("click", (event) => event.stopPropagation());
        nameInput.addEventListener("change", () => {
          commitCanvasToDocument();
          state.document = documentModel.renamePage(state.document, page.id, nameInput.value);
          markDirty();
        });
        item.appendChild(nameInput);

        const actions = document.createElement("div");
        actions.className = "dse-page-item__actions";
        actions.appendChild(iconButton("⧉", "Duplicar página", (event) => {
          event.stopPropagation();
          commitCanvasToDocument();
          state.document = documentModel.duplicatePage(state.document, page.id);
          renderPagesList();
          markDirty();
        }));
        actions.appendChild(iconButton("×", "Excluir página", async (event) => {
          event.stopPropagation();
          if (state.document.pages.length <= 1) return;
          if (!window.confirm("Excluir esta página?")) return;
          const wasActive = page.id === state.activePageId;
          state.document = documentModel.removePage(state.document, page.id);
          if (wasActive) state.activePageId = state.document.pages[0].id;
          await renderLoadedPage();
          markDirty();
        }));
        item.appendChild(actions);
        return item;
      }));
    }

    function iconButton(label, title, handler) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dse-icon-btn";
      button.title = title;
      button.setAttribute("aria-label", title);
      button.textContent = label;
      button.addEventListener("click", (event) => {
        runEditorTask(() => handler(event), `Não foi possível ${title.toLowerCase()}`);
      });
      return button;
    }

    async function runEditorTask(action, title) {
      try {
        await action();
      } catch (error) {
        console.error(title, error);
        config.toast?.("danger", title, error.message || "Tente novamente.");
      }
    }

    /* ── painel de objetos ────────────────────────────────────────────── */

    function renderLayers() {
      const list = byId("dse-objects-list");
      if (!list || !layers || !state.canvas) return;
      const active = state.canvas.getActiveObject();
      const items = layers.listLayers(state.canvas);
      list.replaceChildren(...items.map((item) => {
        const row = document.createElement("li");
        row.className = `dse-object-item${active && active.vfId === item.id ? " is-active" : ""}`;
        row.addEventListener("click", () => {
          const object = layers.findByLayerId(state.canvas, item.id);
          if (object) {
            state.canvas.setActiveObject(object);
            state.canvas.requestRenderAll();
          }
        });

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "dse-object-item__name";
        nameInput.value = item.name;
        nameInput.addEventListener("click", (event) => event.stopPropagation());
        nameInput.addEventListener("change", () => {
          layers.rename(state.canvas, item.id, nameInput.value);
          markDirty();
        });

        const actions = document.createElement("div");
        actions.className = "dse-object-item__actions";
        actions.appendChild(iconButton(item.visible ? "◉" : "◎", "Mostrar/ocultar", (event) => {
          event.stopPropagation();
          layers.toggleVisible(state.canvas, item.id);
          renderLayers();
          markDirty();
        }));
        actions.appendChild(iconButton(item.locked ? "🔒" : "🔓", "Bloquear/desbloquear", (event) => {
          event.stopPropagation();
          layers.toggleLocked(state.canvas, item.id);
          renderLayers();
          markDirty();
        }));
        actions.appendChild(iconButton("×", "Excluir objeto", (event) => {
          event.stopPropagation();
          layers.remove(state.canvas, item.id);
          renderLayers();
          renderProperties(null);
          markDirty();
        }));
        row.append(nameInput, actions);
        return row;
      }));
    }

    /* ── painel de propriedades ───────────────────────────────────────── */

// Painel de propriedades: o container só traz o parágrafo "vazio" no HTML
    // (ver design-templates.html); os campos entram num <div> criado uma vez
    // e reaproveitado nas próximas seleções.
    function propertiesFieldsContainer() {
      const panel = byId("dse-properties");
      if (!panel) return null;
      let fields = panel.querySelector("#dse-properties-fields");
      if (!fields) {
        fields = document.createElement("div");
        fields.id = "dse-properties-fields";
        panel.appendChild(fields);
      }
      return fields;
    }

    function renderProperties(object) {
      const empty = byId("dse-properties-empty");
      const fields = propertiesFieldsContainer();
      if (!fields || !empty) return;
      if (!object) {
        empty.hidden = false;
        fields.hidden = true;
        fields.replaceChildren();
        return;
      }
      empty.hidden = true;
      fields.hidden = false;
      const specs = propertyFieldsFor(object);
      const rows = specs.map((spec) => {
        const row = document.createElement("div");
        row.className = "dse-prop-row dse-prop-row--full";
        const wrapper = document.createElement("div");
        wrapper.className = "dse-prop-field";
        row.appendChild(wrapper);
        const labelEl = document.createElement("label");
        const captionEl = document.createElement("span");
        captionEl.textContent = spec.label;
        labelEl.appendChild(captionEl);

        let input;
        if (spec.kind === "checkbox") {
          input = document.createElement("input");
          input.type = "checkbox";
        } else if (spec.kind === "textarea") {
          input = document.createElement("textarea");
          input.className = "vf-textarea";
          input.rows = 3;
        } else if (spec.kind === "select") {
          input = document.createElement("select");
          input.className = "vf-select";
          spec.options.forEach((value) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            input.appendChild(option);
          });
        } else if (spec.kind === "color") {
          input = document.createElement("input");
          input.type = "color";
        } else if (spec.kind === "range") {
          input = document.createElement("input");
          input.type = "range";
          input.min = String(spec.min);
          input.max = String(spec.max);
          input.step = String(spec.step);
        } else {
          input = document.createElement("input");
          input.type = "number";
          input.className = "vf-input";
        }
        input.disabled = Boolean(spec.derived);

        // "visível" e "bloqueado" passam pelo painel de objetos (design-simple-
        // layers.js): bloquear também precisa desligar selectable/evented, e
        // os dois precisam refletir na lista de objetos, não só no canvas.
        if (spec.key === "visible") {
          input.checked = object.visible !== false;
          input.addEventListener("change", () => {
            if (layers) layers.setVisible(state.canvas, object.vfId, input.checked);
            else object.set("visible", input.checked);
            state.canvas.requestRenderAll();
            renderLayers();
            markDirty();
          });
        } else if (spec.key === "locked") {
          input.checked = Boolean(object.vfLocked);
          input.addEventListener("change", () => {
            if (layers) layers.setLocked(state.canvas, object.vfId, input.checked);
            state.canvas.requestRenderAll();
            renderLayers();
            markDirty();
          });
        } else {
          const currentValue = object[spec.key];
          if (currentValue !== undefined) input.value = currentValue;
          input.addEventListener("input", () => {
            const value = spec.kind === "range" || spec.kind === "number" ? Number(input.value) : input.value;
            object.set(spec.key, value);
            state.canvas.requestRenderAll();
            markDirty();
          });
        }

        labelEl.appendChild(input);
        wrapper.appendChild(labelEl);
        return row;
      });

      if (String(object.type).toLowerCase() === "image") rows.push(...imageActionRows(object));

      fields.replaceChildren(...rows);
    }

    // Ações específicas de imagem que não são um campo simples: substituir o
    // arquivo (mantém posição/tamanho) e restaurar a proporção original
    // (reseta scaleY para igualar scaleX, desfazendo distorção).
function actionRow(label, className, handler) {
      const row = document.createElement("div");
      row.className = "dse-prop-row dse-prop-row--full";
      const wrapper = document.createElement("div");
      wrapper.className = "dse-prop-field";
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = label;
      button.addEventListener("click", handler);
      wrapper.appendChild(button);
      row.appendChild(wrapper);
      return row;
    }

    function imageActionRows(object) {
      return [
        actionRow("Substituir imagem", "vf-btn vf-btn--secondary vf-btn--sm", () => replaceImageObject(object)),
        actionRow("Restaurar proporção", "vf-btn vf-btn--ghost vf-btn--sm", () => {
          object.set("scaleY", object.scaleX);
          state.canvas.requestRenderAll();
          markDirty();
        }),
      ];
    }

    function replaceImageObject(object) {
      const fabric = fabricLib();
      if (!fabric) return;
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp";
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          object.setSrc(reader.result).then(() => {
            state.canvas.requestRenderAll();
            markDirty();
          });
        };
        reader.readAsDataURL(file);
      });
      input.click();
    }

    /* ── inserção básica ──────────────────────────────────────────────── */

    function addObjectToCanvas(kind, extra) {
      const fabric = fabricLib();
      if (!fabric || !state.canvas) return;
      const spec = buildInsertedObject(kind, { ...extra, vfId: documentModel.generateId() });
      const { type, text, src, ...objectOptions } = spec;
      let object;
      if (type === "textbox") object = new fabric.Textbox(text, objectOptions);
      else if (type === "rect") object = new fabric.Rect(objectOptions);
      else if (type === "circle") object = new fabric.Circle(objectOptions);
      else if (type === "image" && src) {
        fabric.Image.fromURL(src).then((img) => {
          img.set(objectOptions);
          state.canvas.add(img);
          state.canvas.setActiveObject(img);
          state.canvas.requestRenderAll();
          renderLayers();
          markDirty();
        }).catch((error) => {
          console.error("Falha ao adicionar imagem ao canvas", error);
          config.toast?.("danger", "Não foi possível adicionar a imagem", error.message || "Tente novamente.");
        });
        return;
      } else return;
      state.canvas.add(object);
      state.canvas.setActiveObject(object);
      state.canvas.requestRenderAll();
      renderLayers();
      markDirty();
    }

    /* ── ciclo de vida ─────────────────────────────────────────────────── */

    function setupCanvasOnce() {
      if (state.canvas) return state.canvas;
      const fabric = fabricLib();
      if (!fabric) throw new Error("Fabric.js indisponível.");
      const fabricObjectClass = fabric.FabricObject || fabric.Object;
      if (fabricObjectClass) {
        fabricObjectClass.customProperties = [
          ...new Set([...(fabricObjectClass.customProperties || []), ...VF_PROPS]),
        ];
      }
      const canvas = new fabric.Canvas(byId("dse-canvas"), { preserveObjectStacking: true });
      canvas.on("selection:created", (event) => renderProperties(event.selected && event.selected[0]));
      canvas.on("selection:updated", (event) => renderProperties(event.selected && event.selected[0]));
      canvas.on("selection:cleared", () => renderProperties(null));
      canvas.on("object:modified", () => { renderLayers(); markDirty(); });
      canvas.on("object:added", () => {
        if (state.loadingPage) return;
        renderLayers();
        updateEmptyCanvasMessage();
      });
      canvas.on("object:removed", () => {
        if (state.loadingPage) return;
        renderLayers();
        updateEmptyCanvasMessage();
      });
      state.canvas = canvas;
      return canvas;
    }

function showEditorView() {
      const library = byId("dtl-library-view");
      const editor = byId("dse-view");
      if (library) library.hidden = true;
      if (editor) editor.hidden = false;
    }

    function hideEditorView() {
      const library = byId("dtl-library-view");
      const editor = byId("dse-view");
      if (library) library.hidden = false;
      if (editor) editor.hidden = true;
    }

    // A tela não tem um <input type=file> próprio para a inserção de imagem
    // (só o de logo/produto do cliente, com outro dono) — criado uma vez e
    // reaproveitado a cada clique em "Imagem".
    function imageInsertInput() {
      if (imageInsertInput.el) return imageInsertInput.el;
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp";
      input.hidden = true;
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        input.value = "";
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => addObjectToCanvas("image", { src: reader.result, width: img.naturalWidth, height: img.naturalHeight });
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
      document.body.appendChild(input);
      imageInsertInput.el = input;
      return input;
    }

    function bindToolbarOnce() {
      if (bindToolbarOnce.done) return;
      bindToolbarOnce.done = true;
      byId("dse-back")?.addEventListener("click", () => {
        if (state.dirty && !window.confirm("Existem alterações não salvas. Sair mesmo assim?")) return;
        hideEditorView();
        workspace?.reload?.();
      });
      byId("dse-name")?.addEventListener("input", (event) => {
        state.document = { ...state.document, name: event.target.value };
        markDirty();
      });
      document.querySelectorAll("[data-insert]").forEach((button) => {
        button.addEventListener("click", () => {
          const kind = button.dataset.insert;
          if (kind === "image") { imageInsertInput().click(); return; }
          if (kind === "logo") {
            const logo = workspace?.getClientLogo?.();
            if (!logo || !logo.dataUrl) {
              config.toast?.("warning", "Sem logo", "Cadastre a identidade visual do cliente antes de inserir o logo.");
              return;
            }
            addObjectToCanvas("logo", { src: logo.dataUrl });
            return;
          }
          addObjectToCanvas(kind);
        });
      });
      byId("dse-add-page")?.addEventListener("click", () => {
        runEditorTask(async () => {
          commitCanvasToDocument();
          const page = documentModel.createPage({ width: activePage().width, height: activePage().height });
          state.document = documentModel.addPage(state.document, page);
          state.activePageId = state.document.pages[state.document.pages.length - 1].id;
          await renderLoadedPage();
          markDirty();
        }, "Não foi possível adicionar a página");
      });
      byId("dse-bring-front")?.addEventListener("click", () => {
        const object = state.canvas?.getActiveObject();
        if (!object || !layers) return;
        layers.bringToFront(state.canvas, object.vfId);
        markDirty();
      });
      byId("dse-send-back")?.addEventListener("click", () => {
        const object = state.canvas?.getActiveObject();
        if (!object || !layers) return;
        layers.sendToBack(state.canvas, object.vfId);
        markDirty();
      });
      byId("dse-duplicate-object")?.addEventListener("click", () => {
        runEditorTask(async () => {
          const object = state.canvas?.getActiveObject();
          if (!object) return;
          const clone = await object.clone();
          clone.set({ vfId: documentModel.generateId(), vfName: object.vfName ? `${object.vfName} (cópia)` : undefined, left: (object.left || 0) + 20, top: (object.top || 0) + 20 });
          state.canvas.add(clone);
          state.canvas.setActiveObject(clone);
          state.canvas.requestRenderAll();
          renderLayers();
          markDirty();
        }, "Não foi possível duplicar o objeto");
      });
      byId("dse-delete-object")?.addEventListener("click", () => {
        const object = state.canvas?.getActiveObject();
        if (!object) return;
        state.canvas.remove(object);
        state.canvas.discardActiveObject();
        state.canvas.requestRenderAll();
        renderLayers();
        renderProperties(null);
        markDirty();
      });
      byId("dse-save-version")?.addEventListener("click", () => save());
      byId("dse-export")?.addEventListener("click", () => {
        runEditorTask(() => exportCanvasAsPng(), "Não foi possível exportar o PNG");
      });
    }

    async function generateThumbnail() {
      if (!state.canvas) return null;
      const page = activePage();
      const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(page.width, page.height));
      return state.canvas.toDataURL({ format: "png", multiplier: scale, quality: 0.7 });
    }

    function exportCanvasAsPng() {
      if (!state.canvas || !state.document) return;
      const dataUrl = state.canvas.toDataURL({ format: "png", multiplier: 1 });
      const fileName = `${String(state.document.name || "arte")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-+|-+$/g, "") || "arte"}.png`;
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = fileName;
      link.click();
    }

    async function save() {
      commitCanvasToDocument();
      const validation = documentModel.validateDocument(state.document);
      if (!validation.ok) {
        config.toast?.("danger", "Não foi possível salvar", validation.mensagem);
        return;
      }
      setStatus("Salvando…", "saving");
      try {
        const thumbnail = await generateThumbnail();
        const built = buildSaveState(state.document, state.activePageId, activePage().fabricJson, thumbnail);
        state.context = await workspace.saveDocument(built.document, state.context, { thumbnail: built.thumbnail });
        state.document = built.document;
        setStatus("Versão salva", null);
        config.toast?.("success", "Versão salva", "O item foi atualizado no acervo do cliente.");
      } catch (error) {
        setStatus("Falha ao salvar", "error");
        config.toast?.("danger", "Não foi possível salvar", error.message);
      }
    }

    async function resolveIncomingDocument(rawDocument, context) {
      if (documentModel.isVfDesignDocument(rawDocument)) {
        const current = documentModel.sanitizeDocument(rawDocument);
        return {
          document: {
            ...current,
            clienteId: context?.clienteId ?? current.clienteId,
            itemType: context?.type === "artwork" ? "artwork" : current.itemType,
          },
          warnings: [],
        };
      }
      if (!rawDocument || Object.keys(rawDocument).length === 0) {
        return { document: documentModel.createDocument({ name: context?.name, clienteId: context?.clienteId }), warnings: [] };
      }
      if (!legacyMigrationLib) {
        return { document: documentModel.sanitizeDocument(rawDocument), warnings: [] };
      }
      const migration = legacyMigrationLib.createLegacyMigration({
        documentModel,
        templateEngine: window.VF_DESIGN_TEMPLATE_ENGINE,
        templatePresets: window.VF_DESIGN_TEMPLATE_PRESETS,
        componentsLib: window.VF_DESIGN_TEMPLATE_COMPONENTS,
        layoutsLib: window.VF_DESIGN_TEMPLATE_LAYOUTS,
        templateRendererLib: window.VF_DESIGN_TEMPLATE_RENDERER,
        builderModel: window.VF_DESIGN_TEMPLATE_BUILDER_MODEL,
        documentLike: document,
        svgToFabricJson: fabricLib() ? (svg) => fabricLib().loadSVGFromString(svg).then((result) => ({
          version: "6.9.1", objects: (result.objects || []).filter(Boolean),
        })) : null,
      });
      const result = await migration.migrateDocument(rawDocument, {
        name: context?.name, clienteId: context?.clienteId, itemType: context?.type,
      });
      return { document: result.document, warnings: result.warnings };
    }

    async function openProject(rawDocument, context) {
      try {
        setupCanvasOnce();
        bindToolbarOnce();
        const { document: resolved, warnings } = await resolveIncomingDocument(rawDocument, context);
        const onlyEmptyLegacyFallbacks = warnings.length > 0 && resolved.pages.every((page) => (
          Array.isArray(page.fabricJson?.objects)
          && page.fabricJson.objects.length === 1
          && page.fabricJson.objects[0]?.vfType === "legacy-group"
          && page.fabricJson.objects[0]?.objects?.length === 0
        ));
        if (onlyEmptyLegacyFallbacks) {
          const error = new Error("Template legado com edição limitada. Importe uma prévia PNG para usar como fundo editável.");
          error.code = "LEGACY_EDIT_LIMITED";
          throw error;
        }
        state.document = resolved;
        state.context = context || null;
        state.activePageId = resolved.pages[0].id;
        state.selectedLayerId = null;
        if (byId("dse-name")) byId("dse-name").value = resolved.name;
        const banner = byId("dse-legacy-warning");
        const bannerText = byId("dse-legacy-warning-text");
        if (banner) banner.hidden = warnings.length === 0;
        if (bannerText) bannerText.textContent = warnings.join(" ");
        await renderLoadedPage();
        showEditorView();
        setStatus(warnings.length ? "Convertido — revise antes de salvar" : "Pronto para editar", warnings.length ? "dirty" : null);
      } catch (error) {
        hideEditorView();
        console.error("Falha ao abrir projeto no Editor Reduzido", error);
        const legacyLimited = error.code === "LEGACY_EDIT_LIMITED";
        config.toast?.(
          legacyLimited ? "warning" : "danger",
          legacyLimited ? "Template legado" : "Não foi possível abrir o editor",
          legacyLimited ? error.message : "O item não pôde ser carregado. Você voltou para a biblioteca."
        );
        error.vfEditorHandled = true;
        throw error;
      }
    }

    async function newProject(client) {
      const document_ = documentModel.createDocument({
        name: "Novo template", clienteId: client?.id ?? null, source: { type: "blank" },
      });
      await openProject(document_, { type: "template", clienteId: client?.id ?? null, name: document_.name });
    }

    return Object.freeze({ openProject, newProject, VF_PROPS });
  }

  return { createSimpleEditor, propertyFieldsFor, buildInsertedObject, buildSaveState, VF_PROPS };
});
