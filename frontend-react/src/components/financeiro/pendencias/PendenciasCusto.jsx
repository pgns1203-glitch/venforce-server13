// frontend-react/src/components/financeiro/pendencias/PendenciasCusto.jsx
//
// Pendências de custo como AÇÃO, em TRÊS grupos com contagem — o operador não
// precisa deduzir o que pode fazer com "7 produtos precisam de custo":
//
//   1. Corrigir agora no portal     custo + imposto na linha → salvar na base
//   2. Corrigir por planilha        baixar → preencher → enviar aqui mesmo →
//                                   importar e atualizar a base
//   3. Bloqueadas / dependem de     sem ID do Item, custo ambíguo, Shopee com
//      decisão                      conflito Item × Model — com o motivo e o
//                                   caminho de cada uma
//
// 1 e 2 são as MESMAS pendências seguras: o volume decide onde elas aparecem
// (≤ LIMITE_CORRECAO_INDIVIDUAL no portal, acima disso na planilha) e o
// operador pode trocar. Os dois terminam na BASE DE CUSTOS vinculada
// atualizada; depois, e só depois, REPROCESSAR (nunca automático, um botão só).
//
// Segurança: quem pode ser gravado é decidido por utils/financeiro/baseCustos
// com os registros REAIS da base; o agrupamento é utils/financeiro/
// gruposPendencias. A tela não cria regra de matching.

import { useCallback, useEffect, useMemo, useState } from "react";
import { agruparPendencias, gapsSemLinha, GAP_TIPO_LABEL, montarPlanilhaPendencias, motivoDoGap, nomeDaPlanilhaDePendencias, separarPendenciasParaPlanilha } from "../../../utils/financeiro/pendencias.js";
import { classificarPendencias, LIMITE_CORRECAO_INDIVIDUAL } from "../../../utils/financeiro/gruposPendencias.js";
import { baixarBlob, TIPO_XLSX } from "../../../utils/financeiro/arquivos.js";
import { indexarPorProduto, itensDaBase } from "../../../utils/financeiro/baseCustos.js";
import { obterCustosDaBase, obterPadraoCustoBase } from "../../../services/basesCustoApi.js";
import { SecaoFinanceira } from "../shared/SecaoFinanceira.jsx";
import { formatarMoeda } from "../../../utils/currency.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";
import { PendenciaLinha } from "./PendenciaLinha.jsx";
import { CorrecaoEmLote } from "./CorrecaoEmLote.jsx";

export { LIMITE_CORRECAO_INDIVIDUAL };
const MAX_VISIVEIS = 10;

const qtd = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function idsDa(p) {
  return [p.itemId ? `Item ${p.itemId}` : null, p.modelId ? `Model ${p.modelId}` : null, p.sku ? `SKU ${p.sku}` : null].filter(Boolean);
}

function CabecalhoTabela() {
  return (
    <thead>
      <tr>
        <th>Produto</th>
        <th>Identificação</th>
        <th>Motivo</th>
        <th className="is-numeric">Receita impactada</th>
        <th className="is-numeric">Custo atual</th>
        <th>Novo custo</th>
        <th>Imposto %</th>
        <th>Ação</th>
      </tr>
    </thead>
  );
}

// Moldura de um grupo: número + título + POR QUE o grupo existe.
function Grupo({ id, numero, titulo, contagem, explicacao, children }) {
  return (
    <section className={`vf-fin-pend-grupo${contagem === 0 ? " is-vazio" : ""}`} data-grupo={id} aria-label={titulo}>
      <header className="vf-fin-pend-grupo__cabecalho">
        <span className="vf-fin-pend-grupo__numero" aria-hidden="true">{numero}</span>
        <h4 className="vf-fin-pend-grupo__titulo">{titulo}</h4>
        <span className="vf-fin-pend-grupo__contagem" data-contagem={contagem}>{contagem}</span>
      </header>
      {explicacao && <p className="vf-fin-pend-grupo__explicacao">{explicacao}</p>}
      {children}
    </section>
  );
}

