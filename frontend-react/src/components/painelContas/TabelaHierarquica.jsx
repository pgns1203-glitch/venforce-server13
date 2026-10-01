// frontend-react/src/components/painelContas/TabelaHierarquica.jsx
//
// Tabela hierárquica do Painel de Contas operacional. Continua sendo uma
// TABELA (não cards): comparar muitos clientes depende de colunas alinhadas.
// Construída sobre `.vf-table` (Fundação Global V2); o específico deste padrão
// mora em TabelaHierarquica.css.
//
// ── Os níveis ────────────────────────────────────────────────────────────
// CLIENTE    → o número CONSOLIDADO da competência selecionada — a linha
//              DOMINANTE. Escopo escrito ("Consolidado · 3 contas"), estado
//              compacto e, quando alguma conta pede ação, UMA frase ("2 contas
//              precisam de ação") em vez de repetir o botão de cada conta. Na
//              coluna de contexto, sempre: dados até · fonte · atualizado em.
//              Sem dado, a linha diz POR QUÊ — nunca mostra outro mês.
// CONTA      → cada conta/operação, SECUNDÁRIA e recuada, com o próprio
//              número (o mesmo escopo que a Central de Vendas mostra ao
//              selecionar a conta). É nela que mora "Lançar dados". Já vem na
//              lista: abrir um cliente não custa requisição.
//
// ATUALIZAR  → admin: "↻ Atualizar" na linha do cliente dispara a atualização
//              sob demanda (servidor). Em curso, a âncora diz o período
//              ("Atualizando até hoje") e o botão, a contagem ("Atualizando
//              1/2"); terminada com pendência, uma linha logo abaixo diz QUAL
//              conta falhou e por quê.
// HISTÓRICO  → meses do consolidado (lazy) → semanas (lazy). A competência
//              selecionada fica marcada.
//
// NÃO existe "expandir todos": seria uma requisição de histórico por cliente,
// o oposto do que o lazy loading protege.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatarMoeda } from "../../utils/currency.js";
import { formatarPercentual, formatarVariacaoPercentual, formatarPontosPercentuais } from "../../utils/percentage.js";
import { AUSENTE, ehAusente, direcao } from "../../utils/numbers.js";
import { rotularCompetenciaCurta, formatarData, formatarDataHora } from "../../utils/dates.js";
import { colunasVisiveis, gruposVisiveis } from "./colunas.js";
import { atualizacaoEmCurso } from "../../utils/painelContasAtualizacao.js";
import { DemonstrativoComposicao } from "./ComposicaoFaturamento.jsx";
import "./TabelaHierarquica.css";

// Squad é identidade, não estado: tag NEUTRA (cor fica reservada para o que
// tem semântica). É a ÚNICA etiqueta da linha: estado vira `.vf-status`
// (ponto + texto, forma codifica o tom) e fonte vira texto.
const TOM_SQUAD = "is-neutral";

// Tom por status: cor é a segunda pista — o rótulo em texto é a primeira, e a
// FORMA do ponto (●/◇/○ da Fundação) a terceira. Quatro tons só:
// verde = sincronizado · âmbar = parcial/atenção · cinza = ausência ou fonte
// neutra (manual, sincronizando) · vermelho = erro real. "" = `.vf-status`
// base (ponto cheio cinza), distinto do ○ vazado de ausência.
const TOM_STATUS = {
  sincronizado: "is-success",
  manual: "",
  parcial: "is-warning",
  sem_dados: "is-empty",
  sem_conta: "is-warning",
  sem_conexao: "is-warning",
  sem_integracao: "is-empty",
  sincronizando: "",
  erro_sync: "is-danger",
  nao_publicado: "is-warning",
  conta_inativa: "is-empty",
};

const NOTA_ADS_POR_CONTA = "Ads é medido por cliente (todas as contas juntas) — não existe valor por conta, e nada é rateado.";

function formatarValor(tipo, valor) {
  if (tipo === "indisponivel") return AUSENTE;
  // `casas: 0` é escolha de densidade; o valor exato fica no `title`.
  if (tipo === "moeda") return formatarMoeda(valor, { casas: 0 });
  return formatarPercentual(valor);
}

function valorExato(tipo, valor) {
  if (tipo !== "moeda" || ehAusente(valor)) return undefined;
  return formatarMoeda(valor);
}

// fat/lc/ads variam em {abs,pct} -> mostra pct. mc/acos/tacos variam em {pp}.
function lerVariacao(tipo, variacao) {
  if (!variacao) return null;
  if (tipo === "moeda" && !ehAusente(variacao.pct)) {
    return { valor: variacao.pct, texto: formatarVariacaoPercentual(variacao.pct) };
  }
  if (tipo === "fracao" && !ehAusente(variacao.pp)) {
    return { valor: variacao.pp, texto: formatarPontosPercentuais(variacao.pp) };
  }
  return null;
}

// Direção NUNCA sai do sinal matemático sozinho: `sentido` vem da coluna.
function Delta({ sentido, valor, texto }) {
  const n = Number(valor);
  const tom = sentido === "neutro" ? "neutro" : direcao(n, { inverso: sentido === "positivo-ruim" });
  const simbolo = n === 0 ? "=" : n > 0 ? "▲" : "▼";
  return (
    <span className={`vf-ph-delta is-${tom}`}>
      <span className="vf-ph-delta__simbolo" aria-hidden="true">{simbolo}</span>
      {texto}
    </span>
  );
}

// Classes de apresentação do número — nenhuma muda o valor exibido:
//   vf-ph-col--<chave>  peso por métrica (FAT domina a linha; ver CSS)
//   is-inicio-grupo     divisor vertical discreto entre Financeiro e Ads
//   is-ausente          "—" em tom secundário (ausência não compete com dado)
//   is-negativo         negativo diferenciado sem depender só da cor (o "−"
//                       já vem do formatador)
// Cobertura de custos: só SINALIZA. LC/MC continuam os números calculados;
// quando parte do FAT não tem custo, uma marca discreta diz quanto está coberto.
export function textoCoberturaParcial(custos) {
  const pct = formatarPercentual(custos.cobertura);
  return `Cálculo parcial: os custos cobrem ${pct} do FAT (${formatarMoeda(custos.faturamentoComCusto)} de `
    + `${formatarMoeda(custos.faturamentoComCusto + custos.faturamentoSemCusto)}). O LC soma só os pedidos com custo `
    + "cadastrado e a MC é LC ÷ faturamento com custo — valem para a parte coberta.";
}

