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
// Layout V4 (artefato aprovado painel-contas-v4-b-realistic): container WIDE
// + densidade compacta; cabeçalho com competência · faixa de escopo (seção ×
// Squad) · Resumo da carteira + Merece atenção · lista com filtros rápidos e
// cabeçalho presos. A tabela é a do artefato (TabelaCarteira.jsx) nas duas
// vistas: Essencial (FAT · Margem · Ads · Dados) e Detalhada (+ LC, ACOS,
// TACoS); histórico, semanas e composição moram na investigação do cliente.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePainelContas } from "../hooks/usePainelContas.js";
import {
  ToolbarLista, SeletorCompetencia, RegraAtualizacao, OPCOES_STATUS,
} from "../components/painelContas/ToolbarPainel.jsx";
import { SecoesMarketplace } from "../components/painelContas/SecoesMarketplace.jsx";
import { useExpansao } from "../components/painelContas/TabelaHierarquica.jsx";
import { TabelaCarteira } from "../components/painelContas/TabelaCarteira.jsx";
import { LancamentoManualDrawer, FilaConcluida } from "../components/painelContas/LancamentoManualDrawer.jsx";
import { ResumoCarteira, MereceAtencao, lerRecolhido, gravarRecolhido } from "../components/painelContas/VisaoCarteira.jsx";
import { FILTROS_LOCAIS_VAZIOS, aplicarFiltrosLocais, contarFiltrosLocais } from "../components/painelContas/filtrosLocais.js";
import { regrasAtencao, filaDeLancamento, contaAguardaLancamento } from "../components/painelContas/atencao.js";
import { VISTAS, VISTA_PADRAO } from "../components/painelContas/colunas.js";
import { rotularCompetencia, rotularCompetenciaCurta } from "../utils/dates.js";
import { formatarMoeda } from "../utils/currency.js";

// Situações diferentes, mensagens diferentes. "Nenhum resultado" para tudo
// obriga a pessoa a descobrir sozinha o que aconteceu. Cada vazio diz O QUE
// foi filtrado e oferece a saída que desfaz exatamente aquilo.
function Vazio({ titulo, descricao, acao, onAcao, icone = "∅", tom = "" }) {
  return (
    <div className={`vf-empty vf-ph-vazio ${tom}`}>
      <span className="vf-empty__icon vf-ph-vazio__icone" aria-hidden="true">{icone}</span>
      <p className="vf-empty__title">{titulo}</p>
      <p className="vf-empty__description">{descricao}</p>
      {acao && (
        <div className="vf-empty__actions">
          <button type="button" className="vf-btn vf-btn--sm" onClick={onAcao}>{acao}</button>
        </div>
      )}
    </div>
  );
}

function EstadoVazio({ busca, squadId, status, competencia, squadsDisponiveis, onLimpar, onStatus, visao, onConsolidado, acesso }) {
  // Sem Squad: nenhum filtro mudaria o resultado — a carteira vem do vínculo.
  if (acesso?.tipo === "nenhum") {
    return (
      <Vazio
        titulo="Você ainda não faz parte de um Squad"
        descricao="O Painel mostra os clientes dos Squads de que você participa. Peça ao coordenador do seu Squad ou ao administrador para incluir você."
      />
    );
  }

  if (busca.trim()) {
    return (
      <Vazio
        icone="⌕"
        titulo={`Nenhum cliente para “${busca.trim()}”`}
        descricao="A busca cobre nome e slug do cliente, dentro da sua carteira. Confira a grafia ou limpe os filtros."
        acao="Limpar filtros"
        onAcao={onLimpar}
      />
    );
  }

  if (squadId != null) {
    const squad = squadsDisponiveis.find((s) => s.id === squadId);
    return (
      <Vazio
        titulo={squad ? `Nenhum cliente no squad ${squad.nome}` : "Nenhum cliente neste squad"}
        descricao="Nenhum cliente da sua carteira está vinculado a este squad agora."
        acao="Ver todos os squads"
        onAcao={onLimpar}
      />
    );
  }

  if (status && status !== "todos") {
    const rotulo = (OPCOES_STATUS.find((o) => o.valor === status)?.rotulo || status).toLowerCase();
    // "Ninguém precisa de ação" é boa notícia, não um beco sem saída.
    const boaNoticia = status === "atencao" || status === "sem_dados" || status === "parcial";
    return (
      <Vazio
        icone={boaNoticia ? "✓" : "∅"}
        tom={boaNoticia ? "is-ok" : ""}
        titulo={`Nenhum cliente ${rotulo} em ${rotularCompetenciaCurta(competencia)}`}
        descricao={boaNoticia
          ? "Nada pendente neste recorte. O filtro de status vale só para a competência selecionada."
          : "O filtro de status vale só para a competência selecionada."}
        acao="Ver todos os status"
        onAcao={() => onStatus("todos")}
      />
    );
  }

  if (visao?.codigo) {
    return (
      <Vazio
        titulo={`Nenhum cliente com operação ${visao.rotulo} na sua carteira`}
        descricao={`Uma operação ${visao.rotulo} aparece aqui quando a conta é cadastrada no cliente (Clientes e Contas). ${visao.fonte === "manual" ? "Os números entram por lançamento manual." : ""}`.trim()}
        acao="Ver consolidado"
        onAcao={onConsolidado}
      />
    );
  }

  return (
    <Vazio
      titulo="Sua carteira está vazia"
      descricao="Nenhum cliente ativo está atribuído a você no momento. Fale com o coordenador do seu squad se isso for inesperado."
    />
  );
}

