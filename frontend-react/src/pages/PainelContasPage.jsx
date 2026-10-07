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

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePainelContas } from "../hooks/usePainelContas.js";
import { ToolbarPainel, OPCOES_STATUS } from "../components/painelContas/ToolbarPainel.jsx";
import { SecoesMarketplace } from "../components/painelContas/SecoesMarketplace.jsx";
import { useGruposDeColunas } from "../components/painelContas/MenuColunas.jsx";
import { TabelaHierarquica, useExpansao } from "../components/painelContas/TabelaHierarquica.jsx";
import { LancamentoManualDrawer } from "../components/painelContas/LancamentoManualDrawer.jsx";
import { colunasVisiveis } from "../components/painelContas/colunas.js";
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

function EstadoVazio({ busca, squadId, status, competencia, squadsDisponiveis, onLimpar, onStatus, visao, onConsolidado }) {
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

// De onde vem a carteira (regra do Painel: admin · coordenador · gestor).
export function descreverAcesso(acesso) {
  if (!acesso) return null;
  if (acesso.tipo === "admin") return "todos os Squads";
  const partes = [];
  const squads = (acesso.squadsCoordenados || []).map((s) => s.nome);
  if (squads.length) partes.push(`${squads.length === 1 ? "Squad que você coordena" : "Squads que você coordena"}: ${squads.join(", ")}`);
  if (acesso.clientesComoGestor > 0) {
    partes.push(`gestor de ${acesso.clientesComoGestor} ${acesso.clientesComoGestor === 1 ? "cliente" : "clientes"}`);
  }
  return partes.join(" · ") || null;
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

  const { grupos, alternar: alternarGrupo } = useGruposDeColunas();
  const expansao = useExpansao();
  const colunas = colunasVisiveis(grupos);
  const [lancamento, setLancamento] = useState(null); // { cliente, conta }

  const abrirLancamento = useCallback((cliente, conta) => setLancamento({ cliente, conta }), []);
  const fecharLancamento = useCallback(() => setLancamento(null), []);

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
          {modoManual && <IndicadorModoManual />}
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
            descricao="O Painel mostra a carteira de quem coordena um Squad ou é gestor de um cliente. Se você deveria ver esta carteira, fale com o administrador."
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

        {/* Um painel só: seções → filtros → resumo → tabela. A moldura é da
            ferramenta inteira, não de cada peça — nada fica "solto" na tela. */}
        {clientes && (
          <section className="vf-ph-painel" aria-label="Carteira">
            <SecoesMarketplace secoes={secoesMarketplace} ativa={marketplace} onSelecionar={setMarketplace} />
            <ToolbarPainel
              busca={busca} onBusca={setBusca}
              competencia={competencia} onCompetencia={setCompetencia} competenciaPadrao={competenciaPadrao}
              squadId={squadId} onSquad={setSquadId} squadsDisponiveis={squadsDisponiveis}
              status={status} onStatus={setStatus}
              mostrarLegado={mostrarLegado} onMostrarLegado={setMostrarLegado}
              temFiltroAtivo={temFiltroAtivo} onLimpar={limparFiltros}
              grupos={grupos} onAlternarGrupo={alternarGrupo}
              resumoCarteira={resumoCarteira} atualizando={atualizando}
              competenciaAtual={competenciaAtual} podeAtualizar={permissoes.atualizarDados === true}
              modoManual={modoManual}
            />

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

            {temClientes && (
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
                semanasContasPorCliente={semanasContasPorCliente}
                carregarSemanasContas={carregarSemanasContas}
                composicaoPorCliente={composicaoPorCliente}
                carregarComposicao={carregarComposicao}
                atualizando={atualizando}
                onLancar={abrirLancamento}
                competenciaAtual={competenciaAtual}
                atualizacoes={atualizacoes}
                podeAtualizar={permissoes.atualizarDados === true}
                onAtualizar={atualizarCliente}
                onDispensarAtualizacao={dispensarAtualizacao}
                mostrarHistoricoCliente={!marketplace || marketplace === "meli"}
              />
            )}
          </section>
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
          </p>
        )}
      </div>

      {lancamento && (
        <LancamentoManualDrawer
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
        />
      )}
    </div>
  );
}
