// frontend-react/src/services/cliente360Api.js
// Endpoints da Cliente 360. Todos passam pelo backend Express — o React NUNCA
// chama a API do Mercado Livre diretamente: token, grant, refresh, paginação e
// cache continuam sendo responsabilidade do servidor.

import { requisitar } from "./apiClient.js";

const raiz = (slug) => `/operacao/cliente-360/${encodeURIComponent(slug)}`;

export function listarClientes({ signal } = {}) {
  return requisitar("/operacao/cliente-360/clientes", { signal });
}

// GET /operacao/cliente-360/:slug/resultado — payload completo da tela.
export function obterResultado(slug, { competencia, compararCom, marketplace, margemAlvo, signal } = {}) {
  return requisitar(`${raiz(slug)}/resultado`, {
    params: { competencia, compararCom, marketplace, margemAlvo },
    signal,
  });
}

// POST /operacao/cliente-360/:slug/resultado/simular
// A matemática do simulador roda NO SERVIDOR, com o mesmo motor puro da ponte.
// O React só envia o cenário — não existe cópia das fórmulas aqui.
export function simular(slug, { competencia, cenario, cenarioRapido, elasticidades, marketplace, signal } = {}) {
  return requisitar(`${raiz(slug)}/resultado/simular`, {
    metodo: "POST",
    body: { competencia, cenario, cenarioRapido, elasticidades, marketplace },
    signal,
  });
}

export function obterElasticidades(slug, { meses = 6, ate, marketplace, signal } = {}) {
  return requisitar(`${raiz(slug)}/elasticidades`, {
    params: { meses, ate, marketplace },
    signal,
  });
}

export function obterPlacar(slug, { desde, marketplace, signal } = {}) {
  return requisitar(`${raiz(slug)}/placar`, { params: { desde, marketplace }, signal });
}
