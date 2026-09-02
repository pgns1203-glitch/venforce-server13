// frontend-react/src/hooks/useEntregasFechamento.js
//
// F4.2 — o estado das entregas de fechamento do cliente e as duas ações de
// escrita que o backend já suporta com segurança (publicar/despublicar).
//
// As regras que este hook existe para garantir (Master Spec A6 da maratona):
//
//   · toda escrita tem loading, sucesso e erro próprios, por LINHA — um erro
//     ao publicar Julho não pode apagar a lista inteira nem sujar Agosto;
//   · duplo clique é impossível: enquanto uma ação está em voo, nenhuma
//     outra começa (`acaoEmCurso`);
//   · depois do sucesso vem um GET AUTORITATIVO, nunca um remendo local do
//     estado — quem sabe se a entrega ficou publicada é o servidor;
//   · contexto obsoleto é descartado: se o cliente mudou entre o pedido e a
//     resposta, o resultado é jogado fora e a recarga NÃO acontece (a do
//     contexto novo já está rodando);
//   · a lista é abortada e recarregada a cada troca de cliente.
//
// Período NÃO entra aqui de propósito. A ação é sempre sobre uma entrega
// concreta, identificada por `id`, e cada entrega carrega o próprio
// `periodo` — nada é inferido de "mês atual", `new Date()` ou "última
// entrega". A tela é quem mostra de qual competência é cada linha.

import { useCallback, useEffect, useRef, useState } from "react";
import { listarEntregasDeFechamento, publicarEntrega, despublicarEntrega } from "../services/entregasApi.js";
import { ApiError } from "../services/apiClient.js";

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

export function useEntregasFechamento({ clienteSlug, habilitado }) {
  const [entregas, setEntregas] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [acaoEmCurso, setAcaoEmCurso] = useState(null); // id da entrega
  const [erroDeAcao, setErroDeAcao] = useState(null); // { id, mensagem }

  const seqRef = useRef(0);
  const abortRef = useRef(null);
  const clienteRef = useRef(clienteSlug);
  clienteRef.current = clienteSlug;

  const carregar = useCallback(() => {
    if (!habilitado || !clienteSlug) {
      setEntregas(null);
      setErro(null);
      setCarregando(false);
      return Promise.resolve();
    }
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;

    setCarregando(true);
    setErro(null);

    return listarEntregasDeFechamento(clienteSlug, { signal: controlador.signal })
      .then((payload) => {
        if (seq !== seqRef.current) return;
        setEntregas(Array.isArray(payload?.entregas) ? payload.entregas : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError" || seq !== seqRef.current) return;
        setEntregas(null);
        setErro(normalizarErro(err));
      })
      .finally(() => {
        if (seq === seqRef.current) setCarregando(false);
      });
  }, [clienteSlug, habilitado]);

  useEffect(() => {
    carregar();
    return () => abortRef.current?.abort();
  }, [carregar]);

  // Uma só função para as duas escritas: a diferença entre publicar e
  // despublicar é o verbo, não o protocolo.
  const executar = useCallback(
    (id, chamada) => {
      if (acaoEmCurso != null) return Promise.resolve(false); // proteção contra duplo clique
      const clienteNoPedido = clienteRef.current;
      setAcaoEmCurso(id);
      setErroDeAcao(null);
      return chamada(id)
        .then(() => {
          // Contexto trocou durante a requisição: a escrita valeu (o
          // servidor a aceitou), mas esta tela já não fala desse cliente —
          // recarregar aqui sobrescreveria a lista do cliente novo.
          if (clienteRef.current !== clienteNoPedido) return false;
          return carregar().then(() => true); // GET autoritativo
        })
        .catch((err) => {
          if (err?.name === "AbortError") return false;
          if (clienteRef.current !== clienteNoPedido) return false;
          setErroDeAcao({ id, mensagem: normalizarErro(err).mensagem });
          return false;
        })
        .finally(() => {
          if (clienteRef.current === clienteNoPedido) setAcaoEmCurso(null);
        });
    },
    [acaoEmCurso, carregar]
  );

  const publicar = useCallback((id) => executar(id, publicarEntrega), [executar]);
  const despublicar = useCallback((id) => executar(id, despublicarEntrega), [executar]);

  return {
    entregas,
    carregando,
    erro,
    recarregar: carregar,
    acaoEmCurso,
    erroDeAcao,
    limparErroDeAcao: () => setErroDeAcao(null),
    publicar,
    despublicar,
  };
}

// A entrega do período em tela. Comparação por PREFIXO porque
// `entregas_cliente.periodo` é texto livre no fluxo legado (o campo
// #fin-periodo de Portal/financeiro.js aceita qualquer coisa) — é a mesma
// tolerância que financeiroVisaoService.js:118 já aplica, replicada aqui
// para as duas telas concordarem sobre qual linha é a do período.
//
// `clienteContaId`, quando informado, desempata entre contas: a lista vem
// SEM filtro de conta de propósito (entregasApi.js), então um cliente com
// duas ClienteContas (V3 P2.6 D1) pode ter uma entrega por conta no MESMO
// período. Sem esse desempate, a primeira entrega da competência que
// aparecesse na lista virava a entrega OPERÁVEL da tela — Publicar/
// Despublicar agiriam sobre o fechamento de OUTRA conta sem nenhum aviso.
// A regra espelha financeiroVisaoService.js `compararEntregas`: prefere a
// entrega desta conta; sem ela, aceita a entrega legada (sem operação
// registrada, `cliente_conta_id` null); nunca devolve a entrega de uma
// conta ESPECÍFICA diferente — aí é preferível declarar "sem fechamento"
// do que oferecer uma ação sobre o dado errado.
export function entregaDoPeriodo(entregas, periodo, clienteContaId = null) {
  if (!Array.isArray(entregas) || !periodo) return null;
  const candidatas = entregas.filter((e) => String(e.periodo || "").includes(periodo));
  if (!candidatas.length) return null;
  if (clienteContaId == null) return candidatas[0];
  const destaConta = candidatas.find((e) => e.cliente_conta_id != null && Number(e.cliente_conta_id) === Number(clienteContaId));
  if (destaConta) return destaConta;
  return candidatas.find((e) => e.cliente_conta_id == null) || null;
}
