// frontend-react/src/hooks/useVisao.js
//
// Busca a Visão operacional (GET /operacao/visao/:cliente) sempre que a
// operação atual (cliente+conta) ou o período mudam. Um único request compõe
// os 6 blocos no servidor — nada de 6 hooks/6 fetches (isso só fazia sentido
// no fallback client-side especulado antes de o endpoint existir).
//
// Guarda de corrida (MASTER_SPEC §6.6): cada chamada carrega um `seq`
// próprio; uma resposta que chega depois de o contexto já ter mudado de novo
// é descartada silenciosamente — nunca sobrescreve o estado com dado de uma
// operação que o usuário já deixou.

import { useEffect, useRef, useState } from "react";
import { obterVisao } from "../services/visaoApi.js";
import { ApiError } from "../services/apiClient.js";
import { lerPeriodoDaUrl, escreverPeriodoNaUrl } from "../utils/periodoUrl.js";

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

export function useVisao({ clienteSlug, clienteContaId, pronta }) {
  const [periodo, setPeriodo] = useState(() => lerPeriodoDaUrl());
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const seqRef = useRef(0);
  const abortRef = useRef(null);

  useEffect(() => {
    escreverPeriodoNaUrl(periodo);
  }, [periodo]);

  useEffect(() => {
    if (!pronta || !clienteSlug || !clienteContaId) {
      // Contexto incompleto: o Shell já cuida de esconder a página inteira
      // nesse caso (data-vf-scope="account") — aqui só zera o estado para
      // não deixar dado da operação ANTERIOR visível se o React não for
      // desmontado a tempo.
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

    obterVisao(clienteSlug, { clienteContaId, periodo, signal: controlador.signal })
      .then((payload) => {
        if (seq !== seqRef.current) return; // operação/período já trocou de novo
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
  }, [clienteSlug, clienteContaId, periodo, pronta]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { periodo, setPeriodo, dados, carregando, erro };
}
