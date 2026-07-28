// frontend-react/src/main.jsx
// Ponto de entrada da primeira página React do Portal VenForce.
//
// Integração com o Portal legado, nesta ordem:
//   1. `initLayout()` (layout.js, script clássico carregado antes deste bundle)
//      desenha sidebar e topbar, valida o token em localStorage["vf-token"] e
//      redireciona para index.html se não houver sessão — exatamente como nas
//      telas vanilla;
//   2. o app React monta em #root, dentro de <main class="vf-content">.
//
// Não há login novo, não há CDN, não há iframe: o React vem do bundle.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles/cliente360.css";

// Se layout.js não tiver carregado (ex.: alguém abriu o HTML fora do Portal), a
// página ainda renderiza — só sem a navegação lateral.
if (typeof window.initLayout === "function") {
  window.initLayout();
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
