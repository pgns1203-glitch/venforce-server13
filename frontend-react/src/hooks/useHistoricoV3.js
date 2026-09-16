// frontend-react/src/hooks/useHistoricoV3.js
//
// FASE 6 (Projeto_cliente360) — Histórico, LAZY (mesmo padrão de
// useSaudeAdsV3.js: só busca depois que o bootstrap da Fase 1 já resolveu).
// Cancelamento por AbortController + seqRef — troca de conta descarta
// resposta atrasada da conta anterior.

import { useEffect, useRef, useState } from "react";
import { obterHistoricoV3 } from "../services/cliente360V3HistoricoApi.js";
import { ApiError } from "../services/apiClient.js";

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

export function useHistoricoV3({ clienteSlug, clienteContaId, habilitado, limite = 30 }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const seqRef = useRef(0);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!habilitado || !clienteSlug || !clienteContaId) {
      setDados(null);
      setErro(null);
      setCarregando(false);
      return undefined;
    }

    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;

    setCarregando(true);
    setErro(null);

    obterHistoricoV3(clienteSlug, { clienteContaId, limite, signal: controlador.signal })
      .then((payload) => {
        if (seq !== seqRef.current) return;
        setDados(payload.historico);
      })
      .catch((err) => {
        if (err?.name === "AbortError" || seq !== seqRef.current) return;
        setDados(null);
        setErro(normalizarErro(err));
      })
      .finally(() => {
        if (seq === seqRef.current) setCarregando(false);
      });

    return () => controlador.abort();
  }, [clienteSlug, clienteContaId, habilitado, limite]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { dados, carregando, erro };
}
