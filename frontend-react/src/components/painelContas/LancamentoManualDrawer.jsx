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
// competência no topo (ou "Abrir" numa competência do histórico, que troca a
// tela e reabre o drawer) — o formulário nunca mistura o lançamento de um mês
// com a tela de outro.
//
// Rastreabilidade: o bloco "Registro" diz dados até · atualizado em ·
// responsável · fonte · competência · status, e a trilha (criado/alterado/
// removido) é lida sob demanda do servidor. Nada aqui é inferido no cliente.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatarMoeda } from "../../utils/currency.js";
import { formatarPercentual } from "../../utils/percentage.js";
import { rotularCompetencia, rotularCompetenciaCurta, formatarData, formatarDataHora } from "../../utils/dates.js";

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

// Limites do campo "dados até": dentro da competência e nunca depois de hoje
// (São Paulo) — a mesma regra que o servidor aplica.
export function limitesDataReferencia(competencia, hoje = hojeEmSaoPaulo()) {
  const [ano, mes] = String(competencia).split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const fimMes = `${competencia}-${String(ultimo).padStart(2, "0")}`;
  return { min: `${competencia}-01`, max: fimMes < hoje ? fimMes : hoje };
}

function hojeEmSaoPaulo(agora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

const ROTULO_ACAO = { criado: "Criado", alterado: "Alterado", removido: "Removido" };

function resumoValores(v) {
  const partes = [];
  if (v?.faturamento != null) partes.push(`FAT ${formatarMoeda(v.faturamento, { casas: 0 })}`);
  if (v?.lucroContribuicao != null) partes.push(`LC ${formatarMoeda(v.lucroContribuicao, { casas: 0 })}`);
  if (v?.margemContribuicao != null) partes.push(`MC ${formatarPercentual(v.margemContribuicao)}`);
  if (v?.investimentoAds != null) partes.push(`Ads ${formatarMoeda(v.investimentoAds, { casas: 0 })}`);
  if (v?.dataReferencia) partes.push(`dados até ${formatarData(v.dataReferencia)}`);
  return partes.join(" · ") || "sem valores";
}

function Registro({ conta, competencia }) {
  const m = conta?.manual;
  if (!m) return null;
  const substituido = m.statusRegistro === "substituido_por_automatico";
  return (
    <section className="vf-ph-registro" aria-label="Registro do lançamento">
      <p className="vf-ph-registro__titulo">{conta.rotulo} · {rotularCompetencia(competencia)}</p>
      <dl className="vf-ph-registro__lista">
        <div><dt>Dados até</dt><dd>{m.dataReferencia ? formatarData(m.dataReferencia) : "não informado"}</dd></div>
        <div><dt>Atualizado em</dt><dd>{m.atualizadoEm ? formatarDataHora(m.atualizadoEm) : "—"}</dd></div>
        <div><dt>Responsável</dt><dd>{m.atualizadoPor || "—"}</dd></div>
        <div><dt>Fonte</dt><dd>Manual</dd></div>
        <div><dt>Status</dt><dd>{substituido ? "Guardado — o automático é o exibido" : "Vigente"}</dd></div>
        {m.criadoEm && (
          <div><dt>Criado</dt><dd>{formatarDataHora(m.criadoEm)}{m.criadoPor ? ` por ${m.criadoPor}` : ""}</dd></div>
        )}
      </dl>
    </section>
  );
}

// Trilha de alterações da conta × competência, lida ao abrir.
function Trilha({ carregar }) {
  const [estado, setEstado] = useState({ carregando: false, erro: null, itens: null });
  async function abrir(evento) {
    if (!evento.currentTarget.open || estado.itens || estado.carregando) return;
    setEstado({ carregando: true, erro: null, itens: null });
    try {
      const r = await carregar();
      setEstado({ carregando: false, erro: null, itens: r?.historico || [] });
    } catch (err) {
      setEstado({ carregando: false, erro: err?.message || "Não foi possível carregar o histórico.", itens: null });
    }
  }
  return (
    <details className="vf-ph-trilha" onToggle={abrir}>
      <summary>Histórico de alterações</summary>
      {estado.carregando && <p className="vf-ph-trilha__nota">Carregando…</p>}
      {estado.erro && <p className="vf-field__error">{estado.erro}</p>}
      {estado.itens && estado.itens.length === 0 && <p className="vf-ph-trilha__nota">Nenhuma alteração registrada nesta competência.</p>}
      {estado.itens && estado.itens.length > 0 && (
        <ol className="vf-ph-trilha__lista">
          {estado.itens.map((h) => (
            <li key={h.id}>
              <span className="vf-ph-trilha__acao">{ROTULO_ACAO[h.acao] || h.acao}</span>
              {" "}{formatarDataHora(h.em)}{h.por ? ` · ${h.por}` : ""}
              <span className="vf-ph-trilha__valores">{resumoValores(h.valores)}</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

// Competências já lançadas desta conta (Ago, Set, Out…): cada uma é um
// registro próprio. "Abrir" leva a tela inteira para aquele mês.
function CompetenciasDaConta({ carregar, competencia, onAbrir }) {
  const [estado, setEstado] = useState({ itens: null, erro: null });
  useEffect(() => {
    let vivo = true;
    carregar()
      .then((r) => { if (vivo) setEstado({ itens: r?.lancamentos || [], erro: null }); })
      .catch((err) => { if (vivo) setEstado({ itens: null, erro: err?.message || "Não foi possível carregar." }); });
    return () => { vivo = false; };
  }, [carregar]);
  if (estado.erro) return <p className="vf-field__error">{estado.erro}</p>;
  if (!estado.itens || estado.itens.length === 0) return null;
  return (
    <section className="vf-ph-competencias" aria-label="Competências lançadas desta conta">
      <p className="vf-ph-registro__titulo">Competências lançadas</p>
      <ul className="vf-ph-competencias__lista">
        {estado.itens.map((l) => (
          <li key={l.competencia} className={l.competencia === competencia ? "is-atual" : ""}>
            <span className="vf-ph-competencias__mes">{rotularCompetenciaCurta(l.competencia)}</span>
            <span className="vf-ph-competencias__valor">
              {l.valores?.fat != null ? formatarMoeda(l.valores.fat, { casas: 0 }) : "FAT não informado"}
              {l.dataReferencia ? ` · até ${formatarData(l.dataReferencia)}` : ""}
            </span>
            {l.competencia === competencia
              ? <span className="vf-ph-competencias__atual">esta tela</span>
              : onAbrir && (
                <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => onAbrir(l.competencia)}
                  aria-label={`Abrir ${rotularCompetencia(l.competencia)}`}>
                  Abrir
                </button>
              )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Abre com o que está GRAVADO para a conta × competência (vigente ou guardado
// sob o automático) — reabrir o drawer nunca mostra o formulário vazio quando
// existe lançamento.
function valoresIniciais(conta) {
  const m = conta?.manual || null;
  return {
    faturamento: paraCampo(m?.valores?.fat),
    lucroContribuicao: paraCampo(m?.valores?.lc),
    margemPct: paraCampo(m?.valores?.mc, 100),
    investimentoAds: paraCampo(m?.valores?.ads),
    gmvAds: paraCampo(m?.gmvAds),
    dataReferencia: m?.dataReferencia || "",
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

export function LancamentoManualDrawer({
  cliente, contaInicial, competencia, onSalvar, onRemover, onFechar,
  onCarregarLancamentos, onCarregarHistorico, onIrParaCompetencia, modoManual = false,
}) {
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
  const temManual = Boolean(conta?.manual);
  const ref = conta?.referenciaApi || (conta?.fonte?.tipo === "api" ? { fat: conta.resumo?.fat, dadosAte: conta.dadosAte, rotulo: conta.fonte.rotulo } : null);
  const limites = useMemo(() => limitesDataReferencia(competencia), [competencia]);
  const dataRef = campos.dataReferencia;
  const dataRefInvalida = Boolean(dataRef) && (dataRef < limites.min || dataRef > limites.max);
  const carregarLancamentos = useMemo(
    () => (onCarregarLancamentos && conta ? () => onCarregarLancamentos(cliente.id, conta.id) : null),
    [onCarregarLancamentos, cliente, conta]
  );
  const carregarHistorico = useMemo(
    () => (onCarregarHistorico && conta ? () => onCarregarHistorico(cliente.id, conta.id, competencia) : null),
    [onCarregarHistorico, cliente, conta, competencia]
  );

  async function salvar(evento) {
    evento.preventDefault();
    if (!conta || invalido || vazio || inconsistente || dataRefInvalida) return;
    setEnviando(true);
    setErroServidor(null);
    try {
      await onSalvar(cliente.id, conta.id, {
        faturamento: fat,
        lucroContribuicao: lc,
        margemContribuicao: mc,
        investimentoAds: ads,
        gmvAds: gmv,
        dataReferencia: campos.dataReferencia || null,
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

                <div className="vf-field">
                  <label className="vf-field__label" htmlFor={`${idTitulo}-data`}>Dados até</label>
                  <input
                    id={`${idTitulo}-data`}
                    type="date"
                    className="vf-input vf-input--sm vf-ph-drawer__data"
                    min={limites.min}
                    max={limites.max}
                    value={campos.dataReferencia}
                    onChange={(e) => setCampos((prev) => ({ ...prev, dataReferencia: e.target.value }))}
                    aria-describedby={`${idTitulo}-data-dica`}
                    aria-invalid={dataRefInvalida || undefined}
                  />
                  <span className="vf-field__hint" id={`${idTitulo}-data-dica`}>
                    Último dia coberto pelos números (opcional). Em branco = não informado.
                  </span>
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
                {dataRefInvalida && (
                  <p className="vf-field__error" role="alert">
                    "Dados até" precisa estar em {rotularCompetencia(competencia)} e não pode ser depois de hoje.
                  </p>
                )}
                {inconsistente && (
                  <p className="vf-field__error" role="alert">
                    FAT, LC e MC não batem: MC deve ser LC ÷ FAT. Informe só dois deles para o terceiro ser calculado.
                  </p>
                )}
                {erroServidor && <p className="vf-field__error" role="alert">{erroServidor}</p>}

                {ref && ref.fat != null && (
                  <p className="vf-ph-drawer__nota" data-testid="referencia-api">
                    Referência da {ref.rotulo || "API"}: FAT {formatarMoeda(ref.fat, { casas: 2 })}
                    {ref.dadosAte ? ` (dados até ${formatarData(ref.dadosAte)})` : ""}.
                  </p>
                )}

                <p className="vf-ph-drawer__nota">
                  {modoManual ? (
                    <>
                      O dado fica marcado como <strong>MANUAL</strong> e <strong>prevalece sobre a API</strong> enquanto o
                      Painel estiver em modo manual — nenhuma rotina automática o substitui. Cada competência é um registro
                      próprio: salvar este mês não altera os outros.
                    </>
                  ) : (
                    <>
                      O dado fica marcado como <strong>MANUAL</strong>. Se a integração publicar esta competência, o automático
                      passa a ser o exibido e este lançamento continua guardado. Cada competência é um registro próprio:
                      salvar este mês não altera os outros.
                    </>
                  )}
                </p>

                {temManual && <Registro conta={conta} competencia={competencia} />}
                {temManual && carregarHistorico && <Trilha key={`${conta.id}:${competencia}`} carregar={carregarHistorico} />}
                {carregarLancamentos && (
                  <CompetenciasDaConta
                    key={conta.id}
                    carregar={carregarLancamentos}
                    competencia={competencia}
                    onAbrir={onIrParaCompetencia ? (comp) => onIrParaCompetencia(cliente.id, conta.id, comp) : null}
                  />
                )}
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
              disabled={!conta || invalido || vazio || inconsistente || dataRefInvalida || enviando}
            >
              {enviando ? "Salvando…" : "Salvar lançamento"}
            </button>
          </footer>
        </form>
      </aside>
    </>
  );
}
