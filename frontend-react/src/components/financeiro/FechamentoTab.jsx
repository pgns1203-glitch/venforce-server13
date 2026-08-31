// frontend-react/src/components/financeiro/FechamentoTab.jsx
//
// Status do fechamento do período — leitura vinda de
// server/services/financeiroVisaoService.js — e, desde F4.2, a publicação
// do período EM TELA.
//
// O que continua no legado (Portal/financeiro.html) e por quê: GERAR um
// fechamento é upload de planilha + cálculo, e o endpoint que faz isso
// (POST /fechamentos/financeiro) não recebe `periodo` nem grava
// `cliente_conta_id` na entrega. Migrar o botão sem esses dois campos seria
// prometer, numa tela que exibe cliente + operação + competência, uma
// garantia que o contrato não dá. Ver
// Squads_migration/VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md (D1, D2).
//
// Publicar/despublicar, ao contrário, agem sobre uma entrega concreta, por
// `id`, e cada entrega carrega o próprio período — nada é inferido.

import { formatarDataHora } from "../../utils/dates.js";
import { entregaDoPeriodo } from "../../hooks/useEntregasFechamento.js";
import { EntregaAcoes } from "./EntregaAcoes.jsx";

const STATUS_INFO = {
  publicado: { label: "Publicado", tom: "success" },
  rascunho: { label: "Rascunho", tom: "warning" },
  nao_gerado: { label: "Não gerado", tom: "neutral" },
};

export function FechamentoTab({ resultado, clienteSlug, periodo, periodoLabel, entregas }) {
  const dados = resultado.dados;
  const semFechamento = !resultado.disponivel || !dados || dados.status === "nao_gerado";

  // A entrega operável do período em tela. Enquanto a lista carrega, não
  // existe ação — e o status vem do payload de leitura, que já chegou.
  const entrega = entregaDoPeriodo(entregas?.entregas, periodo);
  const statusAtual = entrega ? (entrega.publicado ? "publicado" : "rascunho") : dados?.status;
  const status = STATUS_INFO[statusAtual] || STATUS_INFO.nao_gerado;

  return (
    <div className="vf-stack">
      <div className="vf-cluster" style={{ justifyContent: "space-between" }}>
        <span className={`vf-status is-${status.tom}`}>{status.label}</span>
        <span className="vf-field__hint">{periodoLabel}</span>
      </div>

      {semFechamento ? (
        <div className="vf-empty">
          <p className="vf-empty__title">Nenhum fechamento gerado</p>
          <p className="vf-empty__description">
            {resultado.motivo || `${periodoLabel} ainda não tem fechamento processado.`}
          </p>
          <div className="vf-empty__actions">
            <a className="vf-btn vf-btn--primary" href={`financeiro.html?cliente=${encodeURIComponent(clienteSlug)}`}>
              Gerar no Financeiro (legado) →
            </a>
          </div>
        </div>
      ) : (
        <>
          <p className="vf-field__hint">
            Gerado em {formatarDataHora(entrega?.created_at || dados.geradoEm)}
            {entrega?.publicado || dados.publicadoEm
              ? ` · publicado em ${formatarDataHora(entrega?.published_at || dados.publicadoEm)}`
              : ""}
          </p>

          {entrega ? (
            <div className="vf-stack vf-stack--sm">
              <EntregaAcoes
                entrega={entrega}
                ocupada={entregas.acaoEmCurso === entrega.id}
                bloqueada={entregas.acaoEmCurso != null && entregas.acaoEmCurso !== entrega.id}
                erro={entregas.erroDeAcao?.id === entrega.id ? entregas.erroDeAcao.mensagem : null}
                onPublicar={entregas.publicar}
                onDespublicar={entregas.despublicar}
              />
              <p className="vf-field__hint">
                Publicar gera um link público sem senha e sem validade. Despublicar revoga o link atual.
              </p>
            </div>
          ) : (
            // Sem `id` não existe ação — e dizer por quê é melhor do que um
            // botão que não faz nada.
            <p className="vf-field__hint">
              {entregas?.carregando
                ? "Carregando as ações desta entrega…"
                : entregas?.erro
                ? `Ações indisponíveis: ${entregas.erro.mensagem}`
                : "Esta entrega não apareceu na lista operacional do cliente."}
            </p>
          )}

          <p className="vf-field__hint">
            Reprocessar ou substituir o cálculo continua no{" "}
            <a href={`financeiro.html?cliente=${encodeURIComponent(clienteSlug)}`}>Financeiro (legado) →</a>
          </p>
        </>
      )}
    </div>
  );
}
