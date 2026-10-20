// frontend-react/src/components/financeiro/mesa/ProdutosMesa.jsx
//
// Produtos do fechamento em LARGURA TOTAL, abaixo da mesa (modelo B): busca à
// esquerda dos filtros por status, uma lista em grade única (como a de
// Anúncios ML) ordenada por receita e linhas que expandem para a composição
// do produto. As linhas são as COMPLETAS do processamento em memória —
// milhares no Order.all —, então a lista é paginada.
//
// Sem rolagem horizontal: as colunas secundárias (Un., Repasse, Imposto)
// saem conforme a largura da lista (container query em financeiro.css) e
// continuam visíveis na linha expandida.

import { useMemo, useState } from "react";
import { contarPorFiltro, filtrarLinhas, FILTROS_PRODUTO } from "../../../utils/financeiro/produtos.js";
import { numOuNull } from "../../../utils/financeiro/resumoFechamento.js";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";
import { ProdutoFinanceiroStatus } from "../produtos/ProdutoFinanceiroStatus.jsx";

const TAMANHOS_PAGINA = [25, 50, 100];
// Os cinco recortes do modelo B ficam sempre à vista; os demais (custo
// ambíguo, aguardando financeiro, cancelados) só quando existem linhas — é o
// que mantém a busca e os filtros na mesma linha.
const FILTROS_SEMPRE = new Set(["todos", "saudaveis", "atencao", "criticos", "sem_custo"]);
const POR_PAGINA_PADRAO = 25;

const CHEVRON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Ordem por receita (maior primeiro). Só a ordem de exibição — nenhum valor
// muda. Sem receita vai para o fim, na ordem do motor.
function porReceita(linhas) {
  return linhas
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const ra = numOuNull(a.l.receita);
      const rb = numOuNull(b.l.receita);
      if (ra === null && rb === null) return a.i - b.i;
      if (ra === null) return 1;
      if (rb === null) return -1;
      return rb - ra || a.i - b.i;
    })
    .map((x) => x.l);
}

function sigla(l) {
  const base = l.sku || l.titulo || l.itemId || "";
  const limpo = String(base).replace(/[^0-9A-Za-zÀ-ú]/g, "");
  return limpo.slice(0, 3).toUpperCase() || "—";
}

// Custo da coluna: o total da linha; sem total, o unitário (dito como /un).
function custo(l) {
  if (numOuNull(l.custoTotal) !== null) return formatarValor(l.custoTotal, "moeda");
  if (numOuNull(l.custoUnitario) !== null) return `${formatarValor(l.custoUnitario, "moeda")}/un`;
  return formatarValor(null);
}

// Imposto da coluna: o valor; sem valor, o percentual.
function imposto(l) {
  if (numOuNull(l.impostoValor) !== null) return formatarValor(l.impostoValor, "moeda");
  if (numOuNull(l.impostoPercentual) !== null) return formatarValor(l.impostoPercentual, "pontos");
  return formatarValor(null);
}

// MC em pontos, pintada pela mesma faixa do status (relatório público).
function tomDaMc(mc) {
  const n = numOuNull(mc);
  if (n === null) return "neutro";
  if (n < 0) return "critico";
  if (n < 15) return "atencao";
  return "saudavel";
}

const DETALHES = [
  ["pedidoId", "Pedido", "texto"],
  ["itemId", "Item ID", "texto"],
  ["sku", "SKU", "texto"],
  ["modelId", "Model ID", "texto"],
  ["unidades", "Unidades", "numero"],
  ["receita", "Receita", "moeda"],
  ["repasse", "Repasse / líquido", "moeda"],
  ["custoUnitario", "Custo unitário", "moeda"],
  ["custoTotal", "Custo total", "moeda"],
  ["impostoPercentual", "Imposto %", "pontos"],
  ["impostoValor", "Imposto", "moeda"],
  ["lc", "LC", "moeda"],
  ["mc", "MC", "pontos"],
];

