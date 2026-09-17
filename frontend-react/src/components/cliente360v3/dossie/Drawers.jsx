// frontend-react/src/components/cliente360v3/dossie/Drawers.jsx
//
// Os aprofundamentos do Dossiê. Todos usam o mesmo primitivo (Drawer.jsx) e
// seguem a mesma regra: ENTENDER acontece aqui, EDITAR vai para o módulo dono.
// Nenhum destes drawers dispara requisição nova — o dado já está em memória,
// vindo do bootstrap ou dos blocos lazy que o usuário já abriu.
//
// Ficam num arquivo só porque são CORPOS de drawer: composições curtas sobre o
// mesmo primitivo, que precisam ficar consistentes entre si (mesma grade de
// campos, mesma tipografia de rótulo, mesma tabela). Separados, divergem.

import { formatarMoeda, formatarVariacaoMoeda } from "../../../utils/currency.js";
import { formatarNumero, ehAusente, plural, AUSENTE } from "../../../utils/numbers.js";
import { formatarPercentual, formatarVariacaoPercentual, formatarPontosPercentuais } from "../../../utils/percentage.js";
import { rotularCompetencia, formatarData, formatarDataHora } from "../../../utils/dates.js";
import { STATUS_MARGEM, problemaProduto, rotularConfiancaMargem } from "../../../utils/dossie.js";
import Drawer from "./Drawer.jsx";
import TabelaDensa from "./TabelaDensa.jsx";
import { colunasProdutos } from "./ProdutosCentral.jsx";
import { Delta, Indisponivel } from "./Primitivos.jsx";

// ── Peças compartilhadas ────────────────────────────────────────────────────

// Campo com valor ausente NÃO vira uma linha de "—": ele sai da lista, e quem
// chama declara numa nota única o que ficou de fora e por quê. Doze travessões
// empilhados não informam nada; uma frase informa.
function ausente(valor) {
  return valor === undefined || valor === null || valor === AUSENTE;
}

