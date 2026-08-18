// frontend-react/src/hooks/useFullSnapshot.js
// Estado da tela principal: carga do snapshot e estados explícitos de
// loading/erro/vazio. Mesma disciplina de useCliente360: uma requisição por
// vez, AbortController cancela a anterior ao trocar de conta ou recarregar.

import { useCallback, useEffect, useRef, useState } from "react";
import { obterSnapshotFull } from "../services/fullApi.js";
import { ApiError } from "../services/apiClient.js";

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

export function useFullSnapshot(clienteContaId, { windowDays = 14 } = {}) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const abortRef = useRef(null);

  const carregar = useCallback(async () => {
    abortRef.current?.abort();

    if (!clienteContaId) {
      setDados(null);
      setErro(null);
      setCarregando(false);
      return;
    }

    const controlador = new AbortController();
    abortRef.current = controlador;

    setCarregando(true);
    setErro(null);
    try {
      const payload = await obterSnapshotFull(clienteContaId, { windowDays, signal: controlador.signal });
      if (controlador.signal.aborted) return;
      setDados(payload);
    } catch (err) {
      if (err?.name === "AbortError" || controlador.signal.aborted) return;
      setDados(null);
      setErro(normalizarErro(err));
    } finally {
      if (!controlador.signal.aborted) setCarregando(false);
    }
  }, [clienteContaId, windowDays]);

  useEffect(() => {
    carregar();
    return () => abortRef.current?.abort();
  }, [carregar]);

  return { dados, carregando, erro, recarregar: carregar };
}
