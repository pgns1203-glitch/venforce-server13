// frontend-react/src/hooks/useFechamentoNativo.js
//
// Convergência #3 — a máquina de estados de GERAR + SALVAR um fechamento
// dentro do Financeiro V3. O que o legado (Portal/financeiro.js) fazia em
// ~600 linhas de DOM, aqui em estado React: seleção de arquivos, envio
// multipart, competência declarada pelo backend, divergência de período,
// salvamento da entrega e o 409 de duplicidade.
//
// REGRAS QUE ESTE HOOK EXISTE PARA GARANTIR:
//  · Cliente/Conta/Período NÃO são escolhidos aqui — vêm do VF Context e do
//    seletor da página. O que for para o backend é exatamente o que o
//    usuário vê no cabeçalho (missão §12).
//  · Competência divergente NUNCA é salva em silêncio: se
//    `competencia.divergente`, "Salvar" fica travado atrás de uma
//    confirmação explícita (missão §13 — o backend não bloqueia, o frontend
//    pede confirmação).
//  · 409 ENTREGA_JA_EXISTE não é erro de tela: vira a escolha
//    "cancelar × substituir", e substituir preserva o token público.
//  · Uma ação por vez; abort em troca de contexto / unmount.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { processarFechamento, salvarEntregaFechamento, FechamentoApiError } from "../services/financeiroFechamentoApi.js";
import { montarPayloadFechamento } from "../utils/fechamentoPayload.js";

const AJUSTES_INICIAIS = { ads: "", venforce: "", affiliates: "", fullCost: "", additionalCosts: "" };
const ARQUIVOS_INICIAIS = { sales: null, costs: null, ordersAll: null, onhold: null };

// TikTok Shop depende de uma Base TikTok escolhida à mão (o endpoint exige
// `costsBaseId` e não aceita upload de custos) — um seletor de base que o V3
// ainda não tem. Até ele existir, TikTok continua no legado, e isso é dito na
// tela em vez de oferecer um caminho que o backend recusaria.
export const MARKETPLACES_NATIVOS = ["meli", "shopee"];

function normalizarErro(err) {
  if (err instanceof FechamentoApiError) {
    return { mensagem: err.message, codigo: err.codigo, status: err.status };
  }
  return { mensagem: err?.message || "Erro inesperado.", codigo: "desconhecido", status: 0 };
}