// Modo manual: SEMPRE visível, mas do tamanho de um selo no cabeçalho — não
// uma faixa da largura da tela. "Entender" abre a explicação completa num
// painel ancorado (fecha com Esc ou clicando fora).
export function IndicadorModoManual() {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!aberto) return undefined;
    const fechar = (evento) => {
      if (evento.type === "keydown" ? evento.key === "Escape" : !ref.current?.contains(evento.target)) setAberto(false);
    };
    document.addEventListener("mousedown", fechar);
    document.addEventListener("keydown", fechar);
    return () => {
      document.removeEventListener("mousedown", fechar);
      document.removeEventListener("keydown", fechar);
    };
  }, [aberto]);

  return (
    <div className="vf-ph-modo" role="note" data-testid="banner-modo-manual" ref={ref}>
      <span className="vf-ph-modo__selo">Modo manual</span>
      <span className="vf-ph-modo__texto">Valores lançados pela equipe prevalecem sobre a API.</span>
      <button
        type="button"
        className="vf-ph-modo__entender"
        aria-expanded={aberto}
        aria-controls={id}
        onClick={() => setAberto((v) => !v)}
      >
        Entender
      </button>
      {aberto && (
        <div id={id} className="vf-ph-modo__detalhe" role="region" aria-label="Sobre o modo manual">
          <p className="vf-ph-modo__detalhe-titulo">Painel em modo manual</p>
          <p>
            Os valores lançados pela equipe prevalecem sobre a API (inclusive Mercado Livre) e nenhuma rotina automática
            os substitui. Em conta com dado da API, o lançamento mostra o valor da API como referência.
          </p>
          <p>Para faturamento e métricas de referência, consulte a Central de Margem.</p>
        </div>
      )}
    </div>
  );
}

// De onde vem a carteira (regra do Painel: admin · membros dos Squads ·
// gestor do cliente).
export function descreverAcesso(acesso) {
  if (!acesso) return null;
  if (acesso.tipo === "admin") return "todos os Squads";
  const partes = [];
  const squads = (acesso.squads || []).map((s) => s.nome);
  if (squads.length) partes.push(`${squads.length === 1 ? "Seu Squad" : "Seus Squads"}: ${squads.join(", ")}`);
  if (acesso.clientesComoGestor > 0) {
    partes.push(`gestor de ${acesso.clientesComoGestor} ${acesso.clientesComoGestor === 1 ? "cliente" : "clientes"}`);
  }
  return partes.join(" · ") || null;
}

// Squad: segmentado quando cabe (até 5), select sempre disponível (no
// notebook o CSS troca o segmentado pelo select). Controle sem efeito não
// aparece: um squad só vira texto.
const MAX_SQUADS_SEGMENTADO = 5;

