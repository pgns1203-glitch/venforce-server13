const STORAGE_KEY = "vf-token";

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
  initGuiaInstalacao();
}

// "Como instalar" nos cards abre o guia compartilhado (<details>) e rola até
// ele. O href="#instalar-no-chrome" já é o fallback sem JS.
function initGuiaInstalacao() {
  document.querySelectorAll("[data-vf-open]").forEach((link) => {
    link.addEventListener("click", () => {
      const alvo = document.getElementById(link.dataset.vfOpen);
      if (alvo) alvo.open = true;
    });
  });
}
