// frontend-react/src/components/painelContas/TabelaHierarquica.jsx
//
// Tabela hierárquica do Painel de Contas operacional. Continua sendo uma
// TABELA (não cards): comparar muitos clientes depende de colunas alinhadas.
// Construída sobre `.vf-table` (Fundação Global V2); o específico deste padrão
// mora em TabelaHierarquica.css.
//
// ── Os níveis ────────────────────────────────────────────────────────────
// CLIENTE    → o número CONSOLIDADO da competência selecionada, com o escopo
//              escrito na linha ("Consolidado · 3 contas", "Consolidado · 2 de
//              3 contas", "Mercado Livre 1 · X"), status, fonte e frescor.
//              Sem dado, a linha diz POR QUÊ — nunca mostra outro mês.
// CONTA      → cada conta/operação com o próprio número (o mesmo escopo que a
//              Central de Vendas mostra ao selecionar a conta). Já vem na
//              lista: abrir um cliente não custa requisição.
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
import "./TabelaHierarquica.css";

// Squad usa UM tom só — o da marca (tons de status mentiriam num rótulo que é
// só identidade).
const TOM_SQUAD = "is-primary";

// Tom por status: cor é a segunda pista — o rótulo em texto é a primeira.
const TOM_STATUS = {
  sincronizado: "is-success",
  manual: "is-info",
  parcial: "is-warning",
  sem_dados: "is-neutral",
  sem_conta: "is-warning",
  sem_conexao: "is-warning",
  sem_integracao: "is-neutral",
  sincronizando: "is-info",
  erro_sync: "is-danger",
  nao_publicado: "is-warning",
  conta_inativa: "is-neutral",
};

const TOM_FONTE = { api: "is-neutral", manual: "is-info", misto: "is-info" };

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

function Celula({ coluna, valor, variacao, titulo }) {
  const texto = formatarValor(coluna.tipo, valor);
  const delta = lerVariacao(coluna.tipo, variacao);
  const indisponivel = coluna.tipo === "indisponivel";
  return (
    <td
      className={`num${indisponivel ? " vf-ph-indisponivel" : ""}`}
      title={titulo || (indisponivel ? "Sem fonte de dado auditada nesta versão" : valorExato(coluna.tipo, valor))}
    >
      <span className="vf-ph-valor">{texto}</span>
      {delta && <Delta sentido={coluna.sentido} valor={delta.valor} texto={delta.texto} />}
    </td>
  );
}

function TagStatus({ status }) {
  if (!status) return null;
  return (
    <span className={`vf-tag vf-ph-tag ${TOM_STATUS[status.codigo] || "is-neutral"}`} title={status.motivo || undefined}>
      {status.rotulo}
    </span>
  );
}

function TagFonte({ fonte }) {
  if (!fonte) return null;
  return (
    <span className={`vf-tag vf-ph-tag ${TOM_FONTE[fonte.tipo] || "is-neutral"}`} title={`Fonte do dado: ${fonte.rotulo}`}>
      {fonte.rotulo}
    </span>
  );
}

