// Portal/design-import-modal.js
// -----------------------------------------------------------------------------
// Controlador do modal de importação (3 etapas: Arquivo -> Revisão -> Salvar)
// da Biblioteca de Templates.
//
// A MÁQUINA DE ESTADOS (createImportController) é PURA: recebe o registro de
// importadores (design-import-registry.js) e metadados de arquivo já lidos
// (texto para JSON/SVG, dataUrl+dimensões para imagem) — nunca um File ou
// FileReader diretamente. Isso deixa toda a lógica de "que etapa mostrar",
// "qual importador usar" e "o que enviar para build()" testável em Node.
//
// A parte que só existe no navegador (drag&drop, <input type=file>,
// FileReader, Image() para medir dimensões) mora em bindImportModalDom, que
// só chama os métodos do controlador — nunca decide sozinha o que é válido.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_IMPORT_MODAL = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STEPS = ["file", "review", "save"];

  function initialState() {
    return { step: "file", fileMeta: null, importer: null, analysis: null, errorMessage: null, saveDefaults: null };
  }

  function createImportController(deps) {
    const config = deps || {};
    const registry = config.registry;
    if (!registry) throw new Error("createImportController precisa de registry.");

    let state = initialState();

    function getState() {
      return state;
    }

    function reset() {
      state = initialState();
      return state;
    }

    // fileMeta: { name, size, type }. Devolve o importador resolvido pela
    // extensão, ou null quando o formato não é suportado.
    function pickImporter(fileName) {
      return registry.resolveByFileName(fileName);
    }

    // rawInput: string (JSON/SVG, texto do arquivo já lido) OU
    // { dataUrl, width, height, mimeType } (imagem). Quem lê o arquivo de
    // fato é bindImportModalDom; este método só decide e valida.
    function analyzeFile(fileMeta, rawInput) {
      const meta = fileMeta || {};
      const importer = pickImporter(meta.name);
      if (!importer) {
        state = {
          ...initialState(),
          errorMessage: `Formato não suportado. Use: ${registry.acceptedExtensions().join(", ")}.`,
        };
        return state;
      }

      const input = importer.id === "image"
        ? { ...(rawInput || {}), fileName: meta.name, sizeBytes: meta.size, mimeType: (rawInput && rawInput.mimeType) || meta.type }
        : { text: String(rawInput || ""), fileName: meta.name, sizeBytes: meta.size };

      const analysis = importer.analyze(input);
      if (!analysis.ok) {
        state = { ...initialState(), importer, errorMessage: analysis.mensagem };
        return state;
      }

      state = { step: "review", fileMeta: meta, importer, analysis, errorMessage: null, saveDefaults: null };
      return state;
    }

    // Etapa 2 -> 3. `defaults`: { itemType, clienteId, accountRef } vindos da
    // tela (cliente ativo no momento em que o modal foi aberto).
    function goToSave(defaults) {
      if (state.step !== "review" || !state.analysis) {
        throw Object.assign(new Error("É preciso revisar o arquivo antes de salvar."), { codigo: "ETAPA_INVALIDA" });
      }
      const info = defaults || {};
      state = {
        ...state,
        step: "save",
        saveDefaults: {
          name: state.analysis.summary.name || state.fileMeta.name || "Novo item",
          itemType: info.itemType === "artwork" ? "artwork" : "template",
          clienteId: info.clienteId ?? null,
          accountRef: info.accountRef ?? null,
        },
      };
      return state;
    }

    function backTo(step) {
      if (!STEPS.includes(step)) throw new Error(`Etapa desconhecida: ${step}.`);
      const stepIndex = STEPS.indexOf(step);
      const currentIndex = STEPS.indexOf(state.step);
      if (stepIndex >= currentIndex) return state;
      state = { ...state, step };
      return state;
    }

    // Etapa 3: constrói o documento final a partir da escolha do usuário
    // (nome, template/arte, cliente, conta vinculada). Não persiste —
    // devolve { document, warnings } para a tela salvar via API do estúdio.
    async function confirmSave(options) {
      if (state.step !== "save" || !state.analysis || !state.importer) {
        throw Object.assign(new Error("Etapa inválida para salvar."), { codigo: "ETAPA_INVALIDA" });
      }
      const chosen = options || {};
      const result = await state.importer.build(state.analysis, {
        name: chosen.name || state.saveDefaults.name,
        clienteId: chosen.clienteId ?? state.saveDefaults.clienteId,
        accountRef: chosen.accountRef ?? state.saveDefaults.accountRef,
        itemType: chosen.itemType || state.saveDefaults.itemType,
      });
      return result;
    }

    return Object.freeze({ STEPS, getState, reset, pickImporter, analyzeFile, goToSave, backTo, confirmSave });
  }

  /* ── ligação com o DOM (navegador) ─────────────────────────────────────── */

  const IMAGE_MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

  function extensionOf(fileName) {
    const match = /\.([a-z0-9]+)$/i.exec(String(fileName || ""));
    return match ? match[1].toLowerCase() : "";
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Falha ao ler o arquivo."));
      reader.readAsText(file);
    });
  }

  function readFileAsImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve({ dataUrl: String(reader.result || ""), width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error("Não foi possível ler as dimensões da imagem."));
        img.src = reader.result;
      };
      reader.onerror = () => reject(reader.error || new Error("Falha ao ler o arquivo."));
      reader.readAsDataURL(file);
    });
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  // ids: { overlay, dropzone, fileInput, errorBox, errorText, stepFile,
  //   stepReview, stepSave, reviewFileName, reviewFormat, reviewSize,
  //   reviewDimensions, reviewPages, reviewObjects, reviewWarnings,
  //   saveName, saveTypeTemplate, saveTypeArtwork, saveAccountField,
  //   saveAccount, back, cancel, next, closeX (opcional),
  //   stepIndicatorFile/stepIndicatorReview/stepIndicatorSave (opcionais) }
  // hooks: { getContext(): {clienteId, accountRef}, listAccounts(): [{account_ref, display_name}],
  //   onImported(document, {warnings}), toast(kind, title, message) }
  function bindImportModalDom(controller, ids, hooks) {
    const byId = (id) => document.getElementById(id);
    let itemType = "template";

    function setPanel(el, active) {
      if (!el) return;
      el.classList.toggle("is-active", active);
      el.hidden = !active;
    }

    function setIndicator(id, step, current) {
      const el = id && byId(id);
      if (!el) return;
      const order = ["file", "review", "save"];
      el.classList.toggle("is-active", step === current);
      el.classList.toggle("is-done", order.indexOf(step) < order.indexOf(current));
    }

    function showStep(step) {
      setPanel(byId(ids.stepFile), step === "file");
      setPanel(byId(ids.stepReview), step === "review");
      setPanel(byId(ids.stepSave), step === "save");
      setIndicator(ids.stepIndicatorFile, "file", step);
      setIndicator(ids.stepIndicatorReview, "review", step);
      setIndicator(ids.stepIndicatorSave, "save", step);
      byId(ids.back).hidden = step === "file";
      byId(ids.next).textContent = step === "save" ? "Salvar e abrir" : "Avançar";
      byId(ids.next).disabled = step === "file";
    }

    function showError(message) {
      const box = byId(ids.errorBox);
      const text = byId(ids.errorText);
      box.hidden = !message;
      if (text) text.textContent = message || "";
    }

    function open() {
      controller.reset();
      itemType = "template";
      showError(null);
      showStep("file");
      byId(ids.fileInput).value = "";
      byId(ids.overlay).classList.add("is-open");
      byId(ids.overlay).setAttribute("aria-hidden", "false");
    }

    function close() {
      byId(ids.overlay).classList.remove("is-open");
      byId(ids.overlay).setAttribute("aria-hidden", "true");
    }

    async function handleFile(file) {
      if (!file) return;
      showError(null);
      const ext = extensionOf(file.name);
      try {
        const rawInput = ["png", "jpg", "jpeg", "webp"].includes(ext)
          ? { ...(await readFileAsImage(file)), mimeType: IMAGE_MIME_BY_EXT[ext] || file.type }
          : await readFileAsText(file);
        const state = controller.analyzeFile({ name: file.name, size: file.size, type: file.type }, rawInput);
        if (state.step !== "review") {
          showError(state.errorMessage || "Não foi possível importar este arquivo.");
          return;
        }
        renderReview(state.analysis.summary, file.name);
        showStep("review");
        byId(ids.next).disabled = false;
      } catch (error) {
        showError(error.message || "Não foi possível ler o arquivo.");
      }
    }

    function renderReview(summary, fileName) {
      byId(ids.reviewFileName).textContent = fileName;
      byId(ids.reviewFormat).textContent = summary.format.toUpperCase();
      byId(ids.reviewSize).textContent = formatBytes(summary.sizeBytes);
      byId(ids.reviewDimensions).textContent = summary.width && summary.height
        ? `${summary.width} × ${summary.height} px` : "—";
      byId(ids.reviewPages).textContent = String(summary.pageCount ?? 1);
      byId(ids.reviewObjects).textContent = String(summary.objectCount ?? "—");
      const warningsList = byId(ids.reviewWarnings);
      warningsList.replaceChildren(...(summary.warnings || []).map((warning) => {
        const li = document.createElement("li");
        li.textContent = warning;
        return li;
      }));
    }

    function setItemType(next) {
      itemType = next;
      byId(ids.saveTypeTemplate).classList.toggle("is-active", next === "template");
      byId(ids.saveTypeTemplate).setAttribute("aria-pressed", String(next === "template"));
      byId(ids.saveTypeArtwork).classList.toggle("is-active", next === "artwork");
      byId(ids.saveTypeArtwork).setAttribute("aria-pressed", String(next === "artwork"));
      byId(ids.saveAccountField).hidden = next !== "artwork";
    }

    function renderSaveStep() {
      const state = controller.getState();
      byId(ids.saveName).value = state.analysis.summary.name || state.fileMeta.name;
      if (ids.saveClientName) {
        const label = byId(ids.saveClientName);
        if (label) label.textContent = (hooks.getClientLabel && hooks.getClientLabel()) || "—";
      }
      const accounts = hooks.listAccounts ? hooks.listAccounts() : [];
      const select = byId(ids.saveAccount);
      select.replaceChildren();
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "Todas / não definida";
      select.appendChild(none);
      accounts.forEach((account) => {
        const option = document.createElement("option");
        option.value = account.account_ref;
        option.textContent = account.display_name;
        select.appendChild(option);
      });
      setItemType("template");
    }

    byId(ids.dropzone).addEventListener("click", () => byId(ids.fileInput).click());
    byId(ids.dropzone).addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") byId(ids.fileInput).click();
    });
    ["dragover", "dragenter"].forEach((type) => byId(ids.dropzone).addEventListener(type, (event) => {
      event.preventDefault();
      byId(ids.dropzone).classList.add("is-dragging");
    }));
    ["dragleave", "drop"].forEach((type) => byId(ids.dropzone).addEventListener(type, () => {
      byId(ids.dropzone).classList.remove("is-dragging");
    }));
    byId(ids.dropzone).addEventListener("drop", (event) => {
      event.preventDefault();
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      handleFile(file);
    });
    byId(ids.fileInput).addEventListener("change", (event) => handleFile(event.target.files && event.target.files[0]));

    byId(ids.saveTypeTemplate).addEventListener("click", () => setItemType("template"));
    byId(ids.saveTypeArtwork).addEventListener("click", () => setItemType("artwork"));

    byId(ids.back).addEventListener("click", () => {
      const state = controller.getState();
      if (state.step === "review") { showStep("file"); controller.backTo("file"); return; }
      if (state.step === "save") { showStep("review"); controller.backTo("review"); }
    });

    byId(ids.cancel).addEventListener("click", close);
    if (ids.closeX) byId(ids.closeX)?.addEventListener("click", close);
    byId(ids.overlay).addEventListener("click", (event) => { if (event.target === byId(ids.overlay)) close(); });

    byId(ids.next).addEventListener("click", async () => {
      const state = controller.getState();
      if (state.step === "review") {
        const context = hooks.getContext ? hooks.getContext() : {};
        controller.goToSave({ itemType, clienteId: context.clienteId, accountRef: context.accountRef });
        renderSaveStep();
        showStep("save");
        return;
      }
      if (state.step === "save") {
        try {
          const result = await controller.confirmSave({
            name: byId(ids.saveName).value,
            itemType,
            accountRef: itemType === "artwork" ? (byId(ids.saveAccount).value || null) : null,
          });
          close();
          hooks.onImported(result.document, { warnings: result.warnings });
        } catch (error) {
          hooks.toast?.("danger", "Não foi possível importar", error.message);
        }
      }
    });

    return Object.freeze({ open, close });
  }

  return { createImportController, STEPS, bindImportModalDom };
});