function marcaParcial(coluna, custos) {
  if (custos?.estado !== "parcial") return false;
  return (custos.indicadores || ["lc", "mc"]).includes(coluna.chave);
}

function Celula({ coluna, valor, variacao, titulo, custos = null }) {
  const texto = formatarValor(coluna.tipo, valor);
  const delta = lerVariacao(coluna.tipo, variacao);
  const indisponivel = coluna.tipo === "indisponivel";
  const ausente = indisponivel || ehAusente(valor);
  const negativo = !ausente && Number(valor) < 0;
  const classes = [
    "num",
    `vf-ph-col--${coluna.chave}`,
    coluna.inicioGrupo ? "is-inicio-grupo" : "",
    indisponivel ? "vf-ph-indisponivel" : "",
  ].filter(Boolean).join(" ");
  return (
    <td
      className={classes}
      title={titulo || (indisponivel ? "Sem fonte de dado auditada nesta versão" : valorExato(coluna.tipo, valor))}
    >
      <span className={`vf-ph-valor${ausente ? " is-ausente" : ""}${negativo ? " is-negativo" : ""}`}>{texto}</span>
      {delta && <Delta sentido={coluna.sentido} valor={delta.valor} texto={delta.texto} />}
      {!ausente && marcaParcial(coluna, custos) && (
        <span className="vf-ph-parcial" title={textoCoberturaParcial(custos)} aria-label={textoCoberturaParcial(custos)}>
          <span aria-hidden="true">◐ {formatarPercentual(custos.cobertura)}</span>
        </span>
      )}
    </td>
  );
}

function StatusCompacto({ status, rotulo }) {
  if (!status) return null;
  return (
    <span className={`vf-status vf-ph-status ${TOM_STATUS[status.codigo] ?? "is-empty"}`} title={status.motivo || undefined}>
      {rotulo || status.rotulo}
    </span>
  );
}

// "28/09" quando o ano é o da competência (a tela inteira já diz o ano);
// data completa quando não é — nunca uma data ambígua.
function dataCurta(iso, competencia) {
  const completa = formatarData(iso);
  return String(iso).slice(0, 4) === String(competencia).slice(0, 4) ? completa.slice(0, 5) : completa;
}

// Frescor do CLIENTE, sempre as três peças — ausente vira "—", nunca some:
//   dados até 28/09/2026 · API
//   atualizado 29/09/2026 06:20
// É contexto (4ª prioridade da linha): tipografia menor e cinza, no tom
// `text-muted` (AA) — mais baixo que isso deixaria de ser legível. Em
// andamento, quem fala é o botão ↻ — esta linha continua mostrando a última
// atualização concluída, que ainda é verdade.
function FrescorCliente({ cliente, concluidaAgora }) {
  return (
    <>
      <span className="vf-ph-contexto__linha vf-ph-meta">
        <span>dados até {cliente.dadosAte ? formatarData(cliente.dadosAte) : AUSENTE}</span>
        <span title={cliente.fonte ? `Fonte do dado: ${cliente.fonte.rotulo}` : "Sem fonte na competência"}>
          · {cliente.fonte?.rotulo || "sem fonte"}
        </span>
      </span>
      <span className="vf-ph-contexto__linha vf-ph-meta">
        <span className={concluidaAgora ? "vf-ph-frescor--ok" : undefined}>
          {concluidaAgora && <span aria-hidden="true">✓ </span>}
          atualizado {cliente.atualizadoEm ? formatarDataHora(cliente.atualizadoEm) : AUSENTE}
        </span>
      </span>
    </>
  );
}

// ── Atualizar dados ─────────────────────────────────────────────────────────
// O texto de ajuda É a regra: automático até ontem; agora inclui hoje (mês
// corrente) ou reprocessa o mês inteiro (mês anterior).
export function explicarAtualizacao(competencia, competenciaAtual) {
  const mes = rotularCompetenciaCurta(competencia);
  return competencia === competenciaAtual
    ? `Atualizar agora: ${mes} do dia 1 até hoje, incluindo dados parciais de hoje. A atualização automática (de madrugada) vai só até ontem.`
    : `Atualizar agora: reprocessa ${mes} completo (mês encerrado).`;
}

// Fase visível do botão. Só LÊ o estado que o hook já mantém — nenhuma regra
// nova: em curso = `atualizacaoEmCurso`; o resto sai do `estado` do job.
function faseAtualizacao(atualizacao) {
  if (!atualizacao) return "normal";
  if (atualizacaoEmCurso(atualizacao)) return "andamento";
  const estadoJob = atualizacao.job?.estado;
  if (atualizacao.erro || estadoJob === "falhou") return "falha";
  if (estadoJob === "concluida_com_pendencias") return "pendencia";
  if (estadoJob === "concluida") return "ok";
  return "normal";
}

function progressoBotao(job) {
  const { concluidas = 0, total = 0 } = job?.progresso || {};
  return total > 0 ? `Atualizando ${concluidas}/${total}` : "Atualizando…";
}

// ↻ Atualizar — rótulo em texto (descobrível sem hover), estados escritos:
//   normal     ↻ Atualizar            (hover/foco: "Atualizar até hoje")
//   andamento  ↻ Atualizando 1/3      (travado; ícone gira)
//   ok         ✓ Atualizado           (hover/foco: "Atualizar até hoje")
//   falha      Falhou · tentar novamente
// O rótulo de hover é empilhado na MESMA célula de grid do normal: a largura
// do botão é a do maior dos dois, então trocar o texto não desloca nada.
// O nome acessível continua "Atualizar dados de <cliente>" (+ o estado, quando
// não é o normal) e o `title` segue explicando a regra de período.
function BotaoAtualizar({ cliente, competencia, competenciaAtual, atualizacao, onAtualizar }) {
  const sincronizavel = (cliente.contas || []).some((c) => c.ativa && c.marketplace === "meli" && c.conectada);
  const fase = faseAtualizacao(atualizacao);
  const emCurso = fase === "andamento";
  const ajuda = sincronizavel
    ? explicarAtualizacao(competencia, competenciaAtual)
    : "Nenhuma conta Mercado Livre ativa e conectada — não há o que sincronizar.";
  const rotuloHover = competencia === competenciaAtual ? "Atualizar até hoje" : "Reprocessar o mês";

  let icone = "↻";
  let rotulo = "Atualizar";
  let estadoAcessivel = "";
  if (emCurso) {
    rotulo = progressoBotao(atualizacao.job);
    estadoAcessivel = ` — ${rotulo.toLowerCase()}`;
  } else if (fase === "ok") {
    icone = "✓";
    rotulo = "Atualizado";
    estadoAcessivel = " — atualizado";
  } else if (fase === "falha" || fase === "pendencia") {
    icone = null;
    rotulo = `${fase === "falha" ? "Falhou" : "Pendências"} · tentar novamente`;
    estadoAcessivel = ` — ${fase === "falha" ? "falhou" : "concluída com pendências"}, tentar novamente`;
  }
  const trocaNoHover = sincronizavel && (fase === "normal" || fase === "ok");

  return (
    <button
      type="button"
      className={`vf-btn vf-btn--ghost vf-btn--sm vf-ph-atualizar is-${fase}${trocaNoHover ? " tem-hover" : ""}`}
      onClick={() => onAtualizar(cliente.id)}
      disabled={emCurso || !sincronizavel}
      aria-label={`Atualizar dados de ${cliente.nome}${estadoAcessivel}`}
      title={emCurso ? "Atualização em andamento" : ajuda}
    >
      <span className="vf-ph-atualizar__rotulos">
        <span className="vf-ph-atualizar__rotulo">
          {icone && <span aria-hidden="true" className={`vf-ph-atualizar__icone${emCurso ? " is-girando" : ""}`}>{icone}</span>}
          {rotulo}
        </span>
        {trocaNoHover && (
          <span className="vf-ph-atualizar__rotulo vf-ph-atualizar__rotulo--hover" aria-hidden="true">
            <span className="vf-ph-atualizar__icone">↻</span>
            {rotuloHover}
          </span>
        )}
      </span>
    </button>
  );
}

