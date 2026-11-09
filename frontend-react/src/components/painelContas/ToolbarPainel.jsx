// frontend-react/src/components/painelContas/ToolbarPainel.jsx
//
// V4: a barra de controle virou três peças —
//   SeletorCompetencia  (cabeçalho)  ‹ Outubro/2026 ›
//   ToolbarLista        (sobre a tabela, presa no topo ao rolar)
//       Buscar · Todos · Completos · Parciais · Sem dados · Pedem ação ·
//       Filtros ▾ · Limpar      Recolher tudo · Essencial|Detalhada · Exibir ▾
//   (marketplace e squad moram na faixa de escopo — SecoesMarketplace.jsx)
// Os chips são o MESMO filtro de status de antes (enviado ao servidor), só
// que à vista; Manual/Automático e "Mostrar legado" ficam em Filtros ▾.
// As contagens dos chips vêm de `resumoCarteira` (servidor).
//
// Texto original abaixo (o contrato de cada filtro não mudou):
// Barra de controle do Painel de Contas. Filtros são INSTRUMENTO, não
// formulário: uma linha só, sem rótulo flutuante em cima de cada controle (o
// próprio controle diz o que é), com rótulo acessível em `aria-label`.
//
//   Buscar · Competência · Squad · Status      [ ] Mostrar legado · Colunas
//
// Marketplace NÃO mora aqui: virou a SEÇÃO da tela (abas acima da barra,
// SecoesMarketplace.jsx), porque muda o número, não só a lista.
//
// A COMPETÊNCIA é a peça central: a tabela inteira representa exatamente o
// mês escolhido — nunca "o último mês que cada cliente tem".
//
// A faixa de baixo é o resumo da carteira NA COMPETÊNCIA, calculado pelo
// servidor sobre a carteira filtrada (seção/squad/busca/legado), antes do
// filtro de status — por isso cada número também funciona como atalho para
// filtrar. É uma linha de texto, não cards de KPI: a tabela continua dominante.
// Leitura executiva: cobertura primeiro ("31 de 42 clientes com dados"), depois
// o que falta e o que pede ação. Manual/automático são FONTE, não situação —
// ficam no filtro de status, fora da frase.
//
// À direita, a regra de frescor, sempre visível: a automática vai até ontem;
// "Atualizar agora" (admin) inclui o dia parcial de hoje.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatarNumero } from "../../utils/numbers.js";
import { rotularCompetencia, competenciaAnterior } from "../../utils/dates.js";
import { MenuColunas } from "./MenuColunas.jsx";
import { VISTAS } from "./colunas.js";
import { FILTROS_LOCAIS_VAZIOS, contarFiltrosLocais } from "./filtrosLocais.js";

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

export function RegraAtualizacao({ competencia, competenciaAtual, podeAtualizar, modoManual = false }) {
  const corrente = competencia === competenciaAtual;
  // Modo manual: o Painel não promete atualização que não vai acontecer.
  if (modoManual) {
    return (
      <span className="vf-ph-regra" data-testid="regra-atualizacao">
        <span>{corrente ? "Mês em andamento" : "Mês fechado"} · sem atualização automática</span>
      </span>
    );
  }
  return (
    <span className="vf-ph-regra" data-testid="regra-atualizacao">
      <span>Atualização automática: {corrente ? "até ontem" : "mês encerrado"}</span>
      {podeAtualizar && (
        <span>Atualizar agora: {corrente ? "inclui dados parciais de hoje" : "reprocessa o mês completo"}</span>
      )}
    </span>
  );
}

// ‹ select › — mesmo select de antes (24 meses + o da URL), com passos.
export function SeletorCompetencia({ competencia, onCompetencia, competenciaPadrao }) {
  const competencias = useMemo(() => competenciasDisponiveis(competenciaPadrao, competencia), [competenciaPadrao, competencia]);
  const i = competencias.indexOf(competencia); // lista em ordem decrescente
  const anterior = i >= 0 && i < competencias.length - 1 ? competencias[i + 1] : null;
  const proxima = i > 0 ? competencias[i - 1] : null;
  return (
    <span className="vf-ph-comp-sel">
      <span className="vf-ph-comp-sel__stepper">
        <button type="button" onClick={() => anterior && onCompetencia(anterior)} disabled={!anterior} aria-label="Competência anterior">‹</button>
        <select
          className="vf-ph-filtro--competencia"
          aria-label="Competência"
          value={competencia}
          onChange={(e) => onCompetencia(e.target.value)}
        >
          {competencias.map((c) => (
            <option key={c} value={c}>{rotularCompetencia(c)}</option>
          ))}
        </select>
        <button type="button" onClick={() => proxima && onCompetencia(proxima)} disabled={!proxima} aria-label="Próxima competência">›</button>
      </span>
    </span>
  );
}

