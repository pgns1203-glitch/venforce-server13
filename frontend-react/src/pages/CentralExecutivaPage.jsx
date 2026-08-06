import { useMemo } from "react";
import { useCentralExecutiva } from "../hooks/useCentralExecutiva.js";
import { formatarMoeda, formatarMoedaCompacta, formatarVariacaoMoeda } from "../utils/currency.js";
import { formatarPercentual, formatarPontosPercentuais } from "../utils/percentage.js";

const STATUS = {
  critico: { label: "Crítico", classe: "is-danger" },
  atencao: { label: "Atenção", classe: "is-warning" },
  saudavel: { label: "Saudável", classe: "is-success" },
  sem_dados: { label: "Sem dados", classe: "is-neutral" },
};

function soma(contas, campo) {
  return contas.reduce((total, conta) => total + (Number.isFinite(conta[campo]) ? conta[campo] : 0), 0);
}

function Kpi({ label, value, trend, state, featured = false }) {
  return (
    <div className={`vf-kpi${featured ? " vf-kpi--featured" : ""}${state ? ` vf-kpi--${state}` : ""}`}>
      <span className="vf-kpi__label">{label}</span>
      <span className="vf-kpi__value vf-kpi__value--currency">{value}</span>
      {trend && <span className={`vf-kpi__trend ${state ? `is-${state}` : ""}`}>{trend}</span>}
    </div>
  );
}

function gerarNarrativa(resumo) {
  const partes = [];
  if (resumo.criticos) partes.push(`${resumo.criticos} conta${resumo.criticos > 1 ? "s" : ""} crítica${resumo.criticos > 1 ? "s" : ""}`);
  if (resumo.atencao) partes.push(`${resumo.atencao} em atenção`);
  if (resumo.deltaResultado < 0) partes.push(`queda de ${formatarMoeda(Math.abs(resumo.deltaResultado))} no resultado operacional`);
  if (resumo.potencial > 0) partes.push(`${formatarMoeda(resumo.potencial)} de recuperação mapeada`);
  if (!partes.length) return "A carteira não apresenta desvios materiais nos dados carregados para o período.";
  return `A carteira concentra ${partes.join(", ")}. Priorize as contas com maior impacto financeiro e baixa confiança.`;
}

