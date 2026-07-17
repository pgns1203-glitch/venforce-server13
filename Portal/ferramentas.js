const STORAGE_KEY = "vf-token";
const API_BASE = "https://venforce-server.onrender.com";

function getToken() {
  const t = localStorage.getItem(STORAGE_KEY);
  if (!t) {
    window.location.replace("index.html");
    return null;
  }
  return t;
}

const TOKEN = getToken();

if (TOKEN) {
  initLayout();
  initFerramentaOR();
}

function setStatus(msg, type) {
  const el = document.getElementById("or-status");
  el.textContent = msg || "";
  el.classList.remove("is-success", "is-danger");
  if (type) el.classList.add(type);
  el.hidden = !msg;
}

function setBaixarLoading(on) {
  const button = document.getElementById("btn-baixar");
  const text = document.getElementById("btn-baixar-text");
  const spinner = document.getElementById("btn-baixar-spinner");

  button.disabled = on;
  button.classList.toggle("is-loading", on);
  text.textContent = on ? "Gerando..." : "Baixar ferramenta personalizada";
  spinner.hidden = true;
}

function criarCampo(labelText, inputClass, attrs) {
  const field = document.createElement("label");
  field.className = "vf-field";

  const label = document.createElement("span");
  label.className = "vf-field__label vf-tools-row-label";
  label.textContent = labelText;

  const input = document.createElement("input");
  input.className = `vf-input ${inputClass}`;
  Object.entries(attrs).forEach(([key, value]) => {
    input.setAttribute(key, value);
  });

  field.append(label, input);
  return field;
}

function criarLinhaMLB() {
  const div = document.createElement("div");
  div.className = "vf-tools-or-row";

  const mlbField = criarCampo("MLB", "mlb-input", {
    type: "text",
    placeholder: "MLB123456789",
    "aria-label": "MLB",
  });
  const qtdField = criarCampo("Quantidade", "qtd-input", {
    type: "number",
    placeholder: "Qtd",
    min: "1",
    value: "20",
    "aria-label": "Quantidade padrão",
  });
  const precoField = criarCampo("Preço final", "preco-input", {
    type: "text",
    placeholder: "199,90",
    "aria-label": "Preço final",
  });

  const action = document.createElement("div");
  action.className = "vf-tools-or-row__action";
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "vf-btn vf-btn--danger vf-btn--icon vf-btn--sm btn-remover";
  removeButton.setAttribute("aria-label", "Remover MLB");
  removeButton.textContent = "×";
  removeButton.addEventListener("click", () => {
    if (document.querySelectorAll("#mlbs-lista > .vf-tools-or-row").length > 1) div.remove();
  });
  action.appendChild(removeButton);

  div.append(mlbField, qtdField, precoField, action);
  return div;
}

function adicionarMLB() {
  document.getElementById("mlbs-lista").appendChild(criarLinhaMLB());
}

function coletarMLBs() {
  const linhas = document.querySelectorAll("#mlbs-lista > .vf-tools-or-row");
  const resultado = [];

  for (const linha of linhas) {
    const mlb = linha.querySelector(".mlb-input").value.trim();
    const qtd = parseInt(linha.querySelector(".qtd-input").value) || 0;
    const preco = linha.querySelector(".preco-input").value.trim();

    if (!mlb) continue;
    if (qtd <= 0) {
      setStatus("Quantidade inválida para " + mlb, "is-danger");
      return null;
    }
    if (!preco) {
      setStatus("Preço inválido para " + mlb, "is-danger");
      return null;
    }
    resultado.push({ mlb, quantidade_padrao: qtd, preco_final: preco });
  }

  return resultado;
}

async function baixarFerramenta() {
  setStatus("", "");
  const mlbs = coletarMLBs();
  if (!mlbs) return;
  if (!mlbs.length) {
    setStatus("Adicione ao menos um MLB.", "is-danger");
    return;
  }

  setBaixarLoading(true);
  try {
    const res = await fetch(`${API_BASE}/download-ferramenta-or`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + TOKEN,
      },
      body: JSON.stringify({ mlbs }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.erro || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ferramenta-or.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("Download iniciado com sucesso!", "is-success");
  } catch (err) {
    setStatus("Erro: " + err.message, "is-danger");
  } finally {
    setBaixarLoading(false);
  }
}

function initFerramentaOR() {
  document.getElementById("btn-add-mlb").addEventListener("click", adicionarMLB);
  document.getElementById("btn-baixar").addEventListener("click", baixarFerramenta);
  adicionarMLB();
}
