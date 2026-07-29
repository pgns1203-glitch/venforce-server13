/*
 * Control Center — cliente HTTP da API de observabilidade.
 *
 * Nenhuma chamada daqui é capturada pelo coletor: o vf-debug-client ignora
 * qualquer URL com /admin/observability, senão o Control Center geraria os
 * próprios eventos em laço.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "vf-token";
  var USER_KEY = "vf-user";
  var API_BASE_KEY = "vf-api-base";
  var DEFAULT_API_BASE = "https://venforce-server.onrender.com";
  var PREFIX = "/admin/observability";

  function apiBase() {
    try {
      var override = localStorage.getItem(API_BASE_KEY);
      if (override) return String(override).replace(/\/+$/, "");
    } catch (e) { /* usa o padrão */ }
    return DEFAULT_API_BASE;
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "{}") || {}; } catch (e) { return {}; }
  }

  function isAdmin() {
    return String((user() || {}).role || "").toLowerCase() === "admin";
  }

  function buildQuery(params) {
    var qs = new URLSearchParams();
    Object.keys(params || {}).forEach(function (chave) {
      var valor = params[chave];
      if (valor === undefined || valor === null || valor === "" || valor === false) return;
      qs.set(chave, String(valor));
    });
    var texto = qs.toString();
    return texto ? "?" + texto : "";
  }

  /**
   * Sempre resolve — nunca rejeita. O erro vira estado renderizável, para que
   * uma falha de rede não derrube a tela.
   */
  function call(path, options) {
    var opts = options || {};
    var url = apiBase() + PREFIX + path + buildQuery(opts.params);
    var jwt = token();

    if (!jwt) {
      return Promise.resolve({
        ok: false, status: 401, dados: null,
        erro: "Sessão sem token. Faça login novamente.", tipo: "sem-token"
      });
    }

    var headers = { Authorization: "Bearer " + jwt };
    var init = { method: opts.method || "GET", headers: headers, signal: opts.signal };

    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    return fetch(url, init).then(function (resposta) {
      var requestId = null;
      try { requestId = resposta.headers.get("x-request-id"); } catch (e) { /* header não exposto */ }

      var contentType = "";
      try { contentType = resposta.headers.get("content-type") || ""; } catch (e) { /* ignora */ }

      if (contentType.indexOf("json") === -1) {
        return resposta.text().then(function (texto) {
          return {
            ok: false, status: resposta.status, dados: null, requestId: requestId,
            erro: "Resposta não-JSON do servidor (HTTP " + resposta.status + ")",
            tipo: resposta.status === 404 ? "endpoint-ausente" : "resposta-invalida",
            corpo: texto.slice(0, 400)
          };
        });
      }

      return resposta.json().then(function (dados) {
        if (!resposta.ok || dados.ok === false) {
          return {
            ok: false,
            status: resposta.status,
            dados: dados,
            requestId: requestId,
            erro: dados.erro || "HTTP " + resposta.status,
            degradado: dados.degradado === true,
            tipo: resposta.status === 401 ? "sem-permissao"
              : resposta.status === 403 ? "sem-permissao"
                : resposta.status === 404 ? "nao-encontrado"
                  : resposta.status === 503 ? "banco-indisponivel"
                    : "erro"
          };
        }
        return { ok: true, status: resposta.status, dados: dados, requestId: requestId };
      }).catch(function () {
        return {
          ok: false, status: resposta.status, dados: null, requestId: requestId,
          erro: "JSON inválido na resposta do servidor", tipo: "json-invalido"
        };
      });
    }).catch(function (erro) {
      if (erro && erro.name === "AbortError") {
        return { ok: false, abortado: true, status: 0, dados: null, erro: "requisição substituída", tipo: "abortado" };
      }
      return {
        ok: false, status: 0, dados: null,
        erro: erro && erro.message ? erro.message : "falha de rede",
        tipo: "offline"
      };
    });
  }

  window.VFCApi = {
    apiBase: apiBase,
    token: token,
    user: user,
    isAdmin: isAdmin,
    buildQuery: buildQuery,
    call: call,

    summary: function (params, signal) { return call("/summary", { params: params, signal: signal }); },
    requests: function (params, signal) { return call("/requests", { params: params, signal: signal }); },
    requestDetail: function (requestId, signal) {
      return call("/requests/" + encodeURIComponent(requestId), { signal: signal });
    },
    errors: function (params, signal) { return call("/errors", { params: params, signal: signal }); },
    sessions: function (params, signal) { return call("/sessions", { params: params, signal: signal }); },
    health: function (signal) { return call("/health", { signal: signal }); },
    healthCheck: function (alvos, signal) {
      return call("/health/check", { method: "POST", body: { alvos: alvos }, signal: signal });
    },
    routes: function (signal) { return call("/routes", { signal: signal }); },
    routeStats: function (params, signal) { return call("/routes/stats", { params: params, signal: signal }); },
    purge: function (confirmacao, antesDe) {
      return call("/purge", { method: "POST", body: { confirmacao: confirmacao, antesDe: antesDe } });
    },
    exportUrl: function (params) {
      return apiBase() + PREFIX + "/export" + buildQuery(params);
    },
    // Baixa via fetch para poder enviar o Authorization (a API não usa cookie).
    download: function (params) {
      var jwt = token();
      if (!jwt) return Promise.resolve({ ok: false, erro: "sem token" });
      return fetch(this.exportUrl(params), { headers: { Authorization: "Bearer " + jwt } })
        .then(function (resposta) {
          if (!resposta.ok) throw new Error("HTTP " + resposta.status);
          return resposta.blob();
        })
        .then(function (blob) {
          var url = URL.createObjectURL(blob);
          var link = document.createElement("a");
          var extensao = params && params.format === "csv" ? "csv" : "json";
          link.href = url;
          link.download = "observabilidade-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + "." + extensao;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
          return { ok: true };
        })
        .catch(function (erro) {
          return { ok: false, erro: erro && erro.message ? erro.message : "falha ao exportar" };
        });
    },

    // Teste rápido usado na visão Tools. Fora do prefixo de observabilidade.
    ping: function (caminho, comToken) {
      var inicio = performance.now();
      var headers = {};
      if (comToken) headers.Authorization = "Bearer " + token();
      return fetch(apiBase() + caminho, { headers: headers })
        .then(function (resposta) {
          var requestId = null;
          try { requestId = resposta.headers.get("x-request-id"); } catch (e) { /* ignora */ }
          return {
            ok: resposta.ok,
            status: resposta.status,
            duracaoMs: Math.round(performance.now() - inicio),
            requestId: requestId,
            correlacao: !!requestId
          };
        })
        .catch(function (erro) {
          return {
            ok: false, status: 0,
            duracaoMs: Math.round(performance.now() - inicio),
            erro: erro && erro.message ? erro.message : "falha de rede"
          };
        });
    }
  };
})();
