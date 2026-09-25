// frontend-react/src/components/painelContas/TabelaHierarquica.jsx
//
// Tabela hierárquica Cliente → Mês → Semana do Painel de Contas por Squad.
// Continua sendo uma TABELA (não cards): a comparação entre muitos clientes
// depende de colunas alinhadas. Construída sobre `.vf-table` (Fundação Global
// V2), com o específico deste padrão em TabelaHierarquica.css.
//
// Cada nível expande sob demanda: nenhum dado de mês/semana é buscado antes
// do clique na linha (lazy loading real, Auditoria §14). O CACHE do dado já
// buscado vive no hook e nunca é descartado ao recolher — reabrir a mesma
// linha não refaz a chamada. NÃO existe "expandir todos", de propósito: seria
// uma requisição por cliente, o oposto do que o lazy loading protege.
//
// ── Os três níveis ───────────────────────────────────────────────────────
// CLIENTE  → resumo executivo. Sozinho, recolhido, já responde "como esse
//            cliente está": nome forte, Squad, último mês e sincronização.
// MÊS      → análise histórica: competência + variação contra o mês anterior.
// SEMANA   → drilldown. Só FAT tem série diária persistida; o resto é "—"
//            por ausência real de fonte, nunca por rateio do valor mensal.
//
// A diferença entre eles é altura de linha, peso tipográfico, recuo e fundo —
// não só indentação, que era o que tornava os níveis indistinguíveis antes.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatarMoeda } from "../../utils/currency.js";
import { formatarPercentual, formatarVariacaoPercentual, formatarPontosPercentuais } from "../../utils/percentage.js";
import { AUSENTE, ehAusente, direcao } from "../../utils/numbers.js";
import { rotularCompetenciaCurta, formatarData } from "../../utils/dates.js";
import { colunasVisiveis, gruposVisiveis } from "./colunas.js";
import "./TabelaHierarquica.css";

// O Squad usa UM tom só — o da marca. A tentação é dar uma cor a cada squad,
// mas os tons que a Fundação oferece são tons de STATUS: sortear `is-warning`
// para um squad faz uma tabela financeira anunciar "atenção" num rótulo que é
// só identidade (visto na primeira passada visual: dois dos quatro squads da
// carteira saíram âmbar). E com cinco tons a colisão volta no sexto squad de
// qualquer jeito. Quem separa squads aqui é o filtro e a ordenação por Squad,
// que fazem isso sem mentir em cor.
const TOM_SQUAD = "is-primary";

function formatarValor(tipo, valor) {
  if (tipo === "indisponivel") return AUSENTE;
  // `casas: 0` é escolha de densidade: numa tabela com muitos clientes os
  // centavos só alargam a coluna. O valor exato continua acessível no
  // `title` da célula — encurtado na tela, nunca perdido.
  if (tipo === "moeda") return formatarMoeda(valor, { casas: 0 });
  return formatarPercentual(valor);
}

function valorExato(tipo, valor) {
  if (tipo !== "moeda" || ehAusente(valor)) return undefined;
  return formatarMoeda(valor);
}

// fat/lc/ads variam em {abs,pct} -> mostra pct. mc/acos/tacos variam em {pp}.
// O NÚMERO que sai daqui é o mesmo que decide a direção, então texto e cor
// nunca podem discordar.
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

// Direção NUNCA sai do sinal matemático sozinho (§16). `sentido` vem da
// definição da coluna: para ACOS/TACoS subir é pior, para Invest. Ads subir
// não é bom nem ruim. Símbolo e sinal vêm antes da cor — quem não distingue
// verde de vermelho lê a mesma informação.
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

function Celula({ coluna, valor, variacao }) {
  const texto = formatarValor(coluna.tipo, valor);
  const delta = lerVariacao(coluna.tipo, variacao);
  const indisponivel = coluna.tipo === "indisponivel";
  return (
    <td
      className={`num${indisponivel ? " vf-ph-indisponivel" : ""}`}
      title={indisponivel ? "Sem fonte de dado auditada nesta versão" : valorExato(coluna.tipo, valor)}
    >
      <span className="vf-ph-valor">{texto}</span>
      {delta && <Delta sentido={coluna.sentido} valor={delta.valor} texto={delta.texto} />}
    </td>
  );
}

