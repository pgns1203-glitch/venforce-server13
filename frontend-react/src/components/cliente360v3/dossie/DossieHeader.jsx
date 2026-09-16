// frontend-react/src/components/cliente360v3/dossie/DossieHeader.jsx
//
// Header de contexto do Dossiê. Sticky, textual, sem hero: a sidebar global
// já diz QUEM é o cliente e QUAL é a operação, mas ela some do campo de visão
// assim que o olho desce para uma tabela — e "de quem é este número?" é a
// pergunta mais cara desta tela. Aqui o contexto acompanha a rolagem.
//
// O que NÃO entra aqui: dropdown de cliente e de conta (são da sidebar, §2 do
// brief). O seletor de COMPETÊNCIA entra, porque não existe em lugar nenhum
// do Shell — sem ele a tela não tem como trocar de mês.

import { rotularCompetencia, formatarData } from "../../../utils/dates.js";
import { formatarPercentual } from "../../../utils/percentage.js";
import { rotularMarketplace } from "../../../utils/dossie.js";

const NIVEL_CONFIANCA = {
  confiavel: { tom: "success", label: "Confiável" },
  parcial: { tom: "warning", label: "Parcial" },
  insuficiente: { tom: "danger", label: "Insuficiente" },
};

export default function DossieHeader({
  cliente,
  contexto,
  periodo,
  comparacao,
  confianca,
  estado,
  periodos,
  periodoSelecionado,
  onTrocarPeriodo,
  onConfigurar,
}) {
  // O Dossiê pode não ter resultado (envelope indisponível, competência ainda
  // carregando) e mesmo assim SABE de quem é a tela: o contexto vem do Shell,
  // não do payload. O header nunca fica órfão — e nunca inventa um nome:
  // sem nome resolvido, o slug (identificador real) ocupa o lugar.
  const nome = cliente?.nome || contexto?.nome || null;
  const slug = cliente?.slug || contexto?.slug || null;
  const marketplace = rotularMarketplace(periodo?.marketplace || contexto?.marketplace);
  const competencia = periodo?.competencia || periodoSelecionado || null;
  const nivel = NIVEL_CONFIANCA[confianca?.nivel];
  const cobertura = confianca?.coberturaResultado;
  const estadoRuim = estado && estado.chave !== "ok";

  return (
    <header className="c360d-header">
      <div className="c360d-header__identidade">
        {nome || slug ? (
          <h1 className="c360d-header__cliente">{nome || slug}</h1>
        ) : (
          <span className="vf-skeleton c360d-header__esqueleto" style={{ width: 150 }} aria-hidden="true" />
        )}
        {marketplace && (
          <>
            <span className="c360d-header__sep" aria-hidden="true">·</span>
            <span className="c360d-header__operacao">{marketplace}</span>
          </>
        )}
        {nome && slug && <span className="c360d-header__slug">{slug}</span>}
      </div>

      <div className="c360d-header__periodo">
        <span className="c360d-header__competencia">{rotularCompetencia(competencia)}</span>
        {comparacao && (
          <span
            className="c360d-header__vs"
            title={
              periodo && comparacao
                ? `${formatarData(periodo.inicio)}–${formatarData(periodo.fim)} contra ${formatarData(comparacao.inicio)}–${formatarData(comparacao.fim)}`
                : undefined
            }
          >
            vs {rotularCompetencia(comparacao.competencia)}
          </span>
        )}
        {periodo?.parcial && (
          <span className="vf-tag is-warning" title={`Compara os mesmos ${periodo.diasNoPeriodo} dias do mês anterior`}>
            Parcial · {periodo.diasNoPeriodo}/{periodo.diasNoMes} dias
          </span>
        )}
      </div>

      <div className="c360d-header__sinais">
        {nivel && (
          <span className={`vf-status is-${nivel.tom}`} title="Confiança do resultado operacional">
            Confiança {nivel.label}
            {cobertura != null && <span className="c360d-header__num"> · {formatarPercentual(cobertura, 0)}</span>}
          </span>
        )}
        {estadoRuim && (
          <span className={`vf-status is-${estado.bloqueante ? "danger" : "warning"}`}>
            {estado.bloqueante ? "Bloqueado" : "Atenção"}
          </span>
        )}
      </div>

      <div className="c360d-header__acoes">
        <label className="c360d-header__campo">
          <span className="vf-visually-hidden">Período</span>
          <select
            className="vf-select vf-select--sm"
            value={periodoSelecionado || ""}
            onChange={(e) => onTrocarPeriodo?.(e.target.value)}
            disabled={!onTrocarPeriodo}
            title={onTrocarPeriodo ? "Competência apurada" : "Troca de competência desativada nesta superfície"}
          >
            {(periodos || []).map((c) => (
              <option key={c} value={c}>{rotularCompetencia(c)}</option>
            ))}
          </select>
        </label>
        <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={onConfigurar}>
          <span aria-hidden="true">⚙</span> Configurar operação
        </button>
      </div>
    </header>
  );
}