// Filtros rápidos = os status mais usados, com a contagem do servidor.
export const FILTROS_RAPIDOS = [
  { valor: "todos", rotulo: "Todos", contagem: (r) => r.operacionais },
  { valor: "com_dados", rotulo: "Completos", contagem: (r) => r.comDados, ponto: "ok" },
  { valor: "parcial", rotulo: "Parciais", contagem: (r) => r.parciais, ponto: "parc" },
  { valor: "sem_dados", rotulo: "Sem dados", contagem: (r) => r.semDados, ponto: "nd" },
  { valor: "atencao", rotulo: "Pedem ação", contagem: (r) => r.atencao, ponto: "acao" },
];

// Popover simples (Esc / clique fora fecham, foco volta ao gatilho).
function usePopover() {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);
  const gatilhoRef = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fechar = (evento) => {
      if (evento.type === "keydown") {
        if (evento.key !== "Escape") return;
        setAberto(false);
        gatilhoRef.current?.focus();
        return;
      }
      if (!ref.current?.contains(evento.target)) setAberto(false);
    };
    document.addEventListener("mousedown", fechar);
    document.addEventListener("keydown", fechar);
    return () => {
      document.removeEventListener("mousedown", fechar);
      document.removeEventListener("keydown", fechar);
    };
  }, [aberto]);
  return { aberto, setAberto, ref, gatilhoRef };
}

