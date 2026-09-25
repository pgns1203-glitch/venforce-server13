// frontend-react/src/components/painelContas/ToolbarPainel.jsx
//
// Barra de controle do Painel de Contas. Substitui os três campos de
// formulário soltos que existiam antes: numa tela de administração os
// filtros são INSTRUMENTO, não um formulário a preencher — por isso busca,
// Squad e Ano ficam numa linha só, sem rótulo flutuante em cima de cada um
// (o próprio controle diz o que é: placeholder na busca, valor selecionado
// nos selects), com rótulo acessível preservado em `aria-label`.
//
// A faixa de baixo é o resumo administrativo (§24): contagens DERIVADAS do
// payload que já está na tela — nenhuma requisição nova, nenhum "health
// score" inventado. É uma linha de texto, não cards de KPI: a tabela
// continua sendo o elemento dominante.

import { useMemo } from "react";
import { plural } from "../../utils/numbers.js";
import { MenuColunas } from "./MenuColunas.jsx";

// Janela pequena e estática — não há endpoint de "anos com dado". O ano
// vindo da URL entra na lista mesmo fora da janela, senão um link
// compartilhado apontaria para um valor que o select não consegue exibir.
export function anosDisponiveis(anoAtual, anoSelecionado) {
  const base = [anoAtual, anoAtual - 1, anoAtual - 2, anoAtual - 3];
  if (anoSelecionado != null && !base.includes(Number(anoSelecionado))) base.push(Number(anoSelecionado));
  return base.sort((a, b) => b - a);
}

// `resumo` nulo = cliente que nunca foi sincronizado (o backend devolve a
// linha assim mesmo, de propósito: cliente sem dado nunca é escondido).
export function resumirCarteira(clientes) {
  const lista = Array.isArray(clientes) ? clientes : [];
  const squads = new Set(lista.map((c) => c.squad?.id).filter((id) => id != null));
  const comDados = lista.filter((c) => c.resumo).length;
  return {
    total: lista.length,
    squads: squads.size,
    comDados,
    semSincronizacao: lista.length - comDados,
  };
}

export function ToolbarPainel({
  busca, onBusca,
  ano, onAno, anoPadrao,
  squadId, onSquad, squadsDoUsuario,
  temFiltroAtivo, onLimpar,
  grupos, onAlternarGrupo,
  clientes, atualizando,
  temExpandido, onRecolherTudo,
}) {
  const resumo = useMemo(() => resumirCarteira(clientes), [clientes]);
  // Um Squad só: o filtro não filtra nada. Esconder é mais honesto que
  // oferecer um controle sem efeito.
  const mostrarFiltroSquad = squadsDoUsuario.length > 1;
  const anos = useMemo(() => anosDisponiveis(anoPadrao, ano), [anoPadrao, ano]);

  return (
    <div className="vf-ph-barra">
      <div className="vf-toolbar vf-ph-barra__controles">
        <div className="vf-toolbar__filters">
          <input
            type="search"
            className="vf-input vf-search vf-ph-busca"
            placeholder="Buscar cliente por nome ou slug…"
            aria-label="Buscar cliente por nome ou slug"
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
          />

          {mostrarFiltroSquad && (
            <select
              className="vf-select vf-select--sm vf-ph-filtro"
              aria-label="Filtrar por Squad"
              value={squadId ?? ""}
              onChange={(e) => onSquad(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">Todos os squads</option>
              {squadsDoUsuario.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          )}

          <select
            className="vf-select vf-select--sm vf-ph-filtro vf-ph-filtro--ano"
            aria-label="Filtrar por ano"
            value={ano}
            onChange={(e) => onAno(Number(e.target.value))}
          >
            {anos.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          {temFiltroAtivo && (
            <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={onLimpar}>
              Limpar filtros
            </button>
          )}
        </div>

        <div className="vf-toolbar__actions">
          {temExpandido && (
            <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={onRecolherTudo}>
              Recolher tudo
            </button>
          )}
          <MenuColunas grupos={grupos} onAlternar={onAlternarGrupo} />
        </div>
      </div>

      <p className="vf-ph-resumo" aria-live="polite">
        <span className="vf-ph-resumo__forte">{plural(resumo.total, "cliente", "clientes")}</span>
        {resumo.squads > 0 && <span>{plural(resumo.squads, "squad", "squads")}</span>}
        <span>{resumo.comDados} com dados</span>
        {resumo.semSincronizacao > 0 && (
          <span className="vf-ph-resumo__alerta">{resumo.semSincronizacao} sem sincronização</span>
        )}
        {atualizando && <span className="vf-ph-resumo__atualizando">Atualizando…</span>}
      </p>
    </div>
  );
}