// Na âncora, só O QUE está acontecendo (período); a contagem de contas mora
// no botão ↻ — as duas peças juntas, sem repetir nenhuma.
function progressoTexto(job, competencia, competenciaAtual) {
  const mesCompleto = job ? job.periodo?.mesCompleto : competencia !== competenciaAtual;
  return mesCompleto ? "Reprocessando o mês" : "Atualizando até hoje";
}

// Desfecho da atualização com pendência ou falha: logo abaixo do cliente,
// visível mesmo com a linha recolhida — diz QUAL conta e POR QUÊ.
function LinhaAtualizacao({ cliente, atualizacao, colSpan, onAtualizar, onDispensar }) {
  const { job, erro } = atualizacao;
  const rotuloConta = (id) => cliente.contas?.find((c) => c.id === id)?.rotulo || `Conta #${id}`;
  const pendentes = (job?.contas || []).filter((c) => c.estado !== "ok");
  const falhou = Boolean(erro) || job?.estado === "falhou";
  const titulo = erro
    ? `Não foi possível atualizar: ${erro.mensagem}`
    : `${falhou ? "Atualização falhou" : "Atualização concluída com pendências"}`
      + `${job?.concluidaEm ? ` às ${formatarDataHora(job.concluidaEm).slice(-5)}` : ""} · ${job?.mensagem || ""}`;
  const podeTentar = !erro || erro.status !== 403;
  return (
    <tr className={`vf-ph-row vf-ph-row--atualizacao ${falhou ? "is-falha" : "is-pendencia"}`}>
      <td colSpan={colSpan}>
        <div className="vf-ph-atualizacao" role="status">
          <p className="vf-ph-atualizacao__titulo">{titulo}</p>
          {pendentes.length > 0 && (
            <ul className="vf-ph-atualizacao__contas">
              {pendentes.map((c) => (
                <li key={c.contaId} className={`vf-ph-atualizacao__conta is-${c.estado}`}>
                  <span className="vf-ph-atualizacao__conta-rotulo">{rotuloConta(c.contaId)}</span>
                  {" — "}
                  {c.mensagem || (c.estado === "falha" ? "falhou" : "pendente")}
                </li>
              ))}
            </ul>
          )}
          <span className="vf-ph-atualizacao__acoes">
            {podeTentar && (
              <button type="button" className="vf-btn vf-btn--sm" onClick={() => onAtualizar(cliente.id)}>Tentar de novo</button>
            )}
            <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => onDispensar(cliente.id)}>Dispensar</button>
          </span>
        </div>
      </td>
    </tr>
  );
}

// Área de expansão: o BOTÃO ocupa a célula inteira, não só o chevron.
function CelulaExpansivel({ aberto, onClick, rotuloAcessivel, nivel, children }) {
  return (
    <th scope="row" className="vf-table__sticky-cell vf-ph-ancora">
      <button
        type="button"
        className={`vf-ph-toggle vf-ph-toggle--${nivel}`}
        onClick={onClick}
        aria-expanded={aberto}
        aria-label={rotuloAcessivel}
      >
        <svg className="vf-ph-chevron" data-aberto={aberto ? "true" : "false"} aria-hidden="true" viewBox="0 0 12 12" focusable="false">
          <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="vf-ph-ancora__conteudo">{children}</span>
      </button>
    </th>
  );
}

function LinhaEstado({ colSpan, children, tom = "" }) {
  return (
    <tr className={`vf-ph-row vf-ph-row--estado ${tom}`}>
      <td colSpan={colSpan}>{children}</td>
    </tr>
  );
}

// Loading da expansão como LINHAS de esqueleto: a tabela não salta.
function LinhasEsqueleto({ colSpan, linhas = 2, rotulo }) {
  return (
    <>
      {Array.from({ length: linhas }).map((_, i) => (
        <tr key={i} className="vf-ph-row vf-ph-row--esqueleto" aria-hidden={i > 0}>
          <td colSpan={colSpan}>
            {i === 0 && <span className="vf-visually-hidden">{rotulo}</span>}
            <span className="vf-skeleton vf-skeleton--row" />
          </td>
        </tr>
      ))}
    </>
  );
}

function LinhaErro({ colSpan, mensagem, onTentar }) {
  return (
    <tr className="vf-ph-row vf-ph-row--estado is-erro">
      <td colSpan={colSpan}>
        <span className="vf-ph-erro__texto">{mensagem}</span>
        <button type="button" className="vf-btn vf-btn--sm" onClick={onTentar}>Tentar novamente</button>
      </td>
    </tr>
  );
}

function textoAcoes(n) {
  return n === 1 ? "1 conta precisa de ação" : `${n} contas precisam de ação`;
}

function BotaoLancar({ rotulo, onClick, editar = false }) {
  return (
    <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm vf-ph-lancar" onClick={onClick} aria-label={rotulo}>
      {editar ? "Editar manual" : "Lançar dados"}
    </button>
  );
}