function Campos({ itens }) {
  const visiveis = itens.filter((i) => i && !ausente(i.valor));
  if (visiveis.length === 0) return null;
  return (
    <dl className="c360d-campos">
      {visiveis.map((item) => (
        <div key={item.rotulo} className="c360d-campos__par" title={item.titulo}>
          <dt>{item.rotulo}</dt>
          <dd className={item.tom ? `is-${item.tom}` : undefined}>{item.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function Bloco({ titulo, fonte, children }) {
  return (
    <section className="c360d-dbloco">
      <h3 className="c360d-dbloco__titulo">
        {titulo}
        {fonte && <span className="c360d-fonte">{fonte}</span>}
      </h3>
      {children}
    </section>
  );
}

// ── Produto ─────────────────────────────────────────────────────────────────

export function DrawerProduto({ produto, margemInfo, tendencia, clienteSlug, onFechar }) {
  if (!produto) return null;
  const problema = problemaProduto(produto);
  const mapaMargem = margemInfo && STATUS_MARGEM[margemInfo.status];

  return (
    <Drawer
      titulo={produto.titulo || produto.mlb}
      subtitulo={
        <>
          <span className="c360d-mono">{produto.mlb}</span>
          {produto.curvaAbc && <> · curva {produto.curvaAbc}</>}
        </>
      }
      onFechar={onFechar}
      rodape={
        <>
          <a className="vf-btn vf-btn--secondary vf-btn--sm" href={`central-margem.html?cliente=${encodeURIComponent(clienteSlug || "")}`}>
            Evidências na Central de Margem
          </a>
          <a className="vf-btn vf-btn--ghost vf-btn--sm" href={`bases.html?cliente=${encodeURIComponent(clienteSlug || "")}`}>
            Abrir base de custo
          </a>
        </>
      }
    >
      <Bloco titulo="No período" fonte="fechamento">
        <Campos
          itens={[
            { rotulo: "Faturamento", valor: formatarMoeda(produto.faturamento) },
            { rotulo: "Participação", valor: formatarPercentual(produto.participacao) },
            { rotulo: "Unidades", valor: formatarNumero(produto.unidades) },
            { rotulo: "Preço médio", valor: formatarMoeda(produto.precoMedio) },
            {
              rotulo: "Impacto no resultado",
              valor: produto.contribuicao == null ? AUSENTE : formatarVariacaoMoeda(produto.contribuicao),
              tom: produto.contribuicao == null ? undefined : produto.contribuicao >= 0 ? "positivo" : "negativo",
              titulo: produto.contribuicao == null ? "Item fora da ponte desta competência" : undefined,
            },
            { rotulo: "Resultado do item", valor: formatarMoeda(produto.resultado), tom: produto.resultado < 0 ? "negativo" : undefined },
            { rotulo: "Margem de contribuição", valor: formatarPercentual(produto.margem), tom: produto.margem < 0 ? "negativo" : undefined },
            { rotulo: "Margem por unidade", valor: formatarMoeda(produto.margemUnitaria), tom: produto.margemUnitaria < 0 ? "negativo" : undefined },
            { rotulo: "Status", valor: <span className={`vf-status is-${produto.status.tom}`}>{produto.status.label}</span> },
            problema ? { rotulo: "Problema", valor: problema } : null,
          ]}
        />
        {/* O payload traz a linha financeira COMPLETA (preço, resultado do
            item, margem unitária, custos) só para os produtos que o motor
            classificou como no vermelho ou abaixo do alvo. Para os demais, a
            360 recebe o recorte da ponte. Dizer isso uma vez é melhor do que
            imprimir cinco travessões. */}
        {produto.precoMedio == null && (
          <p className="c360d-dnota">
            Preço, resultado e margem por unidade não vêm no payload para este item: a 360 só recebe a
            linha financeira completa dos produtos classificados como no vermelho ou abaixo do alvo.
          </p>
        )}
      </Bloco>

      {(produto.custoUnitario != null || produto.freteUnitario != null) && (
        <Bloco titulo="Custo unitário" fonte="base de custo desta operação">
          <Campos
            itens={[
              { rotulo: "Custo do produto", valor: formatarMoeda(produto.custoUnitario) },
              { rotulo: "Frete", valor: formatarMoeda(produto.freteUnitario) },
              { rotulo: "Comissão", valor: formatarMoeda(produto.comissaoUnitaria) },
              { rotulo: "Imposto", valor: formatarMoeda(produto.impostoUnitario) },
              produto.gapMargemPp != null ? { rotulo: "Gap até o alvo", valor: `${formatarNumero(produto.gapMargemPp, 1)} p.p.` } : null,
              produto.recuperavelAteAlvo != null ? { rotulo: "Recuperável até o alvo", valor: formatarMoeda(produto.recuperavelAteAlvo) } : null,
            ]}
          />
        </Bloco>
      )}

      <Bloco titulo="Antes × depois" fonte="ponte do resultado">
        {tendencia ? (
          <>
            <Campos
              itens={[
                {
                  rotulo: "Unidades",
                  valor: (
                    <>
                      {formatarNumero(tendencia.unidadesAnterior)} → {formatarNumero(tendencia.unidadesAtual)}{" "}
                      <Delta
                        valor={(tendencia.unidadesAtual ?? 0) - (tendencia.unidadesAnterior ?? 0)}
                        texto={formatarNumero((tendencia.unidadesAtual ?? 0) - (tendencia.unidadesAnterior ?? 0))}
                      />
                    </>
                  ),
                },
                tendencia.unitario
                  ? {
                      rotulo: "Unitário",
                      valor: `${formatarMoeda(tendencia.unitario.anterior)} → ${formatarMoeda(tendencia.unitario.atual)}`,
                    }
                  : null,
              ]}
            />
            <ul className="c360d-dlista">
              {tendencia.fatores.map((f) => (
                <li key={f.chave}>
                  <span>{f.label}</span>
                  <span className={f.impacto >= 0 ? "is-positivo" : "is-negativo"}>{formatarVariacaoMoeda(f.impacto)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Indisponivel
            compacto
            titulo="Sem comparação por item"
            motivo="Este produto não aparece na ponte desta competência. A 360 não traz série histórica por produto — só o antes/depois dos itens que explicam a variação do resultado."
          />
        )}
      </Bloco>

      <Bloco titulo="Motor de Margem" fonte={margemInfo ? "catálogo e custo desta conta" : null}>
        {margemInfo ? (
          margemInfo.identidade === "missing" ? (
            <Indisponivel compacto titulo="Item não encontrado no catálogo" motivo={margemInfo.motivo} />
          ) : (
            <Campos
              itens={[
                { rotulo: "Status", valor: <span className={`vf-status is-${mapaMargem?.tom || "neutral"}`}>{mapaMargem?.label || margemInfo.statusLabel}</span> },
                margemInfo.confidence ? { rotulo: "Confiança", valor: rotularConfiancaMargem(margemInfo.confidence) } : null,
                margemInfo.margemPercent != null
                  ? { rotulo: `Margem (${margemInfo.margemTipo || "—"})`, valor: formatarPercentual(margemInfo.margemPercent) }
                  : null,
                margemInfo.problemaPrincipal ? { rotulo: "Problema", valor: margemInfo.problemaPrincipal } : null,
              ]}
            />
          )
        ) : (
          <p className="c360d-fraco">
            Abra o modo <strong>Margem</strong> na Central de Produtos para cruzar este item com o Motor de Margem —
            a consulta é sob demanda.
          </p>
        )}
      </Bloco>

      {/* Ads NÃO é atribuído por produto — por decisão do motor, não por falta
          de tela. Dizer isso aqui evita que alguém procure o número e conclua
          que sumiu. */}
      <p className="c360d-dnota">
        Ads não entra na conta deste item: o investimento é despesa mensal da conta, sem atribuição por
        pedido ou produto. Ele aparece na seção Ads, sobre a operação inteira.
      </p>
    </Drawer>
  );
}

// ── Fator da ponte ──────────────────────────────────────────────────────────

const COLUNAS_COMPOSICAO = [
  { key: "label", header: "Componente", width: "60%", cabecalhoDeLinha: true, render: (i) => i.label },
  {
    key: "impacto", header: "Impacto", width: "40%", align: "right",
    render: (i) => formatarVariacaoMoeda(i.impacto),
    cellClassName: (i) => (i.impacto >= 0 ? "is-positivo" : "is-negativo"),
  },
];

function colunasProdutosDoFator(temUnitario) {
  return [
    { key: "produto", header: "Produto", width: temUnitario ? "28%" : "50%", cabecalhoDeLinha: true,
      render: (p) => <span className="c360d-prod__titulo" title={p.titulo || p.mlb}>{p.titulo || p.mlb}</span> },
    { key: "unid", header: "Unid.", width: temUnitario ? "18%" : "26%", align: "right",
      render: (p) => `${formatarNumero(p.unidadesAnterior)} → ${formatarNumero(p.unidadesAtual)}` },
    ...(temUnitario
      ? [{ key: "unit", header: "Unitário", width: "32%", align: "right",
          render: (p) => `${formatarMoeda(p.unitario?.anterior)} → ${formatarMoeda(p.unitario?.atual)}` }]
      : []),
    { key: "impacto", header: "Impacto", width: temUnitario ? "22%" : "24%", align: "right",
      render: (p) => formatarVariacaoMoeda(p.impacto, 0),
      cellClassName: (p) => (p.impacto >= 0 ? "is-positivo" : "is-negativo") },
  ];
}

export function DrawerFator({ fator, onFechar }) {
  if (!fator) return null;
  const temUnitario = !!fator.produtos?.[0]?.unitario;

  return (
    <Drawer
      titulo={fator.label}
      subtitulo={
        <span className={fator.impacto >= 0 ? "is-positivo" : "is-negativo"}>
          {formatarVariacaoMoeda(fator.impacto)} no resultado operacional
        </span>
      }
      onFechar={onFechar}
    >
      {fator.descricao && <p className="c360d-dtexto">{fator.descricao}</p>}
      {fator.formula && (
        <p className="c360d-dformula">
          <span>Fórmula</span> {fator.formula}
        </p>
      )}

      {fator.composicao?.length > 0 && (
        <Bloco titulo="O que foi agrupado" fonte="fatores individualmente imateriais">
          <TabelaDensa
            legenda={`Composição de ${fator.label}`}
            colunas={COLUNAS_COMPOSICAO}
            linhas={fator.composicao}
            chave={(i) => i.chave}
          />
        </Bloco>
      )}

      {fator.produtos?.length > 0 ? (
        <Bloco titulo="Produtos responsáveis">
          <TabelaDensa
            legenda={`Produtos responsáveis por ${fator.label}`}
            colunas={colunasProdutosDoFator(temUnitario)}
            linhas={fator.produtos}
            chave={(p) => p.mlb}
          />
        </Bloco>
      ) : (
        !fator.composicao?.length && (
          <Indisponivel
            compacto
            titulo="Sem detalhamento por produto"
            motivo="Este fator move o resultado da conta inteira e o motor não o atribui a itens específicos."
          />
        )
      )}
    </Drawer>
  );
}

// ── Oportunidade ────────────────────────────────────────────────────────────

export function DrawerOportunidade({ oportunidade, onFechar }) {
  if (!oportunidade) return null;
  const op = oportunidade;

  return (
    <Drawer
      titulo={op.titulo}
      subtitulo={
        op.contaNoTotal
          ? <>Recuperável estimado: <strong>{formatarMoeda(op.recuperavelEstimado)}</strong></>
          : "Alerta sem valor estimável — fora do total recuperável"
      }
      onFechar={onFechar}
      rodape={
        op.destino ? (
          <a className="vf-btn vf-btn--primary vf-btn--sm" href={op.destino}>
            Abrir tela de ação
          </a>
        ) : null
      }
    >
      <p className="c360d-dtexto">{op.descricao}</p>
      {op.acaoRecomendada && (
        <Bloco titulo="Ação recomendada">
          <p className="c360d-dtexto">{op.acaoRecomendada}</p>
        </Bloco>
      )}

      {op.produtos?.length > 0 && (
        <Bloco titulo={`Itens envolvidos (${op.produtos.length})`}>
          <ul className="c360d-dlista">
            {op.produtos.map((p) => (
              <li key={p.mlb}>
                <span>
                  {p.titulo || p.mlb} <span className="c360d-mono">{p.mlb}</span>
                </span>
                <span className="is-negativo">
                  {formatarMoeda(p.impacto ?? p.resultado ?? (p.recuperavel != null ? -p.recuperavel : null), { casas: 0 })}
                </span>
              </li>
            ))}
          </ul>
        </Bloco>
      )}

      <p className="c360d-dnota">
        O valor é um teto conservador calculado sobre perdas que já aparecem na ponte ou nos produtos do
        período — não uma promessa de recuperação.
      </p>
    </Drawer>
  );
}

// ── Confiança (evidências) ──────────────────────────────────────────────────

const COLUNAS_RECONCILIACAO = [
  { key: "label", header: "Componente", width: "68%", cabecalhoDeLinha: true, render: (l) => l.label },
  {
    key: "valor", header: "Valor", width: "32%", align: "right",
    render: (l) => formatarMoeda(l.valor),
    cellClassName: (l) => l.classe || "",
  },
];

const COLUNAS_PEDIDOS = [
  { key: "pedido", header: "Pedido", width: "30%", cabecalhoDeLinha: true, render: (p) => <span className="c360d-mono">{p.pedidoId}</span> },
  { key: "data", header: "Data", width: "20%", render: (p) => formatarData(p.data) },
  { key: "valor", header: "Valor", width: "22%", align: "right", render: (p) => formatarMoeda(p.valor, { casas: 0 }) },
  { key: "pend", header: "Pendências", width: "28%", render: (p) => <span className="c360d-fraco">{(p.pendencias || []).join(", ") || AUSENTE}</span> },
];

export function DrawerConfianca({ confianca, fechamento, onFechar }) {
  if (!confianca) return null;
  const reconciliacao = confianca.reconciliacao || fechamento?.reconciliacao?.atual || null;
  const pedidos = (confianca.pedidosDerrubando || []).slice(0, 12);

  const linhasReconciliacao = reconciliacao
    ? [
        { chave: "oficial", label: "Faturamento no fechamento (oficial)", valor: reconciliacao.faturamentoFechamento },
        { chave: "detalhe", label: "Faturamento detalhado por item", valor: reconciliacao.faturamentoDetalhe },
        ...(reconciliacao.ajusteIdentificado
          ? [{ chave: "ajuste", label: `Ajustes com origem identificada${reconciliacao.origemAjuste ? ` (${reconciliacao.origemAjuste})` : ""}`, valor: reconciliacao.ajusteIdentificado }]
          : []),
        {
          chave: "diferenca",
          label: "Diferença sem origem identificada",
          valor: reconciliacao.diferenca,
          classe: reconciliacao.diferenca ? "is-negativo" : "",
        },
      ]
    : [];

  return (
    <Drawer titulo="Evidências de confiança" subtitulo="Fechamento API · escopo desta conta" onFechar={onFechar}>
      <Bloco titulo="Cobertura" fonte="percentual do faturamento, não do número de pedidos">
        <Campos
          itens={[
            { rotulo: "Resultado apurado", valor: formatarPercentual(confianca.coberturaResultado) },
            { rotulo: "Custo conhecido", valor: formatarPercentual(confianca.coberturaCusto) },
            { rotulo: "Frete conhecido", valor: formatarPercentual(confianca.coberturaFrete) },
            { rotulo: "Receita sem apuração", valor: formatarMoeda(confianca.receitaBloqueada) },
            { rotulo: "Pedidos bloqueados", valor: formatarNumero(confianca.pedidosBloqueados) },
            { rotulo: "Pedidos parciais", valor: formatarNumero(confianca.pedidosParciais) },
          ]}
        />
      </Bloco>

      {(confianca.alertas || []).length > 0 && (
        <Bloco titulo="Alertas">
          <ul className="c360d-dlista">
            {confianca.alertas.map((a, i) => (
              <li key={a.chave || i}>
                <span>{a.mensagem}</span>
                {a.fonte && <span className="c360d-fraco">{a.fonte}</span>}
              </li>
            ))}
          </ul>
        </Bloco>
      )}

      {reconciliacao && (
        <Bloco titulo="Reconciliação detalhe × fechamento" fonte={reconciliacao.status === "reconciliado" ? "fecha" : "divergente"}>
          <TabelaDensa
            legenda="Reconciliação entre o detalhe por item e o total do fechamento"
            colunas={COLUNAS_RECONCILIACAO}
            linhas={linhasReconciliacao}
            chave={(l) => l.chave}
          />
          {reconciliacao.status !== "reconciliado" && (
            <p className="c360d-dnota">
              A diferença é mostrada como está. Nenhum número foi forçado a fechar e nenhum ajuste artificial
              foi criado.
            </p>
          )}
        </Bloco>
      )}

      {pedidos.length > 0 && (
        <Bloco titulo={`Pedidos que derrubam a confiança (${pedidos.length})`}>
          <TabelaDensa
            legenda="Pedidos que derrubam a confiança"
            colunas={COLUNAS_PEDIDOS}
            linhas={pedidos}
            chave={(p) => p.pedidoId}
          />
        </Bloco>
      )}

      {confianca.geradoEm && (
        <p className="c360d-dnota">Fechamento sincronizado em {formatarDataHora(confianca.geradoEm)}.</p>
      )}
    </Drawer>
  );
}

// ── Comparação completa ─────────────────────────────────────────────────────

export function DrawerComparacao({ fechamento, periodo, comparacao, onFechar }) {
  if (!fechamento) return null;
  const { atual, anterior, variacoes } = fechamento;

  const linhas = [
    { chave: "faturamento", label: "Faturamento", a: anterior.faturamento, b: atual.faturamento, v: variacoes.faturamento, fmt: "moeda" },
    { chave: "resultado", label: "Resultado operacional", a: anterior.resultadoOperacional, b: atual.resultadoOperacional, v: variacoes.resultadoOperacional, fmt: "moeda", destaque: true },
    { chave: "margem", label: "Margem operacional", a: anterior.margemOperacional, b: atual.margemOperacional, v: variacoes.margemOperacional, fmt: "pct" },
    { chave: "aposAds", label: "Resultado após Ads", a: anterior.resultadoAposAds, b: atual.resultadoAposAds, v: variacoes.resultadoAposAds, fmt: "moeda" },
    // Ads subir não é bom nem ruim por si — o efeito sobre o resultado já está em
    // "Resultado após Ads". Delta neutro para não emitir um julgamento que o
    // dado não sustenta.
    { chave: "ads", label: "Investimento em Ads", a: anterior.ads, b: atual.ads, v: variacoes.ads, fmt: "moeda", neutro: true },
    { chave: "pedidos", label: "Pedidos", a: anterior.pedidos, b: atual.pedidos, v: variacoes.pedidos, fmt: "num" },
    { chave: "unidades", label: "Unidades", a: anterior.unidades, b: atual.unidades, v: variacoes.unidades, fmt: "num" },
    { chave: "ticket", label: "Ticket médio", a: anterior.ticketMedio, b: atual.ticketMedio, v: variacoes.ticketMedio, fmt: "moeda" },
    { chave: "cancel", label: "Cancelamentos", a: anterior.cancelamentos, b: atual.cancelamentos, v: variacoes.cancelamentos, fmt: "num", inverso: true },
    { chave: "comissao", label: "Comissão", a: anterior.comissao, b: atual.comissao, v: null, fmt: "moeda" },
    { chave: "frete", label: "Frete", a: anterior.frete, b: atual.frete, v: null, fmt: "moeda" },
    { chave: "custo", label: "Custo do produto", a: anterior.custo, b: atual.custo, v: null, fmt: "moeda" },
    { chave: "imposto", label: "Imposto", a: anterior.imposto, b: atual.imposto, v: null, fmt: "moeda" },
  ];

  const formatar = (valor, fmt) => {
    if (ehAusente(valor)) return AUSENTE;
    // Centavo aqui SIM: esta é a tela de detalhe. Sem ele, ticket médio de
    // R$ 223,80 e R$ 223,52 viram "R$ 224" nas duas colunas e a variação de
    // −0,1% ao lado parece um erro.
    if (fmt === "moeda") return formatarMoeda(valor);
    if (fmt === "pct") return formatarPercentual(valor);
    return formatarNumero(valor);
  };

  const colunas = [
    { key: "label", header: "Indicador", width: "34%", cabecalhoDeLinha: true, render: (l) => l.label },
    { key: "a", header: rotularCompetencia(comparacao?.competencia), width: "20%", align: "right", render: (l) => formatar(l.a, l.fmt) },
    { key: "b", header: rotularCompetencia(periodo?.competencia), width: "20%", align: "right", render: (l) => formatar(l.b, l.fmt) },
    {
      key: "delta", header: "Δ", width: "26%", align: "right",
      render: (l) => {
        if (!l.v) return <span className="c360d-ausente">{AUSENTE}</span>;
        if (l.fmt === "pct") return <Delta valor={l.v.pp} texto={formatarPontosPercentuais(l.v.pp)} inverso={l.inverso} neutro={l.neutro} />;
        return <Delta valor={l.v.pct ?? l.v.abs} texto={formatarVariacaoPercentual(l.v.pct)} inverso={l.inverso} neutro={l.neutro} />;
      },
    },
  ];

  return (
    <Drawer
      titulo="Comparação completa"
      subtitulo={`${rotularCompetencia(periodo?.competencia)} contra ${rotularCompetencia(comparacao?.competencia)}${periodo?.parcial ? ` · mesmos ${periodo.diasNoPeriodo} dias` : ""}`}
      onFechar={onFechar}
    >
      <TabelaDensa
        legenda="Indicadores das duas competências"
        colunas={colunas}
        linhas={linhas}
        chave={(l) => l.chave}
        classeLinha={(l) => (l.destaque ? "is-destaque" : "")}
      />
      <p className="c360d-dnota">
        Comissão, frete, custo e imposto aparecem como totais do período: a variação deles já está
        decomposta por fator na ponte do resultado.
      </p>
    </Drawer>
  );
}

// ── Lista completa de produtos ──────────────────────────────────────────────

export function DrawerProdutosTodos({ linhas, margemPorMlb, onAbrirProduto, totais, onFechar }) {
  return (
    <Drawer
      titulo="Produtos da competência"
      subtitulo={`${plural(linhas.length, "item material", "itens materiais")}${totais?.analisados != null ? ` · ${formatarNumero(totais.analisados)} analisados` : ""}`}
      largura="lg"
      onFechar={onFechar}
    >
      <TabelaDensa
        legenda="Todos os produtos materiais da competência"
        colunas={colunasProdutos({ onAbrirProduto, margemPorMlb, comProblema: true })}
        linhas={linhas}
        chave={(l) => l.mlb}
        onSelecionar={onAbrirProduto}
      />
      <p className="c360d-dnota">
        A 360 carrega os produtos MATERIAIS da competência (topo de cada classificação do motor), não o
        catálogo inteiro. Para varrer o catálogo, use a Central de Margem.
      </p>
    </Drawer>
  );
}

// ── Configurar operação ─────────────────────────────────────────────────────

function Cta({ titulo, descricao, estado, tom, href, label }) {
  return (
    <div className="c360d-cta">
      <div className="c360d-cta__texto">
        <p className="c360d-cta__titulo">
          {titulo}
          {estado && <span className={`vf-status is-${tom}`}>{estado}</span>}
        </p>
        <p className="c360d-cta__descricao">{descricao}</p>
      </div>
      <a className="vf-btn vf-btn--secondary vf-btn--sm" href={href}>{label}</a>
    </div>
  );
}

export function DrawerConfiguracao({ clienteSlug, grantBase, onFechar }) {
  const d = grantBase?.disponivel ? grantBase.dados : null;
  const href = (pagina) => `${pagina}?cliente=${encodeURIComponent(clienteSlug || "")}`;

  return (
    <Drawer
      titulo="Configurar operação"
      subtitulo="A 360 mostra o estado; a edição acontece no módulo dono"
      onFechar={onFechar}
    >
      <Cta
        titulo="Conexão (Grant)"
        descricao="Reconectar o token do Mercado Livre desta conta."
        estado={d ? (d.grantConectado ? "Conectada" : `Grant: ${d.grantStatus || "sem conexão"}`) : null}
        tom={d?.grantConectado ? "success" : "danger"}
        href={href("clientes.html")}
        label="Gerenciar"
      />
      <Cta
        titulo="Base de custo"
        descricao="Revisar ou vincular a base usada para custo e margem."
        estado={d ? (d.baseVinculada ? "Vinculada" : "Sem base") : null}
        tom={d?.baseVinculada ? "success" : "warning"}
        href={href("bases.html")}
        label="Revisar"
      />
      <Cta
        titulo="Contas do cliente"
        descricao="Contas conectadas, marketplace e external ID de cada operação."
        href={href("clientes.html")}
        label="Abrir"
      />
      <Cta
        titulo="Diagnóstico inicial"
        descricao="Ver ou refazer o diagnóstico inicial desta operação."
        href={href("diagnostico-inicial.html")}
        label="Abrir"
      />
      <Cta
        titulo="Entrega e Financeiro"
        descricao="Publicar ou revisar a entrega de fechamento."
        href={href("financeiro.html")}
        label="Abrir"
      />
    </Drawer>
  );
}

// ── Evento do histórico ─────────────────────────────────────────────────────

export function DrawerEvento({ evento, onFechar }) {
  if (!evento) return null;
  return (
    <Drawer titulo={evento.titulo} subtitulo={formatarDataHora(evento.timestamp)} onFechar={onFechar}>
      <Campos
        itens={[
          { rotulo: "Tipo", valor: evento.tipo },
          { rotulo: "Escopo", valor: evento.escopo === "client_legacy" ? "Cliente inteiro (legado)" : "Esta conta" },
          evento.competencia ? { rotulo: "Competência", valor: rotularCompetencia(evento.competencia) } : null,
          { rotulo: "Responsável", valor: evento.ator || "sistema" },
          evento.fonte ? { rotulo: "Fonte", valor: evento.fonte } : null,
        ]}
      />
      {evento.detalhe && <p className="c360d-dtexto">{evento.detalhe}</p>}
    </Drawer>
  );
}