function MenuFiltros({ status, onStatus, mostrarLegado, onMostrarLegado, legadoOcultos, filtrosLocais, onFiltrosLocais }) {
  const { aberto, setAberto, ref, gatilhoRef } = usePopover();
  const id = useId();
  const secundario = status === "manual" || status === "automatico";
  const ativos = (secundario ? 1 : 0) + (mostrarLegado ? 1 : 0) + contarFiltrosLocais(filtrosLocais);
  // Rascunho: os campos numéricos só valem ao "Aplicar".
  const [rascunho, setRascunho] = useState(filtrosLocais);
  useEffect(() => { if (aberto) setRascunho(filtrosLocais); }, [aberto, filtrosLocais]);
  const mudar = (chave) => (e) => setRascunho((r) => ({ ...r, [chave]: e.target.value }));
  return (
    <div className="vf-ph-menu" ref={ref}>
      <button
        ref={gatilhoRef}
        type="button"
        className={`vf-btn vf-btn--sm vf-ph-menu__gatilho${ativos ? " is-ativo" : ""}`}
        aria-expanded={aberto}
        aria-haspopup="true"
        aria-controls={id}
        onClick={() => setAberto((v) => !v)}
      >
        Filtros{ativos ? ` · ${ativos}` : ""} <span aria-hidden="true">▾</span>
      </button>
      {aberto && (
        <div id={id} className="vf-popover vf-ph-menu__painel vf-ph-menu__painel--filtros" role="group" aria-label="Mais filtros">
          <p className="vf-popover__title">Mais filtros</p>
          <form
            className="vf-ph-menu__form"
            onSubmit={(e) => { e.preventDefault(); onFiltrosLocais(rascunho); setAberto(false); }}
          >
            <label className="vf-ph-menu__campo vf-ph-menu__campo--cheio">
              <span>Status / origem do dado</span>
              <select
                className="vf-select vf-select--sm vf-ph-filtro"
                aria-label="Filtrar por status"
                value={status}
                onChange={(e) => onStatus(e.target.value)}
              >
                {OPCOES_STATUS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
              </select>
            </label>
            <label className="vf-ph-menu__campo">
              <span>MC abaixo de (%)</span>
              <input className="vf-input vf-input--sm" inputMode="decimal" placeholder="ex.: 8" value={rascunho.mcMax} onChange={mudar("mcMax")} />
            </label>
            <label className="vf-ph-menu__campo">
              <span>TACoS acima de (%)</span>
              <input className="vf-input vf-input--sm" inputMode="decimal" placeholder="ex.: 6" value={rascunho.tacosMin} onChange={mudar("tacosMin")} />
            </label>
            <label className="vf-ph-menu__campo">
              <span>Ads</span>
              <select className="vf-select vf-select--sm" value={rascunho.ads} onChange={mudar("ads")}>
                <option value="todos">Com ou sem</option>
                <option value="com">Com Ads</option>
                <option value="sem">Sem Ads</option>
              </select>
            </label>
            <label className="vf-ph-menu__campo">
              <span>Contas no cliente</span>
              <select className="vf-select vf-select--sm" value={rascunho.contasMin} onChange={mudar("contasMin")}>
                <option value="">Qualquer</option>
                <option value="2">2 ou mais</option>
                <option value="4">4 ou mais</option>
                <option value="8">8 ou mais</option>
              </select>
            </label>
            <label className="vf-check vf-ph-legado vf-ph-menu__campo--cheio">
              <input type="checkbox" checked={mostrarLegado} onChange={(e) => onMostrarLegado(e.target.checked)} />
              <span>Mostrar legado{legadoOcultos > 0 && !mostrarLegado ? ` (${formatarNumero(legadoOcultos)} ocultos)` : ""}</span>
            </label>
            <p className="vf-ph-menu__nota vf-ph-menu__campo--cheio">
              Status e legado filtram no servidor. MC, TACoS, Ads e nº de contas recortam a lista já carregada — sem endpoint novo.
            </p>
            <div className="vf-ph-menu__acoes vf-ph-menu__campo--cheio">
              <button
                type="button"
                className="vf-btn vf-btn--ghost vf-btn--sm"
                onClick={() => { setRascunho(FILTROS_LOCAIS_VAZIOS); onFiltrosLocais(FILTROS_LOCAIS_VAZIOS); }}
              >
                Limpar
              </button>
              <button type="submit" className="vf-btn vf-btn--primary vf-btn--sm">Aplicar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export const DENSIDADES = [
  { valor: "confortavel", rotulo: "Confortável" },
  { valor: "compacta", rotulo: "Compacta" },
];

function MenuExibir({ densidade, onDensidade, agrupar, onAgrupar, agruparDisponivel, motivoAgrupar }) {
  const { aberto, setAberto, ref, gatilhoRef } = usePopover();
  const id = useId();
  return (
    <div className="vf-ph-menu" ref={ref}>
      <button
        ref={gatilhoRef}
        type="button"
        className="vf-btn vf-btn--sm vf-ph-menu__gatilho"
        aria-expanded={aberto}
        aria-haspopup="true"
        aria-controls={id}
        onClick={() => setAberto((v) => !v)}
      >
        Exibir <span aria-hidden="true">▾</span>
      </button>
      {aberto && (
        <div id={id} className="vf-popover vf-ph-menu__painel vf-ph-menu__painel--exibir" role="group" aria-label="Exibir">
          <p className="vf-popover__title">Exibir</p>
          <div className="vf-ph-menu__linha">
            <span>Densidade<small>Compacta esconde as linhas de apoio (LC, TACoS)</small></span>
            <span className="vf-segmented" role="group" aria-label="Densidade">
              {DENSIDADES.map((d) => (
                <button
                  key={d.valor}
                  type="button"
                  className={`vf-segmented__item${densidade === d.valor ? " is-active" : ""}`}
                  aria-pressed={densidade === d.valor}
                  onClick={() => onDensidade(d.valor)}
                >
                  {d.rotulo}
                </button>
              ))}
            </span>
          </div>
          <label className="vf-ph-menu__linha">
            <span>Agrupar por squad<small>{motivoAgrupar}</small></span>
            <span className="vf-switch">
              <input
                type="checkbox"
                aria-label="Agrupar por squad"
                checked={agrupar && agruparDisponivel}
                disabled={!agruparDisponivel}
                onChange={(e) => onAgrupar(e.target.checked)}
              />
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

export function ToolbarLista({
  busca, onBusca,
  status, onStatus,
  mostrarLegado, onMostrarLegado,
  temFiltroAtivo, onLimpar,
  resumoCarteira, atualizando,
  vista, onVista, grupos, onAlternarGrupo,
  temExpandido, onRecolherTudo, pendentes = 0, onAbrirPendentes,
  filtrosLocais = FILTROS_LOCAIS_VAZIOS, onFiltrosLocais = () => {},
  densidade = "confortavel", onDensidade = () => {},
  agrupar = true, onAgrupar = () => {}, agruparDisponivel = false, motivoAgrupar = "",
}) {
  const r = resumoCarteira;
  const buscaRef = useRef(null);
  // "/" foca a busca (fora de campos de texto).
  useEffect(() => {
    const aoTeclar = (evento) => {
      if (evento.key !== "/" || evento.ctrlKey || evento.metaKey || evento.altKey) return;
      const alvo = evento.target;
      if (alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return;
      evento.preventDefault();
      buscaRef.current?.focus();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, []);

  return (
    <div className="vf-ph-toolbar" data-testid="toolbar-lista">
      <span className="vf-ph-busca">
        <input
          ref={buscaRef}
          type="search"
          className="vf-input vf-input--sm vf-search vf-ph-busca__input"
          placeholder="Buscar cliente ou slug…"
          aria-label="Buscar cliente por nome ou slug"
          value={busca}
          onChange={(e) => onBusca(e.target.value)}
        />
        {!busca && <kbd aria-hidden="true">/</kbd>}
      </span>

      {pendentes > 0 && (
        <button type="button" className="vf-btn vf-btn--sm" onClick={onAbrirPendentes} title="Abre de uma vez os clientes que pedem ação (sem nova requisição)">
          Abrir pendentes ({pendentes})
        </button>
      )}

      {r && (
        <span className="vf-ph-chips" role="group" aria-label="Filtro rápido de status">
          {FILTROS_RAPIDOS.map((f) => {
            const n = f.contagem(r) ?? 0;
            const ativo = status === f.valor;
            return (
              <button
                key={f.valor}
                type="button"
                className={`vf-chip vf-ph-chip${ativo ? " is-active" : ""}${n === 0 && !ativo ? " is-zero" : ""}`}
                aria-pressed={ativo}
                onClick={() => onStatus(ativo && f.valor !== "todos" ? "todos" : f.valor)}
              >
                {f.ponto && <span className={`vf-ph-chip-dot is-${f.ponto}`} aria-hidden="true" />}
                {f.rotulo} <b>{formatarNumero(n)}</b>
              </button>
            );
          })}
        </span>
      )}

      <MenuFiltros
        status={status}
        onStatus={onStatus}
        mostrarLegado={mostrarLegado}
        onMostrarLegado={onMostrarLegado}
        legadoOcultos={r?.legadoOcultos || 0}
        filtrosLocais={filtrosLocais}
        onFiltrosLocais={onFiltrosLocais}
      />

      {temFiltroAtivo && (
        <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={onLimpar}>
          Limpar filtros
        </button>
      )}
      {atualizando && <span className="vf-ph-resumo__atualizando">Atualizando…</span>}

      <span className="vf-ph-toolbar__acoes">
        {/* Na vista detalhada "Recolher tudo" mora no cabeçalho da tabela. */}
        {temExpandido && vista !== "detalhada" && (
          <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm vf-ph-recolher" onClick={onRecolherTudo}>Recolher tudo</button>
        )}
        <span className="vf-segmented vf-ph-vista" role="group" aria-label="Vista da tabela">
          {VISTAS.map((v) => (
            <button
              key={v.valor}
              type="button"
              className={`vf-segmented__item${vista === v.valor ? " is-active" : ""}`}
              aria-pressed={vista === v.valor}
              onClick={() => onVista(v.valor)}
            >
              {v.rotulo}
            </button>
          ))}
        </span>
        {vista === "detalhada" && <MenuColunas grupos={grupos} onAlternar={onAlternarGrupo} />}
        <MenuExibir
          densidade={densidade}
          onDensidade={onDensidade}
          agrupar={agrupar}
          onAgrupar={onAgrupar}
          agruparDisponivel={agruparDisponivel}
          motivoAgrupar={motivoAgrupar}
        />
      </span>
    </div>
  );
}