function LinhaSemana({ semana, colunas, origem = "consolidado" }) {
  const intervalo = `${String(semana.de).slice(8)}–${String(semana.ate).slice(8)}`;
  return (
    <tr className={`vf-ph-row vf-ph-row--semana vf-ph-row--semana-${origem}`}>
      <th scope="row" className="vf-table__sticky-cell vf-ph-ancora">
        <span className={`vf-ph-indent ${origem === "conta" ? "vf-ph-indent--2" : "vf-ph-indent--3"}`}>
          <span className="vf-ph-semana__rotulo">{semana.semana}</span>
          <span className="vf-ph-semana__dias">{intervalo}</span>
        </span>
      </th>
      <td className="vf-table__sticky-cell vf-ph-contexto" />
      {colunas.map((c) => (
        <Celula key={c.chave} coluna={c} valor={semana.resumo?.[c.chave] ?? null} />
      ))}
      <td className="vf-ph-folga" />
    </tr>
  );
}

function LinhaMes({ clienteId, clienteNome, mes, selecionada, aberto, onAlternar, semanasPorChave, carregarSemanas, colunas }) {
  const chave = `${clienteId}:${mes.competencia}`;
  const estado = semanasPorChave[chave];
  const colSpan = colunas.length + 3;
  const rotulo = rotularCompetenciaCurta(mes.competencia);

  useEffect(() => {
    if (aberto && !estado) carregarSemanas(clienteId, mes.competencia);
  }, [aberto, estado, carregarSemanas, clienteId, mes.competencia]);

  return (
    <>
      <tr className={`vf-ph-row vf-ph-row--mes${selecionada ? " is-selecionada" : ""}`}>
        <CelulaExpansivel
          aberto={aberto}
          onClick={onAlternar}
          nivel="mes"
          rotuloAcessivel={`Competência ${rotulo} de ${clienteNome} — ${aberto ? "recolher" : "expandir"} semanas`}
        >
          <span className="vf-ph-indent vf-ph-indent--2">
            <span className="vf-ph-mes__rotulo">{rotulo}</span>
            {selecionada && <span className="vf-ph-meta"> · selecionada</span>}
          </span>
        </CelulaExpansivel>
        <td className="vf-table__sticky-cell vf-ph-contexto">
          {mes.sincronizadoEm && (
            <span className="vf-ph-meta" title={`Snapshot sincronizado em ${formatarDataHora(mes.sincronizadoEm)}`}>
              sync {formatarData(mes.sincronizadoEm)}
            </span>
          )}
        </td>
        {colunas.map((c) => (
          <Celula key={c.chave} coluna={c} valor={mes.resumo?.[c.chave] ?? null} variacao={mes.variacaoVsMesAnterior?.[c.chave]} />
        ))}
        <td className="vf-ph-folga" />
      </tr>

      {aberto && estado?.carregando && <LinhasEsqueleto colSpan={colSpan} linhas={2} rotulo="Carregando semanas" />}
      {aberto && estado?.erro && !estado.carregando && (
        <LinhaErro
          colSpan={colSpan}
          mensagem={`Não foi possível carregar as semanas. ${estado.erro.mensagem}`}
          onTentar={() => carregarSemanas(clienteId, mes.competencia, { forcar: true })}
        />
      )}
      {aberto && estado?.semanas && estado.semanas.length === 0 && (
        <LinhaEstado colSpan={colSpan}>Sem dia sincronizado nesta competência.</LinhaEstado>
      )}
      {aberto && estado?.semanas?.map((s) => <LinhaSemana key={s.semana} semana={s} colunas={colunas} />)}
    </>
  );
}

// Estado da conta DENTRO de uma atualização em curso/terminada: só aparece
// quando diz algo (pendente = sincronizando agora; falha/parcial = por quê).
function EstadoNaAtualizacao({ estadoConta, emCurso }) {
  if (!estadoConta) return null;
  if (estadoConta.estado === "pendente" && emCurso) {
    return <span className="vf-ph-meta vf-ph-conta__sync"><span className="vf-spinner vf-spinner--sm vf-ph-spinner" aria-hidden="true" /> sincronizando…</span>;
  }
  if (estadoConta.estado === "falha") {
    return <span className="vf-ph-conta__sync is-falha" title={estadoConta.mensagem || undefined}>· falhou na atualização</span>;
  }
  return null;
}

// "Mercado Livre 1 · AMARO SOLUÇÕES" → canal em primeiro plano, operação em
// tom secundário. O texto é o mesmo rótulo do servidor, só em dois pesos.
function RotuloConta({ rotulo }) {
  const texto = String(rotulo ?? "");
  const i = texto.indexOf(" · ");
  if (i < 0) return <span className="vf-ph-conta__canal">{texto}</span>;
  return (
    <>
      <span className="vf-ph-conta__canal">{texto.slice(0, i)}</span>
      <span className="vf-ph-conta__operacao"> · {texto.slice(i + 3)}</span>
    </>
  );
}

