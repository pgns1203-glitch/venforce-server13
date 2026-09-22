// frontend-react/src/hooks/usePainelContas.js
//
// Estado do Painel de Controle de Contas por Squad: filtros de nível 1
// (ano/squadId/busca) + expansão lazy dos níveis 2 (meses de um cliente) e 3
// (semanas de um mês) — cada um só busca quando a linha é aberta pela
// primeira vez (Auditoria §14). Guarda de corrida (mesmo padrão de
// useVisao.js) só no nível 1, onde a MESMA chave (ano/squadId/busca) muda de
// valor ao longo do tempo — nos níveis 2/3 cada chave (clienteId / clienteId+
// competencia) é imutável, então uma resposta tardia nunca é dado errado
// para a linha, só um fetch duplicado inofensivo; por isso o cache evita
// refetch em vez de guardar contra corrida.
//
// ── Busca com debounce ───────────────────────────────────────────────────
// `busca` é o que está NO CAMPO (controlado, responde a cada tecla) e
// `buscaAplicada` é o que foi PARA O SERVIDOR. Só o segundo entra nas
// dependências de carregarLista, então digitar "mercado" dispara uma
// requisição e não sete. A guarda de corrida continua sendo a defesa real:
// debounce reduz o volume, não garante ordem de chegada — as duas coisas
// convivem, uma não substitui a outra.
//
// ── Filtros na URL ───────────────────────────────────────────────────────
// Estado inicial lido de ?ano=&squadId=&busca= e reescrito a cada mudança
// (utils/painelContasUrl.js). Preferência de exibição, nunca autorização: o
// servidor resolve a carteira antes de olhar qualquer filtro.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listarPainelContas, listarMesesCliente, listarSemanasMes } from "../services/painelContasApi.js";
import { ApiError } from "../services/apiClient.js";
import { lerFiltrosDaUrl, escreverFiltrosNaUrl } from "../utils/painelContasUrl.js";

const DEBOUNCE_BUSCA_MS = 300;

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

function anoAtual() {
  return new Date().getFullYear();
}

export function usePainelContas() {
  const anoPadrao = useMemo(anoAtual, []);
  const iniciais = useMemo(() => lerFiltrosDaUrl(undefined, anoPadrao), [anoPadrao]);

  const [ano, setAno] = useState(iniciais.ano);
  const [squadId, setSquadId] = useState(iniciais.squadId);
  const [busca, setBusca] = useState(iniciais.busca);
  const [buscaAplicada, setBuscaAplicada] = useState(iniciais.busca);
  const [squadsDoUsuario, setSquadsDoUsuario] = useState([]);
  const [clientes, setClientes] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  // { [clienteId]: { carregando, erro, meses } }
  const [mesesPorCliente, setMesesPorCliente] = useState({});
  // { [`${clienteId}:${competencia}`]: { carregando, erro, semanas, definicaoSemana } }
  const [semanasPorChave, setSemanasPorChave] = useState({});

  const seqRef = useRef(0);
  const abortRef = useRef(null);

  // ── Debounce da busca ──
  useEffect(() => {
    if (busca === buscaAplicada) return undefined;
    const id = setTimeout(() => setBuscaAplicada(busca), DEBOUNCE_BUSCA_MS);
    return () => clearTimeout(id);
  }, [busca, buscaAplicada]);

  // ── Espelho na URL ──
  // Usa `busca` (o campo), não `buscaAplicada`: a URL acompanha o que a
  // pessoa vê digitado; replaceState não custa requisição nenhuma.
  useEffect(() => {
    escreverFiltrosNaUrl({ ano, squadId, busca }, anoPadrao);
  }, [ano, squadId, busca, anoPadrao]);

  const carregarLista = useCallback(() => {
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;

    setCarregando(true);
    setErro(null);

    listarPainelContas({ ano, squadId, busca: buscaAplicada, signal: controlador.signal })
      .then((payload) => {
        if (seq !== seqRef.current) return;
        setClientes(payload.clientes || []);
        setSquadsDoUsuario(payload.squadsDoUsuario || []);
      })
      .catch((err) => {
        if (err?.name === "AbortError" || seq !== seqRef.current) return;
        setClientes(null);
        setErro(normalizarErro(err));
      })
      .finally(() => {
        if (seq === seqRef.current) setCarregando(false);
      });

    return () => controlador.abort();
  }, [ano, squadId, buscaAplicada]);

  useEffect(() => {
    // Troca de ano/squadId/busca invalida qualquer expansão em aberto — os
    // meses/semanas já carregados podiam ser de um ano diferente do filtro
    // novo (meses lê `ano` como parâmetro próprio, não herda do cliente).
    setMesesPorCliente({});
    setSemanasPorChave({});
    return carregarLista();
  }, [carregarLista]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ── Nível 2: meses de UM cliente (lazy) ──
  const carregarMeses = useCallback((clienteId, { forcar = false } = {}) => {
    setMesesPorCliente((prev) => {
      const atual = prev[clienteId];
      if (!forcar && atual && (atual.carregando || atual.meses)) return prev; // já carregado/em voo — cache
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

  // ── Nível 3: semanas de UM mês (lazy) ──
  const carregarSemanas = useCallback((clienteId, competencia, { forcar = false } = {}) => {
    const chave = `${clienteId}:${competencia}`;
    setSemanasPorChave((prev) => {
      const atual = prev[chave];
      if (!forcar && atual && (atual.carregando || atual.semanas)) return prev;
      return { ...prev, [chave]: { carregando: true, erro: null, semanas: atual?.semanas ?? null } };
    });

    listarSemanasMes(clienteId, competencia)
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

  const limparFiltros = useCallback(() => {
    setAno(anoPadrao);
    setSquadId(null);
    setBusca("");
    setBuscaAplicada("");
  }, [anoPadrao]);

  const temFiltroAtivo = Number(ano) !== Number(anoPadrao) || squadId != null || busca.trim() !== "";

  return {
    ano, setAno, squadId, setSquadId, busca, setBusca,
    buscaAplicada, anoPadrao, temFiltroAtivo, limparFiltros,
    squadsDoUsuario, clientes, carregando, erro, recarregar: carregarLista,
    // §22: a tabela continua na tela durante a troca de filtro; `atualizando`
    // é o que autoriza o tratamento visual de "esses dados ainda são os
    // anteriores" — sem isso, ou a tela pisca, ou mente.
    atualizando: carregando && clientes !== null,
    mesesPorCliente, carregarMeses,
    semanasPorChave, carregarSemanas,
  };
}
