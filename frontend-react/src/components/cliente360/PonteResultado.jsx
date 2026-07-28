// Ponte do RESULTADO OPERACIONAL.
//
// Começa no resultado operacional da competência comparada e termina no da atual.
// Cada linha é um fator operacional e pode ser expandida para mostrar a fórmula e
// os produtos responsáveis com o unitário antes/depois.
//
// Não existe linha de Ads aqui, por construção do motor: investimento em mídia é
// despesa mensal da conta inteira, sem atribuição por pedido, produto ou campanha.
// Colocá-la na ponte contaminaria a explicação de preço, volume, mix e custo.

import { useState } from "react";
import { formatarMoeda, formatarVariacaoMoeda } from "../../utils/currency.js";
import { formatarNumero } from "../../utils/numbers.js";
import { rotularCompetencia } from "../../utils/dates.js";
import DataTable, { CelulaProduto } from "./DataTable.jsx";

const COLUNAS_COMPOSICAO = [
  { key: "label", header: "Componente agrupado", width: "70%", isRowHeader: true, render: (i) => i.label },
  { key: "impacto", header: "Impacto", width: "30%", align: "right",
    render: (i) => formatarVariacaoMoeda(i.impacto),
    cellClassName: (i) => (i.impacto >= 0 ? "c360-dir--positivo" : "c360-dir--negativo") },
];

// A tabela de produtos da linha muda de colunas conforme o fator tenha ou não
// unitário (volume/mix não têm). As larguras somam 100% nos dois casos.
function colunasProdutosDaLinha(temUnitario) {
  const produto = {
    key: "produto", header: "Produto", width: temUnitario ? "34%" : "52%",
    variant: "produto", isRowHeader: true,
    render: (p) => <CelulaProduto titulo={p.titulo || p.mlb} mlb={p.mlb} />,
  };
  const unidades = [
    { key: "unidAntes", header: "Unid. antes", width: temUnitario ? "12%" : "16%", align: "right",
      render: (p) => formatarNumero(p.unidadesAnterior) },
    { key: "unidDepois", header: "Unid. depois", width: temUnitario ? "12%" : "16%", align: "right",
      render: (p) => formatarNumero(p.unidadesAtual) },
  ];
  const unitarios = temUnitario ? [
    { key: "unitAntes", header: "Unitário antes", width: "14%", align: "right",
      render: (p) => formatarMoeda(p.unitario?.anterior) },
    { key: "unitDepois", header: "Unitário depois", width: "14%", align: "right",
      render: (p) => formatarMoeda(p.unitario?.atual) },
  ] : [];
  const impacto = {
    key: "impacto", header: "Impacto", width: temUnitario ? "14%" : "16%", align: "right",
    render: (p) => formatarVariacaoMoeda(p.impacto),
    cellClassName: (p) => (p.impacto >= 0 ? "c360-dir--positivo" : "c360-dir--negativo"),
  };
  return [produto, ...unidades, ...unitarios, impacto];
}

function LinhaPonte({ linha, maiorImpacto }) {
  const [aberta, setAberta] = useState(false);
  const positiva = linha.impacto >= 0;
  const largura = `${Math.max(2, (Math.abs(linha.impacto) / maiorImpacto) * 100)}%`;
  const temDetalhe = !!(linha.descricao || linha.produtos?.length || linha.composicao?.length);

  return (
    <li className="c360-ponte__linha-wrap">
      <button
        type="button"
        className="c360-ponte__linha"
        aria-expanded={aberta}
        disabled={!temDetalhe}
        onClick={() => setAberta((v) => !v)}
      >
        <span className="c360-ponte__nome">
          {temDetalhe && <span className="c360-ponte__seta" aria-hidden="true">{aberta ? "▾" : "▸"}</span>}
          {linha.label}
        </span>
        <span className="c360-ponte__barra">
          <span
            className={`c360-ponte__preenchimento ${positiva ? "is-positivo" : "is-negativo"}`}
            style={{ width: largura }}
          />
        </span>
        <span className={`c360-ponte__valor c360-dir--${positiva ? "positivo" : "negativo"}`}>
          {formatarVariacaoMoeda(linha.impacto)}
        </span>
      </button>

      {aberta && temDetalhe && (
        <div className="c360-ponte__detalhe">
          {linha.descricao && <p className="c360-ponte__descricao">{linha.descricao}</p>}
          {linha.formula && (
            <p className="c360-ponte__formula">
              <span>Fórmula</span> {linha.formula}
            </p>
          )}

          {/* "Outros" nunca é caixa-preta: mostra exatamente o que foi agrupado. */}
          {linha.composicao?.length > 0 && (
            <DataTable
              caption={`Composição de ${linha.label}`}
              columns={COLUNAS_COMPOSICAO}
              rows={linha.composicao}
              getRowKey={(item) => item.chave}
            />
          )}

          {linha.produtos?.length > 0 && (
            <DataTable
              caption={`Produtos responsáveis por ${linha.label}`}
              columns={colunasProdutosDaLinha(!!linha.produtos[0]?.unitario)}
              rows={linha.produtos}
              getRowKey={(p) => p.mlb}
            />
          )}
        </div>
      )}
    </li>
  );
}