function LinhaConta({
  cliente, competencia, conta, colunas, onLancar, atualizacao,
  aberto, onAlternar, estadoSemanas, carregarSemanasContas,
}) {
  const semDado = !conta.resumo;
  const manualSubstituido = conta.manual?.substituidoPorAutomatico;
  const adsPorCliente = conta.fonte?.tipo !== "manual";
  const estadoConta = atualizacao?.job?.contas?.find((c) => c.contaId === conta.id) || null;
  // Motivo só quando acrescenta: "Sem integração" já diz o que o motivo diria,
  // e a conta sincronizando AGORA mostra isso, não o erro da rodada anterior.
  const sincronizandoAgora = estadoConta?.estado === "pendente" && atualizacaoEmCurso(atualizacao);
  const motivo = semDado && !sincronizandoAgora && conta.status?.motivo && conta.status.codigo !== "sem_integracao"
    ? conta.status.motivo
    : null;
  const colSpan = colunas.length + 3;
  const semanasConta = estadoSemanas?.contas?.find((item) => Number(item.contaId) === Number(conta.id))?.semanas;

  useEffect(() => {
    if (aberto && !estadoSemanas) carregarSemanasContas(cliente.id, competencia);
  }, [aberto, estadoSemanas, carregarSemanasContas, cliente.id, competencia]);

  return (
    <>
      <tr className={`vf-ph-row vf-ph-row--conta${semDado ? " is-sem-dado" : ""}${conta.ativa ? "" : " is-inativa"}${conta.precisaAcao ? " is-acao" : ""}${aberto ? " is-aberta" : ""}`}>
        <CelulaExpansivel
          aberto={aberto}
          onClick={onAlternar}
          nivel="conta"
          rotuloAcessivel={`Conta ${conta.rotulo} — ${aberto ? "recolher" : "expandir"} semanas`}
        >
          <span className="vf-ph-indent">
            <span className="vf-ph-conta__rotulo" title={conta.rotulo}><RotuloConta rotulo={conta.rotulo} /></span>
            <span className="vf-ph-conta__meta">
              <StatusCompacto status={conta.status} />
              {motivo && <span className="vf-ph-meta vf-ph-conta__motivo">· {motivo}</span>}
              {!semDado && conta.dadosAte && (
                <span
                  className="vf-ph-meta"
                  title={`Dados até ${formatarData(conta.dadosAte)}${conta.atualizadoEm ? ` · atualizado ${formatarDataHora(conta.atualizadoEm)}` : ""}`}
                >
                  · dados até {dataCurta(conta.dadosAte, competencia)}
                </span>
              )}
              {conta.avisos?.length > 0 && (
                <span className="vf-ph-aviso" title={conta.avisos.join("\n")} aria-label={conta.avisos.join(". ")}>⚠</span>
              )}
              <EstadoNaAtualizacao estadoConta={estadoConta} emCurso={atualizacaoEmCurso(atualizacao)} />
              {manualSubstituido && (
                <span
                  className="vf-ph-meta"
                  title={`Lançamento manual guardado (FAT ${formatarMoeda(conta.manual.valores?.fat, { casas: 0 })}${conta.manual.atualizadoPor ? `, por ${conta.manual.atualizadoPor}` : ""}) — o dado automático é o exibido.`}
                >
                  · manual substituído pelo automático
                </span>
              )}
            </span>
          </span>
        </CelulaExpansivel>
        <td className="vf-table__sticky-cell vf-ph-contexto">
          {conta.fonte && <span className="vf-ph-meta" title={`Fonte do dado: ${conta.fonte.rotulo}`}>{conta.fonte.rotulo}</span>}
          {conta.podeLancarManual && (
            <BotaoLancar
              rotulo={`${conta.fonte?.tipo === "manual" ? "Editar manual" : "Lançar dados"} — ${conta.rotulo}`}
              editar={conta.fonte?.tipo === "manual"}
              onClick={() => onLancar(cliente, conta)}
            />
          )}
        </td>
        {colunas.map((c) => {
          const semAdsPorConta = c.grupo === "ads" && adsPorCliente;
          return (
            <Celula
              key={c.chave}
              coluna={c}
              valor={semAdsPorConta ? null : conta.resumo?.[c.chave] ?? null}
              titulo={semAdsPorConta ? NOTA_ADS_POR_CONTA : undefined}
              custos={conta.custos}
            />
          );
        })}
        <td className="vf-ph-folga" />
      </tr>
      {aberto && estadoSemanas?.carregando && <LinhasEsqueleto colSpan={colSpan} linhas={2} rotulo="Carregando semanas da conta" />}
      {aberto && estadoSemanas?.erro && !estadoSemanas.carregando && (
        <LinhaErro
          colSpan={colSpan}
          mensagem={`Não foi possível carregar as semanas da conta. ${estadoSemanas.erro.mensagem}`}
          onTentar={() => carregarSemanasContas(cliente.id, competencia, { forcar: true })}
        />
      )}
      {aberto && Array.isArray(semanasConta) && semanasConta.length === 0 && (
        <LinhaEstado colSpan={colSpan}>Sem dados semanais reais para esta conta na competência.</LinhaEstado>
      )}
      {aberto && semanasConta?.map((semana) => (
        <LinhaSemana key={semana.semana} semana={semana} colunas={colunas} origem="conta" />
      ))}
    </>
  );
}

// Composição do faturamento: gatilho na expansão do cliente + demonstrativo
// por conta (lazy). Só existe quando alguma conta ativa tem pedidos
// importados — conta manual não tem pedido para compor.
export function temComposicao(cliente) {
  return (cliente.contas || []).some((c) => c.ativa && c.importId != null);
}

function LinhasComposicao({ cliente, competencia, aberto, onAlternar, estado, carregar, colSpan }) {
  useEffect(() => {
    if (aberto && !estado) carregar(cliente.id, competencia);
  }, [aberto, estado, carregar, cliente.id, competencia]);

  return (
    <>
      <tr className="vf-ph-row vf-ph-row--historico vf-ph-row--composicao-gatilho">
        <CelulaExpansivel
          aberto={aberto}
          onClick={onAlternar}
          nivel="historico"
          rotuloAcessivel={`Composição do faturamento de ${cliente.nome} por conta — ${aberto ? "recolher" : "expandir"}`}
        >
          <span className="vf-ph-indent">
            <span className="vf-ph-historico__rotulo">Composição do faturamento</span>
            <span className="vf-ph-meta"> · por conta</span>
          </span>
        </CelulaExpansivel>
        <td colSpan={colSpan - 1} />
      </tr>
      {aberto && estado?.carregando && <LinhasEsqueleto colSpan={colSpan} linhas={1} rotulo="Carregando composição do faturamento" />}
      {aberto && estado?.erro && !estado.carregando && (
        <LinhaErro
          colSpan={colSpan}
          mensagem={`Não foi possível carregar a composição. ${estado.erro.mensagem}`}
          onTentar={() => carregar(cliente.id, competencia, { forcar: true })}
        />
      )}
      {aberto && estado?.contas && !estado.carregando && (
        <tr className="vf-ph-row vf-ph-row--composicao">
          <td colSpan={colSpan}>
            <DemonstrativoComposicao contas={estado.contas} somaDasContas={estado.somaDasContas} competencia={competencia} />
          </td>
        </tr>
      )}
    </>
  );
}

function LinhaHistorico({ cliente, aberto, onAlternar, colunas }) {
  return (
    <tr className="vf-ph-row vf-ph-row--historico">
      <CelulaExpansivel
        aberto={aberto}
        onClick={onAlternar}
        nivel="historico"
        rotuloAcessivel={`Consolidado semanal do cliente ${cliente.nome} — ${aberto ? "recolher" : "expandir"} histórico`}
      >
        <span className="vf-ph-indent">
          <span className="vf-ph-historico__rotulo">Consolidado semanal do cliente</span>
          <span className="vf-ph-meta"> · histórico mensal</span>
        </span>
      </CelulaExpansivel>
      <td className="vf-table__sticky-cell vf-ph-contexto" />
      <td colSpan={colunas.length} />
      <td className="vf-ph-folga" />
    </tr>
  );
}

