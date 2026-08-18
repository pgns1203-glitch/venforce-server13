// frontend-react/src/hooks/useFullInventoryDetail.js
// Estado do drawer Product360 operacional: detalhe + movimentos de um
// inventory_id. AbortController cancela a busca anterior ao trocar de
// inventário ou fechar/reabrir o drawer.

import { useEffect, useRef, useState } from "react";
import { obterInventoryDetail, obterInventoryMovements } from "../services/fullApi.js";
import { ApiError } from "../services/apiClient.js";

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

export function useFullInventoryDetail(clienteContaId, inventoryId) {
  const [detalhe, setDetalhe] = useState(null);
  const [movimentos, setMovimentos] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    abortRef.current?.abort();

    if (!clienteContaId || !inventoryId) {
      setDetalhe(null);
      setMovimentos(null);
      setErro(null);
      setCarregando(false);
      return undefined;
    }

    const controlador = new AbortController();
    abortRef.current = controlador;

    setCarregando(true);
    setErro(null);
    setDetalhe(null);
    setMovimentos(null);

    (async () => {
      try {
        const [detalheResp, movimentosResp] = await Promise.all([
          obterInventoryDetail(clienteContaId, inventoryId, { signal: controlador.signal }),
          obterInventoryMovements(clienteContaId, inventoryId, { signal: controlador.signal }),
        ]);
        if (controlador.signal.aborted) return;
        setDetalhe(detalheResp);
        setMovimentos(movimentosResp);
      } catch (err) {
        if (err?.name === "AbortError" || controlador.signal.aborted) return;
        setErro(normalizarErro(err));
      } finally {
        if (!controlador.signal.aborted) setCarregando(false);
      }
    })();

    return () => controlador.abort();
  }, [clienteContaId, inventoryId]);

  return { detalhe, movimentos, carregando, erro };
}
