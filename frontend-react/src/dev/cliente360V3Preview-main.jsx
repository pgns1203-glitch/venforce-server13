// frontend-react/src/dev/cliente360V3Preview-main.jsx
//
// Entry do preview visual (?preview=1) — ver cliente-360-v3-preview.html.
// Sem vf-shell.js/vf-context.js: propositalmente não desenha sidebar/topbar
// (evitaria "não depender de vf-context" e "não chamar API" — o boot do
// Shell V3 real resolve carteira/contexto operacional via rede). Renderiza
// só a área de conteúdo da 360, que é o que existe para revisar aqui.
//
// Dev-only por construção: este arquivo só é alcançado pelo plugin de dev
// server em vite.config.js (forcarHtmlDaFonteSobrePublicDir) — nenhum
// entry de build (vite.entries.js) referencia este arquivo, então ele nunca
// entra num bundle de produção.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "../components/ErrorBoundary.jsx";
import Cliente360V3PreviewPage from "./Cliente360V3PreviewPage.jsx";
import "../styles/cliente360.css";
import "../styles/cliente360V3.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <Cliente360V3PreviewPage />
    </ErrorBoundary>
  </StrictMode>
);
