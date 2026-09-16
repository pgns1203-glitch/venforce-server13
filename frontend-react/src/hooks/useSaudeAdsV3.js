// frontend-react/src/hooks/useSaudeAdsV3.js
//
// FASE 5A+5C (Projeto_cliente360) — Ads account-scoped + Saúde leve, LAZY:
// dispara DEPOIS que o bootstrap da Fase 1 resolve (nunca junto do boot —
// Ads chama a API real do Mercado Livre). Mesmo padrão de cancelamento de
// useCliente360V3.js: troca de contexto aborta os requests em voo.

import { useEffect, useRef, useState } from "react";
import { obterAdsV3, obterSaudeV3 } from "../services/cliente360V3SaudeAdsApi.js";
import { ApiError } from "../services/apiClient.js";

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

export function useSaudeAdsV3({ clienteSlug, clienteContaId, periodo, habilitado }) {
  const [ads, setAds] = useState(null);
  const [saude, setSaude] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const seqRef = useRef(0);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!habilitado || !clienteSlug || !clienteContaId || !periodo) {
      setAds(null);
      setSaude(null);
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

    Promise.all([
      obterAdsV3(clienteSlug, { clienteContaId, periodo, signal: controlador.signal }),
      obterSaudeV3(clienteSlug, { clienteContaId, signal: controlador.signal }),
    ])
      .then(([respostaAds, respostaSaude]) => {
        if (seq !== seqRef.current) return;
        setAds(respostaAds.ads);
        setSaude(respostaSaude.saude);
      })
      .catch((err) => {
        if (err?.name === "AbortError" || seq !== seqRef.current) return;
        setAds(null);
        setSaude(null);
        setErro(normalizarErro(err));
      })
      .finally(() => {
        if (seq === seqRef.current) setCarregando(false);
      });

    return () => controlador.abort();
  }, [clienteSlug, clienteContaId, periodo, habilitado]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { ads, saude, carregando, erro };
}
