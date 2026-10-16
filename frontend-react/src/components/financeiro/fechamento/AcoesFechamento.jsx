// frontend-react/src/components/financeiro/fechamento/AcoesFechamento.jsx
//
// O que fazer com o fechamento processado: salvar a entrega, reprocessar ou
// voltar para os arquivos/ajustes. Fica DEPOIS da leitura (resultado,
// pendências, composição) e ANTES dos produtos: quem decide salvar já viu o
// que está salvando. Duplicidade (409) mora aqui porque é uma decisão sobre
// salvar.

import { VFBanner } from "../../ui/VFBanner/index.js";
import { VFButton } from "../../ui/VFButton/index.js";
import { VFStatus } from "../../ui/VFStatus/index.js";

export function AcoesFechamento({ f, periodoLabel, legado }) {
  const salvando = f.estado === "salvando";
  const salvo = f.estado === "salvo";
  const reprocessando = f.estado === "processando";

  return (
    <div className="vf-stack">
      {/* ── Duplicidade (409) ─────────────────────────────────────────── */}
      {f.duplicidade && (
        <VFBanner
          tone={f.duplicidade.publicado ? "danger" : "warning"}
          role="alert"
          title={
            f.duplicidade.publicado
              ? `${periodoLabel} já tem um fechamento PUBLICADO para esta operação`
              : `${periodoLabel} já tem um fechamento salvo para esta operação`
          }
          actions={
            <>
              <VFButton variant="danger" size="sm" disabled={salvando} onClick={f.substituir}>
                {salvando ? "Substituindo…" : "Substituir"}
              </VFButton>
              <VFButton variant="ghost" size="sm" onClick={f.resetar}>
                Cancelar
              </VFButton>
            </>
          }
        >
          {f.duplicidade.publicado
            ? "Substituir grava um novo fechamento desta competência. O link que já está com o cliente continua abrindo o fechamento antigo; o novo ganha um link próprio quando for publicado."
            : "Substituir atualiza a entrega existente com o que acabou de ser processado."}
        </VFBanner>
      )}

      {salvo ? (
        <div className="vf-cluster">
          <VFStatus tone="success" role="status" className="vf-motion-enter">
            Entrega salva. Edite a apresentação e publique em “Entrega para o cliente”, logo abaixo.
          </VFStatus>
          <VFButton variant="ghost" size="sm" onClick={f.resetar}>
            Processar outro
          </VFButton>
        </div>
      ) : !f.duplicidade ? (
        <div className="vf-cluster vf-fin-acoes">
          <VFButton
            variant="primary"
            disabled={salvando || reprocessando || (f.divergente && !f.confirmouDivergencia)}
            aria-busy={salvando ? "true" : undefined}
            onClick={() => f.salvar()}
          >
            {salvando ? "Salvando…" : "Salvar entrega"}
          </VFButton>
          <VFButton size="sm" disabled={salvando || reprocessando} onClick={f.reprocessar}>
            {reprocessando ? "Reprocessando…" : "Reprocessar fechamento"}
          </VFButton>
          <VFButton variant="ghost" size="sm" disabled={salvando} onClick={f.voltarAoFormulario}>
            Editar arquivos e ajustes
          </VFButton>
        </div>
      ) : null}

      <p className="vf-field__hint">
        Reprocessar pelo motor antigo continua possível no <a href={legado}>Financeiro (legado) →</a>
      </p>
    </div>
  );
}
