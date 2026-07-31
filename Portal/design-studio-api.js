(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_STUDIO_API = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createDesignStudioApi(options) {
    const config = options || {};
    const baseUrl = String(config.baseUrl || "").replace(/\/$/, "");
    const getToken = config.getToken || (() => "");
    const fetchImpl = config.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (!fetchImpl) throw new Error("fetch indisponível");

    async function request(path, optionsRequest) {
      const opts = optionsRequest || {};
      const headers = { Accept: "application/json", ...(opts.headers || {}) };
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...opts,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        const error = new Error(data.erro || `Falha HTTP ${response.status}`);
        error.status = response.status;
        error.codigo = data.codigo;
        throw error;
      }
      return data;
    }

    const rootPath = "/design/studio";
    return {
      listClients: () => request(`${rootPath}/clientes`),
      getWorkspace: (clientId, filters) => {
        const query = new URLSearchParams();
        if (filters?.archived) query.set("archived", "true");
        if (filters?.search) query.set("search", filters.search);
        return request(`${rootPath}/clientes/${clientId}${query.toString() ? `?${query}` : ""}`);
      },
      saveIdentity: (clientId, body) => request(`${rootPath}/clientes/${clientId}/identidade`, { method: "PUT", body }),
      generateTemplates: (clientId, quantity) => request(`${rootPath}/clientes/${clientId}/gerar-templates`, { method: "POST", body: { quantity } }),
      createItem: (clientId, type, body) => request(`${rootPath}/clientes/${clientId}/${type}`, { method: "POST", body }),
      getItem: (clientId, type, id) => request(`${rootPath}/clientes/${clientId}/${type}/${id}`),
      updateItem: (clientId, type, id, body) => request(`${rootPath}/clientes/${clientId}/${type}/${id}`, { method: "PUT", body }),
      archiveItem: (clientId, type, id, archived) => request(`${rootPath}/clientes/${clientId}/${type}/${id}/arquivar`, { method: "POST", body: { archived } }),
      duplicateItem: (clientId, type, id) => request(`${rootPath}/clientes/${clientId}/${type}/${id}/duplicar`, { method: "POST", body: {} }),
      listVersions: (clientId, type, id) => request(`${rootPath}/clientes/${clientId}/${type}/${id}/versoes`),
      restoreVersion: (clientId, type, id, version) => request(`${rootPath}/clientes/${clientId}/${type}/${id}/versoes/${version}/restaurar`, { method: "POST", body: {} }),
    };
  }

  return { createDesignStudioApi };
});
