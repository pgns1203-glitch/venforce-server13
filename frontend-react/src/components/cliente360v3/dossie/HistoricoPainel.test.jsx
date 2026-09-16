// frontend-react/src/components/cliente360v3/dossie/HistoricoPainel.test.jsx
//
// Regressão do crash de produção (ErrorBoundary: "TypeError: o.includes is
// not a function"). `entregas_cliente.created_by` é INTEGER (FK para
// users.id) — nunca um e-mail — mas o fixture de preview sempre escreveu
// `ator` como string ("consultor@venforce.com.br"), então o preview nunca
// exercitou `curtoAtor()` com o shape real que `cliente360V3HistoricoService.js`
// (`ator: e.created_by ?? null`) devolve em produção.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HistoricoPainel from "./HistoricoPainel.jsx";

describe("HistoricoPainel", () => {
  it("não quebra quando o evento de entrega traz `ator` numérico (created_by INTEGER real)", () => {
    const historico = {
      eventos: [
        {
          tipo: "entrega",
          timestamp: "2026-09-01T09:14:00Z",
          titulo: "Fechamento de agosto publicado",
          competencia: "2026-08",
          escopo: "account",
          ator: 7, // shape real: entregas_cliente.created_by é INTEGER, não e-mail
        },
      ],
      fontes: {},
    };

    render(<HistoricoPainel historico={historico} carregando={false} erro={null} onAbrirEvento={() => {}} />);

    expect(screen.getByText("Fechamento de agosto publicado")).toBeInTheDocument();
  });
});
