// frontend-react/src/components/painelContas/LancamentoManualDrawer.jsx
//
// Lançamento MANUAL de uma conta/operação numa competência — para marketplace
// sem integração automática ou conta sem dado da API. Drawer enxuto sobre
// `.vf-drawer` (Fundação V2).
//
// O servidor é a autoridade: valida, deriva LC/MC, recusa quando já existe
// dado automático publicado e grava a trilha de auditoria. Aqui só há o que
// ajuda a digitar certo: unidades explícitas (MC em %, enviada como fração),
// número em pt-BR, prévia das derivações (a mesma regra do servidor:
// MC = LC ÷ FAT, LC = FAT × MC, tolerância de 0,5 p.p.), ACOS/TACoS e o
// bloqueio de envio quando FAT, LC e MC não batem.
//
// A competência NÃO é editável aqui: é a da tela. Trocar de mês é trocar a
// competência no topo — assim o formulário nunca mistura o lançamento de um
// mês com a tela de outro.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatarMoeda } from "../../utils/currency.js";
import { formatarPercentual } from "../../utils/percentage.js";
import { rotularCompetencia, formatarDataHora } from "../../utils/dates.js";

const TOLERANCIA_MC = 0.005;

// "1.234,56" / "1234,56" / "1234.56" → número. Vazio → null. Lixo → NaN.
export function lerNumeroBR(texto) {
  const bruto = String(texto ?? "").trim();
  if (!bruto) return null;
  const normalizado = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return NaN;
  return Number(normalizado);
}

function paraCampo(valor, escala = 1) {
  if (valor === null || valor === undefined) return "";
  return String(Math.round(Number(valor) * escala * 10000) / 10000);
}

function valoresIniciais(conta) {
  const m = conta?.fonte?.tipo === "manual" ? conta.manual : null;
  return {
    faturamento: paraCampo(m?.valores?.fat),
    lucroContribuicao: paraCampo(m?.valores?.lc),
    margemPct: paraCampo(m?.valores?.mc, 100),
    investimentoAds: paraCampo(m?.valores?.ads),
    gmvAds: paraCampo(m?.gmvAds),
    observacao: m?.observacao || "",
  };
}

const CAMPOS = [
  { chave: "faturamento", rotulo: "Faturamento (R$)" },
  { chave: "lucroContribuicao", rotulo: "Lucro de contribuição (R$)" },
  { chave: "margemPct", rotulo: "Margem de contribuição (%)", dica: "Em %: 18 = 18%." },
  { chave: "investimentoAds", rotulo: "Investimento Ads (R$)" },
  { chave: "gmvAds", rotulo: "GMV Ads (R$)" },
];

