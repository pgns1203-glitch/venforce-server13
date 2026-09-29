// frontend-react/src/hooks/usePainelContas.js
//
// Estado do Painel de Contas: filtros (competência/squad/busca/status/
// marketplace/legado) + expansão lazy do histórico mensal de um cliente e das
// semanas de um mês. As CONTAS de cada cliente já vêm na lista (lote no
// servidor), então abrir um cliente não custa requisição; só o histórico e as
// semanas são buscados sob demanda. Guarda de corrida (mesmo padrão de
// useVisao.js) só na lista, onde a MESMA chave de filtros muda de valor ao
// longo do tempo — nos níveis lazy cada chave é imutável, então o cache evita
// refetch em vez de guardar contra corrida.
//
// ── Competência ─────────────────────────────────────────────────────────
// A tela inteira representa UMA competência (padrão: mês corrente em São
// Paulo). Nunca "o último mês que cada cliente tem" — isso misturava junho
// com setembro na mesma coluna.
//
// ── Busca com debounce ───────────────────────────────────────────────────
// `busca` é o que está NO CAMPO e `buscaAplicada` é o que foi PARA O
// SERVIDOR. Só o segundo entra nas dependências da lista.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listarPainelContas, listarMesesCliente, listarSemanasMes,
  salvarLancamentoManual, removerLancamentoManual,
} from "../services/painelContasApi.js";
import { ApiError } from "../services/apiClient.js";
import { lerFiltrosDaUrl, escreverFiltrosNaUrl } from "../utils/painelContasUrl.js";
import { competenciaNoFuso } from "../utils/dates.js";

const DEBOUNCE_BUSCA_MS = 300;

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