function SeletorSquad({ squadId, onSquad, squadsDisponiveis, totalClientes }) {
  if (squadsDisponiveis.length <= 1 && squadId == null) {
    return squadsDisponiveis.length === 1
      ? <span className="vf-ph-faixa__unico">Squad <b>{squadsDisponiveis[0].nome}</b></span>
      : null;
  }
  return (
    <span className="vf-ph-faixa__squad">
      <span className="vf-ph-faixa__rotulo">Squad</span>
      {squadsDisponiveis.length <= MAX_SQUADS_SEGMENTADO && (
        <span className="vf-segmented vf-ph-sq-seg" role="group" aria-label="Squad">
          <button
            type="button"
            className={`vf-segmented__item${squadId == null ? " is-active" : ""}`}
            aria-pressed={squadId == null}
            onClick={() => onSquad(null)}
          >
            Todos{squadId == null && totalClientes != null ? <small>{totalClientes}</small> : null}
          </button>
          {squadsDisponiveis.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`vf-segmented__item${squadId === s.id ? " is-active" : ""}`}
              aria-pressed={squadId === s.id}
              onClick={() => onSquad(squadId === s.id ? null : s.id)}
            >
              {s.nome}
            </button>
          ))}
        </span>
      )}
      <select
        className={`vf-select vf-select--sm vf-ph-filtro vf-ph-sq-sel${squadsDisponiveis.length <= MAX_SQUADS_SEGMENTADO ? " is-alternativo" : ""}`}
        aria-label="Filtrar por Squad"
        value={squadId ?? ""}
        onChange={(e) => onSquad(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">Todos os squads{squadId == null && totalClientes != null ? ` · ${totalClientes}` : ""}</option>
        {squadsDisponiveis.map((s) => (
          <option key={s.id} value={s.id}>{s.nome}</option>
        ))}
      </select>
    </span>
  );
}

const CHAVE_VISTA = "vf:painel-contas:vista";
const CHAVE_DENSIDADE = "vf:painel-contas:densidade";
const CHAVE_AGRUPAR = "vf:painel-contas:agrupar";
function lerPreferencia(chave, padrao, validos) {
  try {
    const v = window.localStorage.getItem(chave);
    return validos.includes(v) ? v : padrao;
  } catch {
    return padrao;
  }
}
function gravarPreferencia(chave, valor) {
  try { window.localStorage.setItem(chave, valor); } catch { /* preferência visual */ }
}
function lerVista() {
  try {
    const v = window.localStorage.getItem(CHAVE_VISTA);
    return VISTAS.some((x) => x.valor === v) ? v : VISTA_PADRAO;
  } catch {
    return VISTA_PADRAO;
  }
}