// Segunda linha do cliente: estado compacto + UMA frase de ação/motivo.
// Nunca repete o que o escopo (linha de cima) ou o contexto (ao lado) já diz.
// Mora DENTRO do botão da âncora — por isso "N contas precisam de ação" é
// texto, não outro botão: clicar nele já abre o cliente e mostra as contas.
// Sem dado, o motivo/ação desce para uma linha própria — ele é a informação
// da linha, então não pode ser o primeiro a ser cortado:
//   Cliente X            Mercado Livre 1 · LOJA
//   ○ Sem dados em set/2026
//   Mercado Livre não conectado · último dado: ago/2026
function MetaCliente({ cliente, competencia, competenciaAtual, atualizacao }) {
  const emCurso = atualizacaoEmCurso(atualizacao);
  const acoes = cliente.escopo?.contasPrecisamAcao
    ?? (cliente.contas || []).filter((c) => c.precisaAcao).length;
  const semDado = !cliente.resumo;
  const ultimo = semDado && cliente.ultimaCompetenciaComDado && cliente.ultimaCompetenciaComDado !== competencia
    ? cliente.ultimaCompetenciaComDado
    : null;

  let detalhe = null;
  if (emCurso) {
    detalhe = <span className="vf-ph-progresso">{progressoTexto(atualizacao.job, competencia, competenciaAtual)}</span>;
  } else if (acoes > 0) {
    detalhe = <span className="vf-ph-acoes">{textoAcoes(acoes)}</span>;
  } else if (semDado && cliente.status?.motivo) {
    detalhe = <span className="vf-ph-motivo" title={cliente.status.motivo}>{cliente.status.motivo}</span>;
  }

  const status = (
    <StatusCompacto
      status={cliente.status}
      rotulo={semDado && cliente.status?.codigo === "sem_dados" ? `Sem dados em ${rotularCompetenciaCurta(competencia)}` : undefined}
    />
  );
  const ultimoDado = ultimo && <span className="vf-ph-meta vf-ph-ultimo">último dado: {rotularCompetenciaCurta(ultimo)}</span>;

  if (semDado) {
    return (
      <span className="vf-ph-cliente__meta vf-ph-cliente__meta--vazio">
        <span className="vf-ph-cliente__meta-linha">{status}</span>
        {(detalhe || ultimoDado) && <span className="vf-ph-cliente__meta-linha">{detalhe}{ultimoDado}</span>}
      </span>
    );
  }
  return (
    <span className="vf-ph-cliente__meta">
      {status}
      {detalhe}
      {ultimoDado}
    </span>
  );
}

function LinhaCliente({
  cliente, competencia, competenciaAtual, expansao,
  mesesPorCliente, carregarMeses, semanasPorChave, carregarSemanas,
  semanasContasPorCliente, carregarSemanasContas,
  composicaoPorCliente = {}, carregarComposicao = () => {},
  colunas, onLancar, atualizacao, podeAtualizar, onAtualizar, onDispensar,
  mostrarHistoricoCliente = true,
}) {
  const aberto = expansao.clientesAbertos.has(cliente.id);
  // O histórico mensal é o snapshot CONSOLIDADO do cliente (Central/ML): numa
  // seção Shopee/TikTok ele mostraria número de outro marketplace.
  const historicoAberto = mostrarHistoricoCliente && expansao.historicosAbertos.has(cliente.id);
  const estado = mesesPorCliente[cliente.id];
  const estadoSemanasContas = semanasContasPorCliente[`${cliente.id}:${competencia}`];
  const colSpan = colunas.length + 3;
  const semDado = !cliente.resumo;
  const emCurso = atualizacaoEmCurso(atualizacao);
  const job = atualizacao?.job;
  const mostrarDesfecho = !emCurso && atualizacao
    && (atualizacao.erro || job?.estado === "falhou" || job?.estado === "concluida_com_pendencias");

  // Lazy de verdade: o histórico nasce de a linha de HISTÓRICO estar aberta.
  useEffect(() => {
    if (aberto && historicoAberto && !estado) carregarMeses(cliente.id);
  }, [aberto, historicoAberto, estado, carregarMeses, cliente.id]);

  return (
    <>
      <tr className={`vf-ph-row vf-ph-row--cliente${semDado ? " is-sem-dado" : ""}${cliente.status?.precisaAtencao ? " is-atencao" : ""}${emCurso ? " is-atualizando-linha" : ""}${aberto ? " is-aberto" : ""}`}>
        <CelulaExpansivel
          aberto={aberto}
          onClick={() => expansao.alternarCliente(cliente.id)}
          nivel="cliente"
          rotuloAcessivel={`Cliente ${cliente.nome} — ${aberto ? "recolher" : "expandir"} contas`}
        >
          <span className="vf-ph-cliente">
            <span className="vf-ph-cliente__linha">
              <span className="vf-ph-cliente__nome">{cliente.nome}</span>
              {cliente.escopo?.rotulo && <span className="vf-ph-escopo">{cliente.escopo.rotulo}</span>}
            </span>
            <MetaCliente cliente={cliente} competencia={competencia} competenciaAtual={competenciaAtual} atualizacao={atualizacao} />
          </span>
        </CelulaExpansivel>

        <td className="vf-table__sticky-cell vf-ph-contexto">
          <span className="vf-ph-contexto__linha vf-ph-contexto__topo">
            {cliente.squad
              ? <span className={`vf-tag vf-ph-tag ${TOM_SQUAD}`} title={`Squad: ${cliente.squad.nome}`}>{cliente.squad.nome}</span>
              : <span className="vf-ph-meta is-vazio">sem squad</span>}
            {podeAtualizar && (
              <BotaoAtualizar
                cliente={cliente}
                competencia={competencia}
                competenciaAtual={competenciaAtual}
                atualizacao={atualizacao}
                onAtualizar={onAtualizar}
              />
            )}
          </span>
          <FrescorCliente cliente={cliente} concluidaAgora={job?.estado === "concluida"} />
        </td>

        {colunas.map((c) => <Celula key={c.chave} coluna={c} valor={cliente.resumo?.[c.chave] ?? null} custos={cliente.custos} />)}
        <td className="vf-ph-folga" />
      </tr>

      {mostrarDesfecho && (
        <LinhaAtualizacao
          cliente={cliente}
          atualizacao={atualizacao}
          colSpan={colSpan}
          onAtualizar={onAtualizar}
          onDispensar={onDispensar}
        />
      )}

      {aberto && cliente.contas?.map((conta) => (
        <LinhaConta
          key={conta.id}
          cliente={cliente}
          competencia={competencia}
          conta={conta}
          colunas={colunas}
          onLancar={onLancar}
          atualizacao={atualizacao}
          aberto={expansao.contasAbertas.has(`${cliente.id}:${conta.id}`)}
          onAlternar={() => expansao.alternarConta(cliente.id, conta.id)}
          estadoSemanas={estadoSemanasContas}
          carregarSemanasContas={carregarSemanasContas}
        />
      ))}
      {aberto && (!cliente.contas || cliente.contas.length === 0) && (
        <LinhaEstado colSpan={colSpan}>
          Nenhuma conta/operação cadastrada — cadastre a operação em <a href="clientes.html">Clientes</a> para separar o número por conta.
        </LinhaEstado>
      )}
      {aberto && temComposicao(cliente) && (
        <LinhasComposicao
          cliente={cliente}
          competencia={competencia}
          aberto={expansao.composicoesAbertas.has(cliente.id)}
          onAlternar={() => expansao.alternarComposicao(cliente.id)}
          estado={composicaoPorCliente[`${cliente.id}:${competencia}`]}
          carregar={carregarComposicao}
          colSpan={colSpan}
        />
      )}
      {aberto && mostrarHistoricoCliente && (
        <LinhaHistorico
          cliente={cliente}
          aberto={historicoAberto}
          onAlternar={() => expansao.alternarHistorico(cliente.id)}
          colunas={colunas}
        />
      )}
      {aberto && historicoAberto && estado?.carregando && (
        <LinhasEsqueleto colSpan={colSpan} linhas={3} rotulo="Carregando histórico" />
      )}
      {aberto && historicoAberto && estado?.erro && !estado.carregando && (
        <LinhaErro
          colSpan={colSpan}
          mensagem={`Não foi possível carregar o histórico. ${estado.erro.mensagem}`}
          onTentar={() => carregarMeses(cliente.id, { forcar: true })}
        />
      )}
      {aberto && historicoAberto && estado?.meses && estado.meses.length === 0 && (
        <LinhaEstado colSpan={colSpan}>Sem competência sincronizada em {String(competencia).slice(0, 4)}.</LinhaEstado>
      )}
      {aberto && historicoAberto && estado?.meses?.map((mes) => (
        <LinhaMes
          key={mes.competencia}
          clienteId={cliente.id}
          clienteNome={cliente.nome}
          mes={mes}
          selecionada={mes.competencia === competencia}
          aberto={expansao.mesesAbertos.has(`${cliente.id}:${mes.competencia}`)}
          onAlternar={() => expansao.alternarMes(cliente.id, mes.competencia)}
          semanasPorChave={semanasPorChave}
          carregarSemanas={carregarSemanas}
          colunas={colunas}
        />
      ))}
    </>
  );
}

