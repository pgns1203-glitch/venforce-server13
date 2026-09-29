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
//
// ── Atualizar dados (admin) ──────────────────────────────────────────────
// Uma atualização por cliente × competência roda no SERVIDOR em segundo
// plano; aqui só se dispara, acompanha (polling curto enquanto houver job em
// execução) e, ao terminar, a lista é relida em SILÊNCIO: a tabela não
// esmaece, a expansão continua aberta e só a linha que mudou muda. A lista já
// traz o job em curso de cada cliente, então um F5 retoma o acompanhamento.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listarPainelContas, listarMesesCliente, listarSemanasMes,
  salvarLancamentoManual, removerLancamentoManual,
  iniciarAtualizacaoCliente, obterAtualizacaoCliente,
} from "../services/painelContasApi.js";
import { ApiError } from "../services/apiClient.js";
import { lerFiltrosDaUrl, escreverFiltrosNaUrl } from "../utils/painelContasUrl.js";
import { competenciaNoFuso } from "../utils/dates.js";
import { atualizacaoEmCurso } from "../utils/painelContasAtualizacao.js";

const DEBOUNCE_BUSCA_MS = 300;
const INTERVALO_ATUALIZACAO_MS = 2500;
const MENSAGEM_JOB_PERDIDO = "O acompanhamento desta atualização se perdeu (o servidor pode ter reiniciado). "
  + "O que já foi publicado continua valendo — atualize de novo se precisar.";

