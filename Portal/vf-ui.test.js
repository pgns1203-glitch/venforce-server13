// Portal/vf-ui.test.js — VF.confirm e VF.toast num DOM de verdade (jsdom).
//
// Rodar: node Portal/vf-ui.test.js
// O jsdom vem de frontend-react/node_modules (rode `npm ci` lá antes).

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let JSDOM;
try {
  ({ JSDOM } = require(path.join(__dirname, "..", "frontend-react", "node_modules", "jsdom")));
} catch {
  console.error("jsdom não encontrado: rode `npm ci` em frontend-react antes deste teste.");
  process.exit(1);
}

const codigo = fs.readFileSync(path.join(__dirname, "vf-ui.js"), "utf8");

function novaPagina({ reduzido = true } = {}) {
  const dom = new JSDOM(`<!doctype html><body><button id="origem">Excluir base</button></body>`, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: reduzido });
  w.VF = { shell: "já existia" };
  w.eval(codigo);
  return w;
}

function tecla(w, key, extra = {}) {
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
}

let falhas = 0;
async function caso(nome, fn) {
  try {
    await fn();
    console.log("  ok  " + nome);
  } catch (e) {
    falhas++;
    console.log("  FALHOU  " + nome + "\n        " + e.message);
  }
}

(async () => {
  console.log("vf-ui.js");

  await caso("não apaga o que já estava em window.VF", () => {
    const w = novaPagina();
    assert.strictEqual(w.VF.shell, "já existia");
    assert.strictEqual(typeof w.VF.confirm, "function");
    assert.strictEqual(typeof w.VF.toast, "function");
  });

  await caso("confirm: alertdialog nomeado e descrito, nas classes da V2, trava a rolagem", async () => {
    const w = novaPagina();
    const p = w.VF.confirm({ title: "Desativar base?", message: "Custos e histórico\nsão preservados." });
    const d = w.document.querySelector('[role="alertdialog"]');
    assert.ok(d.classList.contains("vf-modal"));
    assert.ok(d.parentElement.classList.contains("vf-overlay"));
    assert.ok(d.parentElement.classList.contains("is-open"));
    assert.strictEqual(w.document.getElementById(d.getAttribute("aria-labelledby")).textContent, "Desativar base?");
    assert.strictEqual(w.document.getElementById(d.getAttribute("aria-describedby")).textContent, "Custos e histórico\nsão preservados.");
    assert.ok(w.document.body.classList.contains("vf-no-scroll"));
    d.querySelector(".vf-btn--primary").click();
    assert.strictEqual(await p, true);
  });

  await caso("confirm: Confirmar → true, Cancelar → false; remove o modal e destrava", async () => {
    const w = novaPagina();
    let p = w.VF.confirm("Seguir?");
    w.document.querySelector(".vf-btn--ghost").click();
    assert.strictEqual(await p, false);
    assert.strictEqual(w.document.querySelector(".vf-overlay"), null);
    assert.ok(!w.document.body.classList.contains("vf-no-scroll"));
    p = w.VF.confirm({ message: "Seguir?", confirmLabel: "Sim, seguir" });
    const botao = [...w.document.querySelectorAll("button")].find((b) => b.textContent === "Sim, seguir");
    botao.click();
    assert.strictEqual(await p, true);
  });

  await caso("confirm: Escape e clique no fundo respondem false", async () => {
    const w = novaPagina();
    let p = w.VF.confirm("A?");
    tecla(w, "Escape");
    assert.strictEqual(await p, false);
    p = w.VF.confirm("B?");
    const fundo = w.document.querySelector(".vf-overlay");
    fundo.dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
    assert.strictEqual(await p, false);
  });

  await caso("confirm: foco no Confirmar; com tone=danger, no Cancelar; devolve o foco a quem abriu", async () => {
    const w = novaPagina();
    const origem = w.document.getElementById("origem");
    origem.focus();
    let p = w.VF.confirm("A?");
    assert.ok(w.document.activeElement.classList.contains("vf-btn--primary"));
    tecla(w, "Escape");
    await p;
    assert.strictEqual(w.document.activeElement, origem);
    p = w.VF.confirm({ message: "Remover?", tone: "danger", confirmLabel: "Remover" });
    assert.ok(w.document.querySelector(".vf-btn--danger"));
    assert.ok(w.document.activeElement.classList.contains("vf-btn--ghost"));
    tecla(w, "Escape");
    await p;
  });

  await caso("confirm: Tab fica preso entre os dois botões", async () => {
    const w = novaPagina();
    const p = w.VF.confirm("A?");
    const [cancelar, confirmar] = w.document.querySelectorAll(".vf-modal__footer button");
    confirmar.focus();
    tecla(w, "Tab");
    assert.strictEqual(w.document.activeElement, cancelar);
    tecla(w, "Tab", { shiftKey: true });
    assert.strictEqual(w.document.activeElement, confirmar);
    tecla(w, "Escape");
    await p;
  });

  await caso("confirm: com movimento, o modal sai depois da transição", async () => {
    const w = novaPagina({ reduzido: false });
    const p = w.VF.confirm("A?");
    tecla(w, "Escape");
    assert.strictEqual(await p, false);
    assert.ok(w.document.querySelector(".vf-overlay"), "ainda saindo");
    assert.ok(!w.document.querySelector(".vf-overlay").classList.contains("is-open"));
    await new Promise((r) => setTimeout(r, 260));
    assert.strictEqual(w.document.querySelector(".vf-overlay"), null);
  });

  await caso("toast: pilha única, tom vira classe, danger é alert, × fecha", () => {
    const w = novaPagina();
    w.VF.toast({ title: "Base salva", description: "12 custos atualizados", tone: "success" });
    const t = w.VF.toast({ title: "Erro ao baixar base", tone: "danger" });
    const pilhas = w.document.querySelectorAll("#vf-toast-stack");
    assert.strictEqual(pilhas.length, 1);
    assert.strictEqual(pilhas[0].children.length, 2);
    assert.ok(t.classList.contains("vf-toast") && t.classList.contains("is-danger"));
    assert.strictEqual(t.getAttribute("role"), "alert");
    assert.strictEqual(pilhas[0].children[0].getAttribute("role"), "status");
    t.querySelector(".vf-toast__close").click();
    assert.strictEqual(pilhas[0].children.length, 1);
  });

  await caso("toast: some sozinho depois da duração", async () => {
    const w = novaPagina();
    w.VF.toast({ title: "Oi", duration: 30 });
    assert.strictEqual(w.document.querySelectorAll(".vf-toast").length, 1);
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(w.document.querySelectorAll(".vf-toast").length, 0);
  });

  await caso("toast: texto vai como texto (sem HTML injetado)", () => {
    const w = novaPagina();
    const t = w.VF.toast({ title: '<img src=x onerror="alert(1)">' });
    assert.strictEqual(t.querySelector("img"), null);
  });

  console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo ok");
  process.exit(falhas ? 1 : 0);
})();