export default function PainelContasPage() {
  const painel = usePainelContas();
  const {
    competencia, setCompetencia, competenciaPadrao,
    squadId, setSquadId, busca, setBusca, status, setStatus,
    marketplace, setMarketplace, mostrarLegado, setMostrarLegado,
    temFiltroAtivo, limparFiltros,
    clientes, resumoCarteira, squadsDisponiveis, secoesMarketplace, visao, acesso,
    carregando, atualizando, erro, recarregar,
    mesesPorCliente, carregarMeses, semanasPorChave, carregarSemanas,
    semanasContasPorCliente, carregarSemanasContas,
    composicaoPorCliente, carregarComposicao,
    salvarManual, removerManual, lancamentosDaConta, historicoLancamento,
    permissoes, competenciaAtual, atualizacoes, atualizarCliente, dispensarAtualizacao, modo,
  } = painel;
  const modoManual = modo?.codigo === "manual";

  const expansao = useExpansao();
  const [vista, setVistaEstado] = useState(lerVista);
  const setVista = useCallback((v) => {
    setVistaEstado(v);
    try { window.localStorage.setItem(CHAVE_VISTA, v); } catch { /* preferência visual */ }
  }, []);
  const [densidade, setDensidadeEstado] = useState(() => lerPreferencia(CHAVE_DENSIDADE, "confortavel", ["confortavel", "compacta"]));
  const setDensidade = useCallback((v) => { setDensidadeEstado(v); gravarPreferencia(CHAVE_DENSIDADE, v); }, []);
  const [agrupar, setAgruparEstado] = useState(() => lerPreferencia(CHAVE_AGRUPAR, "1", ["0", "1"]) === "1");
  const setAgrupar = useCallback((v) => { setAgruparEstado(v); gravarPreferencia(CHAVE_AGRUPAR, v ? "1" : "0"); }, []);
  // Filtros avançados locais (MC/TACoS/Ads/nº de contas) sobre a lista carregada.
  const [filtrosLocais, setFiltrosLocais] = useState(FILTROS_LOCAIS_VAZIOS);
  const nFiltrosLocais = contarFiltrosLocais(filtrosLocais);
  const clientesVisiveis = useMemo(() => aplicarFiltrosLocais(clientes || [], filtrosLocais), [clientes, filtrosLocais]);
  const limparTudo = useCallback(() => { limparFiltros(); setFiltrosLocais(FILTROS_LOCAIS_VAZIOS); }, [limparFiltros]);
  const [resumoRecolhido, setResumoRecolhido] = useState(lerRecolhido);
  const alternarResumo = useCallback(() => {
    setResumoRecolhido((v) => { gravarRecolhido(!v); return !v; });
  }, []);

  // Lançamento: { cliente, conta, intencao? } — com `fila` quando veio de "Lançar pendentes".
  const [lancamento, setLancamento] = useState(null);
  // Fila: { itens: [{clienteId, contaId}], pos, feitos: [contaId], pulados: [contaId], fim }
  const [fila, setFila] = useState(null);
  const clientesRef = useRef(clientes);
  clientesRef.current = clientes;

  const abrirLancamento = useCallback((cliente, conta, intencao = null) => {
    setFila(null);
    setLancamento({ cliente, conta, intencao });
  }, []);
  const fecharLancamento = useCallback(() => { setLancamento(null); setFila(null); }, []);

  // Depois de salvar/remover a lista é relida: o drawer aberto passa a ler a
  // conta NOVA (mesmo id) — "Salvar" sem sair da fila mostra o que gravou.
  useEffect(() => {
    if (!clientes) return;
    setLancamento((atual) => {
      if (!atual) return atual;
      const cliente = clientes.find((c) => c.id === atual.cliente.id);
      if (!cliente || cliente === atual.cliente) return atual;
      const conta = cliente.contas?.find((c) => c.id === atual.conta?.id);
      return conta ? { ...atual, cliente, conta } : atual;
    });
  }, [clientes]);

  // Item da fila ainda pendente na lista MAIS NOVA (a lista é relida depois de
  // cada salvar); o que deixou de estar pendente é pulado sem perguntar.
  const resolverItem = useCallback((item) => {
    const cliente = (clientesRef.current || []).find((c) => c.id === item.clienteId);
    const conta = cliente?.contas?.find((c) => c.id === item.contaId);
    return cliente && conta && contaAguardaLancamento(conta) ? { cliente, conta } : null;
  }, []);

  // Próximo (dir = 1, dá a volta) ou anterior (dir = -1) navegável da fila.
  const vizinhoNaFila = useCallback((f, dir) => {
    const n = f.itens.length;
    for (let passo = 1; passo < n; passo++) {
      const pos = dir > 0 ? (f.pos + passo) % n : f.pos - passo;
      if (pos < 0) break;
      const item = f.itens[pos];
      if (f.feitos.includes(item.contaId)) continue;
      if (dir > 0 && f.pulados.includes(item.contaId)) continue;
      const alvo = resolverItem(item);
      if (alvo) return { pos, ...alvo };
    }
    return null;
  }, [resolverItem]);

  const irNaFila = useCallback((f, dir) => {
    const v = vizinhoNaFila(f, dir);
    if (v) {
      setFila({ ...f, pos: v.pos, fim: false });
      setLancamento({ cliente: v.cliente, conta: v.conta });
    } else if (dir > 0) {
      setFila({ ...f, fim: true });
      setLancamento(null);
    }
  }, [vizinhoNaFila]);

  const iniciarFila = useCallback((itens = filaDeLancamento(clientesRef.current || []), base = {}) => {
    const f = { itens, pos: -1, feitos: [], pulados: [], fim: false, ...base };
    for (let pos = 0; pos < itens.length; pos++) {
      if (f.feitos.includes(itens[pos].contaId)) continue;
      const alvo = resolverItem(itens[pos]);
      if (alvo) {
        setFila({ ...f, pos, fim: false });
        setLancamento(alvo);
        return;
      }
    }
    if (base.feitos) setFila({ ...f, fim: true });
  }, [resolverItem]);

  const filaAtual = fila && !fila.fim && fila.pos >= 0 ? fila.itens[fila.pos] : null;
  const propsFila = filaAtual && {
    posicao: fila.pos + 1,
    total: fila.itens.length,
    feitos: fila.feitos.length,
    temAnterior: Boolean(vizinhoNaFila(fila, -1)),
    temProxima: Boolean(vizinhoNaFila(fila, 1)),
    onAnterior: () => irNaFila(fila, -1),
    onPular: () => irNaFila({ ...fila, pulados: [...new Set([...fila.pulados, filaAtual.contaId])] }, 1),
    onSalvou: (proxima) => {
      const f = {
        ...fila,
        feitos: [...new Set([...fila.feitos, filaAtual.contaId])],
        pulados: fila.pulados.filter((id) => id !== filaAtual.contaId),
      };
      if (proxima) irNaFila(f, 1);
      else setFila(f);
    },
  };

  // Confirmação explícita: o drawer fecha ao salvar, então a tela diz O QUE
  // foi gravado (conta, competência, FAT) com o valor devolvido pelo servidor.
  const [confirmacao, setConfirmacao] = useState(null);
  const salvarComConfirmacao = useCallback(async (clienteId, contaId, valores) => {
    const resposta = await salvarManual(clienteId, contaId, valores);
    const conta = resposta?.conta;
    const fat = conta?.resumo?.fat;
    setConfirmacao({
      titulo: "Lançamento salvo",
      texto: `${conta?.rotulo || "Conta"} · ${rotularCompetencia(resposta?.competencia || competencia)}`
        + `${fat != null ? ` · FAT ${formatarMoeda(fat, { casas: 2 })}` : ""} · Origem: Manual`,
    });
    return resposta;
  }, [salvarManual, competencia]);
  const removerComConfirmacao = useCallback(async (clienteId, contaId) => {
    const resposta = await removerManual(clienteId, contaId);
    setConfirmacao({ titulo: "Lançamento removido", texto: `${resposta?.conta?.rotulo || "Conta"} · ${rotularCompetencia(competencia)}` });
    return resposta;
  }, [removerManual, competencia]);
  useEffect(() => { setConfirmacao(null); }, [competencia]);

  // Do histórico do drawer para outra competência: a tela troca de mês e o
  // drawer reabre na MESMA conta quando a lista daquele mês chega — nunca
  // com o cliente/valores do mês anterior.
  const [reabrir, setReabrir] = useState(null); // { clienteId, contaId, competencia }
  const irParaCompetencia = useCallback((clienteId, contaId, comp) => {
    setLancamento(null);
    setFila(null);
    setReabrir({ clienteId, contaId, competencia: comp });
    setCompetencia(comp);
  }, [setCompetencia]);
  useEffect(() => {
    if (!reabrir || carregando || !clientes) return;
    // Cada linha diz a própria competência: só reabre com a lista DO mês novo.
    const daNova = clientes.length > 0 && clientes.every((c) => c.competencia === reabrir.competencia);
    if (!daNova) return;
    const cliente = clientes.find((c) => c.id === reabrir.clienteId);
    setReabrir(null);
    if (cliente) setLancamento({ cliente, conta: cliente.contas?.find((c) => c.id === reabrir.contaId) });
  }, [reabrir, carregando, clientes]);

  const temClientes = Boolean(clientes && clientes.length > 0);
  // Lista cheia mas ninguém com número NA COMPETÊNCIA: nota sobre a tabela, não
  // um vazio no lugar dela — os clientes existem e continuam na tela.
  const competenciaSemDado = temClientes && clientes.every((c) => !c.resumo);

  // ── Merece atenção / pendentes (só leitura da lista carregada) ───────────
  const regras = useMemo(() => regrasAtencao(clientes || []), [clientes]);
  const pendentesLancamento = useMemo(() => filaDeLancamento(clientes || []).length, [clientes]);
  const idsPedemAcao = useMemo(
    () => (clientes || []).filter((c) => c.status?.precisaAtencao).map((c) => c.id),
    [clientes],
  );
  const podeLancar = permissoes.lancarManual === true;

  const [destaqueId, setDestaqueId] = useState(null);
  useEffect(() => {
    if (destaqueId == null) return undefined;
    const t = setTimeout(() => setDestaqueId(null), 1800);
    return () => clearTimeout(t);
  }, [destaqueId]);
  const irParaCliente = useCallback((cliente) => {
    expansao.abrirClientes([cliente.id]);
    setDestaqueId(cliente.id);
    setTimeout(() => {
      document.getElementById(`vf-ph-cliente-${cliente.id}`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }, 0);
  }, [expansao]);

  const agirNaRegra = useCallback((regra) => {
    if (regra.acao.tipo === "filtrar") setStatus(regra.acao.status);
    else if (regra.acao.tipo === "fila") iniciarFila();
    else if (regra.itens.length) {
      expansao.abrirClientes(regra.itens.map((it) => it.cliente.id));
      irParaCliente(regra.itens[0].cliente);
    }
  }, [setStatus, iniciarFila, expansao, irParaCliente]);

  // Filtros + cabeçalho da tabela presos ao rolar: a altura do bloco preso é
  // medida e vira o `top` do cabeçalho da tabela.
  const listaRef = useRef(null);
  const presoRef = useRef(null);
  useLayoutEffect(() => {
    const preso = presoRef.current;
    const lista = listaRef.current;
    if (!preso || !lista) return undefined;
    const medir = () => lista.style.setProperty("--vf-ph-preso-h", `${Math.round(preso.getBoundingClientRect().height)}px`);
    medir();
    if (typeof ResizeObserver === "undefined") return undefined;
    const obs = new ResizeObserver(medir);
    obs.observe(preso);
    return () => obs.disconnect();
  }, [temClientes]);

  const descricaoEscopo = [
    squadId != null ? (squadsDisponiveis.find((s) => s.id === squadId)?.nome || "squad") : "todos os squads",
    visao?.codigo ? visao.rotulo : "consolidado",
  ].join(" · ");
  // Contagem da aba Consolidado: a do servidor quando a seção é o consolidado
  // (lembrada ao trocar de aba — nenhuma conta nova).
  const [totalConsolidado, setTotalConsolidado] = useState(null);
  useEffect(() => {
    if (!marketplace && resumoCarteira?.operacionais != null) setTotalConsolidado(resumoCarteira.operacionais);
  }, [marketplace, resumoCarteira]);
  const essencial = vista === "essencial";
  const variosSquads = new Set((clientes || []).map((c) => c.squad?.id ?? null)).size > 1;

  return (
    <div className="vf-page-shell vf-ph-shell" data-vf-density="compact">
      <div className="vf-page-container vf-page-container--wide vf-ph-page">
        <header className="vf-page-header vf-ph-header">
          <div className="vf-page-header__main">
            <h1 className="vf-page-header__title">Painel de Contas</h1>
            <p className="vf-page-header__description">
              {rotularCompetencia(competencia)} · dados operacionais da carteira
              {descreverAcesso(acesso) && <span data-testid="escopo-acesso"> · {descreverAcesso(acesso)}</span>}
            </p>
          </div>
          <div className="vf-ph-header__lado">
            {modoManual && <IndicadorModoManual />}
            <SeletorCompetencia competencia={competencia} onCompetencia={setCompetencia} competenciaPadrao={competenciaPadrao} />
            <RegraAtualizacao
              competencia={competencia}
              competenciaAtual={competenciaAtual}
              podeAtualizar={permissoes.atualizarDados === true}
              modoManual={modoManual}
            />
          </div>
        </header>

        {confirmacao && (
          <div className="vf-banner is-success vf-banner--compact vf-ph-confirmacao" role="status" data-testid="confirmacao-lancamento">
            <div className="vf-banner__content">
              <p className="vf-banner__title">{confirmacao.titulo}</p>
              <p className="vf-banner__description">{confirmacao.texto}</p>
            </div>
            <div className="vf-banner__actions">
              <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setConfirmacao(null)} aria-label="Fechar confirmação">✕</button>
            </div>
          </div>
        )}

        {erro && !clientes && erro.status === 403 && (
          <Vazio
            icone="⊘"
            titulo="O Painel de Contas não está liberado para você"
            descricao="O Painel de Contas é exclusivo da equipe interna. Se você faz parte da equipe, fale com o administrador."
          />
        )}

        {erro && !clientes && erro.status !== 403 && (
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
          <div className="vf-stack vf-ph-esqueleto">
            <div className="vf-skeleton vf-skeleton--title" />
            <div className="vf-skeleton vf-skeleton--row" />
            <div className="vf-skeleton vf-skeleton--row" />
            <div className="vf-skeleton vf-skeleton--row" />
          </div>
        )}

        {clientes && (
          <>
            <SecoesMarketplace
              secoes={secoesMarketplace}
              ativa={marketplace}
              onSelecionar={setMarketplace}
              totalConsolidado={totalConsolidado}
              lado={(
                <SeletorSquad
                  squadId={squadId}
                  onSquad={setSquadId}
                  squadsDisponiveis={squadsDisponiveis}
                  totalClientes={resumoCarteira?.operacionais}
                />
              )}
            />

            {resumoCarteira && (
              <section className={`vf-ph-visao${resumoRecolhido ? " is-recolhida" : ""}`} aria-label="Visão da carteira">
                <ResumoCarteira
                  resumoCarteira={resumoCarteira}
                  clientes={clientes}
                  competencia={competencia}
                  status={status}
                  squadId={squadId}
                  marketplace={marketplace}
                  secoesMarketplace={secoesMarketplace}
                  mostrarLegado={mostrarLegado}
                  onStatus={setStatus}
                  onSquad={setSquadId}
                  onMarketplace={setMarketplace}
                  recolhido={resumoRecolhido}
                  onRecolher={alternarResumo}
                  descricaoEscopo={descricaoEscopo}
                />
                {!resumoRecolhido && (
                  <MereceAtencao
                    regras={regras}
                    competencia={competencia}
                    onAcao={agirNaRegra}
                    onCliente={irParaCliente}
                    pendentesLancamento={pendentesLancamento}
                    onResolver={() => iniciarFila()}
                    podeLancar={podeLancar}
                  />
                )}
              </section>
            )}

            <section className={`vf-ph-lista${essencial ? " is-essencial" : ""}${densidade === "compacta" ? " is-compacta" : ""}`} aria-label="Carteira" ref={listaRef}>
              <div className="vf-ph-lista__preso" ref={presoRef}>
                <div className="vf-ph-lista__head">
                  <h2 className="vf-ph-lista__titulo">Clientes</h2>
                  <span className="vf-ph-lista__meta">
                    {nFiltrosLocais > 0 ? `${clientesVisiveis.length} de ${clientes.length}` : clientes.length}{" "}
                    {clientes.length === 1 ? "cliente" : "clientes"}
                    {status !== "todos" && ` · ${(OPCOES_STATUS.find((o) => o.valor === status)?.rotulo || status).toLowerCase()}`}
                  </span>
                </div>
                <ToolbarLista
                  busca={busca} onBusca={setBusca}
                  status={status} onStatus={setStatus}
                  mostrarLegado={mostrarLegado} onMostrarLegado={setMostrarLegado}
                  temFiltroAtivo={temFiltroAtivo || nFiltrosLocais > 0} onLimpar={limparTudo}
                  filtrosLocais={filtrosLocais} onFiltrosLocais={setFiltrosLocais}
                  densidade={densidade} onDensidade={setDensidade}
                  agrupar={agrupar} onAgrupar={setAgrupar}
                  agruparDisponivel={variosSquads && squadId == null}
                  motivoAgrupar={!variosSquads ? "Sua carteira tem um squad só" : squadId != null ? "Desligado com um squad selecionado" : "Separa a lista por squad"}
                  resumoCarteira={resumoCarteira} atualizando={atualizando}
                  vista={vista} onVista={setVista}
                  temExpandido={expansao.temExpandido} onRecolherTudo={expansao.recolherTudo}
                  pendentes={idsPedemAcao.length}
                  onAbrirPendentes={() => expansao.abrirClientes(idsPedemAcao)}
                />
              </div>

              {clientes.length === 0 && (
                <EstadoVazio
                  busca={busca}
                  squadId={squadId}
                  status={status}
                  competencia={competencia}
                  squadsDisponiveis={squadsDisponiveis}
                  onLimpar={limparFiltros}
                  onStatus={setStatus}
                  visao={visao}
                  onConsolidado={() => setMarketplace(null)}
                  acesso={acesso}
                />
              )}

              {competenciaSemDado && (
                <div className="vf-ph-aviso" role="status">
                  <p className="vf-ph-aviso__titulo">Nenhum cliente listado tem dados em {rotularCompetencia(competencia)}</p>
                  <p className="vf-ph-aviso__texto">
                    Cada linha diz o motivo. Para ver outro mês, troque a competência — nada é preenchido com um mês
                    diferente.{visao?.fonte === "manual"
                      ? ` ${visao.rotulo} não tem integração automática: os números entram por lançamento manual em cada conta.`
                      : modoManual
                        ? " O Painel está em modo manual: os números entram por lançamento em cada conta."
                        : competencia === competenciaAtual && " A atualização automática roda de madrugada, com dados até ontem."}
                  </p>
                </div>
              )}

              {temClientes && clientesVisiveis.length === 0 && (
                <div className="vf-ph-aviso" role="status" data-testid="filtros-locais-vazio">
                  <p className="vf-ph-aviso__titulo">Nenhum cliente com os filtros atuais</p>
                  <p className="vf-ph-aviso__texto">
                    Revise os filtros avançados.{" "}
                    <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setFiltrosLocais(FILTROS_LOCAIS_VAZIOS)}>Limpar filtros avançados</button>
                  </p>
                </div>
              )}

              {temClientes && clientesVisiveis.length > 0 && (
                <TabelaCarteira
                  clientes={clientesVisiveis}
                  competencia={competencia}
                  competenciaAtual={competenciaAtual}
                  vista={vista}
                  densidade={densidade}
                  agrupar={agrupar && squadId == null && variosSquads}
                  ordemSquads={squadsDisponiveis.map((sq) => sq.id)}
                  expansao={expansao}
                  atualizando={atualizando}
                  destaqueId={destaqueId}
                  marketplaceRotulo={marketplace ? visao?.rotulo || marketplace : null}
                  podeLancar={podeLancar}
                  onLancar={abrirLancamento}
                  onLancarPendentes={(cliente) => iniciarFila(filaDeLancamento([cliente]))}
                  podeAtualizar={permissoes.atualizarDados === true}
                  atualizacoes={atualizacoes}
                  onAtualizar={atualizarCliente}
                  onDispensarAtualizacao={dispensarAtualizacao}
                  mostrarHistoricoCliente={!marketplace || marketplace === "meli"}
                  onIrParaCompetencia={setCompetencia}
                  mesesPorCliente={mesesPorCliente}
                  carregarMeses={carregarMeses}
                  semanasPorChave={semanasPorChave}
                  carregarSemanas={carregarSemanas}
                  semanasContasPorCliente={semanasContasPorCliente}
                  carregarSemanasContas={carregarSemanasContas}
                  composicaoPorCliente={composicaoPorCliente}
                  carregarComposicao={carregarComposicao}
                />
              )}
            </section>
          </>
        )}

        {temClientes && (
          <p className="vf-ph-rodape">
            {marketplace
              ? <>Seção {visao?.rotulo || marketplace}: o número de cada cliente soma só as contas {visao?.rotulo || marketplace}; as
                  demais operações ficam no Consolidado. {marketplace === "meli"
                  ? "Ads é medido por cliente (Mercado Livre)."
                  : "Ads aqui é só o lançado manualmente nestas contas."}</>
              : <>O número do cliente é o consolidado das contas indicadas ao lado do nome; ao expandir, cada conta mostra o
                  próprio número (o mesmo da Central de Vendas) e pode abrir suas semanas reais. Ads é medido por cliente.</>}
            {" "}API = sincronização; Manual = lançado pela equipe.
            {essencial && <> Dados: <i className="vf-ph-pip is-a" /> API <i className="vf-ph-pip is-m" /> manual <i className="vf-ph-pip is-w" /> pede ação <i className="vf-ph-pip is-o" /> sem dado.</>}
          </p>
        )}
      </div>

      {lancamento && (
        <LancamentoManualDrawer
          key={`${lancamento.cliente.id}:${lancamento.conta?.id ?? "x"}`}
          cliente={lancamento.cliente}
          contaInicial={lancamento.conta}
          competencia={competencia}
          onSalvar={salvarComConfirmacao}
          onRemover={removerComConfirmacao}
          modoManual={modoManual}
          onFechar={fecharLancamento}
          onCarregarLancamentos={lancamentosDaConta}
          onCarregarHistorico={historicoLancamento}
          onIrParaCompetencia={irParaCompetencia}
          intencao={lancamento.intencao || null}
          fila={propsFila}
        />
      )}
      {fila?.fim && (
        <FilaConcluida
          feitos={fila.feitos.length}
          total={fila.itens.length}
          pulados={fila.pulados.length}
          onFechar={fecharLancamento}
          onVoltarPuladas={() => iniciarFila(fila.itens, { feitos: fila.feitos })}
        />
      )}
    </div>
  );
}
