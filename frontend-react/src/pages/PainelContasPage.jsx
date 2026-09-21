// frontend-react/src/pages/PainelContasPage.jsx
//
// Painel de Controle de Contas por Squad — tabela hierárquica Cliente → Mês →
// Semana (Auditoria: Painel_Controle_Contas_Squads). Escopo GLOBAL
// (data-vf-scope="global", como Carteira/Clientes): não depende de
// Cliente+Operação escolhidos no Shell — é a própria carteira agrupada por
// Squad. Autorização inteira no servidor (GET /painel-contas); o filtro de
// Squad aqui é preferência de exibição, nunca fonte de acesso (§15).

import { usePainelContas } from "../hooks/usePainelContas.js";
import { TabelaHierarquica } from "../components/painelContas/TabelaHierarquica.jsx";

function anosDisponiveis(anoAtual) {
  // Janela pequena e estática — não há endpoint de "anos com dado"; o
  // usuário navega os últimos 3 anos + o atual, suficiente para o histórico
  // real de cliente_360_resumos_mensais hoje.
  return [anoAtual, anoAtual - 1, anoAtual - 2, anoAtual - 3];
}

export default function PainelContasPage() {
  const {
    ano, setAno, squadId, setSquadId, busca, setBusca,
    squadsDoUsuario, clientes, carregando, erro, recarregar,
    mesesPorCliente, carregarMeses, semanasPorChave, carregarSemanas,
  } = usePainelContas();

  const mostrarFiltroSquad = squadsDoUsuario.length > 1;

  return (
    <div className="vf-page-shell">
      <div className="vf-page-container">
        <header className="vf-page-header">
          <div className="vf-page-header__main">
            <p className="vf-page-header__eyebrow">Painel de Contas</p>
            <h1 className="vf-page-header__title">Contas por Squad</h1>
            <p className="vf-page-header__description">
              Cliente → Mês → Semana. FAT, LC, MC, investimento em Ads, ACOS e TACoS vêm do snapshot mensal já
              sincronizado — clientes nunca sincronizados aparecem na lista, sem dado, nunca escondidos.
            </p>
          </div>
        </header>

        <div className="vf-ph-filtros">
          <div className="vf-field">
            <label className="vf-field__label" htmlFor="ph-filtro-ano">Ano</label>
            <select
              id="ph-filtro-ano"
              className="vf-select"
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
            >
              {anosDisponiveis(new Date().getFullYear()).map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {mostrarFiltroSquad && (
            <div className="vf-field">
              <label className="vf-field__label" htmlFor="ph-filtro-squad">Squad</label>
              <select
                id="ph-filtro-squad"
                className="vf-select"
                value={squadId ?? ""}
                onChange={(e) => setSquadId(e.target.value === "" ? null : Number(e.target.value))}
              >
                <option value="">Todos os meus squads</option>
                {squadsDoUsuario.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </div>
          )}

          <div className="vf-field vf-ph-filtro-busca">
            <label className="vf-field__label" htmlFor="ph-filtro-busca">Buscar cliente</label>
            <input
              id="ph-filtro-busca"
              type="search"
              className="vf-input"
              placeholder="Nome ou slug…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </div>

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

        {!clientes && carregando && (
          <div className="vf-stack" style={{ marginTop: 20 }}>
            <div className="vf-skeleton vf-skeleton--title" />
            <div className="vf-skeleton vf-skeleton--row" />
            <div className="vf-skeleton vf-skeleton--row" />
            <div className="vf-skeleton vf-skeleton--row" />
          </div>
        )}

        {clientes && clientes.length === 0 && (
          <div className="vf-empty">
            <p className="vf-empty__title">Nenhum cliente encontrado</p>
            <p className="vf-empty__description">
              {busca || squadId
                ? "Nenhum cliente da sua carteira bate com esse filtro."
                : "Sua carteira não tem clientes ativos no momento. Fale com o coordenador do seu squad se isso for inesperado."}
            </p>
          </div>
        )}

        {clientes && clientes.length > 0 && (
          <TabelaHierarquica
            clientes={clientes}
            mesesPorCliente={mesesPorCliente}
            carregarMeses={carregarMeses}
            semanasPorChave={semanasPorChave}
            carregarSemanas={carregarSemanas}
          />
        )}
      </div>
    </div>
  );
}
