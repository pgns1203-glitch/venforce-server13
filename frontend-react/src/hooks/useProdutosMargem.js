// frontend-react/src/hooks/useProdutosMargem.js
//
// FASE 3 (Projeto_cliente360) — cruzamento de margem, LAZY: só busca quando
// `habilitado` (a seção Produtos foi aberta) e há MLBs para consultar. Mesmo
// padrão de cancelamento de useCliente360V3.js: troca de contexto (conta ou
// lista de MLBs) aborta a requisição anterior e descarta resposta atrasada.

import { useEffect, useRef, useState } from "react";
import { obterProdutosMargemV3 } from "../services/cliente360V3ProdutosApi.js";
import { ApiError } from "../services/apiClient.js";

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

export function useProdutosMargem({ clienteSlug, clienteContaId, periodo, mlbs, habilitado }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const seqRef = useRef(0);
  const abortRef = useRef(null);
  const mlbsKey = (mlbs || []).slice().sort().join(",");

  useEffect(() => {
    if (!habilitado || !clienteSlug || !clienteContaId || !periodo || !mlbsKey) {
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

    obterProdutosMargemV3(clienteSlug, { clienteContaId, periodo, mlbs, signal: controlador.signal })
      .then((payload) => {
        if (seq !== seqRef.current) return;
        setDados(payload);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteSlug, clienteContaId, periodo, mlbsKey, habilitado]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { dados, carregando, erro };
}
