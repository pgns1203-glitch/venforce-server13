// frontend-react/src/pages/PainelContasPage.jsx
//
// Painel de Contas — tela operacional da carteira. Escopo GLOBAL
// (data-vf-scope="global", como Carteira/Clientes). Autorização inteira no
// servidor (GET /painel-contas); todo filtro daqui é preferência de exibição.
//
// Contrato de leitura em 10 segundos:
//   - QUAL competência estou vendo (cabeçalho + seletor);
//   - quantos estão com dados / sem dados / parciais / manuais / pedem ação;
//   - por cliente: o número é consolidado ou de uma conta, de quantas contas,
//     de que fonte, atualizado quando e até que dia — ou, sem número, POR QUÊ.
//
// Layout: container WIDE + densidade compacta. Header e toolbar são fixos em
// altura; só a tabela cresce.

import { useCallback, useState } from "react";
import { usePainelContas } from "../hooks/usePainelContas.js";
import { ToolbarPainel, OPCOES_STATUS } from "../components/painelContas/ToolbarPainel.jsx";
import { useGruposDeColunas } from "../components/painelContas/MenuColunas.jsx";
import { TabelaHierarquica, useExpansao } from "../components/painelContas/TabelaHierarquica.jsx";
import { LancamentoManualDrawer } from "../components/painelContas/LancamentoManualDrawer.jsx";
import { colunasVisiveis } from "../components/painelContas/colunas.js";
import { rotularCompetencia, rotularCompetenciaCurta } from "../utils/dates.js";

// Situações diferentes, mensagens diferentes. "Nenhum resultado" para tudo
// obriga a pessoa a descobrir sozinha o que aconteceu.
function EstadoVazio({ busca, squadId, status, competencia, squadsDisponiveis, onLimpar }) {
  if (busca.trim()) {
    return (
      <div className="vf-empty">
        <p className="vf-empty__title">Nenhum cliente para “{busca.trim()}”</p>
        <p className="vf-empty__description">A busca cobre nome e slug do cliente, dentro da sua carteira.</p>
        <div className="vf-empty__actions">
          <button type="button" className="vf-btn vf-btn--sm" onClick={onLimpar}>Limpar filtros</button>
        </div>
      </div>
    );
  }

  if (squadId != null) {
    const squad = squadsDisponiveis.find((s) => s.id === squadId);
    return (
      <div className="vf-empty">
        <p className="vf-empty__title">{squad ? `Nenhum cliente no squad ${squad.nome}` : "Nenhum cliente neste squad"}</p>
        <p className="vf-empty__description">Nenhum cliente da sua carteira está vinculado a este squad agora.</p>
        <div className="vf-empty__actions">
          <button type="button" className="vf-btn vf-btn--sm" onClick={onLimpar}>Ver todos os squads</button>
        </div>
      </div>
    );
  }

  if (status && status !== "todos") {
    const rotulo = (OPCOES_STATUS.find((o) => o.valor === status)?.rotulo || status).toLowerCase();
    return (
      <div className="vf-empty">
        <p className="vf-empty__title">Nenhum cliente {rotulo} em {rotularCompetenciaCurta(competencia)}</p>
        <p className="vf-empty__description">O filtro de status vale só para a competência selecionada.</p>
        <div className="vf-empty__actions">
          <button type="button" className="vf-btn vf-btn--sm" onClick={onLimpar}>Limpar filtros</button>
        </div>
      </div>
    );
  }

  return (
    <div className="vf-empty">
      <p className="vf-empty__title">Sua carteira está vazia</p>
      <p className="vf-empty__description">
        Nenhum cliente ativo está atribuído a você no momento. Fale com o coordenador do seu squad se isso for inesperado.
      </p>
    </div>
  );
}

