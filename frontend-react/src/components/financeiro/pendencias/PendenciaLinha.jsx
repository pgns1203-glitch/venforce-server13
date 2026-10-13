// frontend-react/src/components/financeiro/pendencias/PendenciaLinha.jsx
//
// Uma pendência na tabela de correção individual. Guarda o estado DA LINHA
// (digitando, escolhendo o registro, conferindo, enviando, registrada, com
// erro) — o sucesso ou a falha de um produto nunca aparece em outro.
//
//   Produto · Item/Model/SKU · Motivo · Receita · Custo atual · Novo custo ·
//   Imposto % · [Salvar na base]
//
// QUEM PODE SER GRAVADO é decidido por utils/financeiro/baseCustos.js
// (identidade segura / ambígua / insuficiente), com os registros REAIS da
// base. Aqui só se desenha:
//   segura        → campos liberados
//   ambigua       → mostra o registro existente e exige ESCOLHER antes de
//                   liberar o custo (nada é adivinhado)
//   insuficiente  → bloqueada, com o motivo e o caminho (planilha / Bases)
//
// Gravação: POST /bases/:slug/custos/upsert — a BASE VINCULADA, não um custo
// temporário do fechamento. O fechamento só muda ao reprocessar.

import { useMemo, useState } from "react";
import { registrarCustoNaBase } from "../../../services/basesCustoApi.js";
import { parseMoedaBR } from "../../../utils/fechamentoPayload.js";
import { formatarMoeda } from "../../../utils/currency.js";
import { fracaoParaPontos, formatarPontos, identidadeDaPendencia, parsePontosBR, pontosParaFracao } from "../../../utils/financeiro/baseCustos.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";

