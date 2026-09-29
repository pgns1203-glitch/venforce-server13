// frontend-react/src/components/painelContas/ToolbarPainel.jsx
//
// Barra de controle do Painel de Contas. Filtros são INSTRUMENTO, não
// formulário: uma linha só, sem rótulo flutuante em cima de cada controle (o
// próprio controle diz o que é), com rótulo acessível em `aria-label`.
//
//   Buscar · Competência · Squad · Status · Marketplace      [ ] Mostrar legado · Colunas
//
// A COMPETÊNCIA é a peça central: a tabela inteira representa exatamente o
// mês escolhido — nunca "o último mês que cada cliente tem".
//
// A faixa de baixo é o resumo da carteira NA COMPETÊNCIA, calculado pelo
// servidor sobre a carteira filtrada (squad/busca/marketplace/legado), antes do
// filtro de status — por isso cada número também funciona como atalho para
// filtrar. É uma linha de texto, não cards de KPI: a tabela continua dominante.
// Leitura executiva: cobertura primeiro ("31 de 42 clientes com dados"), depois
// o que falta e o que pede ação. Manual/automático são FONTE, não situação —
// ficam no filtro de status, fora da frase.
//
// À direita, a regra de frescor, sempre visível: a automática vai até ontem;
// "Atualizar agora" (admin) inclui o dia parcial de hoje.

import { useMemo } from "react";
import { formatarNumero } from "../../utils/numbers.js";
import { rotularCompetencia, competenciaAnterior } from "../../utils/dates.js";
import { MenuColunas } from "./MenuColunas.jsx";

const JANELA_COMPETENCIAS = 24;

export const OPCOES_STATUS = [
  { valor: "todos", rotulo: "Todos os status" },
  { valor: "com_dados", rotulo: "Com dados" },
  { valor: "sem_dados", rotulo: "Sem dados" },
  { valor: "parcial", rotulo: "Parcial" },
  { valor: "manual", rotulo: "Manual" },
  { valor: "automatico", rotulo: "Automático" },
  { valor: "atencao", rotulo: "Precisa de ação" },
];

// Últimos 24 meses a partir da competência corrente (São Paulo). Uma
// competência vinda da URL entra na lista mesmo fora da janela — senão um link
// compartilhado apontaria para um valor que o select não consegue exibir.
export function competenciasDisponiveis(competenciaPadrao, selecionada) {
  const lista = [];
  let cursor = competenciaPadrao;
  for (let i = 0; i < JANELA_COMPETENCIAS; i++) {
    lista.push(cursor);
    cursor = competenciaAnterior(cursor);
  }
  if (selecionada && !lista.includes(selecionada)) lista.push(selecionada);
  return lista.sort().reverse();
}

function ItemResumo({ valor, rotulo, status, statusAtual, onStatus, tom = "", children }) {
  const ativo = statusAtual === status;
  return (
    <button
      type="button"
      className={`vf-ph-resumo__item ${tom}${ativo ? " is-ativo" : ""}`}
      aria-pressed={ativo}
      onClick={() => onStatus(ativo ? "todos" : status)}
    >
      {children || <><span className="vf-ph-resumo__n">{formatarNumero(valor)}</span> {rotulo}</>}
    </button>
  );
}

export function RegraAtualizacao({ competencia, competenciaAtual, podeAtualizar }) {
  const corrente = competencia === competenciaAtual;
  return (
    <span className="vf-ph-regra" data-testid="regra-atualizacao">
      <span>Atualização automática: {corrente ? "até ontem" : "mês encerrado"}</span>
      {podeAtualizar && (
        <span>Atualizar agora: {corrente ? "inclui dados parciais de hoje" : "reprocessa o mês completo"}</span>
      )}
    </span>
  );
}