export function PendenciasCusto({ linhas, processamento, marketplace, contexto = {}, base = null, onReprocessar, reprocessando = false }) {
  const pendencias = useMemo(
    () => agruparPendencias(linhas, { unmatchedCosts: processamento?.unmatchedCosts }),
    [linhas, processamento]
  );
  const semLinha = useMemo(() => gapsSemLinha(pendencias, processamento?.unmatchedCosts), [pendencias, processamento]);

  const [registrados, setRegistrados] = useState({});
  const [gravadasLote, setGravadasLote] = useState(0);
  const [verTodas, setVerTodas] = useState(false);
  const [preferencia, setPreferencia] = useState(null); // null | "portal" | "planilha"
  const [padrao, setPadrao] = useState(null);
  const [itens, setItens] = useState([]);
  const [leituraBase, setLeituraBase] = useState("idle"); // idle | carregando | ok | erro

  // Cada processamento novo é um retrato novo: o que foi corrigido antes ou
  // já saiu da lista (resolvido) ou continua pendente (a base não resolveu).
  useEffect(() => {
    setRegistrados({});
    setGravadasLote(0);
  }, [processamento]);

  // Correção pela base só quando o processamento USOU a base vinculada desta
  // conta — corrigir a base não muda nada se os custos vieram de upload.
  const marketplaceSuportado = marketplace === "meli" || marketplace === "shopee";
  const baseDoProcessamento =
    marketplaceSuportado && processamento?.costsSource === "base" && base?.slug && processamento?.costsBase?.slug === base.slug ? base : null;

  const slugBase = baseDoProcessamento?.slug || null;
  const carregarBase = useCallback(
    (sinal) => {
      if (!slugBase) return Promise.resolve();
      return Promise.all([obterCustosDaBase(slugBase, { signal: sinal }), obterPadraoCustoBase(slugBase, { signal: sinal }).catch(() => null)])
        .then(([b, p]) => {
          setItens(itensDaBase(b));
          setPadrao(p?.padrao || null);
          setLeituraBase("ok");
        })
        .catch((e) => {
          if (e?.name === "AbortError") return;
          setLeituraBase("erro");
        });
    },
    [slugBase]
  );
  useEffect(() => {
    if (!slugBase) {
      setItens([]);
      setPadrao(null);
      setLeituraBase("idle");
      return undefined;
    }
    setLeituraBase("carregando");
    const controlador = new AbortController();
    carregarBase(controlador.signal);
    return () => controlador.abort();
  }, [slugBase, carregarBase]);

  const indice = useMemo(() => indexarPorProduto(itens), [itens]);
  const baseDaConta = baseDoProcessamento && leituraBase === "ok" ? baseDoProcessamento : null;

  const grupos = useMemo(
    () => (baseDaConta ? classificarPendencias({ pendencias, marketplace, indice, preferencia, registrados }) : null),
    [baseDaConta, pendencias, marketplace, indice, preferencia, registrados]
  );

  if (!pendencias.length && !semLinha.length) return null;

  const correcoes = Object.keys(registrados).length + gravadasLote;
  const receitaTotal = pendencias.reduce((s, p) => (p.receitaImpactada === null ? s : s + p.receitaImpactada), 0);

  // A planilha leva o que pode ser GRAVADO a partir dela: com a base, as
  // pendências seguras (grupos 1 e 2); sem a base, tudo que tem ID (para
  // corrigir o arquivo de custos enviado).
  const paraPlanilha = grupos ? grupos.corrigiveis : separarPendenciasParaPlanilha(pendencias, { marketplace }).incluidas;
  function baixarPlanilha() {
    const bytes = montarPlanilhaPendencias(paraPlanilha, { marketplace, ...contexto, indice });
    baixarBlob(new Blob([bytes], { type: TIPO_XLSX }), nomeDaPlanilhaDePendencias({ marketplace, periodo: contexto.competencia }));
  }

  // Memória local do que acabou de ser gravado: a próxima pendência do MESMO
  // registro precisa enxergá-lo — sem isto ela seria tratada como "criar".
  // Shopee: o registro é Item + Model; as OUTRAS variações do Item continuam.
  function aplicarRegistro(r) {
    setItens((atual) => {
      const mesmoRegistro = (i) => i.produtoId === r.produtoId && (marketplace !== "shopee" || (i.idModel || null) === (r.idModel || null));
      const resto = atual.filter((i) => !mesmoRegistro(i));
      return [...resto, { produtoId: r.produtoId, idModel: r.idModel || null, sku: null, custo: r.custo, imposto: r.imposto, nome: r.nome || null }];
    });
  }

  const linhaDaPendencia = (p, extra = null) => (
    <PendenciaLinha
      key={p.chave}
      pendencia={p}
      marketplace={marketplace}
      base={baseDaConta}
      indice={indice}
      padrao={padrao}
      registrado={registrados[p.chave] ?? null}
      aviso={extra}
      onRegistrado={(r) => {
        aplicarRegistro(r);
        setRegistrados((x) => ({ ...x, [p.chave]: r }));
      }}
    />
  );

  const resumo = pendencias.length
    ? `${pendencias.length} ${pendencias.length === 1 ? "produto precisa" : "produtos precisam"} de custo · ${formatarMoeda(Math.round(receitaTotal * 100) / 100)} de receita fora do LC/MC.`
    : "Diagnóstico da base sem produto associado — veja o detalhe abaixo.";

  const botaoReprocessar = onReprocessar ? (
    <button type="button" className={`vf-btn ${correcoes > 0 ? "vf-btn--primary" : "vf-btn--secondary"} vf-btn--sm`} disabled={reprocessando} onClick={onReprocessar}>
      {reprocessando ? "Reprocessando…" : "Reprocessar fechamento"}
    </button>
  ) : null;

  const diagnostico =
    semLinha.length > 0 ? (
      <details className="vf-fin-disclosure">
        <summary>Diagnóstico da base ({semLinha.length})</summary>
        <ul className="vf-fin-leitura">
          {semLinha.slice(0, 200).map((g, i) => (
            <li key={i} className="vf-fin-leitura__item is-warning">
              <span className="vf-mono">{GAP_TIPO_LABEL[g.type] || "ID"}: {String(g.value ?? "—")}</span> — {motivoDoGap(g)}
            </li>
          ))}
        </ul>
      </details>
    ) : null;

  const avisoCorrecoes =
    correcoes > 0 ? (
      <div className="vf-banner is-success vf-banner--compact" role="status">
        <div className="vf-banner__content">
          <p className="vf-banner__description">
            {correcoes === 1 ? "1 custo foi registrado" : `${correcoes} custos foram registrados`} na base. O fechamento só reflete depois de <strong>reprocessar</strong>.
          </p>
        </div>
      </div>
    ) : null;

  // ── Sem a base desta conta: nada pode ser gravado daqui ────────────────────
  if (!grupos) {
    const motivoSemBase = !marketplaceSuportado
      ? "este marketplace não corrige custo por aqui."
      : processamento?.costsSource !== "base"
        ? "este processamento usou a planilha de custos enviada, não a base vinculada da conta — corrigir a base não mudaria nada. Corrija a planilha de custos e reprocesse."
        : !baseDoProcessamento
          ? "a base usada no processamento não é a vinculada a esta operação."
          : leituraBase === "carregando" || leituraBase === "idle"
            ? "lendo a base de custos…"
            : "não foi possível ler a base de custos agora. Tente reprocessar ou corrija em Bases de Custo.";
    const visiveis = verTodas ? pendencias : pendencias.slice(0, MAX_VISIVEIS);
    return (
      <SecaoFinanceira id="pendencias" titulo="Pendências de custo" descricao={resumo}>
        <div className="vf-banner is-info vf-banner--compact" role="status">
          <div className="vf-banner__content">
            <p className="vf-banner__description">
              <strong>Correção direta indisponível neste fechamento:</strong> {motivoSemBase}
            </p>
          </div>
        </div>
        {pendencias.length > 0 && (
          <div className="vf-table-wrap vf-table-scroll vf-fin-pendencias__tabela">
            <table className="vf-table vf-table--compact" aria-label="Produtos com pendência de custo">
              <CabecalhoTabela />
              <tbody>{visiveis.map((p) => linhaDaPendencia(p))}</tbody>
            </table>
          </div>
        )}
        {pendencias.length > MAX_VISIVEIS && (
          <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setVerTodas((v) => !v)}>
            {verTodas ? "Mostrar só as maiores" : `Ver todas as ${pendencias.length} pendências`}
          </button>
        )}
        {pendencias.length > 0 && (
          <div className="vf-cluster">
            <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={baixarPlanilha}>
              Baixar planilha (XLSX)
            </button>
            <a className="vf-btn vf-btn--ghost vf-btn--sm" href="bases.html" target="_blank" rel="noopener noreferrer">
              Abrir Bases de Custo ↗
            </a>
          </div>
        )}
        <div className="vf-fin-pendencias__rodape">
          <span className="vf-field__hint">Depois de corrigir os custos, reprocesse o fechamento.</span>
          {botaoReprocessar}
        </div>
        {diagnostico}
      </SecaoFinanceira>
    );
  }

  // ── Com a base: os três grupos ──────────────────────────────────────────────
  const nomeBase = baseDaConta.nome || baseDaConta.slug;
  const { contagem, modo, modoPadrao, corrigiveis, decisao, bloqueadas, mesmoItem } = grupos;
  const agoraVisiveis = verTodas ? grupos.agora : grupos.agora.slice(0, MAX_VISIVEIS);
  const avisoMesmoItem = (p) =>
    mesmoItem[p.chave] && !registrados[p.chave]
      ? `${mesmoItem[p.chave]} pendências apontam para o mesmo registro da base${marketplace === "shopee" ? " (mesmo Item e Model)" : ""} — salvar esta substitui o custo gravado na outra.`
      : null;

  let explicacaoAgora;
  if (modo === "portal" && corrigiveis.length) {
    explicacaoAgora = `Cada linha aponta para um único registro da base ${nomeBase} (ou para um registro novo): digite o custo, confira o imposto e salve. Grava na base vinculada — o fechamento muda quando você reprocessar.`;
  } else if (corrigiveis.length) {
    explicacaoAgora = `${qtd(corrigiveis.length, "pendência corrigível está", "pendências corrigíveis estão")} no grupo da planilha: são muitas para digitar uma a uma.`;
  } else {
    explicacaoAgora = "Nenhuma pendência pode ser gravada direto daqui com segurança — veja o grupo 3.";
  }

  let explicacaoPlanilha;
  if (modo === "planilha") {
    explicacaoPlanilha = `${modoPadrao === "planilha" ? `São ${corrigiveis.length} pendências — mais rápido por planilha. ` : ""}Baixe a planilha, preencha o Novo custo e envie aqui mesmo: a base ${nomeBase} é atualizada sem sair do Financeiro.`;
  } else if (corrigiveis.length && modoPadrao === "planilha") {
    explicacaoPlanilha = `São ${corrigiveis.length} pendências — por planilha costuma ser mais rápido: baixe, preencha o Novo custo e importe aqui mesmo.`;
  } else if (corrigiveis.length) {
    explicacaoPlanilha = `São poucas — corrigir no portal (grupo 1) é mais rápido. Prefere preencher numa planilha? Ela traz as ${qtd(corrigiveis.length, "pendência corrigível", "pendências corrigíveis")} e você a importa aqui mesmo.`;
  } else {
    explicacaoPlanilha = "Nada a corrigir por planilha: as pendências restantes estão bloqueadas ou dependem de decisão.";
  }

  return (
    <SecaoFinanceira id="pendencias" titulo="Pendências de custo" descricao={resumo}>
      <ul className="vf-fin-pend-resumo" aria-label="Resumo das pendências">
        <li data-grupo="agora"><strong>{contagem.agora}</strong> {contagem.agora === 1 ? "corrigível agora no portal" : "corrigíveis agora no portal"}</li>
        <li data-grupo="planilha"><strong>{contagem.planilha}</strong> por planilha (importação)</li>
        <li data-grupo="bloqueadas"><strong>{contagem.bloqueadas}</strong> {contagem.bloqueadas === 1 ? "bloqueada ou depende de decisão" : "bloqueadas ou dependem de decisão"}</li>
      </ul>

      {avisoCorrecoes}

      <Grupo id="agora" numero="1" titulo="Corrigir agora no portal" contagem={contagem.agora} explicacao={explicacaoAgora}>
        {grupos.agora.length > 0 && (
          <div className="vf-table-wrap vf-table-scroll vf-fin-pendencias__tabela">
            <table className="vf-table vf-table--compact" aria-label="Pendências para corrigir agora">
              <CabecalhoTabela />
              <tbody>{agoraVisiveis.map((p) => linhaDaPendencia(p, avisoMesmoItem(p)))}</tbody>
            </table>
          </div>
        )}
        {grupos.agora.length > MAX_VISIVEIS && (
          <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setVerTodas((v) => !v)}>
            {verTodas ? "Mostrar só as maiores" : `Ver todas as ${grupos.agora.length} pendências`}
          </button>
        )}
        {modo === "planilha" && corrigiveis.length > 0 && (
          <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setPreferencia("portal")}>
            Corrigir as {corrigiveis.length} aqui no portal mesmo assim
          </button>
        )}
      </Grupo>

      <Grupo id="planilha" numero="2" titulo="Corrigir por planilha (importação)" contagem={contagem.planilha} explicacao={explicacaoPlanilha}>
        {modo === "planilha" ? (
          <CorrecaoEmLote
            marketplace={marketplace}
            base={baseDaConta}
            itensBase={itens}
            pendencias={corrigiveis}
            planilha={{ incluidas: paraPlanilha.length, foraDoLote: contagem.bloqueadas }}
            onBaixar={baixarPlanilha}
            onAplicado={({ gravadas }) => {
              setGravadasLote((n) => n + gravadas);
              carregarBase();
            }}
            onReprocessar={onReprocessar}
            reprocessando={reprocessando}
            gravadas={correcoes}
          />
        ) : (
          corrigiveis.length > 0 && (
            <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={() => setPreferencia("planilha")}>
              Corrigir as {corrigiveis.length} por planilha
            </button>
          )
        )}
      </Grupo>

      <Grupo
        id="bloqueadas"
        numero="3"
        titulo="Bloqueadas / dependem de decisão"
        contagem={contagem.bloqueadas}
        explicacao={
          contagem.bloqueadas
            ? "Não podem ser gravadas com segurança sem uma escolha sua — ou sem corrigir fora daqui. Cada linha diz o motivo e o que fazer."
            : "Nenhuma pendência bloqueada."
        }
      >
        {decisao.length > 0 && (
          <div className="vf-stack vf-stack--sm" data-subgrupo="decisao">
            <h5 className="vf-fin-pend-grupo__subtitulo">Dependem de decisão ({decisao.length})</h5>
            <p className="vf-field__hint">
              O Item já tem na base o registro de outra variação: escolha qual registro atualizar. Nada é gravado sem a sua escolha.
            </p>
            <div className="vf-table-wrap vf-table-scroll vf-fin-pendencias__tabela">
              <table className="vf-table vf-table--compact" aria-label="Pendências que dependem de decisão">
                <CabecalhoTabela />
                <tbody>{decisao.map(({ pendencia }) => linhaDaPendencia(pendencia))}</tbody>
              </table>
            </div>
          </div>
        )}
        {bloqueadas.length > 0 && (
          <div className="vf-stack vf-stack--sm" data-subgrupo="bloqueadas">
            <h5 className="vf-fin-pend-grupo__subtitulo">Bloqueadas ({bloqueadas.length})</h5>
            <div className="vf-table-wrap vf-table-scroll vf-fin-pendencias__tabela">
              <table className="vf-table vf-table--compact" aria-label="Pendências bloqueadas">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Identificação</th>
                    <th>Motivo da pendência</th>
                    <th className="is-numeric">Receita impactada</th>
                    <th>Por que não dá para corrigir aqui</th>
                  </tr>
                </thead>
                <tbody>
                  {bloqueadas.map(({ pendencia: p, motivo }) => (
                    <tr key={p.chave} data-pendencia={p.statusCusto} data-identidade="insuficiente">
                      <td><span className="vf-fin-clamp" title={p.produto || undefined}>{p.produto || "—"}</span></td>
                      <td className="vf-mono vf-fin-ids">{idsDa(p).length ? idsDa(p).map((t) => <span key={t}>{t}</span>) : "—"}</td>
                      <td>{p.motivo}</td>
                      <td className="is-numeric">{formatarValor(p.receitaImpactada)}</td>
                      <td className="vf-fin-pend-bloqueio">{motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <a className="vf-btn vf-btn--ghost vf-btn--sm vf-fin-pend-bases" href="bases.html" target="_blank" rel="noopener noreferrer">
              Abrir Bases de Custo ↗
            </a>
          </div>
        )}
      </Grupo>

      {/* Um único Reprocessar: no passo 5 da planilha quando ela está aberta,
          senão aqui no rodapé. */}
      {modo !== "planilha" && (
        <div className="vf-fin-pendencias__rodape">
          <span className="vf-field__hint">
            {correcoes > 0
              ? `${correcoes} ${correcoes === 1 ? "correção feita" : "correções feitas"} na base. Reprocesse para refletir no fechamento.`
              : "Depois de corrigir a base, reprocesse o fechamento."}
          </span>
          {botaoReprocessar}
        </div>
      )}

      {diagnostico}
    </SecaoFinanceira>
  );
}