// Composição do produto: os totais da linha como barras sobre a receita.
function ComposicaoDoProduto({ l }) {
  const receita = numOuNull(l.receita);
  const degraus = [
    ["Receita", l.receita, "is-total"],
    ["Repasse / líquido", l.repasse, "is-total"],
    ["Custo total", l.custoTotal, "is-saida"],
    ["Imposto", l.impostoValor, "is-saida"],
    ["LC", l.lc, numOuNull(l.lc) !== null && l.lc < 0 ? "is-negativo" : "is-final"],
  ].filter(([, v]) => numOuNull(v) !== null);
  if (!degraus.length) return null;
  return (
    <div className="vf-fin-mesa-cascata__degraus is-compacta" role="list">
      {degraus.map(([rotulo, v, classe]) => {
        const largura = receita ? Math.min(100, (Math.abs(v) / Math.abs(receita)) * 100) : 0;
        return (
          <div key={rotulo} className="vf-fin-mesa-cascata__degrau" role="listitem">
            <span className="vf-fin-mesa-cascata__rotulo">{rotulo}</span>
            <span className="vf-fin-mesa-cascata__trilho" aria-hidden="true">
              <span className={`vf-fin-mesa-cascata__barra ${classe}`} style={{ left: 0, width: `${Math.max(largura, 0.5)}%` }} />
            </span>
            <span className="vf-fin-mesa-cascata__valor">{formatarValor(v, "moeda")}</span>
          </div>
        );
      })}
    </div>
  );
}

