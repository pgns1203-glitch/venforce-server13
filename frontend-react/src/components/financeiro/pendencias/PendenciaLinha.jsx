// frontend-react/src/components/financeiro/pendencias/PendenciaLinha.jsx
//
// Uma linha da tabela de pendências. Guarda o estado DA LINHA — digitando,
// conferindo o que será gravado, enviando, registrada ou com erro — para que
// o sucesso ou a falha de um produto nunca apareça em outro.
//
// Gravação: POST /bases/:slug/custos/upsert (mesmo endpoint de Bases), o
// backend normaliza o produto_id e localiza o registro. Aqui só se envia o
// que o operador digitou; o imposto/taxa de um registro novo vêm do padrão da
// base, e a tela os mostra antes da confirmação.

import { useState } from "react";
import { registrarCustoNaBase } from "../../../services/basesCustoApi.js";
import { parseMoedaBR } from "../../../utils/fechamentoPayload.js";
import { formatarMoeda } from "../../../utils/currency.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";

export function PendenciaLinha({ pendencia: p, base, padrao, registrado, onRegistrado, motivoSemCorrecao = null }) {
  const [valor, setValor] = useState("");
  const [fase, setFase] = useState("editando"); // editando | confirmando | enviando
  const [erro, setErro] = useState(null);

  // Só "sem custo" com MLB e base da conta é corrigível aqui; ambíguo nunca.
  const corrigivel = !!base && p.statusCusto === "sem_custo" && !!p.itemId;
  const custo = parseMoedaBR(valor);
  const valido = custo !== null && custo > 0;

  async function registrar() {
    setFase("enviando");
    setErro(null);
    try {
      await registrarCustoNaBase(base.slug, { produtoId: p.itemId, custoProduto: custo, produtoNome: p.produto });
      onRegistrado(custo);
    } catch (e) {
      setErro(e?.message || "Não foi possível registrar o custo.");
      setFase("confirmando");
    }
  }

  let celulaNovoCusto;
  let celulaAcao;
  if (registrado !== null) {
    celulaNovoCusto = <strong>{formatarMoeda(registrado)}</strong>;
    celulaAcao = <span className="vf-status is-success">Registrado na base — reprocesse</span>;
  } else if (!corrigivel) {
    celulaNovoCusto = <span className="vf-field__hint">—</span>;
    celulaAcao = (
      <span className="vf-field__hint">
        {p.statusCusto === "ambiguo"
          ? "Custo ambíguo — há custos diferentes para o mesmo produto; resolver em Bases de Custo"
          : motivoSemCorrecao || "Corrigir em Bases de Custo"}
      </span>
    );
  } else {
    celulaNovoCusto = (
      <label className="vf-fin-ajuste__campo">
        <span className="vf-visually-hidden">Novo custo unitário de {p.itemId}</span>
        <span className="vf-fin-ajuste__prefixo">R$</span>
        <input
          className="vf-input vf-input--sm"
          inputMode="decimal"
          placeholder="0,00"
          aria-label={`Novo custo unitário de ${p.itemId}`}
          value={valor}
          disabled={fase !== "editando"}
          onChange={(e) => {
            setValor(e.target.value);
            setErro(null);
          }}
        />
      </label>
    );
    celulaAcao =
      fase === "editando" ? (
        <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" disabled={!valido} onClick={() => setFase("confirmando")}>
          Salvar na base
        </button>
      ) : (
        <span className="vf-field__hint">{fase === "enviando" ? "Registrando…" : "Confirmar abaixo"}</span>
      );
  }

  const confirmando = registrado === null && corrigivel && fase !== "editando";

  return (
    <>
      <tr data-pendencia={p.statusCusto} data-registrado={registrado !== null ? "true" : undefined}>
        <td><span className="vf-fin-clamp" title={p.produto || undefined}>{p.produto || "—"}</span></td>
        <td className="vf-mono">{p.itemId || "—"}</td>
        <td className="vf-mono">{[p.sku, p.modelId].filter(Boolean).join(" · ") || "—"}</td>
        <td>
          {p.motivo}
          {p.aguardandoFinanceiro && <span className="vf-field__hint"> · também aguardando financeiro</span>}
        </td>
        <td className="is-numeric">{formatarValor(p.receitaImpactada)}</td>
        <td className="is-numeric">{formatarValor(p.custoAtual)}</td>
        <td>{celulaNovoCusto}</td>
        <td>{celulaAcao}</td>
      </tr>
      {/* Confirmação e erro numa linha PRÓPRIA, largura total: o texto do que
          será gravado é longo e não cabe numa célula sem estourar a tabela. */}
      {(confirmando || erro) && (
        <tr className="vf-fin-pendencias__confirmacao" data-confirmacao={p.itemId}>
          <td colSpan={8}>
            {confirmando && (
              <div className="vf-fin-corrigir vf-stack vf-stack--sm" role="group" aria-label={`Confirmar custo de ${p.itemId}`}>
                <p className="vf-field__hint">
                  Grava na base <strong>{base.nome || base.slug}</strong>: <strong className="vf-mono">produto_id = {p.itemId}</strong> com custo{" "}
                  <strong>{formatarMoeda(custo)}</strong>. Se o MLB já existe, só o custo é atualizado
                  {padrao
                    ? `; se não existe, é criado com o imposto padrão da base (${String(padrao.imposto_percentual).replace(".", ",")}%) e taxa fixa ${formatarMoeda(Number(padrao.taxa_fixa))}`
                    : ""}
                  . O fechamento só muda depois de reprocessar.
                </p>
                <div className="vf-cluster">
                  <button type="button" className="vf-btn vf-btn--primary vf-btn--sm" disabled={fase === "enviando"} aria-busy={fase === "enviando" ? "true" : undefined} onClick={registrar}>
                    {fase === "enviando" ? "Registrando…" : "Confirmar e registrar"}
                  </button>
                  <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" disabled={fase === "enviando"} onClick={() => setFase("editando")}>
                    Voltar
                  </button>
                </div>
              </div>
            )}
            {erro && (
              <span className="vf-status is-danger" role="alert">
                {erro}
              </span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
