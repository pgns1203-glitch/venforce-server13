// Cartão do cliente da Central do Full — mesma forma do cartão de Anúncios
// ML (.am-cliente-contexto): identidade e metadados à esquerda, ações num
// trilho à direita. Cliente/conta vêm do Shell V3; aqui só se exibe.
import { formatarDataHora } from "../../utils/dates.js";

const TOM_STATUS = { success: "is-success", warning: "is-warning", danger: "is-danger", empty: "", neutral: "" };

export default function FullClienteCard({ clienteNome, conta, dados, carregando, onAtualizar }) {
  const custos = dados?.quality?.sources?.costs;
  const geradoEm = dados?.cache?.generatedAt;

  return (
    <section className="vf-card full-cliente" aria-labelledby="full-cliente-nome">
      <div className="full-cliente__info">
        <div className="full-cliente__titulo">
          <div>
            <p className="full-eyebrow">Cliente selecionado</p>
            <h2 id="full-cliente-nome">{clienteNome || "—"}</h2>
          </div>
          {conta?.status?.label ? (
            <span className={`vf-status ${TOM_STATUS[conta.status.tone] || ""}`}>{conta.status.label}</span>
          ) : null}
        </div>
        <div className="full-cliente__meta">
          <span>Conta ML: {conta?.externalAccountLabel || conta?.nome || dados?.account?.sellerIdMasked || "—"}</span>
          <span>Estoque lido: {geradoEm ? formatarDataHora(geradoEm) : "—"}</span>
          <span>Vendas: últimos 14 dias</span>
          <span>Meta de cobertura: 30 dias</span>
          <span>
            Base de custo:{" "}
            {custos?.status === "ok" && custos.base ? (
              custos.base.nome || custos.base.slug
            ) : (
              <a href="bases.html">não vinculada</a>
            )}
          </span>
        </div>
      </div>
      <div className="full-cliente__acoes">
        <div className="full-cliente__acao">
          <div>
            <p className="full-cliente__acao-titulo">Atualizar estoque Full</p>
            <p className="full-cliente__acao-texto">Lê de novo estoque, vendas e operações no Mercado Livre.</p>
          </div>
          <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={onAtualizar} disabled={carregando}>
            {carregando ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
      </div>
    </section>
  );
}