function LinhaExpandida({ l }) {
  const itens = DETALHES.filter(([k]) => l[k] !== null && l[k] !== undefined && l[k] !== "");
  return (
    <div className="vf-fin-mesa-produto__detalhe">
      <div>
        <p className="vf-fin-mesa__rotulo-grupo">Composição do produto</p>
        <ComposicaoDoProduto l={l} />
        {l.statusPedido && <p className="vf-field__hint">Status do pedido: {l.statusPedido}</p>}
      </div>
      <dl className="vf-fin-mesa-produto__dados">
        {itens.map(([k, rotulo, tipo]) => (
          <div key={k}>
            <dt>{rotulo}</dt>
            <dd className={tipo === "texto" ? "vf-mono" : undefined}>{tipo === "texto" ? l[k] : formatarValor(l[k], tipo)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// `pedido` = { filtro, seq }: o aviso de pendências pede um recorte de fora
// ("Sem custo"); cada novo `seq` reaplica, mesmo que o filtro seja o mesmo.
export function ProdutosMesa({ linhas, pedido = null, amostra = false, id = "produtos" }) {
  const [filtro, setFiltro] = useState(pedido?.filtro || "todos");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [porPagina, setPorPagina] = useState(POR_PAGINA_PADRAO);
  const [aberta, setAberta] = useState(null);

  const ordenadas = useMemo(() => porReceita(linhas), [linhas]);
  const contagem = useMemo(() => contarPorFiltro(linhas), [linhas]);
  const filtradas = useMemo(() => filtrarLinhas(ordenadas, { filtro, busca }), [ordenadas, filtro, busca]);
  const filtros = FILTROS_PRODUTO.filter((f) => FILTROS_SEMPRE.has(f.id) || contagem[f.id] > 0 || filtro === f.id);

  const [seqAplicado, setSeqAplicado] = useState(pedido?.seq ?? null);
  if (pedido && pedido.seq !== seqAplicado) {
    setSeqAplicado(pedido.seq);
    setFiltro(pedido.filtro);
    setBusca("");
    setPagina(0);
    setAberta(null);
  }

  if (!linhas.length) return null;

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const visiveis = filtradas.slice(paginaAtual * porPagina, (paginaAtual + 1) * porPagina);
  const mudar = (fn) => (v) => { fn(v); setPagina(0); setAberta(null); };

  return (
    <section className="vf-fin-mesa-produtos" id={id} aria-labelledby="vf-fin-produtos-titulo">
      <header className="vf-fin-mesa-produtos__cabecalho">
        <h3 className="vf-fin-mesa__titulo" id="vf-fin-produtos-titulo">Produtos</h3>
        <p className="vf-fin-mesa__descricao">
          {amostra
            ? `Amostra de ${linhas.length.toLocaleString("pt-BR")} linhas gravadas no fechamento salvo. Processe de novo para ver todas.`
            : "Ordenados por receita. Clique numa linha para ver a composição."}
        </p>
      </header>

      <div className="vf-fin-mesa-produtos__ferramentas">
        <input
          type="search"
          className="vf-input vf-search vf-fin-mesa-produtos__busca"
          placeholder="Título, MLB ou SKU"
          aria-label="Buscar produto"
          value={busca}
          onChange={(e) => mudar(setBusca)(e.target.value)}
        />
        <div className="vf-fin-mesa-filtros" role="group" aria-label="Filtrar produtos">
          {filtros.map((f) => (
            <button
              key={f.id}
              type="button"
              className="vf-fin-mesa-filtros__item"
              aria-pressed={filtro === f.id}
              onClick={() => mudar(setFiltro)(f.id)}
            >
              {f.label}
              <span className={`vf-fin-mesa-filtros__contagem is-${f.id}`}>{(contagem[f.id] ?? 0).toLocaleString("pt-BR")}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="vf-fin-mesa-lista" aria-label="Produtos do fechamento">
        <div className="vf-fin-mesa-lista__cabecalho" aria-hidden="true">
          <span />
          <span>Produto</span>
          <span>Status</span>
          <span className="is-num">Un.</span>
          <span className="is-num">Receita</span>
          <span className="is-num">Repasse</span>
          <span className="is-num">Custo</span>
          <span className="is-num">Imposto</span>
          <span className="is-num">LC</span>
          <span className="is-num">MC</span>
          <span />
        </div>
        {visiveis.length === 0 ? (
          <div className="vf-empty vf-empty--compact">
            <p className="vf-empty__description">Nenhum produto neste filtro.</p>
          </div>
        ) : (
          visiveis.map((l, i) => {
            const chave = `${paginaAtual}-${i}`;
            const expandida = aberta === chave;
            const ids = [l.pedidoId ? `Pedido ${l.pedidoId}` : null, l.itemId, l.sku ? `SKU ${l.sku}` : null, l.modelId ? `Model ${l.modelId}` : null].filter(Boolean);
            return (
              <div key={chave} className={`vf-fin-mesa-produto${expandida ? " is-aberta" : ""}`}>
                <div
                  className="vf-fin-mesa-lista__linha"
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandida}
                  onClick={() => setAberta(expandida ? null : chave)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setAberta(expandida ? null : chave);
                    }
                  }}
                >
                  <span className="vf-fin-mesa-produto__sigla" aria-hidden="true">{sigla(l)}</span>
                  <span className="vf-fin-mesa-produto__principal">
                    <span className="vf-fin-mesa-produto__titulo" title={l.titulo || undefined}>{l.titulo || "—"}</span>
                    {ids.length > 0 && (
                      <span className="vf-fin-mesa-produto__ids">
                        {ids.map((t) => <span key={t} className="vf-mono">{t}</span>)}
                      </span>
                    )}
                  </span>
                  <span><ProdutoFinanceiroStatus linha={l} /></span>
                  <span className="is-num">{formatarValor(l.unidades, "numero")}</span>
                  <span className="is-num">{formatarValor(l.receita, "moeda")}</span>
                  <span className="is-num">{formatarValor(l.repasse, "moeda")}</span>
                  <span className="is-num">{custo(l)}</span>
                  <span className="is-num">{imposto(l)}</span>
                  <span className="is-num is-forte">{formatarValor(l.lc, "moeda")}</span>
                  <span className={`is-num vf-fin-mesa-produto__mc is-${tomDaMc(l.mc)}`}>{formatarValor(l.mc, "pontos")}</span>
                  <span className="vf-fin-mesa-produto__chevron" aria-hidden="true">{CHEVRON}</span>
                </div>
                {expandida && <LinhaExpandida l={l} />}
              </div>
            );
          })
        )}
        <div className="vf-fin-mesa-lista__rodape">
          <span>
            {filtradas.length.toLocaleString("pt-BR")} de {linhas.length.toLocaleString("pt-BR")} linhas
            {filtradas.length > 0 &&
              ` · mostrando ${(paginaAtual * porPagina + 1).toLocaleString("pt-BR")}–${Math.min((paginaAtual + 1) * porPagina, filtradas.length).toLocaleString("pt-BR")}`}
          </span>
          <div className="vf-cluster">
            <label className="vf-cluster">
              <span className="vf-field__hint">Linhas por página</span>
              <select
                className="vf-input vf-input--sm"
                aria-label="Linhas por página"
                value={porPagina}
                onChange={(e) => mudar(setPorPagina)(Number(e.target.value))}
              >
                {TAMANHOS_PAGINA.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {totalPaginas > 1 && (
              <>
                <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" disabled={paginaAtual === 0} onClick={() => { setPagina(paginaAtual - 1); setAberta(null); }}>
                  Anterior
                </button>
                <span className="vf-field__hint">Página {paginaAtual + 1} de {totalPaginas}</span>
                <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" disabled={paginaAtual >= totalPaginas - 1} onClick={() => { setPagina(paginaAtual + 1); setAberta(null); }}>
                  Próxima
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
