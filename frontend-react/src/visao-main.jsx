// frontend-react/src/visao-main.jsx
// Ponto de entrada da Visão (F3.2) — primeira ilha React sobre o Shell V3.
//
// Diferente de main.jsx (Cliente 360, sobre layout.js legado): aqui quem
// desenha sidebar/topbar e resolve o contexto operacional é vf-shell.js/
// vf-context.js (script módulo carregado antes deste, ver visao.html). Não
// há `initLayout()` — não existe nesta página.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import VisaoPage from "./pages/VisaoPage.jsx";
import "./styles/visao.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <VisaoPage />
  </StrictMode>
);
