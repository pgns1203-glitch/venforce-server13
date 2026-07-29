// Portal/design-image-storage.js
// -----------------------------------------------------------------------------
// Armazenamento local do Estúdio de Templates.
//
// Regra que motiva este arquivo: o localStorage NÃO guarda mais base64.
//   • localStorage  -> só o projeto "leve" (textos, cores, ids de imagem).
//   • IndexedDB     -> os blobs (data URLs) das imagens, indexados por id.
//
// Quando o IndexedDB não está disponível (Safari privado, storage bloqueado,
// iframe sem permissão) cai para um modo degradado que guarda os blobs no
// próprio localStorage — com limite baixo e aviso explícito para o usuário.
//
// Tudo recebe o ambiente por injeção (`createImageStorage({ indexedDB, localStorage })`)
// para que os testes de Node exercitem os dois caminhos sem navegador.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_IMAGE_STORAGE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DB_NAME = "vf-design-template-studio";
  const DB_VERSION = 1;
  const STORE_NAME = "imagens";
  const FALLBACK_PREFIX = "vf-design-image-fallback:";

  // No modo degradado o localStorage costuma ter ~5 MB no total, dividido com
  // o projeto e com outras telas. 1,5 MB por imagem é o teto seguro.
  const FALLBACK_MAX_BYTES = 1.5 * 1024 * 1024;

  function isQuotaError(error) {
    if (!error) return false;
    const name = String(error.name || "");
    const code = Number(error.code);
    return (
      name === "QuotaExceededError" ||
      name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      code === 22 ||
      code === 1014
    );
  }

  function storageError(codigo, mensagem, causa) {
    const error = new Error(mensagem);
    error.codigo = codigo;
    if (causa) error.causa = causa;
    return error;
  }

  /* ── backend IndexedDB ────────────────────────────────────────────────── */

  function createIndexedDbBackend(indexedDB) {
    let dbPromise = null;

    function openDb() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        let request;
        try {
          request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (error) {
          reject(storageError("IDB_INDISPONIVEL", "IndexedDB indisponível.", error));
          return;
        }
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(storageError("IDB_INDISPONIVEL", "IndexedDB indisponível.", request.error));
        request.onblocked = () => reject(storageError("IDB_BLOQUEADO", "IndexedDB bloqueado por outra aba."));
      }).catch((error) => {
        // Uma falha de abertura não pode envenenar as próximas tentativas.
        dbPromise = null;
        throw error;
      });
      return dbPromise;
    }

    function runTransaction(mode, executar) {
      return openDb().then((db) => new Promise((resolve, reject) => {
        let tx;
        try {
          tx = db.transaction(STORE_NAME, mode);
        } catch (error) {
          reject(storageError("IDB_ERRO", "Não foi possível abrir a transação local.", error));
          return;
        }
        const store = tx.objectStore(STORE_NAME);
        let resultado;
        try {
          resultado = executar(store);
        } catch (error) {
          reject(storageError("IDB_ERRO", "Falha ao acessar o armazenamento local.", error));
          return;
        }
        tx.oncomplete = () => resolve(resultado && typeof resultado.then === "function" ? resultado : resultado);
        tx.onabort = () => {
          const causa = tx.error;
          reject(isQuotaError(causa)
            ? storageError("QUOTA_EXCEDIDA", "O armazenamento local do navegador está cheio.", causa)
            : storageError("IDB_ERRO", "Falha ao gravar no armazenamento local.", causa));
        };
        tx.onerror = () => {
          const causa = tx.error;
          reject(isQuotaError(causa)
            ? storageError("QUOTA_EXCEDIDA", "O armazenamento local do navegador está cheio.", causa)
            : storageError("IDB_ERRO", "Falha ao acessar o armazenamento local.", causa));
        };
      }));
    }

    function requestValue(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    return {
      tipo: "indexeddb",
      async disponivel() {
        await openDb();
        return true;
      },
      async put(id, dataUrl) {
        let pending;
        await runTransaction("readwrite", (store) => {
          pending = requestValue(store.put({ id, dataUrl, atualizadoEm: Date.now() }));
          // O erro do request individual vira abort da transação; o catch
          // abaixo só evita "unhandled rejection" quando isso acontece.
          pending.catch(() => {});
        });
        return id;
      },
      async get(id) {
        let pending;
        await runTransaction("readonly", (store) => {
          pending = requestValue(store.get(id));
          pending.catch(() => {});
        });
        const registro = await pending;
        return registro && typeof registro.dataUrl === "string" ? registro.dataUrl : null;
      },
      async remove(id) {
        let pending;
        await runTransaction("readwrite", (store) => {
          pending = requestValue(store.delete(id));
          pending.catch(() => {});
        });
        return true;
      },
      async keys() {
        let pending;
        await runTransaction("readonly", (store) => {
          pending = requestValue(store.getAllKeys());
          pending.catch(() => {});
        });
        const chaves = await pending;
        return Array.isArray(chaves) ? chaves.map(String) : [];
      },
      close() {
        if (!dbPromise) return;
        const pending = dbPromise;
        dbPromise = null;
        pending.then((db) => { try { db.close(); } catch { /* já fechado */ } }).catch(() => {});
      },
    };
  }

  /* ── backend localStorage (degradado) ─────────────────────────────────── */

  function createLocalStorageBackend(localStorage) {
    return {
      tipo: "localstorage",
      async disponivel() {
        const chave = `${FALLBACK_PREFIX}__probe__`;
        localStorage.setItem(chave, "1");
        localStorage.removeItem(chave);
        return true;
      },
      async put(id, dataUrl) {
        if (String(dataUrl).length > FALLBACK_MAX_BYTES) {
          throw storageError(
            "IMAGEM_GRANDE_DEMAIS",
            "Sem IndexedDB, o navegador só consegue guardar imagens menores. A imagem vale para esta sessão, mas não será recuperada ao recarregar."
          );
        }
        try {
          localStorage.setItem(FALLBACK_PREFIX + id, dataUrl);
        } catch (error) {
          throw isQuotaError(error)
            ? storageError("QUOTA_EXCEDIDA", "O armazenamento local do navegador está cheio.", error)
            : storageError("LOCAL_ERRO", "Falha ao gravar no armazenamento local.", error);
        }
        return id;
      },
      async get(id) {
        return localStorage.getItem(FALLBACK_PREFIX + id);
      },
      async remove(id) {
        localStorage.removeItem(FALLBACK_PREFIX + id);
        return true;
      },
      async keys() {
        const total = Number(localStorage.length) || 0;
        const chaves = [];
        for (let index = 0; index < total; index += 1) {
          const chave = localStorage.key(index);
          if (typeof chave === "string" && chave.startsWith(FALLBACK_PREFIX)) {
            chaves.push(chave.slice(FALLBACK_PREFIX.length));
          }
        }
        return chaves;
      },
      close() {},
    };
  }

  /* ── backend em memória (último recurso) ──────────────────────────────── */

  function createMemoryBackend() {
    const mapa = new Map();
    return {
      tipo: "memoria",
      async disponivel() { return true; },
      async put(id, dataUrl) { mapa.set(id, dataUrl); return id; },
      async get(id) { return mapa.has(id) ? mapa.get(id) : null; },
      async remove(id) { mapa.delete(id); return true; },
      async keys() { return [...mapa.keys()]; },
      close() { mapa.clear(); },
    };
  }

  /* ── fachada ──────────────────────────────────────────────────────────── */

  // env: { indexedDB, localStorage } — ausentes viram indisponíveis.
  // Devolve uma fachada que NUNCA lança em leitura: falha de leitura vira null.
  function createImageStorage(env) {
    const ambiente = env || {};
    let backend = null;
    let selecao = null;
    const avisos = [];

    async function tentar(criar) {
      try {
        const candidato = criar();
        if (!candidato) return null;
        await candidato.disponivel();
        return candidato;
      } catch (error) {
        avisos.push(error && error.codigo ? error.codigo : "INDISPONIVEL");
        return null;
      }
    }

    async function resolver() {
      if (backend) return backend;
      if (!selecao) {
        selecao = (async () => {
          const idb = ambiente.indexedDB
            ? await tentar(() => createIndexedDbBackend(ambiente.indexedDB))
            : null;
          if (idb) return idb;

          const local = ambiente.localStorage
            ? await tentar(() => createLocalStorageBackend(ambiente.localStorage))
            : null;
          if (local) return local;

          return createMemoryBackend();
        })().then((escolhido) => {
          backend = escolhido;
          return escolhido;
        });
      }
      return selecao;
    }

    return {
      async tipo() {
        const atual = await resolver();
        return atual.tipo;
      },
      // true quando o armazenamento é persistente entre recarregamentos.
      async persistente() {
        const atual = await resolver();
        return atual.tipo !== "memoria";
      },
      avisos() {
        return avisos.slice();
      },
      async salvar(id, dataUrl) {
        if (!id || typeof dataUrl !== "string" || !dataUrl) {
          throw storageError("PARAMETROS_INVALIDOS", "Imagem inválida para armazenamento.");
        }
        const atual = await resolver();
        return atual.put(String(id), dataUrl);
      },
      async ler(id) {
        if (!id) return null;
        try {
          const atual = await resolver();
          return await atual.get(String(id));
        } catch {
          return null;
        }
      },
      async remover(id) {
        if (!id) return false;
        try {
          const atual = await resolver();
          await atual.remove(String(id));
          return true;
        } catch {
          return false;
        }
      },
      async listarIds() {
        try {
          const atual = await resolver();
          return await atual.keys();
        } catch {
          return [];
        }
      },
      // Apaga o que o projeto não referencia mais. `idsVivos` vem do modelo.
      async limparOrfaos(idsVivos) {
        const vivos = new Set((Array.isArray(idsVivos) ? idsVivos : []).map(String));
        const todos = await this.listarIds();
        const orfaos = todos.filter((id) => !vivos.has(id));
        for (const id of orfaos) {
          // eslint-disable-next-line no-await-in-loop
          await this.remover(id);
        }
        return orfaos;
      },
      async fechar() {
        if (backend) backend.close();
        backend = null;
        selecao = null;
      },
    };
  }

  return {
    DB_NAME,
    DB_VERSION,
    STORE_NAME,
    FALLBACK_PREFIX,
    FALLBACK_MAX_BYTES,
    isQuotaError,
    createImageStorage,
    createMemoryBackend,
  };
});
