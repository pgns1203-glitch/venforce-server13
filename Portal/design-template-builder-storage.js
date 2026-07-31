// Portal/design-template-builder-storage.js
// -----------------------------------------------------------------------------
// Biblioteca LOCAL dos templates criados pelo Construtor Modular.
//
// Chave própria no localStorage: `vf-design-template-library-v1`. Ela NÃO se
// mistura com `vf-design-template-studio-v1` (o projeto do editor antigo) —
// são dois assuntos diferentes e um não pode corromper o outro.
//
// Regra dura desta camada: base64 NUNCA entra no localStorage. O registro
// guarda só a referência leve da imagem (id, nome do arquivo, mime, medidas);
// o blob vive no armazenamento de imagens já existente
// (design-image-storage.js -> IndexedDB). `salvar` recusa qualquer registro
// que ainda carregue `data:image` — é uma trava, não uma convenção.
//
// Tudo recebe o ambiente por injeção (`createBuilderLibrary({ localStorage })`)
// para que os testes de Node exercitem a camada sem navegador.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_TEMPLATE_BUILDER_STORAGE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LIBRARY_KEY = "vf-design-template-library-v1";
  const LIBRARY_VERSION = 1;
  const MAX_TEMPLATES = 60;

  function storageError(codigo, mensagem, causa) {
    const error = new Error(mensagem);
    error.codigo = codigo;
    if (causa) error.causa = causa;
    return error;
  }

  function isPlainText(value) {
    return typeof value === "string" || typeof value === "number";
  }

  function texto(value, maxLength) {
    if (!isPlainText(value)) return "";
    return String(value).slice(0, maxLength || 200);
  }

  /* ── referências leves de imagem ──────────────────────────────────────── */

  // O que sobra de uma imagem depois de tirar o blob: o suficiente para
  // reencontrá-la no IndexedDB e para mostrar nome/medidas na interface.
  function lightImageRef(ref) {
    const source = ref && typeof ref === "object" ? ref : {};
    return {
      id: isPlainText(source.id) && String(source.id) ? String(source.id) : null,
      fileName: texto(source.fileName, 120),
      mimeType: texto(source.mimeType, 40),
      width: Number.isFinite(Number(source.width)) ? Number(source.width) : null,
      height: Number.isFinite(Number(source.height)) ? Number(source.height) : null,
    };
  }

  // Registro salvo: só o que a biblioteca precisa para reabrir o projeto.
  // Nada de dataUrl, nada de token, nada de estado de interface.
  function toRecord(project, options) {
    const config = options || {};
    const source = project && typeof project === "object" ? project : {};
    const produto = source.product && typeof source.product === "object" ? source.product : {};
    const agora = config.now || new Date().toISOString();

    return {
      version: LIBRARY_VERSION,
      id: texto(source.id, 64),
      name: texto(source.name, 80),
      createdAt: texto(source.createdAt, 40) || agora,
      updatedAt: agora,
      origin: "equipe",

      segment: texto(source.segment, 40),
      style: texto(source.style, 40),
      palette: {
        primary: texto(source.palette && source.palette.primary, 7),
        secondary: texto(source.palette && source.palette.secondary, 7),
        background: texto(source.palette && source.palette.background, 7),
        text: texto(source.palette && source.palette.text, 7),
      },

      pages: (Array.isArray(source.pages) ? source.pages : []).map((id) => texto(id, 64)).filter(Boolean),

      clienteId: source.clienteId == null ? null : source.clienteId,
      clienteNome: texto(source.clienteNome, 80),
      marcaNome: texto(source.marcaNome, 40),

      product: {
        name: texto(produto.name, 64),
        subtitle: texto(produto.subtitle, 140),
        placement: {
          scale: Number(produto.placement && produto.placement.scale) || 100,
          x: Number(produto.placement && produto.placement.x) || 50,
          y: Number(produto.placement && produto.placement.y) || 50,
        },
        editing: produto.editing && typeof produto.editing === "object" ? { ...produto.editing } : {},
        originalImage: lightImageRef(produto.originalImage),
        editedImage: lightImageRef(produto.editedImage),
      },
      logo: lightImageRef(source.logo),

      content: (() => {
        const origem = source.content && typeof source.content === "object" ? source.content : {};
        const saida = {};
        Object.keys(origem).forEach((chave) => { saida[chave] = texto(origem[chave], 500); });
        return saida;
      })(),
    };
  }

  /* ── biblioteca ───────────────────────────────────────────────────────── */

  // env: { localStorage, now, random }
  function createBuilderLibrary(env) {
    const ambiente = env || {};
    const store = ambiente.localStorage;
    const agora = () => (typeof ambiente.now === "function" ? ambiente.now() : new Date().toISOString());
    const sorteio = () => (typeof ambiente.random === "function" ? ambiente.random() : Math.random());

    if (!store || typeof store.getItem !== "function" || typeof store.setItem !== "function") {
      throw new Error("createBuilderLibrary precisa de um localStorage com getItem/setItem.");
    }

    // Leitura NUNCA lança: dado corrompido vira biblioteca vazia, não tela
    // branca. Registros individuais inválidos são descartados um a um.
    function listar() {
      let bruto;
      try {
        bruto = JSON.parse(store.getItem(LIBRARY_KEY) || "null");
      } catch {
        return [];
      }
      const lista = bruto && Array.isArray(bruto.templates) ? bruto.templates : [];
      return lista
        .filter((item) => item && typeof item === "object" && texto(item.id, 64))
        .map((item) => toRecord(item, { now: item.updatedAt }))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }

    function obter(id) {
      const alvo = texto(id, 64);
      return listar().find((item) => item.id === alvo) || null;
    }

    function gravar(templates) {
      const conteudo = JSON.stringify({ version: LIBRARY_VERSION, templates });
      // Trava explícita: se um base64 escapou para o registro, a gravação é
      // recusada em vez de estourar a cota do navegador silenciosamente.
      if (conteudo.includes("data:image")) {
        throw storageError(
          "BASE64_NO_LOCALSTORAGE",
          "Imagens não podem ser gravadas na biblioteca local. O blob fica no armazenamento de imagens."
        );
      }
      try {
        store.setItem(LIBRARY_KEY, conteudo);
      } catch (error) {
        throw storageError(
          "ARMAZENAMENTO_INDISPONIVEL",
          "Não foi possível gravar a biblioteca local. Libere espaço do site neste navegador.",
          error
        );
      }
      return templates;
    }

    function novoId() {
      return `tpl-${Date.now().toString(36)}-${Math.floor(sorteio() * 1e9).toString(36)}`;
    }

    // Salva um projeto do construtor como template da biblioteca. Sem id, ou
    // com id que não existe mais, vira registro novo.
    function salvar(project) {
      const registros = listar();
      const idInformado = texto(project && project.id, 64);
      const existente = idInformado ? registros.find((item) => item.id === idInformado) : null;

      const registro = toRecord(
        { ...project, id: idInformado || novoId(), createdAt: existente ? existente.createdAt : (project && project.createdAt) },
        { now: agora() }
      );

      if (!registro.name.trim()) {
        throw storageError("NOME_AUSENTE", "Dê um nome ao template antes de salvar na biblioteca.");
      }

      const restantes = registros.filter((item) => item.id !== registro.id);
      if (restantes.length + 1 > MAX_TEMPLATES) {
        throw storageError(
          "LIMITE_DE_TEMPLATES",
          `A biblioteca local guarda no máximo ${MAX_TEMPLATES} templates. Exclua algum antes de salvar outro.`
        );
      }

      gravar([registro].concat(restantes));
      return registro;
    }

    function remover(id) {
      const alvo = texto(id, 64);
      const registros = listar();
      const restantes = registros.filter((item) => item.id !== alvo);
      if (restantes.length === registros.length) return false;
      gravar(restantes);
      return true;
    }

    // Cópia: id novo, "Cópia" no nome, datas reiniciadas. As referências de
    // imagem apontam para os MESMOS blobs — o original não é tocado, e a
    // limpeza de órfãos só apaga o que ninguém mais referencia.
    function duplicar(id) {
      const origem = obter(id);
      if (!origem) {
        throw storageError("TEMPLATE_INEXISTENTE", "Este template não está mais na biblioteca local.");
      }
      const momento = agora();
      const copia = {
        ...origem,
        id: novoId(),
        name: texto(`${origem.name} (Cópia)`, 80),
        createdAt: momento,
        updatedAt: momento,
      };
      const registros = listar();
      if (registros.length + 1 > MAX_TEMPLATES) {
        throw storageError(
          "LIMITE_DE_TEMPLATES",
          `A biblioteca local guarda no máximo ${MAX_TEMPLATES} templates. Exclua algum antes de duplicar.`
        );
      }
      gravar([copia].concat(registros));
      return copia;
    }

    // Todos os ids de imagem que a biblioteca ainda referencia. Sem isso a
    // limpeza de órfãos do editor antigo apagaria os blobs dos templates
    // salvos aqui — os dois compartilham o mesmo IndexedDB.
    function listarIdsDeImagens() {
      const ids = new Set();
      listar().forEach((registro) => {
        [registro.logo, registro.product.originalImage, registro.product.editedImage].forEach((ref) => {
          if (ref && ref.id) ids.add(String(ref.id));
        });
      });
      return [...ids];
    }

    function limpar() {
      gravar([]);
    }

    return {
      LIBRARY_KEY,
      listar,
      obter,
      salvar,
      remover,
      duplicar,
      listarIdsDeImagens,
      limpar,
    };
  }

  return {
    LIBRARY_KEY,
    LIBRARY_VERSION,
    MAX_TEMPLATES,
    lightImageRef,
    toRecord,
    createBuilderLibrary,
  };
});