export function useFechamentoNativo({ clienteSlug, clienteNome, clienteContaId, periodo, onSalvo }) {
  const [estado, setEstado] = useState("form"); // form | processando | preview | salvando | salvo
  const [marketplace, setMarketplace] = useState("");
  const [arquivos, setArquivos] = useState(ARQUIVOS_INICIAIS);
  const [ajustes, setAjustes] = useState(AJUSTES_INICIAIS);
  const [processamento, setProcessamento] = useState(null);
  const [erro, setErro] = useState(null);
  const [duplicidade, setDuplicidade] = useState(null); // { entregaId, publicado }
  const [confirmouDivergencia, setConfirmouDivergencia] = useState(false);
  const [entregaSalva, setEntregaSalva] = useState(null);

  const abortRef = useRef(null);
  // O contexto no momento do processamento — salvar tem que ser sob o MESMO
  // cliente/conta que gerou o número (a mesma trava do legado, replicada).
  const contextoDoProcessamentoRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Trocou o cliente, a conta ou o período debaixo do formulário: o resultado
  // processado deixa de valer (foi para outro contexto). Volta ao form.
  useEffect(() => {
    abortRef.current?.abort();
    setEstado("form");
    setProcessamento(null);
    setErro(null);
    setDuplicidade(null);
    setConfirmouDivergencia(false);
    setEntregaSalva(null);
  }, [clienteSlug, clienteContaId, periodo]);

  const competencia = processamento?.competencia || null;
  const divergente = competencia?.divergente === true;

  const setArquivo = useCallback((campo, file) => {
    setArquivos((a) => ({ ...a, [campo]: file || null }));
  }, []);
  const setAjuste = useCallback((campo, valor) => {
    setAjustes((a) => ({ ...a, [campo]: valor }));
  }, []);

  const validacao = useMemo(() => {
    const problemas = [];
    if (!marketplace) problemas.push("Escolha o marketplace.");
    else if (!MARKETPLACES_NATIVOS.includes(marketplace)) {
      problemas.push("TikTok ainda é processado no Financeiro legado (precisa da Base TikTok).");
    }
    if (!arquivos.sales) problemas.push("Selecione a planilha de vendas.");
    if (marketplace === "shopee" && !arquivos.costs) {
      problemas.push("Shopee exige a planilha de custos.");
    }
    if (!clienteContaId) problemas.push("Operação (conta) não resolvida no contexto.");
    return { ok: problemas.length === 0, problemas };
  }, [marketplace, arquivos.sales, arquivos.costs, clienteContaId]);

  const processar = useCallback(async () => {
    if (!validacao.ok) {
      setErro({ mensagem: validacao.problemas[0], codigo: "validacao", status: 0 });
      return;
    }
    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;

    setEstado("processando");
    setErro(null);
    setDuplicidade(null);
    setConfirmouDivergencia(false);
    setEntregaSalva(null);

    const form = new FormData();
    form.append("sales", arquivos.sales);
    form.append("marketplace", marketplace);
    if (clienteSlug) form.append("cliente_slug", clienteSlug);
    if (clienteContaId) form.append("clienteContaId", String(clienteContaId));
    if (periodo) form.append("periodo", periodo);
    if (arquivos.costs) form.append("costs", arquivos.costs);
    if (marketplace === "shopee" && arquivos.ordersAll) form.append("ordersAll", arquivos.ordersAll);
    form.append("ads", String(ajustes.ads || "0"));
    form.append("venforce", String(ajustes.venforce || "0"));
    form.append("affiliates", String(ajustes.affiliates || "0"));
    if (marketplace === "meli") {
      form.append("fullCost", String(ajustes.fullCost || "0"));
      form.append("additionalCosts", String(ajustes.additionalCosts || "0"));
    }

    try {
      const resposta = await processarFechamento(form, { signal: controlador.signal });
      if (controlador.signal.aborted) return;
      contextoDoProcessamentoRef.current = { clienteSlug, clienteContaId, periodo };
      setProcessamento(resposta);
      setEstado("preview");
    } catch (err) {
      if (err?.name === "AbortError") return;
      setErro(normalizarErro(err));
      setEstado("form");
    }
  }, [validacao, arquivos, marketplace, clienteSlug, clienteContaId, periodo, ajustes]);

  const salvar = useCallback(
    async ({ substituir = false } = {}) => {
      if (!processamento) return;
      if (divergente && !confirmouDivergencia && !substituir) {
        setErro({ mensagem: "Confirme a divergência de competência antes de salvar.", codigo: "divergencia", status: 0 });
        return;
      }
      const ctx = contextoDoProcessamentoRef.current;
      if (!ctx || ctx.clienteSlug !== clienteSlug || ctx.clienteContaId !== clienteContaId || ctx.periodo !== periodo) {
        setErro({ mensagem: "O contexto mudou desde o processamento. Processe novamente.", codigo: "contexto", status: 0 });
        setEstado("form");
        return;
      }

      abortRef.current?.abort();
      const controlador = new AbortController();
      abortRef.current = controlador;
      setEstado("salvando");
      setErro(null);

      const payload = montarPayloadFechamento({
        processamento,
        clienteSlug,
        clienteNome,
        periodo,
        marketplace,
        ajustes,
      });

      const body = {
        tipo: "fechamento_mensal",
        titulo: payload.titulo,
        periodo,
        cliente_slug: clienteSlug,
        cliente_conta_id: clienteContaId,
        status: "rascunho",
        payload_json: payload,
        origem_tipo: "fechamento_financeiro",
        ...(substituir ? { substituir: true } : {}),
      };

      try {
        const entrega = await salvarEntregaFechamento(body, { signal: controlador.signal });
        if (controlador.signal.aborted) return;
        setEntregaSalva(entrega);
        setDuplicidade(null);
        setEstado("salvo");
        onSalvo?.(entrega);
      } catch (err) {
        if (err?.name === "AbortError") return;
        if (err instanceof FechamentoApiError && err.codigo === "ENTREGA_JA_EXISTE") {
          setDuplicidade({ entregaId: err.entregaId, publicado: err.publicado });
          setEstado("preview");
          return;
        }
        setErro(normalizarErro(err));
        setEstado("preview");
      }
    },
    [processamento, divergente, confirmouDivergencia, clienteSlug, clienteNome, clienteContaId, periodo, marketplace, ajustes, onSalvo]
  );

  const substituir = useCallback(() => salvar({ substituir: true }), [salvar]);

  const resetar = useCallback(() => {
    abortRef.current?.abort();
    setEstado("form");
    setProcessamento(null);
    setErro(null);
    setDuplicidade(null);
    setConfirmouDivergencia(false);
    setEntregaSalva(null);
    setArquivos(ARQUIVOS_INICIAIS);
  }, []);

  return {
    estado,
    marketplace, setMarketplace,
    arquivos, setArquivo,
    ajustes, setAjuste,
    validacao,
    processamento,
    competencia,
    divergente,
    confirmouDivergencia,
    confirmarDivergencia: () => setConfirmouDivergencia(true),
    erro,
    limparErro: () => setErro(null),
    duplicidade,
    entregaSalva,
    processar,
    salvar,
    substituir,
    resetar,
  };
}