export function ToolbarPainel({
  busca, onBusca,
  competencia, onCompetencia, competenciaPadrao,
  squadId, onSquad, squadsDisponiveis,
  status, onStatus,
  marketplace, onMarketplace, marketplacesDisponiveis,
  mostrarLegado, onMostrarLegado,
  temFiltroAtivo, onLimpar,
  grupos, onAlternarGrupo,
  resumoCarteira, atualizando,
  competenciaAtual = competenciaPadrao, podeAtualizar = false,
}) {
  const competencias = useMemo(() => competenciasDisponiveis(competenciaPadrao, competencia), [competenciaPadrao, competencia]);
  // Controle sem efeito não aparece: um squad só / um marketplace só.
  const mostrarFiltroSquad = squadsDisponiveis.length > 1 || squadId != null;
  const mostrarFiltroMarketplace = marketplacesDisponiveis.length > 1 || marketplace != null;
  const r = resumoCarteira;

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

          <select
            className="vf-select vf-select--sm vf-ph-filtro vf-ph-filtro--competencia"
            aria-label="Competência"
            value={competencia}
            onChange={(e) => onCompetencia(e.target.value)}
          >
            {competencias.map((c) => (
              <option key={c} value={c}>{rotularCompetencia(c)}</option>
            ))}
          </select>

          {mostrarFiltroSquad && (
            <select
              className="vf-select vf-select--sm vf-ph-filtro"
              aria-label="Filtrar por Squad"
              value={squadId ?? ""}
              onChange={(e) => onSquad(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">Todos os squads</option>
              {squadsDisponiveis.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          )}

          <select
            className="vf-select vf-select--sm vf-ph-filtro"
            aria-label="Filtrar por status"
            value={status}
            onChange={(e) => onStatus(e.target.value)}
          >
            {OPCOES_STATUS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>

          {mostrarFiltroMarketplace && (
            <select
              className="vf-select vf-select--sm vf-ph-filtro"
              aria-label="Filtrar por marketplace"
              value={marketplace ?? ""}
              onChange={(e) => onMarketplace(e.target.value === "" ? null : e.target.value)}
            >
              <option value="">Todos os marketplaces</option>
              {marketplacesDisponiveis.map((m) => <option key={m.codigo} value={m.codigo}>{m.rotulo}</option>)}
            </select>
          )}

          {temFiltroAtivo && (
            <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={onLimpar}>
              Limpar filtros
            </button>
          )}
        </div>

        {/* À direita, o que muda a VISTA (não o recorte do mês): legado e
            colunas — "Colunas" sempre no canto. "Recolher tudo" mora no
            cabeçalho da tabela: aqui, aparecer/sumir deslocava a tabela. */}
        <div className="vf-toolbar__actions">
          <label className="vf-check vf-ph-legado">
            <input type="checkbox" checked={mostrarLegado} onChange={(e) => onMostrarLegado(e.target.checked)} />
            <span>Mostrar legado</span>
          </label>
          <MenuColunas grupos={grupos} onAlternar={onAlternarGrupo} />
        </div>
      </div>

      {r && (
        <div className="vf-ph-resumo" data-testid="resumo-carteira">
          <p className="vf-ph-resumo__numeros" aria-live="polite">
            <ItemResumo status="com_dados" statusAtual={status} onStatus={onStatus} tom="is-principal">
              <span className="vf-ph-resumo__n">{formatarNumero(r.comDados)}</span>
              {" de "}
              <span className="vf-ph-resumo__n vf-ph-resumo__n--total">{formatarNumero(r.operacionais)}</span> clientes com dados
            </ItemResumo>
            {r.parciais > 0 && <ItemResumo valor={r.parciais} rotulo="parciais" status="parcial" statusAtual={status} onStatus={onStatus} />}
            {r.semDados > 0 && <ItemResumo valor={r.semDados} rotulo="sem dados" status="sem_dados" statusAtual={status} onStatus={onStatus} />}
            {r.atencao > 0 && (
              <ItemResumo
                valor={r.atencao}
                rotulo={r.atencao === 1 ? "precisa de ação" : "precisam de ação"}
                status="atencao" statusAtual={status} onStatus={onStatus} tom="is-alerta"
              />
            )}
            {!mostrarLegado && r.legadoOcultos > 0 && (
              <span className="vf-ph-resumo__nota" title="Clientes do Squad 8 · Legado ficam fora da lista e das contagens. Marque “Mostrar legado” para consultá-los.">
                {formatarNumero(r.legadoOcultos)} do legado ocultos
              </span>
            )}
            {atualizando && <span className="vf-ph-resumo__atualizando">Atualizando…</span>}
          </p>
          <RegraAtualizacao competencia={competencia} competenciaAtual={competenciaAtual} podeAtualizar={podeAtualizar} />
        </div>
      )}
    </div>
  );
}
