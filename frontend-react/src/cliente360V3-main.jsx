// frontend-react/src/cliente360V3-main.jsx
// Ponto de entrada da Cliente 360 V3 (Projeto_cliente360, Fase 1) —
// fundação da nova 360 sobre o Shell V3. Mesmo padrão de visao-main.jsx:
// quem desenha sidebar/topbar e resolve o contexto operacional é
// vf-shell.js/vf-context.js (script módulo carregado antes deste, ver
// cliente-360-v3.html). Não existe initLayout() aqui.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import Cliente360V3Page from "./pages/Cliente360V3Page.jsx";
// Ordem importa: `cliente360.css` traz os estilos dos componentes da V2 que o
// Dossiê ainda reaproveita (SimuladorResultado, estados vazios/erro). A V3
// nunca havia importado esse arquivo — e como reaproveitava 15 componentes
// dependentes dele, a tela era servida sem os estilos de metade da árvore
// (KPIs em coluna única, ponte sem barras). `cliente360V3.css` vem depois
// para que o Dossiê vença qualquer regra concorrente.
import "./styles/cliente360.css";
import "./styles/cliente360V3.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <Cliente360V3Page />
    </ErrorBoundary>
  </StrictMode>
);
