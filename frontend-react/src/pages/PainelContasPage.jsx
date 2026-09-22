// frontend-react/src/pages/PainelContasPage.jsx
//
// Painel de Controle de Contas por Squad — console administrativo da
// carteira. Escopo GLOBAL (data-vf-scope="global", como Carteira/Clientes):
// não depende de Cliente+Operação escolhidos no Shell — é a própria carteira
// agrupada por Squad. Autorização inteira no servidor (GET /painel-contas);
// o filtro de Squad aqui é preferência de exibição, nunca fonte de acesso
// (Auditoria §15).
//
// Layout: container WIDE + densidade compacta. A tela tem até onze colunas
// numéricas e existe para varrer dezenas de clientes de uma vez — cabeçalho
// e filtros ocupam o mínimo, a tabela fica com todo o resto. Header e
// toolbar são fixos em altura; só a tabela cresce.
//
// O texto sobre a natureza do dado (snapshot mensal, sincronização manual)
// saiu do cabeçalho: é detalhe de sistema, não a mensagem principal de quem
// abre a tela às 8h para achar um cliente. Continua disponível onde ajuda —
// no rodapé de contexto e nos tooltips de cada métrica.

import { usePainelContas } from "../hooks/usePainelContas.js";
import { ToolbarPainel } from "../components/painelContas/ToolbarPainel.jsx";
import { useGruposDeColunas } from "../components/painelContas/MenuColunas.jsx";
import { TabelaHierarquica, useExpansao } from "../components/painelContas/TabelaHierarquica.jsx";
import { colunasVisiveis } from "../components/painelContas/colunas.js";

// §23: cinco situações diferentes, cinco mensagens diferentes. "Nenhum
// resultado" para tudo obriga a pessoa a descobrir sozinha o que aconteceu.
function EstadoVazio({ busca, squadId, squadsDoUsuario, onLimpar }) {
  if (busca.trim()) {
    return (
      <div className="vf-empty">
        <p className="vf-empty__title">Nenhum cliente para “{busca.trim()}”</p>
        <p className="vf-empty__description">
          A busca cobre nome e slug do cliente, dentro da sua carteira.
        </p>
        <div className="vf-empty__actions">
          <button type="button" className="vf-btn vf-btn--sm" onClick={onLimpar}>Limpar filtros</button>
        </div>
      </div>
    );
  }

  if (squadId != null) {
    const squad = squadsDoUsuario.find((s) => s.id === squadId);
    return (
      <div className="vf-empty">
        <p className="vf-empty__title">
          {squad ? `Nenhum cliente no squad ${squad.nome}` : "Nenhum cliente neste squad"}
        </p>
        <p className="vf-empty__description">
          O squad existe e você tem acesso a ele, mas nenhum cliente da sua carteira está vinculado a ele agora.
        </p>
        <div className="vf-empty__actions">
          <button type="button" className="vf-btn vf-btn--sm" onClick={onLimpar}>Ver todos os squads</button>
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
  const {
    ano, setAno, squadId, setSquadId, busca, setBusca,
    anoPadrao, temFiltroAtivo, limparFiltros,
    squadsDoUsuario, clientes, carregando, atualizando, erro, recarregar,
    mesesPorCliente, carregarMeses, semanasPorChave, carregarSemanas,
  } = usePainelContas();

  const { grupos, alternar: alternarGrupo } = useGruposDeColunas();
  const expansao = useExpansao();
  const colunas = colunasVisiveis(grupos);

  const temClientes = Boolean(clientes && clientes.length > 0);
  // Lista cheia mas nenhum resumo: não é carteira vazia nem filtro sem
  // resultado — é o ANO escolhido que não tem snapshot. Isso é uma nota
  // sobre a tabela, não um vazio no lugar dela: os clientes existem e
  // continuam na tela.
  const anoSemDado = temClientes && clientes.every((c) => !c.resumo);

  return (
    <div className="vf-page-shell vf-ph-shell" data-vf-density="compact">
      <div className="vf-page-container vf-page-container--wide vf-ph-page">
        <header className="vf-page-header vf-ph-header">
          <div className="vf-page-header__main">
            <p className="vf-page-header__eyebrow">Controle da carteira</p>
            <h1 className="vf-page-header__title">Painel de Contas</h1>
            <p className="vf-page-header__description">
              Visão consolidada dos clientes por Squad, competência e semana.
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
            ano={ano} onAno={setAno} anoPadrao={anoPadrao}
            squadId={squadId} onSquad={setSquadId} squadsDoUsuario={squadsDoUsuario}
            temFiltroAtivo={temFiltroAtivo} onLimpar={limparFiltros}
            grupos={grupos} onAlternarGrupo={alternarGrupo}
            clientes={clientes} atualizando={atualizando}
            temExpandido={expansao.temExpandido} onRecolherTudo={expansao.recolherTudo}
          />
        )}

        {!clientes && carregando && (
          <div className="vf-stack vf-ph-esqueleto">
            <div className="vf-skeleton vf-skeleton--title" />
            <div className="vf-skeleton vf-skeleton--row" />
            <div className="vf-skeleton vf-skeleton--row" />
            <div className="vf-skeleton vf-skeleton--row" />
            <div className="vf-skeleton vf-skeleton--row" />
          </div>
        )}

        {clientes && clientes.length === 0 && (
          <EstadoVazio
            busca={busca}
            squadId={squadId}
            squadsDoUsuario={squadsDoUsuario}
            onLimpar={limparFiltros}
          />
        )}

        {temClientes && (
          <>
            {anoSemDado && (
              <div className="vf-banner is-info vf-banner--compact" role="status">
                <div className="vf-banner__content">
                  <p className="vf-banner__description">
                    Nenhum cliente da carteira tem snapshot sincronizado em {ano}. Os clientes continuam listados,
                    sem dado — nada foi escondido.
                  </p>
                </div>
              </div>
            )}

            <TabelaHierarquica
              clientes={clientes}
              colunas={colunas}
              grupos={grupos}
              clientesAbertos={expansao.clientesAbertos}
              mesesAbertos={expansao.mesesAbertos}
              alternarCliente={expansao.alternarCliente}
              alternarMes={expansao.alternarMes}
              mesesPorCliente={mesesPorCliente}
              carregarMeses={carregarMeses}
              semanasPorChave={semanasPorChave}
              carregarSemanas={carregarSemanas}
              atualizando={atualizando}
            />

            <p className="vf-ph-rodape">
              Os números vêm do snapshot mensal já sincronizado de cada cliente — a sincronização é disparada
              manualmente, então a data ao lado do cliente é o que define a atualidade do dado. Semana tem apenas
              FAT: nenhuma outra métrica tem série diária persistida, e nada é rateado a partir do mês.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
