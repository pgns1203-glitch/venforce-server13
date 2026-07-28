// frontend-react/src/hooks/useCliente360.js
// Estado da tela: filtros (espelhados na query string), carga do payload e
// estados explícitos de loading/erro/vazio.
//
// Sem Redux e sem React Query: uma página só, uma requisição principal. Um hook
// com useState/useEffect e AbortController resolve com menos peça móvel.
//
// Os filtros vivem na URL para a tela ser linkável a partir do Portal legado:
//   cliente-360-react.html?slug=cliente-x&competencia=2026-06&compararCom=2026-05
// O token NUNCA vai para a URL — continua no localStorage do Portal.

import { useCallback, useEffect, useRef, useState } from "react";
import { obterResultado, listarClientes } from "../services/cliente360Api.js";
import { ApiError, ehAdmin } from "../services/apiClient.js";
import { ehCompetencia, competenciaAnterior, competenciaAtual } from "../utils/dates.js";

const PARAMS = ["slug", "competencia", "compararCom", "marketplace", "margemAlvo"];

export function lerFiltrosDaUrl(search = window.location.search) {
  const q = new URLSearchParams(search || "");
  const competencia = ehCompetencia(q.get("competencia"))
    ? q.get("competencia")
    // Padrão: último mês fechado — evita abrir a tela num mês ainda vazio.
    : competenciaAnterior(competenciaAtual());
  return {
    slug: (q.get("slug") || "").trim().toLowerCase(),
    competencia,
    compararCom: ehCompetencia(q.get("compararCom")) ? q.get("compararCom") : competenciaAnterior(competencia),
    marketplace: (q.get("marketplace") || "meli").trim().toLowerCase(),
    margemAlvo: q.get("margemAlvo") || "",
  };
}

function escreverFiltrosNaUrl(filtros) {
  const q = new URLSearchParams(window.location.search || "");
  for (const chave of PARAMS) {
    const valor = filtros[chave];
    if (valor === null || valor === undefined || valor === "") q.delete(chave);
    else q.set(chave, String(valor));
  }
  window.history.replaceState({}, "", `${window.location.pathname}?${q}`);
}

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

export function useCliente360() {
  const [filtros, setFiltros] = useState(() => lerFiltrosDaUrl());
  const [clientes, setClientes] = useState([]);
  const [clientesCarregando, setClientesCarregando] = useState(true);

  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  // Uma requisição por vez: trocar filtro rápido cancela a anterior, para a
  // resposta antiga nunca sobrescrever a nova (race de filtros).
  const abortRef = useRef(null);

  const carregar = useCallback(async (filtrosAtuais) => {
    const f = filtrosAtuais || filtros;
    if (!f.slug) {
      setDados(null);
      setCarregando(false);
      return;
    }

    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;

    setCarregando(true);
    setErro(null);
    try {
      const payload = await obterResultado(f.slug, {
        competencia: f.competencia,
        compararCom: f.compararCom,
        marketplace: f.marketplace,
        margemAlvo: f.margemAlvo || undefined,
        signal: controlador.signal,
      });
      if (controlador.signal.aborted) return;
      setDados(payload);
    } catch (err) {
      if (err?.name === "AbortError" || controlador.signal.aborted) return;
      setDados(null);
      setErro(normalizarErro(err));
    } finally {
      if (!controlador.signal.aborted) setCarregando(false);
    }
  }, [filtros]);

  // Lista de clientes: conveniência do seletor. Falhar aqui não impede a tela
  // de funcionar quando o slug veio na URL.
  useEffect(() => {
    const controlador = new AbortController();
    let vivo = true;

    listarClientes({ signal: controlador.signal })
      .then((resposta) => {
        if (!vivo) return;
        const lista = resposta?.clientes || [];
        setClientes(lista);
        setFiltros((atual) => (atual.slug || !lista.length ? atual : { ...atual, slug: lista[0].slug }));
      })
      .catch((err) => {
        if (!vivo || err?.name === "AbortError") return;
        setErro((atual) => atual || (lerFiltrosDaUrl().slug ? null : normalizarErro(err)));
      })
      .finally(() => { if (vivo) setClientesCarregando(false); });

    return () => { vivo = false; controlador.abort(); };
  }, []);

  // Filtros → URL + recarga.
  useEffect(() => {
    escreverFiltrosNaUrl(filtros);
    carregar(filtros);
    // `carregar` depende de `filtros`; disparar por filtros evita loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const atualizarFiltro = useCallback((parciais) => {
    setFiltros((atual) => {
      const proximo = { ...atual, ...parciais };
      // Trocar a competência sem escolher a comparação re-ancora no mês anterior.
      if (parciais.competencia && !parciais.compararCom) {
        proximo.compararCom = competenciaAnterior(parciais.competencia);
      }
      return proximo;
    });
  }, []);

  const recarregar = useCallback(() => carregar(filtros), [carregar, filtros]);

  return {
    filtros, atualizarFiltro, recarregar,
    clientes, clientesCarregando,
    dados, carregando, erro,
    ehAdmin: ehAdmin(),
  };
}