// Área de expansão: o BOTÃO ocupa a célula inteira, não só o chevron. Mirar
// um triângulo de 10px era o custo de entrada de toda a tela. Só a primeira
// coluna é clicável — selecionar ou copiar texto de uma célula numérica
// nunca expande nada.
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

// Loading da expansão como LINHAS de esqueleto, não como texto: a tabela não
// muda de altura quando o dado chega, então nada salta sob o cursor.
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

function LinhaMes({ clienteId, clienteNome, mes, aberto, onAlternar, semanasPorChave, carregarSemanas, colunas }) {
  const chave = `${clienteId}:${mes.competencia}`;
  const estado = semanasPorChave[chave];
  const colSpan = colunas.length + 3;
  const rotulo = rotularCompetenciaCurta(mes.competencia);

  useEffect(() => {
    if (aberto && !estado) carregarSemanas(clienteId, mes.competencia);
  }, [aberto, estado, carregarSemanas, clienteId, mes.competencia]);

  return (
    <>
      <tr className="vf-ph-row vf-ph-row--mes">
        <CelulaExpansivel
          aberto={aberto}
          onClick={onAlternar}
          nivel="mes"
          rotuloAcessivel={`Competência ${rotulo} de ${clienteNome} — ${aberto ? "recolher" : "expandir"} semanas`}
        >
          <span className="vf-ph-indent vf-ph-indent--2">
            <span className="vf-ph-mes__rotulo">{rotulo}</span>
          </span>
        </CelulaExpansivel>
        <td className="vf-table__sticky-cell vf-ph-contexto">
          {mes.sincronizadoEm && (
            <span className="vf-ph-meta" title={`Snapshot sincronizado em ${formatarData(mes.sincronizadoEm)}`}>
              sync {formatarData(mes.sincronizadoEm)}
            </span>
          )}
        </td>
        {colunas.map((c) => (
          <Celula
            key={c.chave}
            coluna={c}
            valor={mes.resumo?.[c.chave] ?? null}
            variacao={mes.variacaoVsMesAnterior?.[c.chave]}
          />
        ))}
        <td className="vf-ph-folga" />
      </tr>

      {aberto && estado?.carregando && (
        <LinhasEsqueleto colSpan={colSpan} linhas={2} rotulo="Carregando semanas" />
      )}
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
      {aberto && estado?.semanas?.map((s) => (
        <LinhaSemana key={s.semana} semana={s} colunas={colunas} />
      ))}
    </>
  );
}