// Jobs que vêm na lista entram no estado local, exceto os já dispensados e os
// que o local já conhece num estado final (o local é mais novo).
function mesclarAtualizacoes(prev, clientes, competencia, dispensados) {
  const proximo = {};
  for (const [id, a] of Object.entries(prev)) {
    if (a.competencia === competencia) proximo[id] = a;
  }
  for (const c of clientes || []) {
    const job = c.atualizacao;
    if (!job || dispensados.has(job.id)) continue;
    const atual = proximo[c.id];
    if (atual?.job?.id === job.id && atual.job.estado !== "executando") continue;
    if (atual?.iniciando) continue;
    proximo[c.id] = { competencia, job, erro: null, iniciando: false };
  }
  return proximo;
}

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
  // { [clienteId]: { competencia, job, erro, iniciando } }
  const [atualizacoes, setAtualizacoes] = useState({});
  const dispensadosRef = useRef(new Set());

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

  // `silencioso`: releitura depois de uma atualização — sem estado de
  // carregamento (a tabela não esmaece) e, se falhar, os dados na tela ficam.
  const carregarLista = useCallback(({ silencioso = false } = {}) => {
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;

    if (!silencioso) {
      setCarregando(true);
      setErro(null);
    }

    listarPainelContas({
      competencia, squadId, busca: buscaAplicada, status, marketplace, mostrarLegado, signal: controlador.signal,
    })
      .then((payload) => {
        if (seq !== seqRef.current) return;
        setDados(payload);
        setAtualizacoes((prev) => mesclarAtualizacoes(prev, payload?.clientes, competencia, dispensadosRef.current));
      })
      .catch((err) => {
        if (err?.name === "AbortError" || seq !== seqRef.current) return;
        if (silencioso) return;
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

  const recarregar = useCallback(() => carregarLista(), [carregarLista]);

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

  // ── Atualizar dados ──────────────────────────────────────────────────────
  const aplicarJob = useCallback((clienteId, job, comp) => {
    setAtualizacoes((prev) => ({
      ...prev,
      [clienteId]: job
        ? { competencia: comp, job, erro: null, iniciando: false }
        : { competencia: comp, job: null, erro: { mensagem: MENSAGEM_JOB_PERDIDO }, iniciando: false },
    }));
  }, []);

  const atualizarCliente = useCallback(async (clienteId) => {
    const comp = competencia;
    setAtualizacoes((prev) => ({ ...prev, [clienteId]: { competencia: comp, job: null, erro: null, iniciando: true } }));
    try {
      const resposta = await iniciarAtualizacaoCliente(clienteId, comp);
      aplicarJob(clienteId, resposta.atualizacao, comp);
    } catch (err) {
      // 409: já existe uma atualização deste escopo (outra aba, outra pessoa)
      // — passa a acompanhar a que está rodando em vez de mostrar erro.
      if (err instanceof ApiError && err.status === 409) {
        try {
          const lida = await obterAtualizacaoCliente(clienteId, comp);
          if (lida.atualizacao) {
            aplicarJob(clienteId, lida.atualizacao, comp);
            return;
          }
        } catch {
          // cai no erro original abaixo
        }
      }
      setAtualizacoes((prev) => ({
        ...prev,
        [clienteId]: { competencia: comp, job: null, erro: normalizarErro(err), iniciando: false },
      }));
    }
  }, [competencia, aplicarJob]);

  const dispensarAtualizacao = useCallback((clienteId) => {
    setAtualizacoes((prev) => {
      const atual = prev[clienteId];
      if (!atual || atualizacaoEmCurso(atual)) return prev;
      if (atual.job?.id) dispensadosRef.current.add(atual.job.id);
      const { [clienteId]: _removido, ...resto } = prev;
      return resto;
    });
  }, []);

  // Polling SÓ enquanto existir job executando nesta competência.
  const executando = Object.entries(atualizacoes)
    .filter(([, a]) => a.competencia === competencia && a.job?.estado === "executando")
    .map(([id]) => id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!executando) return undefined;
    let vivo = true;
    const ids = executando.split(",");
    const timer = setInterval(() => {
      for (const id of ids) {
        obterAtualizacaoCliente(id, competencia)
          .then((resposta) => { if (vivo) aplicarJob(id, resposta.atualizacao, competencia); })
          .catch(() => {
            // Falha de rede no polling não encerra o acompanhamento: o job
            // continua no servidor; a próxima volta tenta de novo.
          });
      }
    }, INTERVALO_ATUALIZACAO_MS);
    return () => {
      vivo = false;
      clearInterval(timer);
    };
  }, [executando, competencia, aplicarJob]);

  // Transição "em curso → terminado": relê a lista em silêncio e descarta o
  // histórico/semanas já abertos DAQUELE cliente (o snapshot mudou).
  const emCursoAntesRef = useRef(new Set());
  useEffect(() => {
    // Só conta quem chegou a ter job rodando: um POST recusado (422, rede)
    // não mudou nada no servidor e não pede releitura.
    const agora = new Set(Object.entries(atualizacoes).filter(([, a]) => a.job?.estado === "executando").map(([id]) => id));
    const terminaram = [...emCursoAntesRef.current].filter((id) => !agora.has(id) && atualizacoes[id]);
    emCursoAntesRef.current = agora;
    if (!terminaram.length) return;
    setMesesPorCliente((prev) => {
      const proximo = { ...prev };
      for (const id of terminaram) delete proximo[id];
      return proximo;
    });
    setSemanasPorChave((prev) => Object.fromEntries(
      Object.entries(prev).filter(([k]) => !terminaram.some((id) => k.startsWith(`${id}:`)))
    ));
    carregarLista({ silencioso: true });
  }, [atualizacoes, carregarLista]);

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
    permissoes: dados?.permissoes || { lancarManual: false, atualizarDados: false },
    competenciaAtual: dados?.competenciaAtual || competenciaPadrao,
    carregando, erro, recarregar,
    // A tabela continua na tela durante a troca de filtro; `atualizando` é o
    // que autoriza o tratamento visual de "esses dados ainda são os anteriores".
    atualizando: carregando && clientes !== null,
    mesesPorCliente, carregarMeses,
    semanasPorChave, carregarSemanas,
    salvarManual, removerManual,
    atualizacoes, atualizarCliente, dispensarAtualizacao,
  };
}
