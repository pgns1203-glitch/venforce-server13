// frontend-react/src/services/apiClient.js
// Camada HTTP genérica. Reaproveita EXATAMENTE o mecanismo de autenticação do
// Portal legado — nenhum login novo, nenhuma sessão paralela:
//   - token em localStorage["vf-token"]  (mesma chave de layout.js e das telas vanilla)
//   - usuário em localStorage["vf-user"]
//   - 401 → redireciona para index.html, igual ao restante do Portal
// O token nunca vai para a URL.
//
// API base:
//   - produção: mesma constante das telas vanilla (venforce-server.onrender.com);
//   - desenvolvimento: string vazia → caminhos relativos → proxy do Vite para o
//     Express local, sem CORS e com o mesmo comportamento de mesma origem;
//   - `VITE_API_BASE_URL` sobrescreve os dois quando necessário.
// Nenhuma URL de máquina local fica hardcoded.

const STORAGE_KEY = "vf-token";
const USER_KEY = "vf-user";
const API_BASE_PRODUCAO = "https://venforce-server.onrender.com";

function resolverApiBase() {
  const env = import.meta.env || {};
  if (env.VITE_API_BASE_URL) return String(env.VITE_API_BASE_URL).replace(/\/+$/, "");
  if (env.DEV) return ""; // relativo → proxy do vite.config.js
  return API_BASE_PRODUCAO;
}

export const API_BASE = resolverApiBase();

export class ApiError extends Error {
  constructor(mensagem, { status = 0, codigo = "erro_api" } = {}) {
    super(mensagem);
    this.name = "ApiError";
    this.status = status;
    this.codigo = codigo;
  }
}

export function getToken() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getUsuario() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export function ehAdmin() {
  return String(getUsuario().role || "").toLowerCase() === "admin";
}

// Mesmo comportamento do Portal legado quando a sessão morre.
export function irParaLogin() {
  window.location.replace("index.html");
}

function montarUrl(caminho, params = {}) {
  const query = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor === null || valor === undefined || valor === "") continue;
    query.set(chave, String(valor));
  }
  const sufixo = query.toString() ? `?${query}` : "";
  return `${API_BASE}${caminho}${sufixo}`;
}

export async function requisitar(caminho, { metodo = "GET", params, body, signal } = {}) {
  const token = getToken();
  if (!token) {
    irParaLogin();
    throw new ApiError("Sessão expirada.", { status: 401, codigo: "nao_autenticado" });
  }

  let resposta;
  try {
    resposta = await fetch(montarUrl(caminho, params), {
      method: metodo,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ApiError("Não foi possível falar com o servidor. Verifique a conexão.", {
      status: 0,
      codigo: "rede",
    });
  }

  if (resposta.status === 401) {
    irParaLogin();
    throw new ApiError("Sessão expirada. Faça login novamente.", { status: 401, codigo: "nao_autenticado" });
  }
  if (resposta.status === 403) {
    throw new ApiError("Você não tem permissão para ver este cliente.", { status: 403, codigo: "sem_permissao" });
  }

  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    dados = null;
  }

  if (!resposta.ok || dados?.ok === false) {
    throw new ApiError(dados?.erro || `Falha na requisição (HTTP ${resposta.status}).`, {
      status: resposta.status,
      codigo: resposta.status === 404 ? "nao_encontrado" : "erro_api",
    });
  }

  return dados;
}