// "atualizado 29/09/2026 06:20 · dados até 28/09/2026" — frescor em uma linha.
function Frescor({ atualizadoEm, dadosAte }) {
  if (!atualizadoEm && !dadosAte) return null;
  return (
    <>
      {atualizadoEm && <span className="vf-ph-meta">atualizado {formatarDataHora(atualizadoEm)}</span>}
      {dadosAte && <span className="vf-ph-meta">· dados até {formatarData(dadosAte)}</span>}
    </>
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
        <span className="vf-ph-chevron" data-aberto={aberto ? "true" : "false"} aria-hidden="true">▸</span>
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

function BotaoLancar({ rotulo, onClick, editar = false }) {
  return (
    <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm vf-ph-lancar" onClick={onClick} aria-label={rotulo}>
      {editar ? "Editar manual" : "Lançar dados"}
    </button>
  );
}

function LinhaSemana({ semana, colunas }) {
  const intervalo = `${String(semana.de).slice(8)}–${String(semana.ate).slice(8)}`;
  return (
    <tr className="vf-ph-row vf-ph-row--semana">
      <th scope="row" className="vf-table__sticky-cell vf-ph-ancora">
        <span className="vf-ph-indent vf-ph-indent--3">
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

function LinhaConta({ cliente, conta, colunas, onLancar }) {
  const semDado = !conta.resumo;
  const manualSubstituido = conta.manual?.substituidoPorAutomatico;
  const adsPorCliente = conta.fonte?.tipo !== "manual";
  return (
    <tr className={`vf-ph-row vf-ph-row--conta${semDado ? " is-sem-dado" : ""}${conta.ativa ? "" : " is-inativa"}`}>
      <th scope="row" className="vf-table__sticky-cell vf-ph-ancora vf-ph-conta">
        <span className="vf-ph-indent">
          <span className="vf-ph-conta__rotulo">{conta.rotulo}</span>
          <span className="vf-ph-cliente__meta">
            <TagStatus status={conta.status} />
            {semDado
              ? conta.status?.motivo && conta.status.codigo !== "sem_integracao" && (
                <span className="vf-ph-meta">{conta.status.motivo}</span>
              )
              : <Frescor atualizadoEm={conta.atualizadoEm} dadosAte={conta.dadosAte} />}
            {conta.avisos?.length > 0 && (
              <span className="vf-ph-aviso" title={conta.avisos.join("\n")} aria-label={conta.avisos.join(". ")}>⚠</span>
            )}
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
      </th>
      <td className="vf-table__sticky-cell vf-ph-contexto">
        <span className="vf-ph-contexto__linha"><TagFonte fonte={conta.fonte} /></span>
        {conta.podeLancarManual && (
          <BotaoLancar
            rotulo={`Lançar dados — ${conta.rotulo}`}
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
          />
        );
      })}
      <td className="vf-ph-folga" />
    </tr>
  );
}

function LinhaHistorico({ cliente, aberto, onAlternar, colunas }) {
  return (
    <tr className="vf-ph-row vf-ph-row--historico">
      <CelulaExpansivel
        aberto={aberto}
        onClick={onAlternar}
        nivel="historico"
        rotuloAcessivel={`Histórico mensal de ${cliente.nome} — ${aberto ? "recolher" : "expandir"} competências`}
      >
        <span className="vf-ph-indent">
          <span className="vf-ph-historico__rotulo">Histórico mensal</span>
          <span className="vf-ph-meta"> · consolidado do cliente</span>
        </span>
      </CelulaExpansivel>
      <td className="vf-table__sticky-cell vf-ph-contexto" />
      <td colSpan={colunas.length} />
      <td className="vf-ph-folga" />
    </tr>
  );
}

function MetaCliente({ cliente, competencia }) {
  if (cliente.resumo) {
    return (
      <span className="vf-ph-cliente__meta">
        <TagStatus status={cliente.status} />
        <Frescor atualizadoEm={cliente.atualizadoEm} dadosAte={cliente.dadosAte} />
      </span>
    );
  }
  const ultimo = cliente.ultimaCompetenciaComDado && cliente.ultimaCompetenciaComDado !== competencia
    ? cliente.ultimaCompetenciaComDado
    : null;
  return (
    <span className="vf-ph-cliente__meta vf-ph-cliente__meta--vazio">
      <span className="vf-ph-sem-dados">Sem dados em {rotularCompetenciaCurta(competencia)}</span>
      {cliente.status?.motivo && <span className="vf-ph-motivo">{cliente.status.motivo}</span>}
      {ultimo && <span className="vf-ph-meta">· último dado: {rotularCompetenciaCurta(ultimo)}</span>}
    </span>
  );
}

function LinhaCliente({
  cliente, competencia, expansao,
  mesesPorCliente, carregarMeses, semanasPorChave, carregarSemanas,
  colunas, onLancar,
}) {
  const aberto = expansao.clientesAbertos.has(cliente.id);
  const historicoAberto = expansao.historicosAbertos.has(cliente.id);
  const estado = mesesPorCliente[cliente.id];
  const colSpan = colunas.length + 3;
  const semDado = !cliente.resumo;

  // Lazy de verdade: o histórico nasce de a linha de HISTÓRICO estar aberta.
  useEffect(() => {
    if (aberto && historicoAberto && !estado) carregarMeses(cliente.id);
  }, [aberto, historicoAberto, estado, carregarMeses, cliente.id]);

  return (
    <>
      <tr className={`vf-ph-row vf-ph-row--cliente${semDado ? " is-sem-dado" : ""}${cliente.status?.precisaAtencao ? " is-atencao" : ""}`}>
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
            <MetaCliente cliente={cliente} competencia={competencia} />
          </span>
        </CelulaExpansivel>

        <td className="vf-table__sticky-cell vf-ph-contexto">
          <span className="vf-ph-contexto__linha">
            {cliente.squad
              ? <span className={`vf-tag vf-ph-tag ${TOM_SQUAD}`}>{cliente.squad.nome}</span>
              : <span className="vf-ph-meta is-vazio">sem squad</span>}
            <TagFonte fonte={cliente.fonte} />
          </span>
          {cliente.podeLancarManual && (
            <BotaoLancar rotulo={`Lançar dados — ${cliente.nome}`} onClick={() => onLancar(cliente, undefined)} />
          )}
        </td>

        {colunas.map((c) => <Celula key={c.chave} coluna={c} valor={cliente.resumo?.[c.chave] ?? null} />)}
        <td className="vf-ph-folga" />
      </tr>

      {aberto && cliente.contas?.map((conta) => (
        <LinhaConta key={conta.id} cliente={cliente} conta={conta} colunas={colunas} onLancar={onLancar} />
      ))}
      {aberto && (!cliente.contas || cliente.contas.length === 0) && (
        <LinhaEstado colSpan={colSpan}>
          Nenhuma conta/operação cadastrada para este cliente — cadastre a operação em Clientes para separar o número por conta.
        </LinhaEstado>
      )}
      {aberto && (
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
  const [historicosAbertos, setHistoricosAbertos] = useState(() => new Set());
  const [mesesAbertos, setMesesAbertos] = useState(() => new Set());

  const alternarCliente = useCallback((id) => alternarEm(setClientesAbertos, id), []);
  const alternarHistorico = useCallback((id) => alternarEm(setHistoricosAbertos, id), []);
  const alternarMes = useCallback((clienteId, competencia) => alternarEm(setMesesAbertos, `${clienteId}:${competencia}`), []);

  const recolherTudo = useCallback(() => {
    setClientesAbertos(new Set());
    setHistoricosAbertos(new Set());
    setMesesAbertos(new Set());
  }, []);

  return {
    clientesAbertos, historicosAbertos, mesesAbertos,
    alternarCliente, alternarHistorico, alternarMes, recolherTudo,
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
  clientes, competencia, colunas: colunasProp, grupos, expansao,
  mesesPorCliente, carregarMeses, semanasPorChave, carregarSemanas,
  atualizando, onLancar = () => {},
}) {
  const colunas = useMemo(() => colunasProp ?? colunasVisiveis(grupos), [colunasProp, grupos]);
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
          aparecem as contas/operações e o histórico mensal.
        </caption>
        <thead>
          <tr className="vf-ph-thead-grupos" ref={linhaGrupoRef}>
            <th scope="col" rowSpan={2} className="vf-table__sticky-cell vf-ph-th-ancora">
              <BotaoOrdenar chave="nome" label="Cliente / Conta" titulo="nome do cliente" ordem={ordem} onOrdenar={ordenar} />
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
              colunas={colunas}
              onLancar={onLancar}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
