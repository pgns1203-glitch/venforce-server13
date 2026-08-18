// frontend-react/src/hooks/useFullAccountPicker.js
// Fluxo de seleção Cliente → Conta Mercado Livre da Central de Gestão Full.
// Reaproveita os endpoints já existentes da Fundação de Clientes/Contas —
// GET /base-vinculos/clientes (mesmo usado por Portal/bases.js e
// Portal/cliente-operacao.js) e GET /clientes/:cliente/contas?marketplace=meli
// (mesmo usado pela Fundação de Contas) — nenhuma modelagem nova de conta,
// só o fluxo de seleção em cima do que já existe.
//
// Regra de auto-seleção: com exatamente UMA conta MELI ativa, ela é
// pré-selecionada (não há ambiguidade nenhuma — mesmo que ainda esteja
// aguardando grant, ver classificarStatusConta). Com 2+ contas, NUNCA
// escolhe sozinho: `contaId` fica vazio até o usuário escolher.
//
// `clienteContaIdAtivo` só fica preenchido quando a conta selecionada está
// de fato conectada — é esse valor (nunca `contaId` cru) que deve alimentar
// o snapshot Full, para nunca disparar coleta numa conta sem grant válido.

import { useCallback, useEffect, useRef, useState } from "react";
import { obterClientesDisponiveis, obterContasMeliDoCliente } from "../services/fullApi.js";
import { ApiError } from "../services/apiClient.js";
import { classificarStatusConta } from "../utils/fullAccountStatus.js";

function normalizarErro(err) {
  if (err instanceof ApiError) return { codigo: err.codigo, mensagem: err.message, status: err.status };
  return { codigo: "desconhecido", mensagem: err?.message || "Erro inesperado.", status: 0 };
}

// `habilitado=false` (deep-link ?clienteContaId= presente) desliga o picker
// por completo: nenhuma chamada a /base-vinculos/clientes é feita. Hooks não
// podem ser chamados condicionalmente, então este é o jeito de a página
// evitar tráfego do seletor quando ele nem é renderizado.
export function useFullAccountPicker({ habilitado = true } = {}) {
  const [clientes, setClientes] = useState([]);
  const [carregandoClientes, setCarregandoClientes] = useState(habilitado);
  const [erroClientes, setErroClientes] = useState(null);

  const [clienteId, setClienteIdState] = useState("");
  const [contas, setContas] = useState([]);
  const [carregandoContas, setCarregandoContas] = useState(false);
  const [erroContas, setErroContas] = useState(null);
  const [contaId, setContaId] = useState("");

  const contasAbortRef = useRef(null);

  useEffect(() => {
    if (!habilitado) return undefined;

    const controlador = new AbortController();
    setCarregandoClientes(true);
    setErroClientes(null);
    obterClientesDisponiveis({ signal: controlador.signal })
      .then((payload) => {
        if (controlador.signal.aborted) return;
        setClientes(Array.isArray(payload?.clientes) ? payload.clientes : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError" || controlador.signal.aborted) return;
        setErroClientes(normalizarErro(err));
      })
      .finally(() => {
        if (!controlador.signal.aborted) setCarregandoClientes(false);
      });
    return () => controlador.abort();
  }, [habilitado]);

  const selecionarCliente = useCallback((novoClienteId) => {
    setClienteIdState(novoClienteId);
    setContaId("");
    setContas([]);
    setErroContas(null);
  }, []);

  useEffect(() => {
    contasAbortRef.current?.abort();

    if (!clienteId) {
      setContas([]);
      setCarregandoContas(false);
      return undefined;
    }

    const controlador = new AbortController();
    contasAbortRef.current = controlador;
    setCarregandoContas(true);
    setErroContas(null);

    obterContasMeliDoCliente(clienteId, { signal: controlador.signal })
      .then((payload) => {
        if (controlador.signal.aborted) return;
        // Dedupe defensivo por id: a mesma cliente_conta_id pode aparecer mais
        // de uma vez na listagem quando ela tem 2+ vínculos de base ativos
        // (fan-out do LEFT JOIN em clienteContaService.listarContasDoCliente
        // — confirmado em dado real de produção). Não é uma segunda conta,
        // é a mesma linha duplicada — nunca deve virar "2 contas" na UI.
        const vistos = new Set();
        const ativas = (payload?.contas || []).filter((c) => {
          if (c.ativo === false || c.marketplace !== "meli" || vistos.has(c.id)) return false;
          vistos.add(c.id);
          return true;
        });
        setContas(ativas);
        // Única conta ativa: pré-seleciona (sem ambiguidade). 2+ contas: nunca escolhe sozinho.
        setContaId(ativas.length === 1 ? String(ativas[0].id) : "");
      })
      .catch((err) => {
        if (err?.name === "AbortError" || controlador.signal.aborted) return;
        setContas([]);
        setErroContas(normalizarErro(err));
      })
      .finally(() => {
        if (!controlador.signal.aborted) setCarregandoContas(false);
      });

    return () => controlador.abort();
  }, [clienteId]);

  const contaSelecionada = contas.find((c) => String(c.id) === String(contaId)) || null;
  const statusContaSelecionada = contaSelecionada ? classificarStatusConta(contaSelecionada) : null;
  const contaConectada = statusContaSelecionada?.code === "conectado";

  return {
    clientes,
    carregandoClientes,
    erroClientes,
    clienteId,
    selecionarCliente,
    contas,
    carregandoContas,
    erroContas,
    contaId,
    selecionarConta: setContaId,
    contaSelecionada,
    statusContaSelecionada,
    // null enquanto não houver conta conectada selecionada — nunca dispara a coleta Full numa conta sem grant válido.
    clienteContaIdAtivo: contaConectada ? Number(contaId) : null,
  };
}