export default function PonteResultado({ ponte, confianca, periodo, comparacao }) {
  if (!ponte) {
    return (
      <section className="vf-section c360-secao c360-ponte">
        <div className="vf-section__header">
          <div className="vf-section__heading">
            <h2 className="vf-section__title">Ponte do resultado operacional</h2>
          </div>
        </div>
        <div className="vf-banner is-warning">
          <div className="vf-banner__content">
            <p className="vf-banner__title">Ponte indisponível nesta competência</p>
            <p className="vf-banner__description">
              {confianca?.motivoOcultarPonte
                || "Não há dados suficientes nos dois períodos para explicar a variação sem inventar número."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const maiorImpacto = Math.max(...ponte.linhas.map((l) => Math.abs(l.impacto)), 1);

  return (
    <section className="vf-section c360-secao c360-ponte">
      <div className="vf-section__header">
        <div className="vf-section__heading">
          <h2 className="vf-section__title">Ponte do resultado operacional</h2>
          <p className="vf-section__description">
            De {rotularCompetencia(comparacao.competencia)} para {rotularCompetencia(periodo.competencia)} —
            cada fator operacional que moveu o resultado. Clique numa linha para ver os produtos.
          </p>
        </div>
        <div className="vf-section__actions">
          <span className={`vf-tag ${ponte.fecha ? "is-success" : "is-danger"}`}>
            {ponte.fecha ? "Fecha exato" : `Resíduo ${formatarMoeda(ponte.residuo)}`}
          </span>
          {confianca?.nivel === "parcial" && <span className="vf-tag is-warning">Confiança parcial</span>}
        </div>
      </div>

      {/* Resíduo acima de R$ 0,01 é declarado, nunca absorvido por ajuste artificial. */}
      {!ponte.fecha && ponte.divergencia && (
        <div className="vf-banner is-danger vf-banner--compact">
          <div className="vf-banner__content">
            <p className="vf-banner__title">A soma dos fatores não fecha</p>
            <p className="vf-banner__description">
              {ponte.divergencia.mensagem} Fonte da divergência: {ponte.divergencia.fonte}.
            </p>
          </div>
        </div>
      )}

      <div className="c360-ponte__extremos">
        <div className="c360-ponte__extremo">
          <p className="c360-ponte__extremo-label">{rotularCompetencia(comparacao.competencia)}</p>
          <p className="c360-ponte__extremo-valor">{formatarMoeda(ponte.inicio)}</p>
        </div>
        <div className={`c360-ponte__delta c360-dir--${ponte.delta >= 0 ? "positivo" : "negativo"}`}>
          {formatarVariacaoMoeda(ponte.delta)}
        </div>
        <div className="c360-ponte__extremo">
          <p className="c360-ponte__extremo-label">{rotularCompetencia(periodo.competencia)}</p>
          <p className="c360-ponte__extremo-valor">{formatarMoeda(ponte.fim)}</p>
        </div>
      </div>

      <ul className="c360-ponte__linhas">
        {ponte.linhas.map((linha) => (
          <LinhaPonte key={linha.chave} linha={linha} maiorImpacto={maiorImpacto} />
        ))}
      </ul>

      <p className="c360-nota c360-nota--fraca">
        A ponte explica somente o resultado operacional (antes de Ads). O investimento em Ads é
        descrito no bloco “Ads no fechamento”.
      </p>
    </section>
  );
}