export function usePainelContas() {
  const competenciaPadrao = useMemo(() => competenciaNoFuso(), []);
  const iniciais = useMemo(() => lerFiltrosDaUrl(undefined, competenciaPadrao), [competenciaPadrao]);

  const [competencia, setCompetencia] = useState(iniciais.competencia);
  const [squadId, setSquadId] = useState(iniciais.squadId);
  const [busca, setBusca] = useState(iniciais.busca);
  const [buscaAplicada, setBuscaAplicada] = useState(iniciais.busca);
  const [status, setStatus] = useState(iniciais.status);
  const [marketplace, setMarketplace] = useState(iniciais.marketplace);
  const [mostrarLegado, setMostrarLegado] = useState(iniciais.mostrarLegado);

  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  // { [clienteId]: { carregando, erro, meses } }
  const [mesesPorCliente, setMesesPorCliente] = useState({});
  // { [`${clienteId}:${competencia}`]: { carregando, erro, semanas, definicaoSemana } }
  const [semanasPorChave, setSemanasPorChave] = useState({});

  const seqRef = useRef(0);
  const abortRef = useRef(null);

  useEffect(() => {
    if (busca === buscaAplicada) return undefined;
    const id = setTimeout(() => setBuscaAplicada(busca), DEBOUNCE_BUSCA_MS);
    return () => clearTimeout(id);
  }, [busca, buscaAplicada]);

  useEffect(() => {
    escreverFiltrosNaUrl({ competencia, squadId, busca, status, marketplace, mostrarLegado }, competenciaPadrao);
  }, [competencia, squadId, busca, status, marketplace, mostrarLegado, competenciaPadrao]);

  const carregarLista = useCallback(() => {
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;

    setCarregando(true);
    setErro(null);

    listarPainelContas({
      competencia, squadId, busca: buscaAplicada, status, marketplace, mostrarLegado, signal: controlador.signal,
    })
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
  }, [competencia, squadId, buscaAplicada, status, marketplace, mostrarLegado]);

  useEffect(() => {
    // Trocar filtro invalida o histórico/semanas já abertos: o histórico usa o
    // ANO da competência selecionada.
    setMesesPorCliente({});
    setSemanasPorChave({});
    return carregarLista();
  }, [carregarLista]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ano = Number(String(competencia).slice(0, 4));

  const carregarMeses = useCallback((clienteId, { forcar = false } = {}) => {
    setMesesPorCliente((prev) => {
      const atual = prev[clienteId];
      if (!forcar && atual && (atual.carregando || atual.meses)) return prev;
      return { ...prev, [clienteId]: { carregando: true, erro: null, meses: atual?.meses ?? null } };
    });

    listarMesesCliente(clienteId, { ano })
      .then((payload) => {
        setMesesPorCliente((prev) => ({
          ...prev,
          [clienteId]: { carregando: false, erro: null, meses: payload.meses || [], cliente: payload.cliente },
        }));
      })
      .catch((err) => {
        setMesesPorCliente((prev) => ({
          ...prev,
          [clienteId]: { carregando: false, erro: normalizarErro(err), meses: null },
        }));
      });
  }, [ano]);

  const carregarSemanas = useCallback((clienteId, comp, { forcar = false } = {}) => {
    const chave = `${clienteId}:${comp}`;
    setSemanasPorChave((prev) => {
      const atual = prev[chave];
      if (!forcar && atual && (atual.carregando || atual.semanas)) return prev;
      return { ...prev, [chave]: { carregando: true, erro: null, semanas: atual?.semanas ?? null } };
    });

    listarSemanasMes(clienteId, comp)
      .then((payload) => {
        setSemanasPorChave((prev) => ({
          ...prev,
          [chave]: { carregando: false, erro: null, semanas: payload.semanas || [], definicaoSemana: payload.definicaoSemana },
        }));
      })
      .catch((err) => {
        setSemanasPorChave((prev) => ({
          ...prev,
          [chave]: { carregando: false, erro: normalizarErro(err), semanas: null },
        }));
      });
  }, []);

  // Lançamento manual: o servidor é a autoridade (validação, precedência do
  // automático, auditoria). Depois de gravar, a lista é recarregada inteira —
  // consolidado, status e contagens do topo mudam juntos, nunca remendados
  // no cliente.
  const salvarManual = useCallback(async (clienteId, contaId, valores) => {
    const resposta = await salvarLancamentoManual(clienteId, contaId, competencia, valores);
    carregarLista();
    return resposta;
  }, [competencia, carregarLista]);

  const removerManual = useCallback(async (clienteId, contaId) => {
    const resposta = await removerLancamentoManual(clienteId, contaId, competencia);
    carregarLista();
    return resposta;
  }, [competencia, carregarLista]);

  const limparFiltros = useCallback(() => {
    setCompetencia(competenciaPadrao);
    setSquadId(null);
    setBusca("");
    setBuscaAplicada("");
    setStatus("todos");
    setMarketplace(null);
    setMostrarLegado(false);
  }, [competenciaPadrao]);

  const temFiltroAtivo = competencia !== competenciaPadrao || squadId != null || busca.trim() !== ""
    || status !== "todos" || marketplace != null || mostrarLegado;

  const clientes = dados ? dados.clientes || [] : null;

  return {
    competencia, setCompetencia, competenciaPadrao,
    squadId, setSquadId,
    busca, setBusca, buscaAplicada,
    status, setStatus,
    marketplace, setMarketplace,
    mostrarLegado, setMostrarLegado,
    temFiltroAtivo, limparFiltros,
    clientes,
    resumoCarteira: dados?.resumoCarteira || null,
    squadsDisponiveis: dados?.squadsDisponiveis || [],
    squadsDoUsuario: dados?.squadsDoUsuario || [],
    marketplacesDisponiveis: dados?.marketplacesDisponiveis || [],
    permissoes: dados?.permissoes || { lancarManual: false },
    carregando, erro, recarregar: carregarLista,
    // A tabela continua na tela durante a troca de filtro; `atualizando` é o
    // que autoriza o tratamento visual de "esses dados ainda são os anteriores".
    atualizando: carregando && clientes !== null,
    mesesPorCliente, carregarMeses,
    semanasPorChave, carregarSemanas,
    salvarManual, removerManual,
  };
}
