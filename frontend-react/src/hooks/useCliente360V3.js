// frontend-react/src/hooks/useCliente360V3.js
//
// Busca o bootstrap da Cliente 360 V3 (GET /operacao/cliente-360-v3/:slug/
// bootstrap) sempre que a operação atual (cliente+conta) ou o período
// mudam. Mesmo padrão de useVisao.js (F3.2): AbortController + seq guard
// contra corrida — uma resposta que chega depois de o contexto já ter
// trocado de novo é descartada, mesmo sem erro e sem abort a tempo.
//
// Camada extra pedida pelo prompt master (Fase 1, "ContextKey"): o backend
// ecoa `contexto.contextKey`; o hook recalcula a chave ESPERADA a partir do
// contexto que disparou aquele request e descarta a resposta se as duas não
// baterem — cobre o caso de uma resposta fora de ordem que o seqRef sozinho
// não pegaria. `compararCom` precisa espelhar aqui o MESMO default que o
// backend aplica quando omitido (mês anterior — cliente360V3BootstrapService
// :: resolverCompararCom) para as duas chaves poderem concordar byte a byte.

import { useEffect, useRef, useState } from "react";
import { obterBootstrapCliente360V3 } from "../services/cliente360V3Api.js";
import { ApiError } from "../services/apiClient.js";
import { criarContextKey } from "../utils/cliente360V3ContextKey.js";
import { competenciaAnterior } from "../utils/dates.js";
import { lerPeriodoDaUrl, escreverPeriodoNaUrl } from "../utils/periodoUrl.js";

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

export function useCliente360V3({ clienteId, clienteSlug, clienteContaId, pronta }) {
  const [periodo, setPeriodo] = useState(() => lerPeriodoDaUrl());
  const [compararCom, setCompararCom] = useState(null); // null = backend decide o default (mês anterior)
  const [boot, setBoot] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const seqRef = useRef(0);
  const abortRef = useRef(null);

  useEffect(() => {
    escreverPeriodoNaUrl(periodo);
  }, [periodo]);

  useEffect(() => {
    if (!pronta || !clienteSlug || !clienteContaId || !periodo) {
      // Contexto incompleto: o Shell já esconde a página inteira nesse caso
      // (data-vf-scope="account") — aqui só zera o estado para não deixar
      // dado da operação/período ANTERIOR visível se o React não desmontar
      // a tempo (master prompt Fase 1: "não exibir dado da conta anterior
      // enquanto a nova carrega").
      setBoot(null);
      setErro(null);
      setCarregando(false);
      return undefined;
    }

    const compararComEfetivo = compararCom || competenciaAnterior(periodo);
    const chaveEsperada = criarContextKey({ clienteId, clienteContaId, periodo, compararCom: compararComEfetivo });

    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;

    setCarregando(true);
    setErro(null);

    obterBootstrapCliente360V3(clienteSlug, { clienteContaId, periodo, compararCom, signal: controlador.signal })
      .then((payload) => {
        if (seq !== seqRef.current) return; // operação/período já trocou de novo
        if (payload?.contexto?.contextKey !== chaveEsperada) return; // resposta de outro contexto
        setBoot(payload);
      })
      .catch((err) => {
        if (err?.name === "AbortError" || seq !== seqRef.current) return;
        setBoot(null);
        setErro(normalizarErro(err));
      })
      .finally(() => {
        if (seq === seqRef.current) setCarregando(false);
      });

    return () => controlador.abort();
  }, [clienteId, clienteSlug, clienteContaId, periodo, compararCom, pronta]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { periodo, setPeriodo, compararCom, setCompararCom, boot, carregando, erro };
}