export function PendenciaLinha({ pendencia: p, marketplace, base, indice, padrao, registrado, onRegistrado }) {
  const identidade = useMemo(
    () => (base ? identidadeDaPendencia({ marketplace, pendencia: p, indice }) : null),
    [base, marketplace, p, indice]
  );
  const registroAtual = identidade?.registro || null;

  const [valor, setValor] = useState("");
  const [impostoTxt, setImpostoTxt] = useState(null); // null = ainda não mexeu: usa o sugerido
  const [escolha, setEscolha] = useState(null);
  const [fase, setFase] = useState("editando"); // editando | confirmando | enviando
  const [erro, setErro] = useState(null);

  const corrigivel = !!identidade && identidade.classe !== "insuficiente";
  const ambigua = identidade?.classe === "ambigua";
  const candidato = ambigua ? identidade.candidatos.find((c) => c.id === escolha) || null : null;
  const liberado = corrigivel && (!ambigua || !!candidato);

  // Imposto sugerido: o do registro existente; senão o padrão da base.
  // (fração do banco → pontos da tela)
  const sugeridoPontos = registroAtual?.imposto != null ? fracaoParaPontos(registroAtual.imposto) : padrao?.imposto_percentual != null ? fracaoParaPontos(padrao.imposto_percentual) : null;
  const impostoEfetivo = impostoTxt === null ? (sugeridoPontos === null ? null : sugeridoPontos) : parsePontosBR(impostoTxt);

  const custo = parseMoedaBR(valor);
  const custoValido = custo !== null && custo > 0;
  const impostoValido = impostoEfetivo === null || (Number.isFinite(impostoEfetivo) && impostoEfetivo >= 0 && impostoEfetivo <= 100);
  const pronto = liberado && custoValido && impostoValido;

  // O Model que será GRAVADO: o do candidato escolhido (ambígua) ou o da identidade.
  const idModelGravado = ambigua ? candidato?.idModel ?? null : identidade?.idModel ?? null;
  const acaoGravada = identidade?.acao === "criar" ? "criado" : "atualizado";

  async function registrar() {
    setFase("enviando");
    setErro(null);
    try {
      await registrarCustoNaBase(base.slug, {
        produtoId: identidade.produtoId,
        custoProduto: custo,
        impostoFracao: impostoEfetivo === null ? null : pontosParaFracao(impostoEfetivo),
        idModel: marketplace === "shopee" ? idModelGravado : null,
        produtoNome: p.produto,
      });
      onRegistrado({ produtoId: identidade.produtoId, idModel: marketplace === "shopee" ? idModelGravado : null, custo, imposto: impostoEfetivo === null ? null : pontosParaFracao(impostoEfetivo), nome: p.produto });
    } catch (e) {
      setErro(e?.message || "Não foi possível registrar o custo.");
      setFase("confirmando");
    }
  }

  const custoAtual = registroAtual ? registroAtual.custo : p.custoAtual;
  const idsTexto = [p.itemId ? `Item ${p.itemId}` : null, p.modelId ? `Model ${p.modelId}` : null, p.sku ? `SKU ${p.sku}` : null].filter(Boolean);

  let celulaCusto;
  let celulaImposto;
  let celulaAcao;
  if (registrado) {
    celulaCusto = <strong>{formatarMoeda(registrado.custo)}</strong>;
    celulaImposto = <span>{registrado.imposto === null ? "—" : `${formatarPontos(fracaoParaPontos(registrado.imposto))}%`}</span>;
    celulaAcao = <span className="vf-status is-success">✓ Custo atualizado na base</span>;
  } else if (!corrigivel) {
    celulaCusto = <span className="vf-field__hint">—</span>;
    celulaImposto = <span className="vf-field__hint">—</span>;
    celulaAcao = <span className="vf-field__hint">{identidade ? "Bloqueada — ver motivo abaixo" : "Sem base para atualizar"}</span>;
  } else {
    celulaCusto = (
      <label className="vf-fin-ajuste__campo">
        <span className="vf-visually-hidden">Novo custo unitário de {p.itemId}</span>
        <span className="vf-fin-ajuste__prefixo">R$</span>
        <input
          className="vf-input vf-input--sm"
          inputMode="decimal"
          placeholder="0,00"
          aria-label={`Novo custo unitário de ${p.itemId}`}
          value={valor}
          disabled={!liberado || fase !== "editando"}
          onChange={(e) => {
            setValor(e.target.value);
            setErro(null);
          }}
        />
      </label>
    );
    celulaImposto = (
      <label className="vf-fin-ajuste__campo">
        <span className="vf-visually-hidden">Imposto (%) de {p.itemId}</span>
        <input
          className="vf-input vf-input--sm"
          inputMode="decimal"
          placeholder={sugeridoPontos === null ? "%" : formatarPontos(sugeridoPontos)}
          aria-label={`Imposto (%) de ${p.itemId}`}
          value={impostoTxt === null ? (sugeridoPontos === null ? "" : formatarPontos(sugeridoPontos)) : impostoTxt}
          disabled={!liberado || fase !== "editando"}
          onChange={(e) => setImpostoTxt(e.target.value)}
        />
        <span className="vf-fin-ajuste__sufixo">%</span>
      </label>
    );
    celulaAcao =
      fase === "editando" ? (
        <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" disabled={!pronto} onClick={() => setFase("confirmando")}>
          {ambigua ? "Atualizar registro selecionado" : "Salvar na base"}
        </button>
      ) : (
        <span className="vf-field__hint">{fase === "enviando" ? "Registrando…" : "Confirmar abaixo"}</span>
      );
  }

  const confirmando = !registrado && corrigivel && fase !== "editando";

  return (
    <>
      <tr data-pendencia={p.statusCusto} data-identidade={identidade?.classe || "sem-base"} data-registrado={registrado ? "true" : undefined}>
        <td><span className="vf-fin-clamp" title={p.produto || undefined}>{p.produto || "—"}</span></td>
        <td className="vf-mono vf-fin-ids">{idsTexto.length ? idsTexto.map((t) => <span key={t}>{t}</span>) : "—"}</td>
        <td>
          {p.motivo}
          {p.aguardandoFinanceiro && <span className="vf-field__hint"> · também aguardando financeiro</span>}
        </td>
        <td className="is-numeric">{formatarValor(p.receitaImpactada)}</td>
        <td className="is-numeric">{formatarValor(custoAtual)}</td>
        <td>{celulaCusto}</td>
        <td>{celulaImposto}</td>
        <td>{celulaAcao}</td>
      </tr>

      {/* Identidade ambígua (Shopee): o registro REAL e a escolha explícita. */}
      {!registrado && ambigua && (
        <tr className="vf-fin-pendencias__confirmacao" data-escolha={identidade.produtoId}>
          <td colSpan={8}>
            <fieldset className="vf-fin-escolha">
              <legend className="vf-field__hint">
                <strong>Encontramos 1 registro possível.</strong> {identidade.motivo} Escolha qual atualizar — nada é gravado sem a sua escolha.
              </legend>
              {identidade.candidatos.map((c) => (
                <label key={c.id} className="vf-fin-escolha__opcao">
                  <input type="radio" name={`escolha-${identidade.produtoId}-${p.modelId || ""}`} checked={escolha === c.id} disabled={fase !== "editando"} onChange={() => setEscolha(c.id)} />
                  <span>
                    <strong>{c.rotulo}</strong> — {c.descricao}
                  </span>
                </label>
              ))}
              {registroAtual && (
                <p className="vf-field__hint">
                  Registro atual: custo {registroAtual.custo === null ? "—" : formatarMoeda(registroAtual.custo)}
                  {registroAtual.imposto != null ? ` · imposto ${formatarPontos(fracaoParaPontos(registroAtual.imposto))}%` : ""}.
                </p>
              )}
            </fieldset>
          </td>
        </tr>
      )}

      {/* Identidade insuficiente: bloqueada, com motivo e caminho. */}
      {!registrado && identidade && identidade.classe === "insuficiente" && (
        <tr className="vf-fin-pendencias__confirmacao" data-bloqueio={identidade.produtoId || "sem-id"}>
          <td colSpan={8}>
            <span className="vf-field__hint">{identidade.motivo}</span>
          </td>
        </tr>
      )}

      {/* Confirmação e erro numa linha PRÓPRIA, largura total. */}
      {(confirmando || erro) && (
        <tr className="vf-fin-pendencias__confirmacao" data-confirmacao={identidade?.produtoId}>
          <td colSpan={8}>
            {confirmando && (
              <div className="vf-fin-corrigir vf-stack vf-stack--sm" role="group" aria-label={`Confirmar custo de ${identidade.produtoId}`}>
                <p className="vf-field__hint">
                  Grava na base <strong>{base.nome || base.slug}</strong> (registro {acaoGravada === "criado" ? "NOVO" : "existente"}):{" "}
                  <strong className="vf-mono">produto_id = {identidade.produtoId}</strong>
                  {marketplace === "shopee" ? <> · <strong className="vf-mono">id_model = {idModelGravado || "—"}</strong></> : null} com custo{" "}
                  <strong>{formatarMoeda(custo)}</strong>
                  {impostoEfetivo === null ? " (imposto mantido)" : <> e imposto <strong>{formatarPontos(impostoEfetivo)}%</strong></>}. É a base vinculada, não um valor só deste
                  fechamento — o fechamento só muda depois de reprocessar.
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
