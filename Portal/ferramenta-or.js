const STORAGE_KEY = "vf-token";
const API_BASE = "https://venforce-server.onrender.com";

function getToken() {
  const t = localStorage.getItem(STORAGE_KEY);
  if (!t) { window.location.replace("index.html"); return null; }
  return t;
}
const TOKEN = getToken();
initLayout();

function setStatus(msg, color) {
  const el = document.getElementById("or-status");
  el.textContent = msg || "";
  el.style.color = color || "var(--vf-text-m)";
  el.style.display = msg ? "block" : "none";
}

function setBaixarLoading(on) {
  document.getElementById("btn-baixar").disabled = on;
  document.getElementById("btn-baixar-text").textContent =
    on ? "Gerando..." : "Baixar ferramenta personalizada";
  document.getElementById("btn-baixar-spinner").style.display =
    on ? "inline-block" : "none";
}

function criarLinhaMLB() {
  const div = document.createElement("div");
  div.style.cssText =
    "display:grid;grid-template-columns:1fr 110px 130px 36px;gap:8px;align-items:center;";
  div.innerHTML = `
    <input type="text"   class="vf-input mlb-input"   placeholder="MLB123456789" style="margin:0;">
    <input type="number" class="vf-input qtd-input"   placeholder="Qtd" min="1" value="20" style="margin:0;">
    <input type="text"   class="vf-input preco-input" placeholder="199,90" style="margin:0;">
    <button type="button" class="vf-btn-danger-sm btn-remover"
      style="height:38px;padding:0 10px;">✕</button>
  `;
  div.querySelector(".btn-remover").addEventListener("click", () => {
    if (document.querySelectorAll("#mlbs-lista > div").length > 1) div.remove();
  });
  return div;
}

function adicionarMLB() {
  document.getElementById("mlbs-lista").appendChild(criarLinhaMLB());
}

function coletarMLBs() {
  const linhas = document.querySelectorAll("#mlbs-lista > div");
  const resultado = [];
  for (const linha of linhas) {
    const mlb   = linha.querySelector(".mlb-input").value.trim();
    const qtd   = parseInt(linha.querySelector(".qtd-input").value) || 0;
    const preco = linha.querySelector(".preco-input").value.trim();
    if (!mlb) continue;
    if (qtd <= 0)  { setStatus("Quantidade inválida para " + mlb, "var(--vf-danger)"); return null; }
    if (!preco)    { setStatus("Preço inválido para " + mlb, "var(--vf-danger)"); return null; }
    resultado.push({ mlb, quantidade_padrao: qtd, preco_final: preco });
  }
  return resultado;
}

async function baixarFerramenta() {
  setStatus("", "");
  const mlbs = coletarMLBs();
  if (!mlbs) return;
  if (!mlbs.length) { setStatus("Adicione ao menos um MLB.", "var(--vf-danger)"); return; }

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
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = "ferramenta-or.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("✓ Download iniciado com sucesso!", "var(--vf-success)");
  } catch (err) {
    setStatus("Erro: " + err.message, "var(--vf-danger)");
  } finally {
    setBaixarLoading(false);
  }
}

document.getElementById("btn-add-mlb").addEventListener("click", adicionarMLB);
document.getElementById("btn-baixar").addEventListener("click", baixarFerramenta);

adicionarMLB(); // inicia com uma linha vazia
