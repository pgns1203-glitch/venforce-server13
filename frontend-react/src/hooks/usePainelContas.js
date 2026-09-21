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

import { useCallback, useEffect, useRef, useState } from "react";
import { listarPainelContas, listarMesesCliente, listarSemanasMes } from "../services/painelContasApi.js";
import { ApiError } from "../services/apiClient.js";

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

function anoAtual() {
  return new Date().getFullYear();
}

export function usePainelContas() {
  const [ano, setAno] = useState(anoAtual);
  const [squadId, setSquadId] = useState(null);
  const [busca, setBusca] = useState("");
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

  const carregarLista = useCallback(() => {
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;

    setCarregando(true);
    setErro(null);

    listarPainelContas({ ano, squadId, busca, signal: controlador.signal })
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
  }, [ano, squadId, busca]);

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

  return {
    ano, setAno, squadId, setSquadId, busca, setBusca,
    squadsDoUsuario, clientes, carregando, erro, recarregar: carregarLista,
    mesesPorCliente, carregarMeses,
    semanasPorChave, carregarSemanas,
  };
}