export default function CentralExecutivaPage() {
  const { filtros, atualizarFiltro, contas, contasFiltradas, carregando, erro, progresso, recarregar } = useCentralExecutiva();

  const resumo = useMemo(() => {
    const validas = contas.filter((c) => c.carregado);
    return {
      total: contas.length,
      faturamento: soma(validas, "faturamento"),
      resultado: soma(validas, "resultadoOperacional"),
      resultadoAds: soma(validas, "resultadoAposAds"),
      deltaResultado: soma(validas, "deltaResultado"),
      potencial: soma(validas, "potencialRecuperacao"),
      receitaBloqueada: soma(validas, "receitaBloqueada"),
      criticos: contas.filter((c) => c.status === "critico").length,
      atencao: contas.filter((c) => c.status === "atencao").length,
      saudaveis: contas.filter((c) => c.status === "saudavel").length,
      semDados: contas.filter((c) => c.status === "sem_dados").length,
    };
  }, [contas]);

  return (
    <div className="vf-page-shell">
      <div className="vf-page-container vf-page-container--wide ce">
        <header className="vf-page-header">
          <div className="vf-page-header__main">
            <p className="vf-page-header__eyebrow">Gestão da carteira</p>
            <h1 className="vf-page-header__title">Central Executiva de Contas</h1>
            <p className="vf-page-header__description">Prioridade, impacto, causa e confiança de todas as contas em uma única leitura.</p>
          </div>
          <div className="vf-page-header__actions">
            <button className="vf-btn vf-btn--secondary vf-btn--sm" type="button" onClick={recarregar} disabled={carregando}>
              {carregando ? "Atualizando…" : "Atualizar carteira"}
            </button>
          </div>
        </header>

        <section className="vf-card vf-card--compact ce-filtros" aria-label="Filtros da carteira">
          <div className="ce-filtros__grid">
            <label className="vf-field"><span className="vf-field__label">Competência</span><input className="vf-input vf-input--sm" type="month" value={filtros.competencia} onChange={(e) => atualizarFiltro({ competencia: e.target.value, compararCom: "" })} /></label>
            <label className="vf-field"><span className="vf-field__label">Comparar com</span><input className="vf-input vf-input--sm" type="month" value={filtros.compararCom} onChange={(e) => atualizarFiltro({ compararCom: e.target.value })} /></label>
            <label className="vf-field"><span className="vf-field__label">Buscar conta</span><input className="vf-input vf-input--sm vf-search" value={filtros.busca} onChange={(e) => atualizarFiltro({ busca: e.target.value })} placeholder="Nome ou slug" /></label>
            <label className="vf-field"><span className="vf-field__label">Situação</span><select className="vf-select vf-select--sm" value={filtros.status} onChange={(e) => atualizarFiltro({ status: e.target.value })}><option value="todos">Todas</option><option value="critico">Críticas</option><option value="atencao">Em atenção</option><option value="saudavel">Saudáveis</option><option value="sem_dados">Sem dados</option></select></label>
          </div>
        </section>

        {erro && <div className="vf-banner is-danger"><div className="vf-banner__content"><p className="vf-banner__title">Não foi possível carregar a carteira</p><p className="vf-banner__description">{erro}</p></div></div>}

        {carregando && <div className="ce-progress" role="status"><span className="vf-spinner" aria-hidden="true" /> Carregando contas {progresso.total ? `${progresso.concluidos}/${progresso.total}` : "…"}</div>}

        <section className="vf-kpi-grid ce-kpis" aria-label="Resumo executivo">
          <Kpi label="Faturamento da carteira" value={formatarMoedaCompacta(resumo.faturamento)} featured />
          <Kpi label="Resultado operacional" value={formatarMoedaCompacta(resumo.resultado)} trend={formatarVariacaoMoeda(resumo.deltaResultado)} state={resumo.deltaResultado < 0 ? "danger" : "success"} />
          <Kpi label="Resultado após Ads" value={formatarMoedaCompacta(resumo.resultadoAds)} />
          <Kpi label="Contas críticas" value={String(resumo.criticos)} trend={`${resumo.atencao} em atenção`} state={resumo.criticos ? "danger" : "success"} />
          <Kpi label="Potencial de recuperação" value={formatarMoedaCompacta(resumo.potencial)} />
          <Kpi label="Receita sem confiança" value={formatarMoedaCompacta(resumo.receitaBloqueada)} trend={`${resumo.semDados} contas sem leitura`} state={resumo.semDados ? "warning" : null} />
        </section>

        <p className="ce-narrativa">{gerarNarrativa(resumo)}</p>

        <section className="vf-section">
          <div className="vf-section__header"><div><h2 className="vf-section__title">Contas que exigem acompanhamento</h2><p className="vf-section__description">Ordenadas por gravidade e impacto no resultado. Abra a Cliente 360 V2 para investigar.</p></div><span className="vf-status is-neutral">{contasFiltradas.length} contas</span></div>
          <div className="vf-table-wrap">
            <table className="vf-table vf-table--compact ce-table">
              <thead><tr><th>Conta</th><th>Situação</th><th className="num">Faturamento</th><th className="num">Resultado</th><th className="num">Margem</th><th className="num">Variação</th><th>O que aconteceu</th><th>Confiança</th><th aria-label="Ação" /></tr></thead>
              <tbody>
                {!contasFiltradas.length && !carregando && <tr><td colSpan="9"><div className="vf-empty-state"><h3 className="vf-empty-state__title">Nenhuma conta encontrada</h3><p className="vf-empty-state__description">Ajuste os filtros para ampliar a leitura.</p></div></td></tr>}
                {contasFiltradas.map((conta) => {
                  const status = STATUS[conta.status] || STATUS.sem_dados;
                  return <tr key={conta.cliente.slug} className={conta.status === "critico" ? "is-danger" : conta.status === "atencao" ? "is-warning" : ""}>
                    <td><strong>{conta.cliente.nome}</strong><span className="ce-table__slug vf-mono">{conta.cliente.slug}</span></td>
                    <td><span className={`vf-status ${status.classe}`}>{status.label}</span></td>
                    <td className="num">{formatarMoeda(conta.faturamento)}</td>
                    <td className="num">{formatarMoeda(conta.resultadoOperacional)}</td>
                    <td className="num">{formatarPercentual(conta.margemOperacional)}</td>
                    <td className={`num ${conta.deltaResultado < 0 ? "is-negative" : conta.deltaResultado > 0 ? "is-positive" : ""}`}><strong>{formatarVariacaoMoeda(conta.deltaResultado)}</strong><span className="ce-table__meta">{formatarPontosPercentuais(conta.deltaMargemPp)}</span></td>
                    <td><strong className="ce-causa">{conta.causa?.titulo || "Sem causa identificada"}</strong><span className="ce-table__meta">{conta.narrativa || `${conta.produtosNegativos || 0} no vermelho · ${conta.produtosAbaixoMeta || 0} abaixo da meta`}</span></td>
                    <td><span className={`vf-status ${conta.confianca === "confiavel" ? "is-success" : conta.confianca === "parcial" ? "is-warning" : "is-danger"}`}>{conta.confianca === "confiavel" ? "Confiável" : conta.confianca === "parcial" ? "Parcial" : "Insuficiente"}</span></td>
                    <td>{conta.href ? <a className="vf-btn vf-btn--ghost vf-btn--sm" href={conta.href}>Abrir 360</a> : <span aria-hidden="true">—</span>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
