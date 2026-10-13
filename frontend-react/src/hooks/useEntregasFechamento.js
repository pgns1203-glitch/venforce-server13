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
import { listarEntregasDeFechamento, publicarEntrega, despublicarEntrega, excluirEntrega } from "../services/entregasApi.js";
import { ApiError } from "../services/apiClient.js";
import { mesmaCompetencia } from "../utils/financeiro/competencia.js";

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

export function useEntregasFechamento({ clienteSlug, clienteContaId = null, habilitado }) {
  const [entregas, setEntregas] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [acaoEmCurso, setAcaoEmCurso] = useState(null); // id da entrega
  const [erroDeAcao, setErroDeAcao] = useState(null); // { id, mensagem }

  const seqRef = useRef(0);
  const abortRef = useRef(null);
  // A "identidade" do pedido é cliente + conta: trocar de operação no meio de
  // uma escrita não pode recarregar a lista da operação nova com a resposta
  // da antiga.
  const chave = `${clienteSlug ?? ""}|${clienteContaId ?? ""}`;
  const clienteRef = useRef(chave);
  clienteRef.current = chave;

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

    return listarEntregasDeFechamento(clienteSlug, { clienteContaId, signal: controlador.signal })
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
  }, [clienteSlug, clienteContaId, habilitado]);

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
  // Excluir é por id EXATO; a confirmação (que nomeia competência e conta)
  // fica na tela. Depois do sucesso, o mesmo GET autoritativo.
  const excluir = useCallback((id) => executar(id, excluirEntrega), [executar]);

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
    excluir,
  };
}

// De quem é esta entrega, do ponto de vista da operação em tela:
//   "esta_conta"  → registra esta operação (cliente_conta_id = conta atual);
//   "legado"      → sem operação registrada (anterior ao P2.6). É do CLIENTE,
//                   nunca atribuída automaticamente à conta atual;
//   "outra_conta" → registra OUTRA operação do cliente.
export function escopoDaEntrega(entrega, clienteContaId) {
  const conta = entrega?.cliente_conta_id ?? entrega?.clienteContaId ?? null;
  if (conta == null) return "legado";
  if (clienteContaId != null && Number(conta) === Number(clienteContaId)) return "esta_conta";
  return "outra_conta";
}

// A entrega OPERÁVEL desta conta na competência em tela. Comparação por
// IGUALDADE da competência normalizada (utils/financeiro/competencia.js —
// mesma regra de financeiroVisaoService `mesmaCompetencia`); "2026-07 a
// 2026-08" não responde por nenhum dos dois meses.
//
// Só devolve entrega DESTA conta. A entrega legada (cliente_conta_id null)
// não é mais promovida a "entrega desta operação": ela aparece rotulada em
// `entregaLegadaDoPeriodo` / Relatórios gerados, nunca como se fosse da
// conta atual. Sem `clienteContaId` não há conta para comparar — e então
// nenhuma entrega é operável por esta via.
//
// Com duplicatas da mesma conta+competência (a tabela não tem UNIQUE), vence
// a mesma ordem do backend: publicada > mais recente > maior id.
function ordemDeEntrega(a, b) {
  const pubA = a.publicado ? 1 : 0;
  const pubB = b.publicado ? 1 : 0;
  if (pubA !== pubB) return pubB - pubA;
  const tA = Date.parse(a.created_at || "") || 0;
  const tB = Date.parse(b.created_at || "") || 0;
  if (tA !== tB) return tB - tA;
  return Number(b.id || 0) - Number(a.id || 0);
}

export function entregasDoPeriodo(entregas, periodo) {
  if (!Array.isArray(entregas) || !periodo) return [];
  return entregas.filter((e) => mesmaCompetencia(e.periodo, periodo));
}

export function entregaDoPeriodo(entregas, periodo, clienteContaId = null) {
  if (clienteContaId == null) return null;
  const daConta = entregasDoPeriodo(entregas, periodo).filter((e) => escopoDaEntrega(e, clienteContaId) === "esta_conta");
  return daConta.sort(ordemDeEntrega)[0] || null;
}

export function entregaLegadaDoPeriodo(entregas, periodo) {
  const legadas = entregasDoPeriodo(entregas, periodo).filter((e) => escopoDaEntrega(e, null) === "legado");
  return legadas.sort(ordemDeEntrega)[0] || null;
}
