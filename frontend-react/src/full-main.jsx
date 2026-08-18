// frontend-react/src/full-main.jsx
// Ponto de entrada da Central de Gestão Full (build isolado, PR5).
//
// Mesma integração da Cliente 360 (ver src/main.jsx): `initLayout()` desenha
// sidebar/topbar e valida a sessão; o app React monta em #root. Sem login
// novo, sem CDN, sem iframe.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import FullApp from "./FullApp.jsx";
import "./styles/fullGestao.css";

if (typeof window.initLayout === "function") {
  window.initLayout();
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <FullApp />
  </StrictMode>
);
