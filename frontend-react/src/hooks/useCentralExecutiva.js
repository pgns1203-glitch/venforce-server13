import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { obterCarteiraExecutiva } from "../services/centralExecutivaApi.js";
import { competenciaAnterior, competenciaAtual, ehCompetencia } from "../utils/dates.js";

function filtrosIniciais() {
  const query = new URLSearchParams(window.location.search || "");
  const competencia = ehCompetencia(query.get("competencia"))
    ? query.get("competencia")
    : competenciaAnterior(competenciaAtual());

  return {
    competencia,
    compararCom: ehCompetencia(query.get("compararCom"))
      ? query.get("compararCom")
      : competenciaAnterior(competencia),
    marketplace: query.get("marketplace") || "meli",
    margemAlvo: query.get("margemAlvo") || "15",
    busca: query.get("busca") || "",
    status: query.get("status") || "todos",
  };
}

function escreverUrl(filtros) {
  const query = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor !== null && valor !== undefined && valor !== "" && valor !== "todos") {
      query.set(chave, String(valor));
    }
  }
  window.history.replaceState({}, "", `${window.location.pathname}?${query}`);
}

export function useCentralExecutiva() {
  const [filtros, setFiltros] = useState(filtrosIniciais);
  const [contas, setContas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [progresso, setProgresso] = useState({ concluidos: 0, total: 0 });
  const abortRef = useRef(null);

  const carregar = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setCarregando(true);
    setErro(null);
    setProgresso({ concluidos: 0, total: 0 });

    try {
      const resposta = await obterCarteiraExecutiva({
        competencia: filtros.competencia,
        compararCom: filtros.compararCom,
        marketplace: filtros.marketplace,
        margemAlvo: filtros.margemAlvo,
        signal: controller.signal,
        onProgresso: setProgresso,
      });
      if (!controller.signal.aborted) setContas(resposta.contas || []);
    } catch (err) {
      if (err?.name !== "AbortError" && !controller.signal.aborted) {
        setErro(err?.message || "Não foi possível carregar a carteira.");
      }
    } finally {
      if (!controller.signal.aborted) setCarregando(false);
    }
  }, [filtros.competencia, filtros.compararCom, filtros.marketplace, filtros.margemAlvo]);

  useEffect(() => {
    escreverUrl(filtros);
  }, [filtros]);

  useEffect(() => {
    carregar();
    return () => abortRef.current?.abort();
  }, [carregar]);

  const contasFiltradas = useMemo(() => {
    const termo = filtros.busca.trim().toLowerCase();
    return contas
      .filter((conta) => filtros.status === "todos" || conta.status === filtros.status)
      .filter((conta) => !termo || conta.cliente?.nome?.toLowerCase().includes(termo) || conta.cliente?.slug?.includes(termo))
      .sort((a, b) => {
        const prioridade = { critico: 0, atencao: 1, sem_dados: 2, saudavel: 3 };
        const porStatus = (prioridade[a.status] ?? 9) - (prioridade[b.status] ?? 9);
        if (porStatus !== 0) return porStatus;
        return (a.deltaResultado ?? 0) - (b.deltaResultado ?? 0);
      });
  }, [contas, filtros.busca, filtros.status]);

  function atualizarFiltro(parcial) {
    setFiltros((atual) => {
      const proximo = { ...atual, ...parcial };
      if (parcial.competencia && !parcial.compararCom) {
        proximo.compararCom = competenciaAnterior(parcial.competencia);
      }
      return proximo;
    });
  }

  return {
    filtros,
    atualizarFiltro,
    contas,
    contasFiltradas,
    carregando,
    erro,
    progresso,
    recarregar: carregar,
  };
}
