// frontend-react/src/hooks/useAdsMercadoAds.js
//
// Campo ADS do Fechamento (modelo B): o investimento do Mercado Ads da conta
// na competência chega SOZINHO ao abrir o Financeiro. O backend responde do
// cache por conta+mês (rápido) ou consulta o ML; `atualizar()` (o ↻ do
// campo) força a consulta ao vivo.
//
// Só Mercado Livre. Sem dado da API (sem permissão, conta sem Mercado Ads,
// erro do ML) o status vira "indisponivel" com o código — o campo segue
// manual, nunca bloqueia o fechamento.

import { useCallback, useEffect, useRef, useState } from "react";
import { obterAdsFechamento } from "../services/financeiroApi.js";
import { ApiError } from "../services/apiClient.js";

const INATIVO = { status: "inativo", dados: null, codigo: null, atualizando: false };

// 4812.4 → "4.812,40" — o mesmo formato que a pessoa digita no campo, para
// a comparação "o campo ainda tem o valor da API?" ser por texto.
export function formatarValorCampo(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// De onde veio o ADS que vai para o fechamento: "mercado_ads" quando o campo
// ainda tem o valor da API, "manual" quando foi digitado, null quando vazio.
export function origemDoAds(valorCampo, ads) {
  const atual = String(valorCampo ?? "").trim();
  if (!atual) return null;
  if (ads?.status === "ok" && ads.valorCampo === atual) return "mercado_ads";
  return "manual";
}

export function useAdsMercadoAds({ clienteSlug, clienteContaId, periodo, habilitado }) {
  const [estado, setEstado] = useState(INATIVO);
  const seqRef = useRef(0);
  const abortRef = useRef(null);
  const ativo = !!(habilitado && clienteSlug && clienteContaId && periodo);

  const carregar = useCallback(
    (atualizar = false) => {
      if (!ativo) {
        abortRef.current?.abort();
        setEstado(INATIVO);
        return;
      }
      const seq = ++seqRef.current;
      abortRef.current?.abort();
      const controlador = new AbortController();
      abortRef.current = controlador;
      // No ↻ o valor atual continua na tela enquanto a consulta roda.
      setEstado((e) => (atualizar && e.status === "ok" ? { ...e, atualizando: true } : { ...INATIVO, status: "carregando" }));

      obterAdsFechamento(clienteSlug, { clienteContaId, periodo, atualizar, signal: controlador.signal })
        .then((r) => {
          if (seq !== seqRef.current) return;
          if (r?.disponivel === true && Number.isFinite(Number(r.investimentoAds))) {
            setEstado({ status: "ok", dados: r, codigo: null, atualizando: false });
          } else {
            setEstado({ status: "indisponivel", dados: null, codigo: r?.codigo || "ML_ADS_API_ERROR", atualizando: false });
          }
        })
        .catch((err) => {
          if (err?.name === "AbortError" || seq !== seqRef.current) return;
          setEstado({
            status: "erro",
            dados: null,
            codigo: err instanceof ApiError ? err.codigo || null : null,
            atualizando: false,
          });
        });
    },
    [ativo, clienteSlug, clienteContaId, periodo]
  );

  useEffect(() => {
    carregar(false);
    return () => abortRef.current?.abort();
  }, [carregar]);

  const atualizar = useCallback(() => carregar(true), [carregar]);
  const valorCampo = estado.status === "ok" ? formatarValorCampo(estado.dados.investimentoAds) : null;

  return { ...estado, valorCampo, atualizar };
}
