// Portal/design-image-api.js
// -----------------------------------------------------------------------------
// Cliente HTTP do editor de imagem.
//
// Fala com três endpoints do servidor VenForce:
//   POST /design/imagens/normalizar   -> Sharp corrige EXIF, limita tamanho e
//                                        devolve um data URL seguro.
//   GET  /design/imagens/capacidades  -> quais operações de IA estão ligadas.
//   POST /design/imagens/ia/:operacao -> executa uma operação de IA.
//
// Nada de chave de API aqui: quem fala com provedor externo é o servidor.
// `fetch` e `getToken` são injetáveis para os testes de Node.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_IMAGE_API = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_TIMEOUT_MS = 30000;

  const CAPACIDADES_VAZIAS = {
    removeBackground: false,
    improveLighting: false,
    generateBackground: false,
    removeObject: false,
    upscale: false,
  };

  function apiError(codigo, mensagem, status) {
    const error = new Error(mensagem);
    error.codigo = codigo;
    if (status) error.status = status;
    return error;
  }

  function normalizarCapacidades(bruto) {
    const fonte = bruto && typeof bruto === "object" ? bruto : {};
    const resultado = {};
    Object.keys(CAPACIDADES_VAZIAS).forEach((chave) => {
      resultado[chave] = fonte[chave] === true;
    });
    return resultado;
  }

  function algumaCapacidadeAtiva(capacidades) {
    return Object.values(normalizarCapacidades(capacidades)).some(Boolean);
  }

  // Mapeia a resposta do servidor para um erro com mensagem apresentável.
  // O servidor já devolve { ok:false, erro, codigo } — nunca mostramos stack.
  function erroDaResposta(status, corpo) {
    const codigo = corpo && corpo.codigo ? String(corpo.codigo) : `HTTP_${status}`;
    const mensagem = corpo && corpo.erro
      ? String(corpo.erro)
      : "Não foi possível processar a imagem no servidor.";
    return apiError(codigo, mensagem, status);
  }

  function createDesignImageApi(options) {
    const config = options || {};
    const baseUrl = String(config.baseUrl || "").replace(/\/+$/, "");
    const fetchImpl = config.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const getToken = typeof config.getToken === "function" ? config.getToken : () => null;
    const timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : DEFAULT_TIMEOUT_MS;
    const AbortImpl = config.AbortController
      || (typeof AbortController === "function" ? AbortController : null);

    function headersAutenticados(extra) {
      const token = getToken();
      const headers = { Accept: "application/json", ...(extra || {}) };
      if (token) headers.Authorization = `Bearer ${token}`;
      return headers;
    }

    async function requisitar(caminho, init) {
      if (!fetchImpl) throw apiError("SEM_FETCH", "Este navegador não suporta a chamada ao servidor.");

      const controller = AbortImpl ? new AbortImpl() : null;
      const timer = controller && typeof setTimeout === "function"
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

      let resposta;
      try {
        resposta = await fetchImpl(`${baseUrl}${caminho}`, {
          ...init,
          headers: headersAutenticados(init && init.headers),
          signal: controller ? controller.signal : undefined,
        });
      } catch (error) {
        if (error && error.name === "AbortError") {
          throw apiError("TIMEOUT", "O servidor demorou demais para responder.");
        }
        throw apiError("REDE_INDISPONIVEL", "Não foi possível falar com o servidor VenForce.");
      } finally {
        if (timer) clearTimeout(timer);
      }

      let corpo = null;
      try {
        corpo = await resposta.json();
      } catch {
        corpo = null;
      }

      if (!resposta.ok || !corpo || corpo.ok === false) {
        throw erroDaResposta(resposta.status, corpo);
      }
      return corpo;
    }

    return {
      // Envia o arquivo cru; o servidor devolve a versão normalizada.
      async normalizar(file, extras) {
        if (!file) throw apiError("ARQUIVO_AUSENTE", "Nenhum arquivo para enviar.");
        const FormDataImpl = config.FormData
          || (typeof FormData === "function" ? FormData : null);
        if (!FormDataImpl) throw apiError("SEM_FORMDATA", "Este navegador não suporta o envio do arquivo.");

        const form = new FormDataImpl();
        form.append("imagem", file, file.name || "imagem");
        if (extras && extras.finalidade) form.append("finalidade", String(extras.finalidade));

        const corpo = await requisitar("/design/imagens/normalizar", { method: "POST", body: form });
        if (!corpo.imagem || typeof corpo.imagem.dataUrl !== "string") {
          throw apiError("RESPOSTA_INVALIDA", "O servidor não devolveu a imagem normalizada.");
        }
        return corpo.imagem;
      },

      // Nunca lança: sem servidor, o editor apenas não oferece IA.
      async capacidadesIa() {
        try {
          const corpo = await requisitar("/design/imagens/capacidades", { method: "GET" });
          return {
            disponivel: true,
            provider: corpo.provider || null,
            capacidades: normalizarCapacidades(corpo.capacidades),
          };
        } catch {
          return { disponivel: false, provider: null, capacidades: normalizarCapacidades(null) };
        }
      },

      async executarIa(operacao, payload) {
        const nome = String(operacao || "").trim();
        if (!nome) throw apiError("OPERACAO_INVALIDA", "Operação de IA não informada.");
        const corpo = await requisitar(`/design/imagens/ia/${encodeURIComponent(nome)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload || {}),
        });
        return corpo.imagem || null;
      },
    };
  }

  return {
    DEFAULT_TIMEOUT_MS,
    CAPACIDADES_VAZIAS,
    normalizarCapacidades,
    algumaCapacidadeAtiva,
    createDesignImageApi,
  };
});
