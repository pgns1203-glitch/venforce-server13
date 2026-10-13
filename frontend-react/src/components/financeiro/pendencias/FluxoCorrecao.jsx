// frontend-react/src/components/financeiro/pendencias/FluxoCorrecao.jsx
//
// "Como corrijo isto?" — os DOIS caminhos, lado a lado, com a volta clara:
//
//   A. Na linha        → digita o novo custo e salva na base (MELI + base
//                        vinculada usada no processamento).
//   B. Por planilha    → baixar → preencher → importar em Bases de Custo →
//                        reprocessar. Bases abre em NOVA aba para o resultado
//                        processado continuar aqui: ir a Bases na mesma aba
//                        jogava fora o processamento e quebrava o caminho de
//                        volta.
//
// O reprocesso é UM passo explícito (aqui, no passo 4), nunca automático.

export function FluxoCorrecao({ aoVivo, motivoSemCorrecao, base, nRegistrados, onBaixar, onReprocessar, reprocessando }) {
  return (
    <div className="vf-fin-fluxo" aria-label="Como corrigir as pendências">
      <section className="vf-fin-fluxo__caminho" data-caminho="linha">
        <h4 className="vf-fin-bloco__titulo">Corrigir aqui, na linha</h4>
        {aoVivo ? (
          <p className="vf-fin-fluxo__texto">
            Digite o <strong>novo custo</strong> do produto e salve na base <strong>{base?.nome || base?.slug}</strong>. Cada
            linha confirma o que será gravado e mostra o resultado. Depois de corrigir, reprocese o fechamento (passo 4 ao lado).
          </p>
        ) : (
          <p className="vf-fin-fluxo__texto">
            <strong>Indisponível neste fechamento:</strong> {motivoSemCorrecao} Corrija pela planilha ao lado ou direto em Bases
            de Custo.
          </p>
        )}
      </section>

      <section className="vf-fin-fluxo__caminho" data-caminho="planilha">
        <h4 className="vf-fin-bloco__titulo">Corrigir por planilha</h4>
        <ol className="vf-fin-fluxo__passos">
          <li>
            <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={onBaixar}>
              Baixar planilha (XLSX)
            </button>
          </li>
          <li>
            <span>Preencha a coluna <strong>Novo custo</strong> (e <strong>Imposto (%)</strong>, se quiser). Linhas em branco são ignoradas.</span>
          </li>
          <li>
            <span>
            Importe em{" "}
            <a href="bases.html" target="_blank" rel="noopener noreferrer">
              Bases de Custo ↗
            </a>{" "}
            → <em>Atualizar por planilha</em>
            {base?.nome ? <> na base <strong>{base.nome}</strong></> : null}. Abre em nova aba: este resultado continua aqui.
            </span>
          </li>
          <li>
            {onReprocessar && (
              <button
                type="button"
                className={`vf-btn ${nRegistrados > 0 ? "vf-btn--primary" : "vf-btn--secondary"} vf-btn--sm`}
                disabled={reprocessando}
                onClick={onReprocessar}
              >
                {reprocessando ? "Reprocessando…" : "Reprocessar fechamento"}
              </button>
            )}
          </li>
        </ol>
      </section>
    </div>
  );
}
