// frontend-react/src/components/cliente360v3/dossie/ConfiancaPainel.jsx
//
// Confiança em DIMENSÕES, nunca fundida num score mágico (§20): cobertura de
// resultado, de custo e de frete são coisas diferentes e se degradam por
// motivos diferentes. Um número só esconderia qual delas caiu.
//
// A fonte aparece UMA vez, no cabeçalho do bloco — não embaixo de cada célula.
// O detalhe caro (reconciliação linha a linha, pedidos que derrubam a
// confiança) vive no drawer, porque é auditoria, não leitura de rotina.

import { formatarMoeda } from "../../../utils/currency.js";
import { plural } from "../../../utils/numbers.js";
import { formatarPercentual } from "../../../utils/percentage.js";
import { formatarDataHora } from "../../../utils/dates.js";
import { Proporcao } from "./Primitivos.jsx";

const NIVEL = {
  confiavel: { tom: "success", label: "Confiável" },
  parcial: { tom: "warning", label: "Parcial" },
  insuficiente: { tom: "danger", label: "Insuficiente" },
};

function Linha({ rotulo, valor, fracao, tom, titulo }) {
  return (
    <div className="c360d-conf__linha" title={titulo}>
      <span className="c360d-conf__rotulo">{rotulo}</span>
      {fracao != null && <Proporcao fracao={fracao} />}
      <span className={`c360d-conf__valor${tom ? ` is-${tom}` : ""}`}>{valor}</span>
    </div>
  );
}

export default function ConfiancaPainel({ confianca, onAbrirEvidencias }) {
  if (!confianca) return null;
  const nivel = NIVEL[confianca.nivel] || NIVEL.insuficiente;
  const reconciliacao = confianca.reconciliacao;
  const bloqueados = confianca.pedidosBloqueados ?? null;
  const alertas = confianca.alertas || [];

  return (
    <div className="c360d-conf">
      <div className="c360d-conf__topo">
        <span className={`vf-status is-${nivel.tom}`}>{nivel.label}</span>
        <span className="c360d-fonte">Fechamento API · escopo desta conta</span>
      </div>

      <div className="c360d-conf__linhas">
        <Linha
          rotulo="Resultado"
          valor={formatarPercentual(confianca.coberturaResultado, 0)}
          fracao={confianca.coberturaResultado}
          titulo="Percentual do faturamento com resultado apurado"
        />
        <Linha
          rotulo="Custo"
          valor={formatarPercentual(confianca.coberturaCusto, 0)}
          fracao={confianca.coberturaCusto}
          titulo="Percentual do faturamento com custo conhecido"
        />
        <Linha
          rotulo="Frete"
          valor={formatarPercentual(confianca.coberturaFrete, 0)}
          fracao={confianca.coberturaFrete}
          titulo="Percentual do faturamento com frete conhecido"
        />
        {reconciliacao && (
          <Linha
            rotulo="Reconciliação"
            valor={reconciliacao.status === "reconciliado" ? "Fecha" : "Divergente"}
            tom={reconciliacao.status === "reconciliado" ? "ok" : "alerta"}
            titulo="Detalhe por item contra o total oficial do fechamento"
          />
        )}
      </div>

      {/* Bloqueio é informação de AÇÃO, não de cobertura: sai da lista e ganha
          uma linha própria, com o valor em risco ao lado da contagem. */}
      {bloqueados != null && (
        <p className={`c360d-conf__bloqueio${bloqueados > 0 ? " is-alerta" : ""}`}>
          {bloqueados > 0 ? (
            <>
              <strong>{plural(bloqueados, "pedido sem apuração", "pedidos sem apuração")}</strong>
              {" · "}
              {formatarMoeda(confianca.receitaBloqueada)} de receita fora do resultado
            </>
          ) : (
            <>Nenhum pedido bloqueado nesta competência.</>
          )}
        </p>
      )}

      {alertas.slice(0, 2).map((alerta, i) => (
        <p key={alerta.chave || i} className="c360d-conf__alerta">
          <span aria-hidden="true">◆</span> {alerta.mensagem}
        </p>
      ))}

      <div className="c360d-conf__rodape">
        <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={onAbrirEvidencias}>
          Ver evidências
        </button>
        {confianca.geradoEm && (
          <span className="c360d-fonte">Sincronizado em {formatarDataHora(confianca.geradoEm)}</span>
        )}
      </div>

      {/* Lacuna conhecida, declarada uma vez: completude da Central de Vendas e
          reconciliação Mercado Pago ainda não têm dimensão própria neste
          contrato. Dizer isso é mais honesto do que sugerir cobertura total. */}
      <p
        className="c360d-conf__lacuna"
        title="Cada fonte nova exige auditoria de escopo por conta antes de virar uma dimensão de confiança aqui."
      >
        Completude da Central de Vendas e reconciliação Mercado Pago ainda não têm dimensão própria nesta tela.
      </p>
    </div>
  );
}