// ── Expansão ────────────────────────────────────────────────────────────────
// Estado elevado para fora das linhas porque "Recolher tudo" precisa alcançar
// todas de uma vez. Recolher é 100% local: não cancela, não descarta cache e
// não dispara requisição nenhuma.
function alternarEm(setter, chave) {
  setter((prev) => {
    const proximo = new Set(prev);
    if (proximo.has(chave)) proximo.delete(chave);
    else proximo.add(chave);
    return proximo;
  });
}

export function useExpansao() {
  const [clientesAbertos, setClientesAbertos] = useState(() => new Set());
  const [contasAbertas, setContasAbertas] = useState(() => new Set());
  const [historicosAbertos, setHistoricosAbertos] = useState(() => new Set());
  const [mesesAbertos, setMesesAbertos] = useState(() => new Set());
  const [composicoesAbertas, setComposicoesAbertas] = useState(() => new Set());

  const alternarCliente = useCallback((id) => alternarEm(setClientesAbertos, id), []);
  const alternarConta = useCallback((clienteId, contaId) => alternarEm(setContasAbertas, `${clienteId}:${contaId}`), []);
  const alternarHistorico = useCallback((id) => alternarEm(setHistoricosAbertos, id), []);
  const alternarMes = useCallback((clienteId, competencia) => alternarEm(setMesesAbertos, `${clienteId}:${competencia}`), []);
  const alternarComposicao = useCallback((id) => alternarEm(setComposicoesAbertas, id), []);

  const recolherTudo = useCallback(() => {
    setClientesAbertos(new Set());
    setContasAbertas(new Set());
    setHistoricosAbertos(new Set());
    setMesesAbertos(new Set());
    setComposicoesAbertas(new Set());
  }, []);

  return {
    clientesAbertos, contasAbertas, historicosAbertos, mesesAbertos, composicoesAbertas,
    alternarCliente, alternarConta, alternarHistorico, alternarMes, alternarComposicao, recolherTudo,
    temExpandido: clientesAbertos.size > 0,
  };
}

// ── Ordenação ───────────────────────────────────────────────────────────────
// Client-side, sobre a lista JÁ carregada, e SÓ no nível cliente: contas
// acompanham o cliente e meses são cronológicos por natureza.
function compararTexto(a, b) {
  return String(a || "").localeCompare(String(b || ""), "pt-BR", { sensitivity: "base" });
}

export function ordenarClientes(clientes, ordem) {
  if (!ordem?.chave) return clientes;
  const { chave, ascendente } = ordem;
  const fator = ascendente ? 1 : -1;

  return [...clientes].sort((a, b) => {
    if (chave === "nome") return compararTexto(a.nome, b.nome) * fator;
    if (chave === "squad") {
      if (!a.squad && !b.squad) return compararTexto(a.nome, b.nome);
      if (!a.squad) return 1;
      if (!b.squad) return -1;
      const porSquad = compararTexto(a.squad.nome, b.squad.nome) * fator;
      return porSquad !== 0 ? porSquad : compararTexto(a.nome, b.nome);
    }
    // Ausência de dado nunca disputa posição: vai para o fim nos dois sentidos.
    const va = a.resumo?.[chave];
    const vb = b.resumo?.[chave];
    const aAusente = ehAusente(va);
    const bAusente = ehAusente(vb);
    if (aAusente && bAusente) return compararTexto(a.nome, b.nome);
    if (aAusente) return 1;
    if (bAusente) return -1;
    if (Number(va) === Number(vb)) return compararTexto(a.nome, b.nome);
    return (Number(va) - Number(vb)) * fator;
  });
}

function BotaoOrdenar({ chave, label, titulo, ordem, onOrdenar }) {
  const ativo = ordem?.chave === chave;
  const classe = ativo ? (ordem.ascendente ? "is-asc" : "is-desc") : "";
  return (
    <button
      type="button"
      className={`vf-table__sort ${classe}`}
      onClick={() => onOrdenar(chave)}
      aria-label={`Ordenar clientes por ${titulo || label}`}
      title={titulo}
    >
      <span>{label}</span>
    </button>
  );
}

