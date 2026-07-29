// Portal/design-image-editor.js
// -----------------------------------------------------------------------------
// Editor de imagem do produto (Estúdio de Templates).
//
// Escopo: preparar a FOTOGRAFIA do produto antes dela entrar nas 7 peças.
// Não é um editor de layout — não há texto, sticker nem elemento livre.
//
// Como funciona:
//   • Um canvas Fabric de 1200x1200 (mesma resolução da peça exportada),
//     exibido em CSS reduzido. O Fabric já converte o ponteiro pela razão
//     entre o bounding rect e o backstore, então arrastar funciona igual.
//   • Todo ajuste é PARÂMETRO (objeto plano de ~15 campos), nunca pixel.
//     Desfazer/refazer navega nesses parâmetros — nenhuma cópia de imagem
//     entra no histórico.
//   • "Aplicar edição" é o único momento em que pixels são gerados:
//     canvas.toDataURL() -> 1200x1200.
//
// O módulo não conhece o projeto do Estúdio: recebe uma imagem + parâmetros e
// devolve, na promessa de open(), { editing, rendered } ou null (cancelado).
// -----------------------------------------------------------------------------

(function (root) {
  "use strict";

  const STAGE_SIZE = 1200;
  const FILTER_DEBOUNCE_MS = 120;
  const MIN_CROP_PX = 24;

  const model = root.VF_DESIGN_IMAGE_MODEL;
  if (!model) {
    console.error("[design-image-editor] design-image-model.js precisa ser carregado antes.");
    return;
  }

  const byId = (id) => document.getElementById(id);

  function fabricLib() {
    return root.fabric || null;
  }

  /* ── conversão de parâmetros -> Fabric ────────────────────────────────── */

  // Brilho do Fabric: -1..1 somado ao canal. Nossa faixa é -100..100.
  // Metade da escala mantém o ajuste utilizável (±0.5) sem estourar branco.
  function toFabricBrightness(value) {
    return (Number(value) || 0) / 200;
  }

  // Contraste do Fabric: -1..1.
  function toFabricContrast(value) {
    return (Number(value) || 0) / 150;
  }

  // Saturação do Fabric: -1..1 (−1 = cinza total).
  function toFabricSaturation(value) {
    return (Number(value) || 0) / 100;
  }

  // Nitidez via convolução 3x3. O peso central cresce com a intensidade e as
  // bordas compensam para a soma continuar 1 (não altera o brilho médio).
  function sharpenMatrix(value) {
    const intensity = model.clamp(Number(value) || 0, 0, 100) / 100;
    if (intensity <= 0) return null;
    const edge = -intensity;
    const center = 1 + 4 * intensity;
    return [0, edge, 0, edge, center, edge, 0, edge, 0];
  }

  function rgbaFromHex(hex, opacity) {
    const clean = String(hex || "#000000").replace("#", "");
    const value = Number.parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${model.clamp(opacity, 0, 1)})`;
  }

  /* ── editor ───────────────────────────────────────────────────────────── */

  function createDesignImageEditor(options) {
    const config = options || {};
    const showToast = typeof config.showToast === "function" ? config.showToast : () => {};
    const confirmar = typeof config.confirmar === "function"
      ? config.confirmar
      : (mensagem) => Promise.resolve(root.confirm(mensagem));

    // Estado vivo da sessão. Zerado a cada open().
    let sessao = null;
    let canvas = null;
    let imagem = null;
    let cropRect = null;
    let editing = model.createDefaultEditing();
    let history = model.createHistory(editing);
    let comparando = false;
    let modoCrop = false;
    let cropBackup = null;
    let resolverAbertura = null;
    let focoAnterior = null;
    let filtroTimer = null;
    let rafPendente = null;
    let aplicando = false;
    const listeners = [];

    /* ── helpers de ciclo de vida de listeners ──────────────────────────── */

    function on(alvo, evento, handler, opcoes) {
      if (!alvo) return;
      alvo.addEventListener(evento, handler, opcoes);
      listeners.push({ alvo, evento, handler, opcoes });
    }

    function removerListeners() {
      while (listeners.length) {
        const { alvo, evento, handler, opcoes } = listeners.pop();
        alvo.removeEventListener(evento, handler, opcoes);
      }
    }

    /* ── estado derivado ────────────────────────────────────────────────── */

    function dimensoesFonte() {
      if (!imagem) return { width: STAGE_SIZE, height: STAGE_SIZE };
      const crop = model.normalizeCrop(editing.crop);
      if (crop) return { width: crop.width, height: crop.height };
      const el = imagem.getElement();
      return {
        width: el.naturalWidth || el.width || STAGE_SIZE,
        height: el.naturalHeight || el.height || STAGE_SIZE,
      };
    }

    // Escala que faz a imagem (já recortada) caber no palco com respiro.
    function escalaDeAjuste() {
      const { width, height } = dimensoesFonte();
      const disponivel = STAGE_SIZE * 0.92;
      return Math.min(disponivel / width, disponivel / height);
    }

    /* ── aplicação dos parâmetros no canvas ─────────────────────────────── */

    function aplicarCrop() {
      if (!imagem) return;
      const el = imagem.getElement();
      const naturalW = el.naturalWidth || el.width;
      const naturalH = el.naturalHeight || el.height;
      const crop = model.normalizeCrop(editing.crop);
      if (!crop) {
        imagem.set({ cropX: 0, cropY: 0, width: naturalW, height: naturalH });
        return;
      }
      const x = model.clamp(crop.x, 0, Math.max(0, naturalW - 1));
      const y = model.clamp(crop.y, 0, Math.max(0, naturalH - 1));
      imagem.set({
        cropX: x,
        cropY: y,
        width: model.clamp(crop.width, 1, naturalW - x),
        height: model.clamp(crop.height, 1, naturalH - y),
      });
    }

    function aplicarTransformacao(params) {
      if (!imagem) return;
      const fabric = fabricLib();
      const escala = escalaDeAjuste() * (params.scale / 100);
      imagem.set({
        originX: "center",
        originY: "center",
        left: STAGE_SIZE / 2 + params.offsetX,
        top: STAGE_SIZE / 2 + params.offsetY,
        scaleX: escala,
        scaleY: escala,
        angle: params.rotation,
        flipX: params.flipX,
        flipY: params.flipY,
      });

      if (params.shadow && params.shadow.enabled && params.shadow.opacity > 0) {
        imagem.set("shadow", new fabric.Shadow({
          color: rgbaFromHex("#101828", params.shadow.opacity / 100),
          // Os valores do painel são relativos ao palco de 1200; o Fabric
          // aplica a sombra no espaço do objeto, então dividimos pela escala.
          blur: (params.shadow.blur * 2) / Math.max(escala, 0.0001),
          offsetX: (params.shadow.offsetX * 2) / Math.max(escala, 0.0001),
          offsetY: (params.shadow.offsetY * 2) / Math.max(escala, 0.0001),
        }));
      } else {
        imagem.set("shadow", null);
      }

      imagem.setCoords();
    }

    function aplicarFundo(params) {
      if (!canvas) return;
      canvas.backgroundColor = params.backgroundColor === model.TRANSPARENT
        ? null
        : params.backgroundColor;
    }

    function aplicarFiltros(params) {
      if (!imagem) return;
      const fabric = fabricLib();
      const filtros = [
        new fabric.filters.Brightness({ brightness: toFabricBrightness(params.brightness) }),
        new fabric.filters.Contrast({ contrast: toFabricContrast(params.contrast) }),
        new fabric.filters.Saturation({ saturation: toFabricSaturation(params.saturation) }),
      ];
      const matrix = sharpenMatrix(params.sharpen);
      if (matrix) filtros.push(new fabric.filters.Convolute({ matrix }));
      imagem.filters = filtros;
      // O Fabric descarta sozinho os filtros em estado neutro.
      imagem.applyFilters();
    }

    // Redesenho barato: só transformação/fundo. Usado durante o arraste.
    function renderizarTransformacao(params) {
      if (!canvas) return;
      const atual = params || (comparando ? model.createDefaultEditing() : editing);
      aplicarCrop();
      aplicarTransformacao(atual);
      aplicarFundo(atual);
      canvas.requestRenderAll();
    }

    // Redesenho completo (inclui filtros de cor, que são caros).
    function renderizarCompleto(params) {
      if (!canvas) return;
      const atual = params || (comparando ? model.createDefaultEditing() : editing);
      aplicarCrop();
      aplicarFiltros(atual);
      aplicarTransformacao(atual);
      aplicarFundo(atual);
      canvas.requestRenderAll();
    }

    function agendarRenderTransformacao() {
      if (rafPendente) return;
      rafPendente = root.requestAnimationFrame(() => {
        rafPendente = null;
        renderizarTransformacao();
      });
    }

    function agendarRenderFiltros() {
      if (filtroTimer) root.clearTimeout(filtroTimer);
      filtroTimer = root.setTimeout(() => {
        filtroTimer = null;
        renderizarCompleto();
      }, FILTER_DEBOUNCE_MS);
    }

    /* ── mutação de parâmetros ──────────────────────────────────────────── */

    // `commit` marca o ponto em que a alteração entra no histórico. Sliders
    // usam commit=false no "input" e commit=true no "change".
    function atualizar(patch, opcoes) {
      const commit = !opcoes || opcoes.commit !== false;
      const pesado = Boolean(opcoes && opcoes.pesado);
      editing = model.cloneEditing({ ...editing, ...patch });
      if (commit) {
        history = model.historyPush(history, editing);
      }
      if (pesado) renderizarCompleto();
      else agendarRenderTransformacao();
      sincronizarControles();
    }

    function irParaHistorico(novoHistorico) {
      history = novoHistorico;
      editing = model.historyCurrent(history);
      sairDoModoCrop({ silencioso: true });
      renderizarCompleto();
      sincronizarControles();
    }

    /* ── modo recorte ───────────────────────────────────────────────────── */

    // O recorte acontece com a imagem em pé e centralizada: a conversão
    // retângulo -> pixels da fonte fica exata e o usuário vê o que corta.
    function entrarNoModoCrop() {
      if (!imagem || modoCrop) return;
      const fabric = fabricLib();
      modoCrop = true;
      cropBackup = { rotation: editing.rotation, flipX: editing.flipX, flipY: editing.flipY };

      const neutro = model.cloneEditing({ ...editing, rotation: 0, flipX: false, flipY: false });
      aplicarCrop();
      aplicarTransformacao(neutro);
      aplicarFundo(neutro);

      const bounds = imagem.getBoundingRect();
      cropRect = new fabric.Rect({
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        fill: "rgba(90, 42, 143, 0.12)",
        stroke: "#5a2a8f",
        strokeWidth: 3,
        strokeDashArray: [14, 10],
        strokeUniform: true,
        cornerColor: "#5a2a8f",
        cornerStrokeColor: "#ffffff",
        cornerSize: 26,
        transparentCorners: false,
        lockRotation: true,
        objectCaching: false,
        noScaleCache: true,
      });
      cropRect.setControlsVisibility({ mtr: false });
      imagem.selectable = false;
      imagem.evented = false;
      canvas.add(cropRect);
      canvas.setActiveObject(cropRect);
      canvas.requestRenderAll();
      sincronizarControles();
    }

    function sairDoModoCrop(opcoes) {
      if (!modoCrop) return;
      modoCrop = false;
      if (cropRect && canvas) {
        canvas.remove(cropRect);
        cropRect = null;
      }
      if (imagem) {
        imagem.selectable = true;
        imagem.evented = true;
      }
      cropBackup = null;
      if (!opcoes || !opcoes.silencioso) {
        renderizarCompleto();
        sincronizarControles();
      }
    }

    // Converte o retângulo do palco para pixels da imagem ORIGINAL.
    // Usa a matriz inversa do objeto, então vale mesmo com espelho aplicado.
    function retanguloParaFonte(rect) {
      const fabric = fabricLib();
      const inversa = fabric.util.invertTransform(imagem.calcTransformMatrix());
      const cantos = [
        { x: rect.left, y: rect.top },
        { x: rect.left + rect.width, y: rect.top },
        { x: rect.left, y: rect.top + rect.height },
        { x: rect.left + rect.width, y: rect.top + rect.height },
      ].map((ponto) => fabric.util.transformPoint(new fabric.Point(ponto.x, ponto.y), inversa));

      const xs = cantos.map((p) => p.x);
      const ys = cantos.map((p) => p.y);

      // Coordenadas locais são relativas ao centro do objeto já recortado.
      const baseX = imagem.cropX + imagem.width / 2;
      const baseY = imagem.cropY + imagem.height / 2;

      const el = imagem.getElement();
      const naturalW = el.naturalWidth || el.width;
      const naturalH = el.naturalHeight || el.height;

      const x0 = model.clamp(baseX + Math.min(...xs), 0, naturalW);
      const y0 = model.clamp(baseY + Math.min(...ys), 0, naturalH);
      const x1 = model.clamp(baseX + Math.max(...xs), 0, naturalW);
      const y1 = model.clamp(baseY + Math.max(...ys), 0, naturalH);

      return model.normalizeCrop({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    }

    function confirmarCrop() {
      if (!modoCrop || !cropRect || !imagem) return;
      const rect = {
        left: cropRect.left,
        top: cropRect.top,
        width: cropRect.width * cropRect.scaleX,
        height: cropRect.height * cropRect.scaleY,
      };
      const crop = retanguloParaFonte(rect);
      const restaurar = cropBackup || { rotation: editing.rotation, flipX: editing.flipX, flipY: editing.flipY };

      if (!crop || crop.width < MIN_CROP_PX || crop.height < MIN_CROP_PX) {
        showToast("warning", "Recorte muito pequeno", "Selecione uma área maior da imagem.");
        return;
      }

      sairDoModoCrop({ silencioso: true });
      // Recorte muda o enquadramento: volta ao centro e à escala de ajuste.
      atualizar({ ...restaurar, crop, scale: 100, offsetX: 0, offsetY: 0 }, { pesado: true });
    }

    function ajustarCropQuadrado() {
      if (!modoCrop || !cropRect || !imagem) return;
      const bounds = imagem.getBoundingRect();
      const lado = Math.min(bounds.width, bounds.height);
      cropRect.set({
        left: bounds.left + (bounds.width - lado) / 2,
        top: bounds.top + (bounds.height - lado) / 2,
        width: lado,
        height: lado,
        scaleX: 1,
        scaleY: 1,
      });
      cropRect.setCoords();
      canvas.requestRenderAll();
    }

    function limparCrop() {
      sairDoModoCrop({ silencioso: true });
      atualizar({ crop: null, scale: 100, offsetX: 0, offsetY: 0 }, { pesado: true });
    }

    /* ── ações da barra de ferramentas ──────────────────────────────────── */

    function girar(graus) {
      atualizar({ rotation: model.normalizeRotation(editing.rotation + graus) });
    }

    function centralizar() {
      atualizar({ offsetX: 0, offsetY: 0 });
    }

    function ajustarAArea() {
      atualizar({ scale: 100, offsetX: 0, offsetY: 0, rotation: editing.rotation });
    }

    function alternarComparacao(ativo) {
      comparando = Boolean(ativo);
      renderizarCompleto();
      sincronizarControles();
    }

    function restaurarOriginal() {
      sairDoModoCrop({ silencioso: true });
      history = model.historyPush(history, model.createDefaultEditing());
      editing = model.historyCurrent(history);
      renderizarCompleto();
      sincronizarControles();
      showToast("info", "Imagem original restaurada", "Todos os ajustes foram zerados. Aplique para confirmar.");
    }

    /* ── sincronização da interface ─────────────────────────────────────── */

    function definirValor(id, valor) {
      const controle = byId(id);
      if (controle && controle.value !== String(valor)) controle.value = valor;
    }

    function definirTexto(id, texto) {
      const alvo = byId(id);
      if (alvo) alvo.textContent = texto;
    }

    function definirPressionado(id, ativo) {
      const alvo = byId(id);
      if (!alvo) return;
      alvo.classList.toggle("is-active", Boolean(ativo));
      alvo.setAttribute("aria-pressed", String(Boolean(ativo)));
    }

    function sincronizarControles() {
      definirValor("die-rotation", Math.round(editing.rotation));
      definirTexto("die-rotation-value", `${Math.round(editing.rotation)}°`);
      definirValor("die-scale", Math.round(editing.scale));
      definirTexto("die-scale-value", `${Math.round(editing.scale)}%`);
      definirValor("die-brightness", Math.round(editing.brightness));
      definirTexto("die-brightness-value", String(Math.round(editing.brightness)));
      definirValor("die-contrast", Math.round(editing.contrast));
      definirTexto("die-contrast-value", String(Math.round(editing.contrast)));
      definirValor("die-saturation", Math.round(editing.saturation));
      definirTexto("die-saturation-value", String(Math.round(editing.saturation)));
      definirValor("die-sharpen", Math.round(editing.sharpen));
      definirTexto("die-sharpen-value", String(Math.round(editing.sharpen)));

      const transparente = editing.backgroundColor === model.TRANSPARENT;
      definirPressionado("die-bg-transparent", transparente);
      definirPressionado("die-bg-color", !transparente);
      const corInput = byId("die-bg-color-input");
      if (corInput) {
        corInput.disabled = transparente;
        if (!transparente && corInput.value !== editing.backgroundColor) {
          corInput.value = editing.backgroundColor;
        }
      }

      const sombraAtiva = editing.shadow.enabled;
      const sombraSwitch = byId("die-shadow-enabled");
      if (sombraSwitch) sombraSwitch.checked = sombraAtiva;
      ["die-shadow-blur", "die-shadow-x", "die-shadow-y", "die-shadow-opacity"].forEach((id) => {
        const controle = byId(id);
        if (controle) controle.disabled = !sombraAtiva;
      });
      definirValor("die-shadow-blur", Math.round(editing.shadow.blur));
      definirTexto("die-shadow-blur-value", String(Math.round(editing.shadow.blur)));
      definirValor("die-shadow-x", Math.round(editing.shadow.offsetX));
      definirTexto("die-shadow-x-value", String(Math.round(editing.shadow.offsetX)));
      definirValor("die-shadow-y", Math.round(editing.shadow.offsetY));
      definirTexto("die-shadow-y-value", String(Math.round(editing.shadow.offsetY)));
      definirValor("die-shadow-opacity", Math.round(editing.shadow.opacity));
      definirTexto("die-shadow-opacity-value", String(Math.round(editing.shadow.opacity)));

      definirPressionado("die-flip-x", editing.flipX);
      definirPressionado("die-flip-y", editing.flipY);
      definirPressionado("die-compare", comparando);
      definirPressionado("die-crop", modoCrop);

      const desfazer = byId("die-undo");
      if (desfazer) desfazer.disabled = !model.canUndo(history);
      const refazer = byId("die-redo");
      if (refazer) refazer.disabled = !model.canRedo(history);

      const painelCrop = byId("die-crop-actions");
      if (painelCrop) painelCrop.hidden = !modoCrop;
      const limpar = byId("die-crop-clear");
      if (limpar) limpar.disabled = !editing.crop;

      const alterado = sessao ? !model.editingEquals(sessao.baseline, editing) : false;
      const marcador = byId("die-dirty");
      if (marcador) marcador.hidden = !alterado;

      // Durante a comparação os controles ficam travados: o que está na tela
      // não é o estado editável, e mexer num slider aqui confundiria.
      const painel = byId("die-panel");
      if (painel) painel.classList.toggle("is-comparing", comparando);
      const aviso = byId("die-compare-hint");
      if (aviso) aviso.hidden = !comparando;
    }

    /* ── abertura e fechamento ──────────────────────────────────────────── */

    function definirCarregando(ativo) {
      const alvo = byId("die-loading");
      if (alvo) alvo.hidden = !ativo;
      const aplicar = byId("die-apply");
      if (aplicar) aplicar.disabled = ativo;
    }

    function elementosFocaveis() {
      const modal = byId("die-modal");
      if (!modal) return [];
      return [...modal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((el) => el.offsetParent !== null || el === document.activeElement);
    }

    function prenderFoco(evento) {
      if (evento.key !== "Tab") return;
      const focaveis = elementosFocaveis();
      if (!focaveis.length) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }

    async function fechar(resultado) {
      if (!sessao) return;
      const overlay = byId("die-overlay");
      if (overlay) {
        overlay.classList.remove("is-open");
        overlay.setAttribute("aria-hidden", "true");
      }
      document.body.classList.remove("vf-no-scroll");
      destruirCanvas();
      removerListeners();
      const resolver = resolverAbertura;
      sessao = null;
      resolverAbertura = null;
      comparando = false;
      modoCrop = false;
      if (focoAnterior && typeof focoAnterior.focus === "function") focoAnterior.focus();
      focoAnterior = null;
      if (resolver) resolver(resultado);
    }

    async function tentarCancelar() {
      if (aplicando) return;
      const alterado = sessao && !model.editingEquals(sessao.baseline, editing);
      if (alterado) {
        const confirmado = await confirmar(
          "Descartar as alterações desta imagem? Elas não foram aplicadas ao template."
        );
        if (!confirmado) return;
      }
      // Cancelar não toca no projeto: a promessa resolve null e a tela
      // simplesmente não faz nada.
      fechar(null);
    }

    async function aplicar() {
      if (!canvas || !imagem || aplicando) return;
      aplicando = true;
      definirCarregando(true);
      try {
        if (modoCrop) sairDoModoCrop({ silencioso: true });
        if (comparando) comparando = false;

        // Garante que o último debounce de filtro já entrou antes de exportar.
        if (filtroTimer) {
          root.clearTimeout(filtroTimer);
          filtroTimer = null;
        }
        renderizarCompleto(editing);
        canvas.discardActiveObject();
        canvas.renderAll();

        const transparente = editing.backgroundColor === model.TRANSPARENT;
        const dataUrl = canvas.toDataURL({
          format: transparente ? "png" : "jpeg",
          quality: 0.92,
          multiplier: 1,
          enableRetinaScaling: false,
        });

        if (!model.isDataImageUrl(dataUrl)) {
          throw new Error("Data URL inválida");
        }

        fechar({
          editing: model.cloneEditing(editing),
          rendered: { dataUrl, width: STAGE_SIZE, height: STAGE_SIZE },
        });
      } catch (error) {
        console.error("[design-image-editor] falha ao aplicar:", error && error.message);
        showToast("danger", "Não foi possível aplicar", "O navegador não conseguiu gerar a imagem editada.");
        definirCarregando(false);
      } finally {
        aplicando = false;
      }
    }

    function destruirCanvas() {
      if (rafPendente) {
        root.cancelAnimationFrame(rafPendente);
        rafPendente = null;
      }
      if (filtroTimer) {
        root.clearTimeout(filtroTimer);
        filtroTimer = null;
      }
      if (canvas) {
        try {
          canvas.dispose();
        } catch (error) {
          console.error("[design-image-editor] falha ao liberar canvas:", error && error.message);
        }
        canvas = null;
      }
      imagem = null;
      cropRect = null;
    }

    function ajustarTamanhoCss() {
      const palco = byId("die-stage");
      if (!palco || !canvas) return;
      const rect = palco.getBoundingClientRect();
      const lado = Math.max(200, Math.floor(Math.min(rect.width, rect.height)));
      canvas.setDimensions({ width: `${lado}px`, height: `${lado}px` }, { cssOnly: true });
      canvas.calcOffset();
      canvas.requestRenderAll();
    }

    function ligarEventosDoCanvas() {
      // Arrastar/escalar/rotacionar pelo canvas escreve de volta nos params.
      canvas.on("object:modified", (evento) => {
        const alvo = evento && evento.target;
        if (!alvo || alvo === cropRect || !imagem) return;
        const fit = escalaDeAjuste();
        atualizar({
          scale: model.clampRange((imagem.scaleX / fit) * 100, model.ADJUSTMENT_RANGES.scale, 100),
          offsetX: imagem.left - STAGE_SIZE / 2,
          offsetY: imagem.top - STAGE_SIZE / 2,
          rotation: model.normalizeRotation(imagem.angle),
        });
      });
      canvas.on("object:moving", () => {
        const marcador = byId("die-dirty");
        if (marcador) marcador.hidden = false;
      });
    }

    function ligarControles() {
      const sliders = [
        ["die-rotation", "rotation", false],
        ["die-scale", "scale", false],
        ["die-brightness", "brightness", true],
        ["die-contrast", "contrast", true],
        ["die-saturation", "saturation", true],
        ["die-sharpen", "sharpen", true],
      ];

      sliders.forEach(([id, campo, pesado]) => {
        const controle = byId(id);
        if (!controle) return;
        on(controle, "input", () => {
          editing = model.cloneEditing({ ...editing, [campo]: Number(controle.value) });
          if (pesado) agendarRenderFiltros();
          else agendarRenderTransformacao();
          sincronizarControles();
        });
        // O commit no histórico acontece só ao soltar o controle.
        on(controle, "change", () => {
          atualizar({ [campo]: Number(controle.value) }, { pesado });
        });
      });

      const sombras = [
        ["die-shadow-blur", "blur"],
        ["die-shadow-x", "offsetX"],
        ["die-shadow-y", "offsetY"],
        ["die-shadow-opacity", "opacity"],
      ];
      sombras.forEach(([id, campo]) => {
        const controle = byId(id);
        if (!controle) return;
        on(controle, "input", () => {
          editing = model.cloneEditing({
            ...editing,
            shadow: { ...editing.shadow, [campo]: Number(controle.value) },
          });
          agendarRenderTransformacao();
          sincronizarControles();
        });
        on(controle, "change", () => {
          atualizar({ shadow: { ...editing.shadow, [campo]: Number(controle.value) } });
        });
      });

      const sombraSwitch = byId("die-shadow-enabled");
      on(sombraSwitch, "change", () => {
        const ligado = sombraSwitch.checked;
        const atual = editing.shadow;
        atualizar({
          shadow: ligado
            ? {
              enabled: true,
              // Ligar a sombra com tudo zerado não mostraria nada: entra um
              // preset discreto que o usuário ajusta depois.
              blur: atual.blur || 18,
              offsetX: atual.offsetX,
              offsetY: atual.offsetY || 10,
              opacity: atual.opacity || 35,
            }
            : { ...atual, enabled: false },
        });
      });

      on(byId("die-bg-transparent"), "click", () => atualizar({ backgroundColor: model.TRANSPARENT }));
      on(byId("die-bg-color"), "click", () => {
        const corInput = byId("die-bg-color-input");
        const cor = corInput && model.isHexColor(corInput.value) ? corInput.value : "#ffffff";
        atualizar({ backgroundColor: cor });
      });
      const corInput = byId("die-bg-color-input");
      on(corInput, "input", () => {
        if (!model.isHexColor(corInput.value)) return;
        editing = model.cloneEditing({ ...editing, backgroundColor: corInput.value });
        agendarRenderTransformacao();
      });
      on(corInput, "change", () => {
        if (model.isHexColor(corInput.value)) atualizar({ backgroundColor: corInput.value });
      });

      on(byId("die-rotate-left"), "click", () => girar(-90));
      on(byId("die-rotate-right"), "click", () => girar(90));
      on(byId("die-flip-x"), "click", () => atualizar({ flipX: !editing.flipX }));
      on(byId("die-flip-y"), "click", () => atualizar({ flipY: !editing.flipY }));
      on(byId("die-center"), "click", centralizar);
      on(byId("die-fit"), "click", ajustarAArea);
      on(byId("die-crop"), "click", () => (modoCrop ? sairDoModoCrop() : entrarNoModoCrop()));
      on(byId("die-crop-square"), "click", ajustarCropQuadrado);
      on(byId("die-crop-confirm"), "click", confirmarCrop);
      on(byId("die-crop-cancel"), "click", () => sairDoModoCrop());
      on(byId("die-crop-clear"), "click", limparCrop);
      on(byId("die-undo"), "click", () => irParaHistorico(model.historyUndo(history)));
      on(byId("die-redo"), "click", () => irParaHistorico(model.historyRedo(history)));
      on(byId("die-restore"), "click", restaurarOriginal);
      on(byId("die-compare"), "click", () => alternarComparacao(!comparando));
      on(byId("die-apply"), "click", aplicar);
      on(byId("die-cancel"), "click", tentarCancelar);
      on(byId("die-close"), "click", tentarCancelar);

      on(byId("die-overlay"), "mousedown", (evento) => {
        if (evento.target === byId("die-overlay")) tentarCancelar();
      });

      on(document, "keydown", aoPressionarTecla, true);
      on(root, "resize", ajustarTamanhoCss);
    }

    function aoPressionarTecla(evento) {
      if (!sessao) return;
      const modal = byId("die-modal");
      if (!modal) return;

      // Se a confirmação da tela estiver por cima, quem manda no teclado é ela.
      const outroOverlay = document.querySelector(".vf-overlay.is-open:not(#die-overlay)");
      if (outroOverlay) return;

      if (evento.key === "Tab") {
        prenderFoco(evento);
        return;
      }

      if (evento.key === "Escape") {
        evento.preventDefault();
        evento.stopPropagation();
        if (modoCrop) sairDoModoCrop();
        else tentarCancelar();
        return;
      }

      const meta = evento.ctrlKey || evento.metaKey;
      const tecla = String(evento.key || "").toLowerCase();

      if (meta && tecla === "z") {
        evento.preventDefault();
        irParaHistorico(evento.shiftKey ? model.historyRedo(history) : model.historyUndo(history));
        return;
      }
      if (meta && tecla === "y") {
        evento.preventDefault();
        irParaHistorico(model.historyRedo(history));
        return;
      }
      if (meta && evento.key === "Enter") {
        evento.preventDefault();
        aplicar();
        return;
      }

      // Atalhos de uma tecla só valem fora de campos de texto.
      const alvo = evento.target;
      const editavel = alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable);
      if (meta || evento.altKey || editavel) return;

      const passo = evento.shiftKey ? 20 : 4;
      if (evento.key === "ArrowLeft") { evento.preventDefault(); atualizar({ offsetX: editing.offsetX - passo }); }
      else if (evento.key === "ArrowRight") { evento.preventDefault(); atualizar({ offsetX: editing.offsetX + passo }); }
      else if (evento.key === "ArrowUp") { evento.preventDefault(); atualizar({ offsetY: editing.offsetY - passo }); }
      else if (evento.key === "ArrowDown") { evento.preventDefault(); atualizar({ offsetY: editing.offsetY + passo }); }
      else if (tecla === "[") { evento.preventDefault(); girar(-90); }
      else if (tecla === "]") { evento.preventDefault(); girar(90); }
      else if (tecla === "0") { evento.preventDefault(); ajustarAArea(); }
      else if (tecla === "c") { evento.preventDefault(); alternarComparacao(!comparando); }
    }

    // options: { dataUrl, fileName, width, height, capacidadesIa }
    // Resolve com { editing, rendered } ao aplicar, ou null ao cancelar.
    function abrir(entrada) {
      const fabric = fabricLib();
      if (!fabric) {
        showToast("danger", "Editor indisponível", "A biblioteca de edição não foi carregada. Recarregue a página.");
        return Promise.resolve(null);
      }
      if (sessao) return Promise.resolve(null);
      if (!entrada || !model.isDataImageUrl(entrada.dataUrl)) {
        showToast("warning", "Nenhuma imagem para editar", "Envie a imagem do produto antes de abrir o editor.");
        return Promise.resolve(null);
      }

      sessao = model.createEditingSession({
        originalImage: { dataUrl: entrada.dataUrl, fileName: entrada.fileName },
        editing: entrada.editing,
      });
      editing = model.sessionEditing(sessao);
      history = sessao.history;
      comparando = false;
      modoCrop = false;
      focoAnterior = document.activeElement;

      const overlay = byId("die-overlay");
      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("vf-no-scroll");
      definirCarregando(true);

      definirTexto("die-file-name", entrada.fileName || "Imagem do produto");
      definirTexto(
        "die-file-meta",
        entrada.width && entrada.height ? `${entrada.width} × ${entrada.height} px` : "Dimensões desconhecidas"
      );
      const avisoResolucao = byId("die-low-res");
      if (avisoResolucao) {
        avisoResolucao.hidden = !model.isLowResolution(entrada.width, entrada.height);
      }
      aplicarCapacidadesIa(entrada.capacidadesIa);

      const promessa = new Promise((resolve) => { resolverAbertura = resolve; });

      const elemento = byId("die-canvas");
      canvas = new fabric.Canvas(elemento, {
        width: STAGE_SIZE,
        height: STAGE_SIZE,
        backgroundColor: null,
        preserveObjectStacking: true,
        // Sem retina scaling o backstore fica exatamente 1200x1200 e o PNG
        // exportado sai no tamanho da peça, sem multiplicador.
        enableRetinaScaling: false,
        selection: false,
        controlsAboveOverlay: true,
      });

      ligarControles();
      ligarEventosDoCanvas();
      ajustarTamanhoCss();

      fabric.FabricImage.fromURL(entrada.dataUrl, { crossOrigin: "anonymous" })
        .then((img) => {
          if (!sessao) {
            // O usuário fechou antes do carregamento terminar.
            return;
          }
          imagem = img;
          imagem.set({
            originX: "center",
            originY: "center",
            cornerColor: "#5a2a8f",
            cornerStrokeColor: "#ffffff",
            borderColor: "#5a2a8f",
            cornerSize: 24,
            transparentCorners: false,
            centeredScaling: true,
            objectCaching: false,
          });
          canvas.add(imagem);
          canvas.setActiveObject(imagem);
          renderizarCompleto();
          sincronizarControles();
          definirCarregando(false);
          const foco = byId("die-apply");
          if (foco) foco.focus();
        })
        .catch((error) => {
          console.error("[design-image-editor] falha ao carregar imagem:", error && error.message);
          showToast("danger", "Falha ao abrir a imagem", "O navegador não conseguiu carregar este arquivo.");
          definirCarregando(false);
          fechar(null);
        });

      return promessa;
    }

    // Os botões de IA só aparecem quando o servidor confirma a capacidade.
    // Sem provedor configurado eles nem entram no DOM visível.
    function aplicarCapacidadesIa(capacidades) {
      const secao = byId("die-ai-section");
      if (!secao) return;
      const ativo = capacidades && capacidades.removeBackground === true;
      secao.hidden = !ativo;
      const botao = byId("die-ai-remove-bg");
      if (botao) botao.disabled = !ativo;
    }

    return {
      abrir,
      // Exposto só para teste/diagnóstico manual no console.
      _interno: { toFabricBrightness, toFabricContrast, toFabricSaturation, sharpenMatrix },
    };
  }

  root.VFDesignImageEditor = { createDesignImageEditor, STAGE_SIZE };
})(typeof window !== "undefined" ? window : globalThis);
