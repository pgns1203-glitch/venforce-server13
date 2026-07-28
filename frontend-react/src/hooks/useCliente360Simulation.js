// frontend-react/src/hooks/useCliente360Simulation.js
// Estado do simulador.
//
// Toda a matemática roda NO SERVIDOR (mesmo motor puro que monta a ponte),
// chamada com debounce curto. Isso evita duas implementações da mesma conta
// divergirem com o tempo — o número simulado é sempre coerente com o explicado.
//
// O cenário aceita, por produto: Δ% preço, Δ% custo, Δ% frete e pausar/despausar.
// NÃO existe campo de Ads: o investimento do fechamento é constante e vem do
// backend apenas para exibir o resultado após Ads do cenário.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { simular as simularApi, obterElasticidades } from "../services/cliente360Api.js";
import { montarIntervencoes, ajustesDoCenarioRapido, ajusteVazio } from "../utils/cenario.js";

const DEBOUNCE_MS = 350;

export function useCliente360Simulation({ slug, competencia, marketplace }) {
  const [ajustes, setAjustes] = useState({});
  const [resultado, setResultado] = useState(null);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState(null);
  const [elasticidades, setElasticidades] = useState(null);
  const [cenarioRapidoAtivo, setCenarioRapidoAtivo] = useState(null);

  const abortRef = useRef(null);
  const timerRef = useRef(null);

  const intervencoes = useMemo(() => montarIntervencoes(ajustes), [ajustes]);
  const temCenario = intervencoes.length > 0;

  const executar = useCallback(async ({ cenarioRapido = null, intervencoesManuais = null } = {}) => {
    if (!slug) return;
    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;

    setProcessando(true);
    setErro(null);
    try {
      const resposta = await simularApi(slug, {
        competencia,
        marketplace,
        cenario: { intervencoes: intervencoesManuais || intervencoes },
        cenarioRapido,
        elasticidades: elasticidades || undefined,
        signal: controlador.signal,
      });
      if (controlador.signal.aborted) return;
      setResultado(resposta);
    } catch (err) {
      if (err?.name === "AbortError" || controlador.signal.aborted) return;
      setResultado(null);
      setErro(err?.message || "Não foi possível simular.");
    } finally {
      if (!controlador.signal.aborted) setProcessando(false);
    }
  }, [slug, competencia, marketplace, intervencoes, elasticidades]);

  // Debounce: o consultor digita em vários campos seguidos; só a última versão
  // do cenário vira requisição.
  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!temCenario) {
      abortRef.current?.abort();
      setResultado(null);
      return undefined;
    }
    timerRef.current = setTimeout(() => executar(), DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [intervencoes, temCenario, executar]);

  // Elasticidade é opcional: sem ela o simulador mantém o volume fixo e avisa,
  // em vez de inventar a reação do mercado.
  useEffect(() => {
    if (!slug) return undefined;
    const controlador = new AbortController();
    let vivo = true;

    setAjustes({});
    setResultado(null);
    setCenarioRapidoAtivo(null);

    obterElasticidades(slug, { meses: 6, ate: competencia, marketplace, signal: controlador.signal })
      .then((resposta) => { if (vivo) setElasticidades(resposta?.elasticidades || null); })
      .catch(() => { if (vivo) setElasticidades(null); });

    return () => { vivo = false; controlador.abort(); };
  }, [slug, competencia, marketplace]);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    abortRef.current?.abort();
  }, []);

  const definir = useCallback((mlb, campo, valor) => {
    setCenarioRapidoAtivo(null);
    setAjustes((atual) => ({ ...atual, [mlb]: { ...(atual[mlb] || ajusteVazio()), [campo]: valor } }));
  }, []);

  const limpar = useCallback(() => {
    setAjustes({});
    setCenarioRapidoAtivo(null);
    setResultado(null);
    setErro(null);
  }, []);

  // Cenários rápidos são resolvidos NO SERVIDOR a partir do perfil real do
  // período; o que muda aqui é só o espelho visual nos controles.
  const aplicarCenarioRapido = useCallback((chave, produtos = []) => {
    if (chave === "limpar") { limpar(); return; }
    const novos = ajustesDoCenarioRapido(chave, produtos);
    setAjustes(novos);
    setCenarioRapidoAtivo(chave);
    executar({ cenarioRapido: chave, intervencoesManuais: montarIntervencoes(novos) });
  }, [executar, limpar]);

  return {
    ajustes, resultado, processando, erro, elasticidades,
    intervencoes, temCenario, cenarioRapidoAtivo,
    definir, limpar, aplicarCenarioRapido,
  };
}