export function LancamentoManualDrawer({ cliente, contaInicial, competencia, onSalvar, onRemover, onFechar }) {
  const idTitulo = useId();
  const contas = useMemo(() => (cliente?.contas || []).filter((c) => c.podeLancarManual), [cliente]);
  const [contaId, setContaId] = useState(() => (contaInicial && contaInicial.podeLancarManual ? contaInicial.id : contas[0]?.id ?? null));
  const conta = contas.find((c) => c.id === contaId) || null;
  const [campos, setCampos] = useState(() => valoresIniciais(conta));
  const [enviando, setEnviando] = useState(false);
  const [erroServidor, setErroServidor] = useState(null);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  const primeiroCampoRef = useRef(null);

  useEffect(() => {
    primeiroCampoRef.current?.focus();
  }, []);

  useEffect(() => {
    function aoTeclar(evento) {
      if (evento.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  function trocarConta(id) {
    const proxima = contas.find((c) => c.id === id) || null;
    setContaId(id);
    setCampos(valoresIniciais(proxima));
    setErroServidor(null);
    setConfirmarRemocao(false);
  }

  const numeros = useMemo(() => ({
    fat: lerNumeroBR(campos.faturamento),
    lc: lerNumeroBR(campos.lucroContribuicao),
    mc: (() => { const p = lerNumeroBR(campos.margemPct); return p === null || Number.isNaN(p) ? p : p / 100; })(),
    ads: lerNumeroBR(campos.investimentoAds),
    gmv: lerNumeroBR(campos.gmvAds),
  }), [campos]);

  const invalido = Object.values(numeros).some((v) => Number.isNaN(v));
  const vazio = Object.values(numeros).every((v) => v === null);
  const { fat, lc, mc, ads, gmv } = numeros;
  const inconsistente = !invalido && fat > 0 && lc !== null && mc !== null && Math.abs(lc / fat - mc) > TOLERANCIA_MC;
  const mcDerivada = !invalido && fat > 0 && lc !== null && mc === null ? lc / fat : null;
  const lcDerivado = !invalido && fat !== null && mc !== null && lc === null ? fat * mc : null;
  const acos = !invalido && ads !== null && gmv > 0 ? ads / gmv : null;
  const tacos = !invalido && ads !== null && fat > 0 ? ads / fat : null;
  const temManual = conta?.fonte?.tipo === "manual";

  async function salvar(evento) {
    evento.preventDefault();
    if (!conta || invalido || vazio || inconsistente) return;
    setEnviando(true);
    setErroServidor(null);
    try {
      await onSalvar(cliente.id, conta.id, {
        faturamento: fat,
        lucroContribuicao: lc,
        margemContribuicao: mc,
        investimentoAds: ads,
        gmvAds: gmv,
        observacao: campos.observacao.trim() || null,
      });
      onFechar();
    } catch (err) {
      setErroServidor(err?.message || "Não foi possível salvar o lançamento.");
    } finally {
      setEnviando(false);
    }
  }

  async function remover() {
    if (!confirmarRemocao) {
      setConfirmarRemocao(true);
      return;
    }
    setEnviando(true);
    setErroServidor(null);
    try {
      await onRemover(cliente.id, conta.id);
      onFechar();
    } catch (err) {
      setErroServidor(err?.message || "Não foi possível remover o lançamento.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <div className="vf-drawer-backdrop is-open" onClick={onFechar} aria-hidden="true" />
      <aside className="vf-drawer is-open vf-ph-drawer" role="dialog" aria-modal="true" aria-labelledby={idTitulo}>
        <form className="vf-ph-drawer__form" onSubmit={salvar} noValidate>
          <header className="vf-drawer__header">
            <h2 className="vf-drawer__title" id={idTitulo}>Lançar dados manuais</h2>
            <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={onFechar} aria-label="Fechar">✕</button>
          </header>

          <div className="vf-drawer__body vf-ph-drawer__body">
            <dl className="vf-ph-drawer__escopo">
              <div><dt>Cliente</dt><dd>{cliente?.nome}</dd></div>
              <div><dt>Competência</dt><dd>{rotularCompetencia(competencia)}</dd></div>
            </dl>

            {contas.length === 0 ? (
              <p className="vf-ph-drawer__nota">Todas as contas deste cliente já têm dado automático nesta competência.</p>
            ) : (
              <>
                <div className="vf-field">
                  <label className="vf-field__label" htmlFor={`${idTitulo}-conta`}>Conta/operação</label>
                  <select
                    id={`${idTitulo}-conta`}
                    aria-describedby={conta?.status?.motivo ? `${idTitulo}-conta-dica` : undefined}
                    className="vf-select vf-select--sm"
                    value={contaId ?? ""}
                    onChange={(e) => trocarConta(Number(e.target.value))}
                  >
                    {contas.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
                  </select>
                  {conta?.status?.motivo && <span className="vf-field__hint" id={`${idTitulo}-conta-dica`}>{conta.status.motivo}</span>}
                </div>

                <div className="vf-ph-drawer__grid">
                  {CAMPOS.map((c, i) => (
                    <div className="vf-field" key={c.chave}>
                      <label className="vf-field__label" htmlFor={`${idTitulo}-${c.chave}`}>{c.rotulo}</label>
                      <input
                        id={`${idTitulo}-${c.chave}`}
                        aria-describedby={c.dica ? `${idTitulo}-${c.chave}-dica` : undefined}
                        ref={i === 0 ? primeiroCampoRef : undefined}
                        className="vf-input vf-input--sm"
                        inputMode="decimal"
                        autoComplete="off"
                        value={campos[c.chave]}
                        onChange={(e) => setCampos((prev) => ({ ...prev, [c.chave]: e.target.value }))}
                        aria-invalid={Number.isNaN(lerNumeroBR(campos[c.chave])) || undefined}
                      />
                      {c.dica && <span className="vf-field__hint" id={`${idTitulo}-${c.chave}-dica`}>{c.dica}</span>}
                    </div>
                  ))}
                </div>

                <p className="vf-ph-drawer__previa" aria-live="polite">
                  {mcDerivada !== null && <span>MC calculada: {formatarPercentual(mcDerivada)}</span>}
                  {lcDerivado !== null && <span>LC calculado: {formatarMoeda(lcDerivado, { casas: 0 })}</span>}
                  {acos !== null && <span>ACOS {formatarPercentual(acos)}</span>}
                  {tacos !== null && <span>TACoS {formatarPercentual(tacos)}</span>}
                </p>

                <div className="vf-field">
                  <label className="vf-field__label" htmlFor={`${idTitulo}-obs`}>Observação</label>
                  <textarea
                    id={`${idTitulo}-obs`}
                    className="vf-input vf-ph-drawer__obs"
                    rows={2}
                    maxLength={500}
                    value={campos.observacao}
                    onChange={(e) => setCampos((prev) => ({ ...prev, observacao: e.target.value }))}
                    placeholder="De onde veio o número (planilha do cliente, painel do marketplace…)"
                  />
                </div>

                {invalido && <p className="vf-field__error">Use só números (ex.: 1.234,56).</p>}
                {inconsistente && (
                  <p className="vf-field__error" role="alert">
                    FAT, LC e MC não batem: MC deve ser LC ÷ FAT. Informe só dois deles para o terceiro ser calculado.
                  </p>
                )}
                {erroServidor && <p className="vf-field__error" role="alert">{erroServidor}</p>}

                <p className="vf-ph-drawer__nota">
                  O dado fica marcado como <strong>MANUAL</strong>. Se a integração publicar esta competência, o automático
                  passa a ser o exibido e este lançamento continua guardado.
                  {temManual && conta.manual?.atualizadoPor && (
                    <> Última alteração por {conta.manual.atualizadoPor}
                      {conta.manual.atualizadoEm ? ` em ${formatarDataHora(conta.manual.atualizadoEm)}` : ""}.</>
                  )}
                </p>
              </>
            )}
          </div>

          <footer className="vf-drawer__footer">
            {temManual && (
              <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm vf-ph-drawer__remover" onClick={remover} disabled={enviando}>
                {confirmarRemocao ? "Confirmar remoção" : "Remover lançamento"}
              </button>
            )}
            <button type="button" className="vf-btn vf-btn--sm" onClick={onFechar}>Cancelar</button>
            <button
              type="submit"
              className="vf-btn vf-btn--primary vf-btn--sm"
              disabled={!conta || invalido || vazio || inconsistente || enviando}
            >
              {enviando ? "Salvando…" : "Salvar lançamento"}
            </button>
          </footer>
        </form>
      </aside>
    </>
  );
}
