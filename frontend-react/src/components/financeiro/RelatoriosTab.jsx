// frontend-react/src/components/financeiro/RelatoriosTab.jsx
//
// F4.2 — a aba deixou de ser uma tabela de leitura e virou o lugar de
// OPERAR os fechamentos já gerados: abrir, copiar o link, publicar e
// despublicar. As ações vêm de GET /entregas-cliente (entregasApi.js), que
// é o mesmo `listarEntregas` que alimenta o bloco `relatorios` do
// GET /financeiro/:cliente — só que trazendo `id`, `token_publico` e
// `published_at`, sem os quais nada disso seria possível.
//
// As duas fontes são CAMADAS, não concorrentes: o payload do Financeiro
// diz se o bloco existe (`disponivel`/`motivo`, decisão do backend); a
// lista de entregas diz quais linhas dá para operar. Se a segunda falhar, a
// tabela continua sendo exibida a partir da primeira, em leitura, dizendo
// por que as ações sumiram — degradar em silêncio seria pior.

import { formatarDataHora, rotularCompetencia } from "../../utils/dates.js";
import { BlocoIndisponivel, BlocoSkeleton } from "../visao/BlocoCard.jsx";
import { EntregaAcoes, linkPublico } from "./EntregaAcoes.jsx";

function Vazio() {
  return (
    <div className="vf-empty">
      <p className="vf-empty__description">Nenhum relatório gerado para este cliente ainda.</p>
    </div>
  );
}

// Modo degradado: a lista operacional não carregou. Mostra o que o payload
// do Financeiro já tinha (sem `id`, portanto sem ação) e diz o porquê.
function TabelaSomenteLeitura({ lista, motivo, onTentarDeNovo }) {
  return (
    <div className="vf-stack">
      <div className="vf-banner is-warning" role="status">
        <div className="vf-banner__content">
          <p className="vf-banner__title">Ações indisponíveis no momento</p>
          <p className="vf-banner__description">{motivo}</p>
        </div>
        <div className="vf-banner__actions">
          <button type="button" className="vf-btn vf-btn--sm" onClick={onTentarDeNovo}>
            Tentar novamente
          </button>
        </div>
      </div>
      <div className="vf-table-wrap">
        <table className="vf-table vf-table--compact">
          <thead>
            <tr><th>Período</th><th>Status</th><th>Gerado em</th><th>Publicado</th><th></th></tr>
          </thead>
          <tbody>
            {lista.map((r, i) => (
              <tr key={`${r.periodo}-${i}`}>
                <td>{rotularCompetencia(r.periodo)}</td>
                <td>{r.status === "publicado" ? "Publicado" : "Rascunho"}</td>
                <td>{formatarDataHora(r.geradoEm)}</td>
                <td>{r.publicado ? "Sim" : "Não"}</td>
                <td className="vf-table__actions">
                  {r.publicado && r.token ? (
                    <a className="vf-btn vf-btn--ghost vf-btn--sm" href={linkPublico(r.token)} target="_blank" rel="noreferrer">
                      Abrir
                    </a>
                  ) : (
                    <span className="vf-field__hint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RelatoriosTab({ relatorios, entregas, periodo }) {
  // Bloco indisponível é decisão do backend — nada a operar.
  if (!relatorios.disponivel) return <BlocoIndisponivel motivo={relatorios.motivo} />;

  const leitura = relatorios.dados || [];

  if (entregas.carregando && !entregas.entregas) return <BlocoSkeleton linhas={4} />;

  // Sem lista operacional (falhou, ou o hook não pôde carregar): a tabela
  // continua, em leitura, dizendo por que as ações sumiram. Um botão que
  // não tem `id` para agir é pior do que a ausência dele.
  if (!Array.isArray(entregas.entregas)) {
    if (!leitura.length) return <Vazio />;
    return (
      <TabelaSomenteLeitura
        lista={leitura}
        motivo={entregas.erro?.mensagem || "A lista operacional de entregas não está disponível."}
        onTentarDeNovo={entregas.recarregar}
      />
    );
  }

  const lista = entregas.entregas;
  if (!lista.length) return <Vazio />;

  return (
    <div className={`vf-table-wrap${entregas.carregando ? " is-atualizando" : ""}`}>
      <p className="vf-field__hint">
        Entregas do <strong>cliente</strong> — <code>entregas_cliente</code> não guarda a operação, então esta lista não
        é filtrada por conta.
      </p>
      <table className="vf-table vf-table--compact">
        <thead>
          <tr>
            <th>Período</th>
            <th>Status</th>
            <th>Gerado em</th>
            <th>Publicado em</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lista.map((e) => {
            const doPeriodoEmTela = String(e.periodo || "").includes(periodo);
            return (
              <tr key={e.id} className={doPeriodoEmTela ? "is-destacada" : undefined}>
                <td>
                  {rotularCompetencia(e.periodo)}
                  {doPeriodoEmTela && <span className="vf-tag" style={{ marginLeft: 8 }}>período em tela</span>}
                </td>
                <td>
                  <span className={`vf-status is-${e.publicado ? "success" : "neutral"}`}>
                    {e.publicado ? "Publicado" : "Rascunho"}
                  </span>
                </td>
                <td>{formatarDataHora(e.created_at)}</td>
                {/* Ausência é ausência: um rascunho nunca teve published_at. */}
                <td>{e.publicado ? formatarDataHora(e.published_at) : "—"}</td>
                <td>
                  <EntregaAcoes
                    entrega={e}
                    ocupada={entregas.acaoEmCurso === e.id}
                    bloqueada={entregas.acaoEmCurso != null && entregas.acaoEmCurso !== e.id}
                    erro={entregas.erroDeAcao?.id === e.id ? entregas.erroDeAcao.mensagem : null}
                    onPublicar={entregas.publicar}
                    onDespublicar={entregas.despublicar}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
