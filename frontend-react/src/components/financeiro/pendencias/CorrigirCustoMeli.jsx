// frontend-react/src/components/financeiro/pendencias/CorrigirCustoMeli.jsx
//
// Correção rápida de custo — SÓ MELI, SÓ com base vinculada e SÓ para
// "sem custo" (nunca para custo ambíguo). No MELI a chave da base é o MLB
// (`produto_id`, um registro por MLB), então o registro afetado é inequívoco.
// No Shopee o custo pode morar no Item ou na Variação — escolher seria criar
// regra de matching na tela; lá a correção é em Bases de Custo.
//
// Fluxo: digitar → ver exatamente o que será gravado → confirmar → gravar
// (POST /bases/:slug/custos/upsert) → só então reprocessar.

import { useEffect, useState } from "react";
import { obterPadraoCustoBase, registrarCustoNaBase } from "../../../services/basesCustoApi.js";
import { parseMoedaBR } from "../../../utils/fechamentoPayload.js";
import { formatarMoeda } from "../../../utils/currency.js";

export function CorrigirCustoMeli({ pendencia, base, onRegistrado, onCancelar }) {
  const [valor, setValor] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [padrao, setPadrao] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    const controlador = new AbortController();
    obterPadraoCustoBase(base.slug, { signal: controlador.signal })
      .then((r) => setPadrao(r?.padrao || null))
      .catch(() => setPadrao(null));
    return () => controlador.abort();
  }, [base.slug]);

  const custo = parseMoedaBR(valor);
  const valido = custo !== null && custo > 0;

  async function registrar() {
    setEnviando(true);
    setErro(null);
    try {
      const r = await registrarCustoNaBase(base.slug, { produtoId: pendencia.itemId, custoProduto: custo, produtoNome: pendencia.produto });
      onRegistrado?.(r);
    } catch (e) {
      setErro(e?.message || "Não foi possível registrar o custo.");
      setEnviando(false);
    }
  }

  return (
    <div className="vf-fin-corrigir vf-stack vf-stack--sm" role="group" aria-label={`Corrigir custo de ${pendencia.itemId}`}>
      {!confirmando ? (
        <div className="vf-cluster">
          <label className="vf-fin-ajuste__campo">
            <span className="vf-visually-hidden">Novo custo unitário</span>
            <span className="vf-fin-ajuste__prefixo">R$</span>
            <input
              className="vf-input vf-input--sm"
              inputMode="decimal"
              placeholder="0,00"
              aria-label="Novo custo unitário"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </label>
          <button type="button" className="vf-btn vf-btn--primary vf-btn--sm" disabled={!valido} onClick={() => setConfirmando(true)}>
            Revisar
          </button>
          <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={onCancelar}>
            Cancelar
          </button>
        </div>
      ) : (
        <>
          <p className="vf-field__hint">
            Vai gravar na base <strong>{base.nome || base.slug}</strong> o registro <strong className="vf-mono">produto_id = {pendencia.itemId}</strong>{" "}
            com custo <strong>{formatarMoeda(custo)}</strong>. Se o MLB já existir na base, o custo dele é atualizado; senão, é criado
            {padrao ? ` com o imposto padrão da base (${String(padrao.imposto_percentual).replace(".", ",")}%) e taxa fixa ${formatarMoeda(Number(padrao.taxa_fixa))}` : ""}.
            Depois o fechamento é reprocessado.
          </p>
          <div className="vf-cluster">
            <button type="button" className="vf-btn vf-btn--primary vf-btn--sm" disabled={enviando} aria-busy={enviando ? "true" : undefined} onClick={registrar}>
              {enviando ? "Registrando…" : "Registrar na base e reprocessar"}
            </button>
            <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" disabled={enviando} onClick={() => setConfirmando(false)}>
              Voltar
            </button>
          </div>
        </>
      )}
      {erro && <span className="vf-status is-danger" role="alert">{erro}</span>}
    </div>
  );
}