export function TabelaHierarquica({
  clientes, competencia, competenciaAtual = competencia, colunas: colunasProp, grupos, expansao,
  mesesPorCliente, carregarMeses, semanasPorChave, carregarSemanas,
  semanasContasPorCliente = {}, carregarSemanasContas = () => {},
  composicaoPorCliente = {}, carregarComposicao = () => {},
  atualizando, onLancar = () => {},
  atualizacoes = {}, podeAtualizar = false, onAtualizar = () => {}, onDispensarAtualizacao = () => {},
  mostrarHistoricoCliente = true,
}) {
  // `inicioGrupo` é só apresentação (divisor vertical entre grupos, do
  // cabeçalho ao corpo); a lista e a ordem das colunas não mudam.
  const colunas = useMemo(
    () => (colunasProp ?? colunasVisiveis(grupos)).map((c, i, todas) => ({
      ...c,
      inicioGrupo: i > 0 && todas[i - 1].grupo !== c.grupo,
    })),
    [colunasProp, grupos],
  );
  const cabecalhoGrupos = useMemo(() => gruposVisiveis(grupos), [grupos]);
  const [ordem, setOrdem] = useState(null);

  const ordenados = useMemo(() => ordenarClientes(clientes, ordem), [clientes, ordem]);

  const ordenar = useCallback((chave) => {
    setOrdem((prev) => {
      if (prev?.chave !== chave) return { chave, ascendente: chave === "nome" || chave === "squad" };
      if (prev.ascendente !== (chave === "nome" || chave === "squad")) return null; // 3º clique: ordem do servidor
      return { chave, ascendente: !prev.ascendente };
    });
  }, []);

  // A segunda linha do cabeçalho gruda logo abaixo da primeira — altura medida.
  const linhaGrupoRef = useRef(null);
  const [alturaGrupo, setAlturaGrupo] = useState(0);
  useLayoutEffect(() => {
    const el = linhaGrupoRef.current;
    if (!el) return undefined;
    const medir = () => setAlturaGrupo(el.getBoundingClientRect().height);
    medir();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [cabecalhoGrupos.length]);

  // Altura do corpo rolável MEDIDA: o que vem depois da tabela é descontado.
  const wrapRef = useRef(null);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const ajustar = () => {
      wrap.style.maxHeight = "";
      const caixa = wrap.getBoundingClientRect();
      const topoNoDocumento = caixa.top + window.scrollY;
      const irmaos = Array.from(wrap.parentElement?.children || []);
      const depoisDaTabela = irmaos
        .slice(irmaos.indexOf(wrap) + 1)
        .reduce((soma, el) => soma + el.getBoundingClientRect().height, 0);
      const respiro = 28;
      const disponivel = window.innerHeight - topoNoDocumento - depoisDaTabela - respiro;
      wrap.style.maxHeight = `${Math.max(220, Math.round(disponivel))}px`;
    };
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  });

  return (
    <div ref={wrapRef} className={`vf-table-wrap vf-ph-wrap${atualizando ? " is-atualizando" : ""}`}>
      <table className="vf-table vf-table--compact vf-ph-table" style={{ "--vf-ph-head-2": `${alturaGrupo}px` }}>
        <caption className="vf-visually-hidden">
          Clientes da carteira na competência selecionada. Cada linha é o número consolidado do cliente; ao expandir,
          aparecem as contas/operações expansíveis por semana e o histórico do consolidado semanal do cliente.
        </caption>
        <thead>
          <tr className="vf-ph-thead-grupos" ref={linhaGrupoRef}>
            <th scope="col" rowSpan={2} className="vf-table__sticky-cell vf-ph-th-ancora">
              {/* "Recolher tudo" no cabeçalho preso: sempre à mão durante o
                  scroll, e aparecer/sumir não desloca a tabela. */}
              <span className="vf-ph-th-ancora__conteudo">
                <BotaoOrdenar chave="nome" label="Cliente / Conta" titulo="nome do cliente" ordem={ordem} onOrdenar={ordenar} />
                {expansao.temExpandido && (
                  <button type="button" className="vf-ph-recolher" onClick={expansao.recolherTudo}>Recolher tudo</button>
                )}
              </span>
            </th>
            <th scope="col" rowSpan={2} className="vf-table__sticky-cell vf-ph-th-contexto">
              <BotaoOrdenar chave="squad" label="Contexto" titulo="Squad" ordem={ordem} onOrdenar={ordenar} />
            </th>
            {cabecalhoGrupos.map((g) => (
              <th key={g.chave} scope="colgroup" colSpan={g.colunas.length} className={`vf-ph-th-grupo${g.disponivel ? "" : " is-indisponivel"}`}>
                {g.label}
                {!g.disponivel && <span className="vf-ph-th-grupo__nota" title={g.nota}>sem fonte</span>}
              </th>
            ))}
            <th rowSpan={2} className="vf-ph-folga" aria-hidden="true" />
          </tr>
          <tr className="vf-ph-thead-metricas">
            {colunas.map((c, i) => (
              <th
                key={c.chave}
                scope="col"
                className={[
                  "num vf-ph-th-metrica",
                  c.tipo === "indisponivel" ? "is-indisponivel" : "",
                  i === 0 || colunas[i - 1].grupo !== c.grupo ? "is-primeira-do-grupo" : "",
                ].filter(Boolean).join(" ")}
              >
                {c.tipo === "indisponivel"
                  ? <abbr title={c.definicao}>{c.label}</abbr>
                  : <BotaoOrdenar chave={c.chave} label={c.label} titulo={c.definicao} ordem={ordem} onOrdenar={ordenar} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordenados.map((cliente) => (
            <LinhaCliente
              key={cliente.id}
              cliente={cliente}
              competencia={competencia}
              expansao={expansao}
              mesesPorCliente={mesesPorCliente}
              carregarMeses={carregarMeses}
              semanasPorChave={semanasPorChave}
              carregarSemanas={carregarSemanas}
              semanasContasPorCliente={semanasContasPorCliente}
              carregarSemanasContas={carregarSemanasContas}
              composicaoPorCliente={composicaoPorCliente}
              carregarComposicao={carregarComposicao}
              colunas={colunas}
              onLancar={onLancar}
              competenciaAtual={competenciaAtual}
              atualizacao={atualizacoes[cliente.id]?.competencia === competencia ? atualizacoes[cliente.id] : null}
              podeAtualizar={podeAtualizar}
              onAtualizar={onAtualizar}
              onDispensar={onDispensarAtualizacao}
              mostrarHistoricoCliente={mostrarHistoricoCliente}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
