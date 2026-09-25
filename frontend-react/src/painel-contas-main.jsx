// frontend-react/src/painel-contas-main.jsx
// Ponto de entrada do Painel de Contas por Squad — ilha React sobre o Shell V3
// (Portal/vf-shell.js, script módulo carregado antes deste — ver
// painel-contas.html). Escopo GLOBAL: não há resolução de contexto operacional
// aqui, a página lê sua própria carteira via GET /painel-contas.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import PainelContasPage from "./pages/PainelContasPage.jsx";
import "./styles/painel-contas.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <PainelContasPage />
    </ErrorBoundary>
  </StrictMode>
);
