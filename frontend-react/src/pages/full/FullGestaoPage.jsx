// Central do Full — modelo C (abas + painel de atenção), na linguagem da
// página Anúncios ML. Fase 1: abas "Estoque no Full" e "Reposição sugerida"
// sobre o snapshot que já existe (estoque, vendas 14d, cobertura, sugestão),
// mais preço, foto e custo da Base. A aba de envios entra na fase 2 — ver
// docs/AUDITORIA_CENTRAL_FULL_MODELO_C_FONTES_DE_DADOS.md.
//
// Cliente e conta vêm do Shell V3 (data-vf-scope="account"), como em Anúncios
// ML: a tela não tem seletor próprio. Sem conta pronta, o Shell mostra o
// próprio estado e esta ilha não renderiza nada.
//
// Sem múltiplas coletas simultâneas: KPIs, painel, listas e drawer usam o
// MESMO `dados` de `useFullSnapshot`; o drawer faz a própria busca (detalhe +
// movimentos) só quando um inventário é aberto.

import { useMemo, useState } from "react";
import { useFullSnapshot } from "../../hooks/useFullSnapshot.js";
import { useOperacaoAtual } from "../../hooks/useVfContext.js";
import { computeFullSummary, filterInventories, ordenarPorUrgencia } from "../../utils/fullSummary.js";
import { VFEmpty, VFLoading } from "../../components/ui/VFEstados/index.js";
import { VFTabs } from "../../components/ui/VFTabs/index.js";
import FullClienteCard from "../../components/full/FullClienteCard.jsx";
import FullKpiStrip from "../../components/full/FullKpiStrip.jsx";
import FullAtencaoPainel from "../../components/full/FullAtencaoPainel.jsx";
import FullEstoqueLista from "../../components/full/FullEstoqueLista.jsx";
import FullReposicaoAba from "../../components/full/FullReposicaoAba.jsx";
import FullInventoryDrawer from "../../components/full/FullInventoryDrawer.jsx";
import FullErrorState from "../../components/full/FullErrorState.jsx";
import { formatarNumero } from "../../utils/numbers.js";
import { quantidadeSugerida } from "../../utils/fullReposicao.js";

const ROTULO_KPI = {
  comEstoque: "Com estoque",
  ruptura: "Sem estoque",
  critico: "Crítico",
  repor: "Repor",
  parado: "Excesso / sem giro",
  semCusto: "Sem custo",
};

const ORDENACOES = {
  disponivel: {
    rotulo: "Mais disponível no Full",
    ordenar: (lista) =>
      [...lista].sort(
        (a, b) =>
          (b.stock?.available ?? -1) - (a.stock?.available ?? -1) ||
          (b.sales?.total14d ?? -1) - (a.sales?.total14d ?? -1)
      ),
  },
  urgencia: { rotulo: "Urgência (cobertura)", ordenar: ordenarPorUrgencia },
  vendas: {
    rotulo: "Mais vendidos 14d",
    ordenar: (lista) => [...lista].sort((a, b) => (b.sales?.total14d ?? -1) - (a.sales?.total14d ?? -1)),
  },
  custo: {
    rotulo: "Maior custo em estoque",
    ordenar: (lista) => [...lista].sort((a, b) => (b.stockCost ?? -1) - (a.stockCost ?? -1)),
  },
};