export default function PainelContasPage() {
  const painel = usePainelContas();
  const {
    competencia, setCompetencia, competenciaPadrao,
    squadId, setSquadId, busca, setBusca, status, setStatus,
    marketplace, setMarketplace, mostrarLegado, setMostrarLegado,
    temFiltroAtivo, limparFiltros,
    clientes, resumoCarteira, squadsDisponiveis, marketplacesDisponiveis,
    carregando, atualizando, erro, recarregar,
    mesesPorCliente, carregarMeses, semanasPorChave, carregarSemanas,
    salvarManual, removerManual,
  } = painel;

  const { grupos, alternar: alternarGrupo } = useGruposDeColunas();
  const expansao = useExpansao();
  const colunas = colunasVisiveis(grupos);
  const [lancamento, setLancamento] = useState(null); // { cliente, conta }

  const abrirLancamento = useCallback((cliente, conta) => setLancamento({ cliente, conta }), []);
  const fecharLancamento = useCallback(() => setLancamento(null), []);

  const temClientes = Boolean(clientes && clientes.length > 0);
  // Lista cheia mas ninguém com número NA COMPETÊNCIA: nota sobre a tabela, não
  // um vazio no lugar dela — os clientes existem e continuam na tela.
  const competenciaSemDado = temClientes && clientes.every((c) => !c.resumo);

  return (
    <div className="vf-page-shell vf-ph-shell" data-vf-density="compact">
      <div className="vf-page-container vf-page-container--wide vf-ph-page">
        <header className="vf-page-header vf-ph-header">
          <div className="vf-page-header__main">
            <p className="vf-page-header__eyebrow">Controle da carteira</p>
            <h1 className="vf-page-header__title">Painel de Contas</h1>
            <p className="vf-page-header__description">
              {rotularCompetencia(competencia)} · dados operacionais da carteira
            </p>
          </div>
        </header>

        {erro && !clientes && (
          <div className="vf-banner is-danger" role="alert">
            <div className="vf-banner__content">
              <p className="vf-banner__title">Não foi possível carregar o Painel de Contas</p>
              <p className="vf-banner__description">{erro.mensagem}</p>
            </div>
            <div className="vf-banner__actions">
              <button type="button" className="vf-btn vf-btn--sm" onClick={recarregar}>Tentar de novo</button>
            </div>
          </div>
        )}

        {clientes && (
          <ToolbarPainel
            busca={busca} onBusca={setBusca}
            competencia={competencia} onCompetencia={setCompetencia} competenciaPadrao={competenciaPadrao}
            squadId={squadId} onSquad={setSquadId} squadsDisponiveis={squadsDisponiveis}
            status={status} onStatus={setStatus}
            marketplace={marketplace} onMarketplace={setMarketplace} marketplacesDisponiveis={marketplacesDisponiveis}
            mostrarLegado={mostrarLegado} onMostrarLegado={setMostrarLegado}
            temFiltroAtivo={temFiltroAtivo} onLimpar={limparFiltros}
            grupos={grupos} onAlternarGrupo={alternarGrupo}
            resumoCarteira={resumoCarteira} atualizando={atualizando}
            temExpandido={expansao.temExpandido} onRecolherTudo={expansao.recolherTudo}
          />
        )}

        {!clientes && carregando && (
          <div className="vf-stack vf-ph-esqueleto">
            <div className="vf-skeleton vf-skeleton--title" />
            <div className="vf-skeleton vf-skeleton--row" />
            <div className="vf-skeleton vf-skeleton--row" />
            <div className="vf-skeleton vf-skeleton--row" />
          </div>
        )}

        {clientes && clientes.length === 0 && (
          <EstadoVazio
            busca={busca}
            squadId={squadId}
            status={status}
            competencia={competencia}
            squadsDisponiveis={squadsDisponiveis}
            onLimpar={limparFiltros}
          />
        )}

        {temClientes && (
          <>
            {competenciaSemDado && (
              <div className="vf-banner is-info vf-banner--compact" role="status">
                <div className="vf-banner__content">
                  <p className="vf-banner__description">
                    Nenhum cliente listado tem dados em {rotularCompetencia(competencia)}. Cada linha diz o motivo;
                    para ver outro mês, troque a competência — nada é preenchido com um mês diferente.
                  </p>
                </div>
              </div>
            )}

            <TabelaHierarquica
              clientes={clientes}
              competencia={competencia}
              colunas={colunas}
              grupos={grupos}
              expansao={expansao}
              mesesPorCliente={mesesPorCliente}
              carregarMeses={carregarMeses}
              semanasPorChave={semanasPorChave}
              carregarSemanas={carregarSemanas}
              atualizando={atualizando}
              onLancar={abrirLancamento}
            />

            <p className="vf-ph-rodape">
              Cada linha mostra a competência selecionada. O número do cliente é o consolidado das contas indicadas ao
              lado do nome; ao expandir, cada conta aparece com o próprio número (o mesmo da Central de Vendas para
              aquela conta). Ads é medido por cliente. Fonte API = sincronização automática; Manual = lançado pela equipe.
            </p>
          </>
        )}
      </div>

      {lancamento && (
        <LancamentoManualDrawer
          cliente={lancamento.cliente}
          contaInicial={lancamento.conta}
          competencia={competencia}
          onSalvar={salvarManual}
          onRemover={removerManual}
          onFechar={fecharLancamento}
        />
      )}
    </div>
  );
}
