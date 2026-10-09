// frontend-react/src/components/financeiro/HistoricoTab.jsx
//
// HISTÓRICO — a SEQUÊNCIA de competências desta operação, mês a mês,
// inclusive os meses sem fechamento. É o que distingue esta aba de
// "Relatórios gerados" (que lista os artefatos e age sobre eles): aqui se
// vê o buraco ("Setembro sem fechamento") e se pula para o mês com um clique.
//
// Nenhuma escrita aqui de propósito: publicar/excluir têm UM lugar
// (Relatórios gerados / Fechamento). Escolher um mês passa pela mesma troca
// de competência da página — com confirmação se houver trabalho em andamento.
//
// O status do mês é o DESTA conta; entrega legada (sem operação registrada)
// é sinalizada, nunca contada como fechamento da conta.

import { competenciaAnterior, competenciaNoFuso, ehCompetencia, rotularCompetencia, formatarDataHora } from "../../utils/dates.js";
import { normalizarCompetencia } from "../../utils/financeiro/competencia.js";
import { escopoDaEntrega, entregaDoPeriodo, entregaLegadaDoPeriodo, entregasDoPeriodo } from "../../hooks/useEntregasFechamento.js";
import { statusDaCompetencia } from "../../utils/financeiro/statusCompetencia.js";
import { BlocoIndisponivel, BlocoSkeleton } from "../visao/BlocoCard.jsx";

const MESES = 12;

// O bloco de leitura de GET /financeiro (`relatorios`) vira o mesmo formato
// das entregas para o modo degradado.
function daLeitura(dados) {
  return (dados || []).map((r) => ({
    id: r.id,
    periodo: r.periodo,
    cliente_conta_id: r.clienteContaId ?? null,
    publicado: !!r.publicado,
    token_publico: r.token || null,
    created_at: r.geradoEm || null,
  }));
}

function sequencia(fim, quantidade) {
  const lista = [];
  let cursor = fim;
  for (let i = 0; i < quantidade; i++) {
    lista.push(cursor);
    cursor = competenciaAnterior(cursor);
  }
  return lista;
}

export function HistoricoTab({ relatorios, entregas, periodo, clienteContaId, onEscolherCompetencia }) {
  if (relatorios && !relatorios.disponivel && !Array.isArray(entregas?.entregas)) return <BlocoIndisponivel motivo={relatorios.motivo} />;
  if (entregas.carregando && !entregas.entregas) return <BlocoSkeleton linhas={6} />;

  const lista = Array.isArray(entregas.entregas) ? entregas.entregas : daLeitura(relatorios?.dados);
  const daConta = lista.filter((e) => escopoDaEntrega(e, clienteContaId) === "esta_conta");

  // A régua termina no mês mais recente entre hoje, a competência em tela e o
  // último fechamento desta conta — nada de mês futuro inventado.
  const candidatos = [competenciaNoFuso(), periodo, ...daConta.map((e) => normalizarCompetencia(e.periodo))].filter(ehCompetencia);
  const fim = candidatos.sort().slice(-1)[0];
  const meses = sequencia(fim, MESES);
  const semConta = lista.filter((e) => escopoDaEntrega(e, clienteContaId) === "legado" && !normalizarCompetencia(e.periodo));

  return (
    <div className="vf-stack vf-stack--sm">
      {!Array.isArray(entregas.entregas) && (
        <p className="vf-field__hint">Lista operacional indisponível — histórico montado a partir da leitura do Financeiro.</p>
      )}
      <ul className="vf-fin-historico" aria-label="Competências desta operação">
        {meses.map((m) => {
          const entrega = entregaDoPeriodo(lista, m, clienteContaId);
          const legada = entregaLegadaDoPeriodo(lista, m);
          const status = statusDaCompetencia({ entrega, entregaLegada: legada });
          const daContaNoMes = entregasDoPeriodo(lista, m).filter((e) => escopoDaEntrega(e, clienteContaId) === "esta_conta").length;
          const emTela = m === periodo;
          return (
            <li key={m} className={`vf-fin-historico__item${emTela ? " is-destacada" : ""}`} data-competencia={m}>
              <span className={`vf-fin-historico__dot is-${status.tom === "success" ? "success" : "neutral"}`} aria-hidden="true">
                {entrega ? "●" : "○"}
              </span>
              <button type="button" className="vf-fin-historico__periodo vf-btn vf-btn--ghost vf-btn--sm" disabled={emTela} onClick={() => onEscolherCompetencia?.(m)}>
                {rotularCompetencia(m)}
              </button>
              <span className="vf-field__hint">
                {status.label}
                {entrega?.published_at && entrega.publicado ? ` · ${formatarDataHora(entrega.published_at)}` : ""}
                {daContaNoMes > 1 ? ` · ${daContaNoMes} fechamentos gravados` : ""}
                {status.legado ? " · existe fechamento legado (sem conta)" : ""}
              </span>
              {emTela && <span className="vf-tag">em tela</span>}
            </li>
          );
        })}
      </ul>
      {semConta.length > 0 && (
        <p className="vf-field__hint">
          {semConta.length} {semConta.length === 1 ? "entrega legada sem competência reconhecível" : "entregas legadas sem competência reconhecível"} — veja em Relatórios gerados.
        </p>
      )}
    </div>
  );
}