export default function FullGestaoPage() {
  const operacao = useOperacaoAtual();
  // Marketplace é cache de exibição do Shell; ausente não é motivo para
  // esconder a tela (o backend recusa conta que não for Mercado Livre).
  const ehMeli = !operacao.marketplace || operacao.marketplace === "meli";
  const clienteContaId = operacao.pronta && ehMeli ? operacao.clienteContaId : null;

  const { dados, carregando, erro, recarregar } = useFullSnapshot(clienteContaId);
  const [aba, setAba] = useState("estoque");
  const [kpisAtivos, setKpisAtivos] = useState([]);
  const [busca, setBusca] = useState("");
  const [ordenacao, setOrdenacao] = useState("disponivel");
  const [inventoryIdSelecionado, setInventoryIdSelecionado] = useState(null);

  const inventories = dados?.inventories ?? [];
  const resumo = useMemo(() => (dados ? computeFullSummary(dados.inventories) : null), [dados]);
  const custosDisponiveis = dados?.quality?.sources?.costs?.status === "ok";
  const listaEstoque = useMemo(
    () => ORDENACOES[ordenacao].ordenar(filterInventories(inventories, { search: busca, kpis: kpisAtivos })),
    [inventories, busca, kpisAtivos, ordenacao]
  );
  const totalSugestoes = useMemo(
    () => inventories.filter((inv) => quantidadeSugerida(inv, 30) > 0).length,
    [inventories]
  );

  if (!operacao.pronta) return null;

  function alternarKpi(chave) {
    setKpisAtivos((atual) => (atual.includes(chave) ? atual.filter((k) => k !== chave) : [...atual, chave]));
    setAba("estoque");
  }

  function filtrarPeloPainel(chave) {
    setKpisAtivos((atual) => (atual.length === 1 && atual[0] === chave ? [] : [chave]));
  }

  const abas = (
    <div className="full-abas">
      <VFTabs
        ariaLabel="Seções da Central do Full"
        value={aba}
        onValueChange={setAba}
        tabs={[
          {
            value: "estoque",
            label: (
              <>
                Estoque no Full <span className="vf-badge">{formatarNumero(inventories.length)}</span>
              </>
            ),
          },
          {
            value: "reposicao",
            label: (
              <>
                Reposição sugerida <span className="vf-badge">{formatarNumero(totalSugestoes)}</span>
              </>
            ),
          },
        ]}
      />
    </div>
  );

  return (
    <div className="vf-page-shell full-page">
      <div className="vf-page-container vf-page-container--wide full-pilha">
        <header className="vf-page-header">
          <div className="vf-page-header__main">
            <p className="vf-page-header__eyebrow">Mercado Livre</p>
            <h1 className="vf-page-header__title">Central do Full</h1>
            <p className="vf-page-header__description">
              Acompanhe o estoque no Full e planeje as reposições de cada cliente.
            </p>
          </div>
          {ehMeli && dados ? (
            <div className="vf-page-header__actions">
              <button type="button" className="vf-btn vf-btn--primary" onClick={() => setAba("reposicao")}>
                Planejar novo envio
              </button>
            </div>
          ) : null}
        </header>

        {!ehMeli ? (
          <VFEmpty title="A Central do Full é do Mercado Livre">
            A conta escolhida não é do Mercado Livre. Troque para uma conta Mercado Livre na barra lateral.
          </VFEmpty>
        ) : null}

        {clienteContaId && erro && !dados ? <FullErrorState erro={erro} onTentarNovamente={recarregar} /> : null}

        {clienteContaId && !dados && !erro && carregando ? (
          <VFLoading label="Lendo o estoque Full da conta…">
            <span className="vf-field__hint">
              A primeira leitura pode levar alguns segundos (anúncios, estoque e operações no Mercado Livre).
            </span>
          </VFLoading>
        ) : null}

        {clienteContaId && dados ? (
          <>
            {erro ? (
              <p className="vf-alert is-danger" role="alert">
                Não foi possível atualizar agora ({erro.mensagem}). Mostrando a última leitura boa.
              </p>
            ) : null}
            {!erro && dados.cache?.stale ? (
              <p className="vf-alert is-warning" role="status">
                Dados desatualizados: a última leitura falhou ou está pendente. Os números abaixo são da última leitura boa.
              </p>
            ) : null}
            {dados.quality?.status === "partial" ? (
              <p className="vf-alert is-warning" role="status">
                Leitura parcial: parte dos anúncios, do estoque ou das operações não pôde ser lida desta vez. Valores
                ausentes aparecem como “—”, nunca como zero inventado.
              </p>
            ) : null}

            <FullClienteCard
              clienteNome={operacao.clienteNome}
              conta={operacao.snapshot.meta}
              dados={dados}
              carregando={carregando}
              onAtualizar={recarregar}
            />
            <FullKpiStrip
              resumo={resumo}
              kpisAtivos={kpisAtivos}
              onAlternar={alternarKpi}
              custosDisponiveis={custosDisponiveis}
            />

            {inventories.length === 0 ? (
              <VFEmpty compact title="Nenhum produto no Full">
                Esta conta não tem anúncios com estoque no Full nesta leitura.
              </VFEmpty>
            ) : aba === "estoque" ? (
              <div className="full-layout">
                <FullAtencaoPainel
                  resumo={resumo}
                  kpisAtivos={kpisAtivos}
                  onFiltrar={filtrarPeloPainel}
                  onPlanejar={() => setAba("reposicao")}
                  custosDisponiveis={custosDisponiveis}
                />
                <section className="vf-card full-principal">
                  {abas}
                  <div className="full-toolbar">
                    <div className="full-toolbar__filtros">
                      <div className="vf-field">
                        <label className="vf-field__label" htmlFor="full-busca">Buscar produtos</label>
                        <input
                          id="full-busca"
                          type="search"
                          className="vf-input vf-search"
                          placeholder="Título, MLB ou SKU"
                          value={busca}
                          onChange={(e) => setBusca(e.target.value)}
                        />
                      </div>
                      <div className="vf-field">
                        <label className="vf-field__label" htmlFor="full-ordenacao">Ordenar por</label>
                        <select
                          id="full-ordenacao"
                          className="vf-select"
                          value={ordenacao}
                          onChange={(e) => setOrdenacao(e.target.value)}
                        >
                          {Object.entries(ORDENACOES).map(([valor, { rotulo }]) => (
                            <option key={valor} value={valor}>
                              {rotulo}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {kpisAtivos.length > 0 ? (
                      <div className="full-toolbar__ativos">
                        <span className="vf-tag is-primary">
                          Filtros: {kpisAtivos.map((k) => ROTULO_KPI[k]).join(", ")}
                        </span>
                        <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setKpisAtivos([])}>
                          Limpar
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <FullEstoqueLista
                    key={`${busca}|${kpisAtivos.join(",")}|${ordenacao}`}
                    inventories={listaEstoque}
                    onDetalhar={setInventoryIdSelecionado}
                  />
                </section>
              </div>
            ) : (
              <FullReposicaoAba
                inventories={inventories}
                cabecalho={abas}
                clienteSlug={operacao.clienteSlug}
                custosDisponiveis={custosDisponiveis}
              />
            )}
          </>
        ) : null}
      </div>

      {inventoryIdSelecionado ? (
        <FullInventoryDrawer
          clienteContaId={clienteContaId}
          inventoryId={inventoryIdSelecionado}
          onFechar={() => setInventoryIdSelecionado(null)}
        />
      ) : null}
    </div>
  );
}
