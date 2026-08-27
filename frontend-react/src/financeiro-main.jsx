// frontend-react/src/financeiro-main.jsx
// Ponto de entrada do Financeiro V3 (F4.1) — mesmo padrão de visao-main.jsx:
// ilha React sobre o Shell V3 (vf-shell.js/vf-context.js), sem layout.js.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import FinanceiroPage from "./pages/FinanceiroPage.jsx";
import "./styles/financeiro.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <FinanceiroPage />
  </StrictMode>
);
