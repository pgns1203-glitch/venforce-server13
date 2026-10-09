// frontend-react/src/hooks/useEntregaApresentacao.js
//
// A APRESENTAÇÃO de uma entrega salva (destaques, pontos de atenção e plano
// de prioridades) — lida do payload_json gravado e regravada por PATCH.
//
// Regras:
//  · entrega que já teve link público (token_publico) é HISTÓRICA: o editor
//    fica em leitura e nenhum PATCH de conteúdo é tentado. Se mesmo assim o
//    backend responder 409 ENTREGA_PUBLICADA_IMUTAVEL, a tela diz isso.
//  · só o campo `entrega` do payload muda; números e identidade do
//    fechamento continuam exatamente como foram salvos.
//  · troca de entrega (outra competência/conta) descarta o rascunho local.

import { useCallback, useEffect, useRef, useState } from "react";
import { buscarEntrega } from "../services/entregasApi.js";
import { atualizarEntregaFechamento, FechamentoApiError } from "../services/financeiroFechamentoApi.js";
import { conteudoDoPayload, conteudoParaPayload, conteudoVazio, mesmoConteudo } from "../utils/financeiro/entregaConteudo.js";

export function useEntregaApresentacao({ entregaId, imutavel = false, identidade = {} }) {
  const [payload, setPayload] = useState(null);
  const [original, setOriginal] = useState(conteudoVazio());
  const [conteudo, setConteudo] = useState(conteudoVazio());
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const [salvoAgora, setSalvoAgora] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    abortRef.current?.abort();
    setPayload(null);
    setOriginal(conteudoVazio());
    setConteudo(conteudoVazio());
    setErro(null);
    setSalvoAgora(false);
    if (!entregaId) return undefined;
    const controlador = new AbortController();
    abortRef.current = controlador;
    setCarregando(true);
    buscarEntrega(entregaId, { signal: controlador.signal })
      .then((r) => {
        if (controlador.signal.aborted) return;
        const p = r?.entrega?.payload_json || {};
        setPayload(p);
        const c = conteudoDoPayload(p.entrega);
        setOriginal(c);
        setConteudo(c);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setErro({ mensagem: e?.message || "Não foi possível carregar a apresentação.", codigo: "carga" });
      })
      .finally(() => {
        if (!controlador.signal.aborted) setCarregando(false);
      });
    return () => controlador.abort();
  }, [entregaId]);

  const alterado = !mesmoConteudo(conteudo, original);

  const salvar = useCallback(async () => {
    if (!entregaId || !payload || imutavel) return false;
    setSalvando(true);
    setErro(null);
    setSalvoAgora(false);
    const novoPayload = { ...payload, entrega: conteudoParaPayload(conteudo, identidade) };
    try {
      const entrega = await atualizarEntregaFechamento(entregaId, { payload_json: novoPayload });
      const p = entrega?.payload_json || novoPayload;
      setPayload(p);
      const c = conteudoDoPayload(p.entrega);
      setOriginal(c);
      setConteudo(c);
      setSalvoAgora(true);
      return true;
    } catch (e) {
      if (e instanceof FechamentoApiError && e.codigo === "ENTREGA_PUBLICADA_IMUTAVEL") {
        setErro({
          mensagem: "Esta entrega já teve link público e o conteúdo dela é histórico. Para mudar a apresentação, salve um novo fechamento desta competência.",
          codigo: e.codigo,
        });
      } else {
        setErro({ mensagem: e?.message || "Não foi possível salvar.", codigo: e?.codigo || "erro" });
      }
      return false;
    } finally {
      setSalvando(false);
    }
  }, [entregaId, payload, imutavel, conteudo, identidade]);

  return {
    conteudo,
    setConteudo,
    alterado,
    carregando,
    salvando,
    salvoAgora,
    erro,
    salvar,
    descartar: () => setConteudo(original),
  };
}
