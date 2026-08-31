// frontend-react/src/hooks/useFinanceiro.js
// Mesmo padrão de useVisao.js: um único fetch por troca de operação/período
// (o backend já compõe resultado+conciliação+relatórios numa chamada),
// guarda de sequência contra resposta antiga sobrescrever contexto novo.

import { useEffect, useRef, useState } from "react";
import { obterFinanceiro } from "../services/financeiroApi.js";
import { ApiError } from "../services/apiClient.js";
import { lerPeriodoDaUrl, escreverPeriodoNaUrl } from "../utils/periodoUrl.js";

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

export function useFinanceiro({ clienteSlug, clienteContaId, pronta }) {
  const [periodo, setPeriodo] = useState(() => lerPeriodoDaUrl());
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  // Convergência #3 — depois que o <NovoFechamento> salva uma entrega, esta
  // leitura precisa ser refeita (o bloco `resultado`/`relatorios` do
  // GET /financeiro/:cliente passou a ter um fechamento novo). Bumpar o nonce
  // é um refetch autoritativo, sem tocar em periodo/conta.
  const [nonce, setNonce] = useState(0);

  const seqRef = useRef(0);
  const abortRef = useRef(null);

  useEffect(() => {
    escreverPeriodoNaUrl(periodo);
  }, [periodo]);

  useEffect(() => {
    if (!pronta || !clienteSlug || !clienteContaId) {
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

    obterFinanceiro(clienteSlug, { clienteContaId, periodo, signal: controlador.signal })
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
  }, [clienteSlug, clienteContaId, periodo, pronta, nonce]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { periodo, setPeriodo, dados, carregando, erro, recarregar: () => setNonce((n) => n + 1) };
}