function LinhaCliente({
  cliente, aberto, onAlternar,
  mesesAbertos, onAlternarMes,
  mesesPorCliente, carregarMeses,
  semanasPorChave, carregarSemanas,
  colunas,
}) {
  const estado = mesesPorCliente[cliente.id];
  const colSpan = colunas.length + 3;
  const semDado = !cliente.resumo;

  // Lazy de verdade: a requisição nasce de a linha ESTAR aberta e ainda não
  // ter dado. Recolher e reabrir não refaz a chamada (o cache do hook já
  // respondeu), e nada é buscado enquanto ninguém abriu.
  useEffect(() => {
    if (aberto && !semDado && !estado) carregarMeses(cliente.id);
  }, [aberto, semDado, estado, carregarMeses, cliente.id]);

  return (
    <>
      <tr className={`vf-ph-row vf-ph-row--cliente${semDado ? " is-sem-dado" : ""}`}>
        <CelulaExpansivel
          aberto={aberto}
          onClick={onAlternar}
          nivel="cliente"
          rotuloAcessivel={`Cliente ${cliente.nome} — ${aberto ? "recolher" : "expandir"} competências`}
        >
          <span className="vf-ph-cliente">
            <span className="vf-ph-cliente__nome">{cliente.nome}</span>
            <span className="vf-ph-cliente__meta">
              {cliente.ultimoMesDisponivel
                ? <>
                    <span>{rotularCompetenciaCurta(cliente.ultimoMesDisponivel)}</span>
                    {cliente.sincronizadoEm && (
                      <span className="vf-ph-meta">· atualizado {formatarData(cliente.sincronizadoEm)}</span>
                    )}
                  </>
                : <span className="vf-ph-meta is-vazio">sem sincronização</span>}
            </span>
          </span>
        </CelulaExpansivel>

        <td className="vf-table__sticky-cell vf-ph-contexto">
          {cliente.squad
            ? <span className={`vf-tag ${TOM_SQUAD}`}>{cliente.squad.nome}</span>
            : <span className="vf-ph-meta is-vazio">sem squad</span>}
        </td>

        {colunas.map((c) => (
          <Celula key={c.chave} coluna={c} valor={cliente.resumo?.[c.chave] ?? null} />
        ))}
        <td className="vf-ph-folga" />
      </tr>

      {aberto && semDado && (
        <LinhaEstado colSpan={colSpan}>
          Este cliente nunca foi sincronizado — não há competência para abrir.
        </LinhaEstado>
      )}
      {aberto && !semDado && estado?.carregando && (
        <LinhasEsqueleto colSpan={colSpan} linhas={3} rotulo="Carregando competências" />
      )}
      {aberto && !semDado && estado?.erro && !estado.carregando && (
        <LinhaErro
          colSpan={colSpan}
          mensagem={`Não foi possível carregar as competências. ${estado.erro.mensagem}`}
          onTentar={() => carregarMeses(cliente.id, { forcar: true })}
        />
      )}
      {aberto && !semDado && estado?.meses && estado.meses.length === 0 && (
        <LinhaEstado colSpan={colSpan}>Sem competência sincronizada neste ano.</LinhaEstado>
      )}
      {aberto && !semDado && estado?.meses?.map((mes) => (
        <LinhaMes
          key={mes.competencia}
          clienteId={cliente.id}
          clienteNome={cliente.nome}
          mes={mes}
          aberto={mesesAbertos.has(`${cliente.id}:${mes.competencia}`)}
          onAlternar={() => onAlternarMes(cliente.id, mes.competencia)}
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
// não dispara requisição nenhuma. O caminho inverso não existe (§19).
export function useExpansao() {
  const [clientesAbertos, setClientesAbertos] = useState(() => new Set());
  const [mesesAbertos, setMesesAbertos] = useState(() => new Set());

  const alternarCliente = useCallback((id) => {
    setClientesAbertos((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }, []);

  const alternarMes = useCallback((clienteId, competencia) => {
    setMesesAbertos((prev) => {
      const chave = `${clienteId}:${competencia}`;
      const proximo = new Set(prev);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  }, []);

  const recolherTudo = useCallback(() => {
    setClientesAbertos(new Set());
    setMesesAbertos(new Set());
  }, []);

  return {
    clientesAbertos, mesesAbertos,
    alternarCliente, alternarMes, recolherTudo,
    temExpandido: clientesAbertos.size > 0,
  };
}

// ── Ordenação ───────────────────────────────────────────────────────────────
// Client-side, sobre a lista JÁ carregada, e SÓ no nível cliente: meses e
// semanas são cronológicos por natureza — reordená-los destruiria a leitura
// de série temporal. Nada disso toca o backend.
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
      // Cliente sem squad sempre por último — é uma pendência a resolver,
      // não o topo nem o fim de um ranking.
      if (!a.squad && !b.squad) return compararTexto(a.nome, b.nome);
      if (!a.squad) return 1;
      if (!b.squad) return -1;
      const porSquad = compararTexto(a.squad.nome, b.squad.nome) * fator;
      return porSquad !== 0 ? porSquad : compararTexto(a.nome, b.nome);
    }
    // Métrica: ausência de dado nunca disputa posição. Um cliente sem
    // sincronização não pode aparecer como "o de menor faturamento" — ele
    // não tem faturamento conhecido. Vai para o fim nos dois sentidos.
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
  clientes, colunas: colunasProp, grupos,
  clientesAbertos, mesesAbertos, alternarCliente, alternarMes,
  mesesPorCliente, carregarMeses, semanasPorChave, carregarSemanas,
  atualizando,
}) {
  const colunas = useMemo(() => colunasProp ?? colunasVisiveis(grupos), [colunasProp, grupos]);
  const cabecalhoGrupos = useMemo(() => gruposVisiveis(grupos), [grupos]);
  const [ordem, setOrdem] = useState(null);

  const ordenados = useMemo(() => ordenarClientes(clientes, ordem), [clientes, ordem]);

  const ordenar = useCallback((chave) => {
    setOrdem((prev) => {
      if (prev?.chave !== chave) {
        // Texto começa em A→Z; número começa no maior, que é o que se procura
        // numa tabela de faturamento.
        return { chave, ascendente: chave === "nome" || chave === "squad" };
      }
      if (prev.ascendente !== (chave === "nome" || chave === "squad")) return null; // terceiro clique volta à ordem do servidor
      return { chave, ascendente: !prev.ascendente };
    });
  }, []);

  // A segunda linha do cabeçalho gruda logo abaixo da primeira. A altura da
  // primeira é medida, não chutada: ela muda com densidade, zoom e fonte do
  // sistema, e um valor fixo descolaria as duas no primeiro scroll.
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

  // ── Altura do corpo rolável ─────────────────────────────────────────────
  // O cabeçalho da tabela só gruda se o SCROLL acontecer dentro deste wrapper
  // — e para isso ele precisa de uma altura máxima. Um valor fixo em CSS foi
  // a primeira tentativa e cortou o rodapé em 1366×768: a conta depende do
  // cabeçalho da página, da barra, do rodapé e do padding do Shell, que
  // mudam com a largura. Aqui a sobra é MEDIDA — o que vem depois da tabela
  // é somado e descontado, então nada abaixo dela fica escondido.
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
      const respiro = 28; // gaps do container + folga inferior do shell
      const disponivel = window.innerHeight - topoNoDocumento - depoisDaTabela - respiro;
      // Piso: numa janela muito baixa é melhor a página rolar do que a
      // tabela virar uma fresta de duas linhas.
      wrap.style.maxHeight = `${Math.max(220, Math.round(disponivel))}px`;
    };

    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  });

  return (
    <div ref={wrapRef} className={`vf-table-wrap vf-ph-wrap${atualizando ? " is-atualizando" : ""}`}>
      <table
        className="vf-table vf-table--compact vf-ph-table"
        style={{ "--vf-ph-head-2": `${alturaGrupo}px` }}
      >
        <caption className="vf-visually-hidden">
          Clientes da carteira por Squad. Cada cliente expande em competências e cada competência em semanas.
        </caption>
        <thead>
          <tr className="vf-ph-thead-grupos" ref={linhaGrupoRef}>
            <th scope="col" rowSpan={2} className="vf-table__sticky-cell vf-ph-th-ancora">
              <BotaoOrdenar chave="nome" label="Cliente / Período" titulo="nome do cliente" ordem={ordem} onOrdenar={ordenar} />
            </th>
            <th scope="col" rowSpan={2} className="vf-table__sticky-cell vf-ph-th-contexto">
              <BotaoOrdenar chave="squad" label="Contexto" titulo="Squad" ordem={ordem} onOrdenar={ordenar} />
            </th>
            {cabecalhoGrupos.map((g) => (
              <th
                key={g.chave}
                scope="colgroup"
                colSpan={g.colunas.length}
                className={`vf-ph-th-grupo${g.disponivel ? "" : " is-indisponivel"}`}
              >
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
                  // A borda do grupo desce pela primeira métrica dele, para o
                  // olho não perder onde um bloco termina e o outro começa.
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
              aberto={clientesAbertos.has(cliente.id)}
              onAlternar={() => alternarCliente(cliente.id)}
              mesesAbertos={mesesAbertos}
              onAlternarMes={alternarMes}
              mesesPorCliente={mesesPorCliente}
              carregarMeses={carregarMeses}
              semanasPorChave={semanasPorChave}
              carregarSemanas={carregarSemanas}
              colunas={colunas}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
