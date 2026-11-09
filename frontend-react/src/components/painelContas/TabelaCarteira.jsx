// frontend-react/src/components/painelContas/TabelaCarteira.jsx
//
// Tabela da carteira no desenho APROVADO (artefato B Realistic): a mesma
// tabela nas duas vistas — Essencial (FAT · Margem · Ads · Dados) e Detalhada
// (FAT · LC · MC · Ads · ACOS · TACoS · Dados).
//
//   Squad (linha de grupo)
//     Cliente            FAT ▬      MC / LC      Ads / TACoS     ■■■ Completo · Motivos
//       ├ Conta          FAT        MC / LC      no cliente      API · até 08/11
//       │  └ detalhe da conta (situação, origem, ações, semanas da conta)
//       └ Investigar <cliente>: Histórico (meses/semanas) | Composição
//
// Tudo que aparece aqui é LEITURA do que o servidor já devolveu (lista,
// /meses, /semanas, /contas/semanas, /contas/composicao) — nenhuma soma de
// dinheiro nova. Histórico, semanas e composição são lazy: só carregam quando
// a investigação do cliente (ou o detalhe da conta) está aberta.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatarMoeda } from "../../utils/currency.js";
import { formatarPercentual, formatarVariacaoPercentual, formatarPontosPercentuais } from "../../utils/percentage.js";
import { formatarNumero, ehAusente } from "../../utils/numbers.js";
import { rotularCompetencia, rotularCompetenciaCurta, formatarData, formatarDataHora } from "../../utils/dates.js";
import { atualizacaoEmCurso } from "../../utils/painelContasAtualizacao.js";
import { LINHAS_EXCLUSAO } from "./ComposicaoFaturamento.jsx";
import {
  BotaoAtualizar, LinhaAtualizacao, LinhaDetalheConta, manualSobreApi, pipConta, composicaoContas,
} from "./TabelaHierarquica.jsx";
import { contaAguardaLancamento } from "./atencao.js";

const COLS = {
  essencial: ["fat", "mc", "ads", "dados"],
  detalhada: ["fat", "lc", "mcd", "ads", "acos", "tacos", "dados"],
};
const ROT = { fat: "FAT", lc: "LC", mc: "Margem", mcd: "MC", ads: "Ads", acos: "ACOS", tacos: "TACoS", dados: "Dados" };
const TIT = {
  fat: "Faturamento — venda dos pedidos válidos do período (sem cancelamentos, devoluções e mediações).",
  lc: "Lucro de contribuição — venda menos imposto, tarifas, frete e custo. ◐ = parte do FAT sem custo.",
  mc: "Margem de contribuição — LC ÷ faturamento com custo cadastrado. Abaixo, o LC.",
  mcd: "Margem de contribuição — LC ÷ faturamento com custo cadastrado.",
  ads: "Investimento em Ads — medido por cliente (ML); conta manual pode ter Ads lançado. Abaixo, o TACoS.",
  acos: "ACOS — Ads ÷ GMV de Ads.",
  tacos: "TACoS — Ads ÷ faturamento total.",
  dados: "Uma marca por conta: ■ API · ■ manual · ◇ problema de integração · □ aguarda lançamento.",
};
const CHAVE_SORT = { mcd: "mc" };
const TECNICOS = { sem_conexao: "sem conexão", erro_sync: "com erro de sincronização", nao_publicado: "não publicada" };
const MES3 = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const brl = (v) => formatarMoeda(v, { casas: 0 });
const pct = (v) => formatarPercentual(v);
const diaMes = (iso) => (iso ? formatarData(iso).slice(0, 5) : "—");
const tecnico = (k) => k.ativa && !k.resumo && Boolean(TECNICOS[k.status?.codigo]);

// Larguras do artefato: colunas de número fixas, Cliente e Dados ficam com o que sobra.
function larguras(cs, W, detalhada) {
  const base = { fat: 150, lc: 120, mc: 118, mcd: 82, ads: 128, acos: 78, tacos: 82, dados: 300 };
  if (detalhada) { base.fat = 136; base.ads = 112; base.dados = W < 1150 ? 196 : 250; } else if (W < 1150) { base.dados = 260; base.fat = 140; }
  // Tela estreita (Detalhada em ~1280): as colunas encolhem na mesma proporção
  // em vez de empurrar a página para o lado.
  const bruto = cs.reduce((s, k) => s + base[k], 0);
  if (bruto + 200 > W && W > 0) {
    const f = Math.max(0.6, (W - 200) / bruto);
    cs.forEach((k) => { base[k] = Math.floor(base[k] * f); });
  }
  const fixo = cs.reduce((s, k) => s + base[k], 0);
  const cli = Math.max(Math.min(220, W - fixo), Math.min(420, W - fixo));
  const sobra = Math.max(0, W - fixo - cli);
  const w = {};
  cs.forEach((k) => { w[k] = base[k]; });
  w.dados += Math.round(sobra * 0.5);
  const metr = cs.filter((k) => k !== "dados");
  metr.forEach((k) => { w[k] += Math.round((sobra * 0.5) / metr.length); });
  return { cli, w };
}

function vSort(c, k) {
  if (k === "nome") return c.nome;
  if (k === "dados") return c.escopo?.contasOperacionais ? (c.escopo.contasComDado || 0) / c.escopo.contasOperacionais : null;
  return c.resumo && !ehAusente(c.resumo[k]) ? Number(c.resumo[k]) : null;
}
export function ordenarCarteira(lista, sort) {
  const { k, dir } = sort;
  return [...lista].sort((a, b) => {
    const x = vSort(a, k);
    const y = vSort(b, k);
    if (k === "nome") return String(x).localeCompare(String(y), "pt-BR") * dir;
    if (x == null && y == null) return a.nome.localeCompare(b.nome, "pt-BR");
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir || a.nome.localeCompare(b.nome, "pt-BR");
  });
}

function Chev({ tamanho = 10 }) {
  return (
    <span className="vf-pb-chev" aria-hidden="true">
      <svg width={tamanho} height={tamanho} viewBox="0 0 10 10"><path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}

function ND({ titulo }) {
  return <span className="vf-pb-nd" title={titulo || "Sem dado"}>—</span>;
}

function Valor({ v, tipo, titulo }) {
  if (ehAusente(v)) return <ND titulo={titulo} />;
  const n = Number(v);
  return (
    <span className={`vf-pb-v${n < 0 ? " vf-pb-neg" : ""}`} title={tipo === "pct" ? `${(n * 100).toFixed(2).replace(".", ",")}%` : formatarMoeda(n)}>
      {tipo === "pct" ? pct(n) : brl(n)}
    </span>
  );
}

function MarcaCusto({ obj, k }) {
  if (obj?.custos?.estado !== "parcial" || (k !== "lc" && k !== "mc")) return null;
  return <span className="vf-pb-parcial-m" title={`Cálculo parcial: os custos cobrem ${pct(obj.custos.cobertura)} do FAT`}>◐</span>;
}

function Linha2({ children }) {
  return <span className="vf-pb-2l">{children ?? " "}</span>;
}

// ── Cliente ────────────────────────────────────────────────────────────────
function celulaCliente(c, k, maxFat, essencial) {
  const r = c.resumo;
  const nd = "Sem dado nesta competência — não é zero";
  if (k === "fat") {
    return (
      <>
        <Valor v={r?.fat} tipo="brl" titulo={nd} />
        {r && r.fat > 0 && maxFat > 0 && <span className="vf-pb-sharebar" style={{ width: `${Math.max(4, Math.round((r.fat / maxFat) * 100))}%` }} />}
      </>
    );
  }
  if (k === "mc") {
    return (
      <>
        <Valor v={r?.mc} tipo="pct" titulo={nd} /><MarcaCusto obj={c} k="mc" />
        <Linha2>{r && !ehAusente(r.lc) ? <>LC {brl(r.lc)}<MarcaCusto obj={c} k="lc" /></> : " "}</Linha2>
      </>
    );
  }
  if (k === "mcd") return <><Valor v={r?.mc} tipo="pct" titulo={nd} /><MarcaCusto obj={c} k="mc" /></>;
  if (k === "lc") return <><Valor v={r?.lc} tipo="brl" titulo={nd} /><MarcaCusto obj={c} k="lc" /></>;
  if (k === "ads") {
    if (r && Number(r.ads) === 0) return <><span className="vf-pb-v">R$ 0</span><Linha2>sem Ads</Linha2></>;
    return (
      <>
        <Valor v={r?.ads} tipo="brl" titulo={r ? "Sem Ads informado neste recorte" : nd} />
        {essencial && <Linha2>{r && !ehAusente(r.tacos) ? `TACoS ${pct(r.tacos)}` : " "}</Linha2>}
      </>
    );
  }
  if (k === "acos") return <Valor v={r?.acos} tipo="pct" titulo={r && Number(r.ads) === 0 ? "Sem investimento em Ads: não se aplica" : "Sem GMV de Ads neste recorte"} />;
  if (k === "tacos") return <Valor v={r?.tacos} tipo="pct" titulo={nd} />;
  return null;
}

function motivosCliente(c, competencia) {
  const contas = (c.contas || []).filter((k) => k.ativa);
  const sub = [];
  const tec = contas.filter(tecnico);
  const pend = contas.filter(contaAguardaLancamento);
  const ov = contas.filter(manualSobreApi);
  if (tec.length) sub.push(`${tec.length} ${tec.length === 1 ? TECNICOS[tec[0].status.codigo] : "com problema de integração"}`);
  if (pend.length) sub.push(`${pend.length} ${pend.length === 1 ? "aguarda lançamento" : "aguardam lançamento"}`);
  const semAcao = contas.filter((k) => !k.resumo && !tecnico(k) && !contaAguardaLancamento(k));
  if (semAcao.length && !sub.length && c.resumo) sub.push(`${semAcao.length} sem dado`);
  if (!sub.length && c.resumo) {
    sub.push([c.fonte?.rotulo, ov.length ? `${ov.length} ${ov.length === 1 ? "correção" : "correções"} sobre API` : null, c.dadosAte ? `até ${diaMes(c.dadosAte)}` : null].filter(Boolean).join(" · "));
  }
  if (!c.resumo && !sub.length) {
    sub.push(c.ultimaCompetenciaComDado && c.ultimaCompetenciaComDado !== competencia
      ? `último dado: ${rotularCompetenciaCurta(c.ultimaCompetenciaComDado)}`
      : contas.length ? (c.status?.motivo || "sem histórico") : "cadastre a operação em Clientes e Contas");
  }
  return sub.filter(Boolean).join(" · ");
}

function Pips({ contas }) {
  const ativas = (contas || []).filter((k) => k.ativa);
  return (
    <span className="vf-pb-pips" aria-hidden="true">
      {ativas.map((k) => {
        const p = pipConta(k);
        const cls = { a: "", m: "m", w: "w", o: "o", x: "x" }[p.classe] ?? "";
        return <i key={k.id} className={`vf-pb-pip ${cls}`} title={`${k.rotulo} — ${manualSobreApi(k) ? "manual sobre API" : p.titulo}`} />;
      })}
    </span>
  );
}

function DadosCliente({ c, competencia, atualizacao }) {
  const [aberto, setAberto] = useState(false);
  const n = c.escopo?.contasOperacionais || 0;
  const kk = c.escopo?.contasComDado || 0;
  let lbl;
  let cls = "";
  if (!c.resumo) { lbl = n ? "Sem dados" : "Sem conta"; cls = " is-nd"; } else if (kk < n) { lbl = `Parcial · ${kk} de ${n}`; cls = " is-parc"; } else lbl = `Completo${n > 1 ? ` · ${n} de ${n}` : ""}`;
  const mot = motivosCliente(c, competencia);
  const emCurso = atualizacaoEmCurso(atualizacao);
  return (
    <div className="vf-pb-dados">
      {n > 0 && <Pips contas={c.contas} />}
      <span className="vf-pb-dados__txt">
        <span className="vf-pb-motivo-row">
          <span className={`vf-pb-dados-l${cls}`} data-testid={`situacao-${c.id}`}>{lbl}</span>
          {mot && (
            <button type="button" className="vf-pb-motivo-btn" aria-expanded={aberto} onClick={() => setAberto((v) => !v)} title={aberto ? undefined : mot}>
              Motivos
            </button>
          )}
        </span>
        {emCurso && <span className="vf-pb-2l"><span className="vf-spinner vf-spinner--sm" aria-hidden="true" /> atualizando…</span>}
        {aberto && mot && <span className="vf-pb-2l vf-pb-motivo-txt">{mot}</span>}
      </span>
    </div>
  );
}

// ── Conta ──────────────────────────────────────────────────────────────────
function partesRotulo(rotulo) {
  const t = String(rotulo ?? "");
  const i = t.indexOf(" · ");
  return i < 0 ? [t, null] : [t.slice(0, i), t.slice(i + 3)];
}

function OrigemConta({ k, estadoConta, emCurso }) {
  if (estadoConta?.estado === "pendente" && emCurso) {
    return <span className="vf-pb-origem"><span className="vf-spinner vf-spinner--sm" aria-hidden="true" /> sincronizando…</span>;
  }
  if (!k.ativa) return <span className="vf-pb-origem">Inativa · fora do consolidado</span>;
  if (k.resumo && k.fonte) {
    if (manualSobreApi(k)) {
      return (
        <span className="vf-pb-origem is-manual" title={`${k.referenciaApi.rotulo || "API"}: FAT ${formatarMoeda(k.referenciaApi.fat)} · o lançamento manual prevalece (modo manual)`}>
          Manual sobre API <small>· {k.manual?.atualizadoPor || ""}</small>
        </span>
      );
    }
    if (k.fonte.tipo === "manual") {
      return (
        <span className="vf-pb-origem is-manual">
          Manual <small>· {[k.manual?.atualizadoPor, k.dadosAte ? `até ${diaMes(k.dadosAte)}` : null].filter(Boolean).join(" · ")}</small>
        </span>
      );
    }
    return (
      <span className="vf-pb-origem">
        {k.fonte.rotulo} <small>· até {diaMes(k.dadosAte)}{k.avisos?.length ? <> · <span title={k.avisos.join(" · ")}>⚠</span></> : null}</small>
      </span>
    );
  }
  if (contaAguardaLancamento(k)) return <span className="vf-status is-empty">Aguarda lançamento</span>;
  if (k.status?.codigo === "erro_sync") return <span className="vf-status is-danger" title={k.status.motivo || undefined}>Erro de sincronização</span>;
  if (TECNICOS[k.status?.codigo]) return <span className="vf-status is-warning" title={k.status.motivo || undefined}>{k.status.rotulo}</span>;
  return <span className="vf-status is-empty" title={k.status?.motivo || undefined}>{k.status?.rotulo || "Sem dado"}</span>;
}

function celulaConta(k, col, essencial) {
  const r = k.resumo;
  const nd = k.ativa ? (r ? "" : k.status?.motivo || "Sem dado") : "Conta inativa";
  const adsNoCliente = r && k.fonte && (k.fonte.tipo === "api" || (manualSobreApi(k) && ehAusente(r.ads)));
  if (col === "fat") {
    return (
      <>
        <Valor v={r?.fat} tipo="brl" titulo={nd} />
        {manualSobreApi(k) && <span className="vf-pb-api-ref" title="Valor da API, guardado como referência">API {brl(k.referenciaApi.fat)}</span>}
      </>
    );
  }
  if (col === "mc") return <><Valor v={r?.mc} tipo="pct" titulo={nd} /><MarcaCusto obj={k} k="mc" /><Linha2>{r && !ehAusente(r.lc) ? `LC ${brl(r.lc)}` : " "}</Linha2></>;
  if (col === "mcd") return <><Valor v={r?.mc} tipo="pct" titulo={nd} /><MarcaCusto obj={k} k="mc" /></>;
  if (col === "lc") return <><Valor v={r?.lc} tipo="brl" titulo={nd} /><MarcaCusto obj={k} k="lc" /></>;
  if (col === "ads" || col === "acos" || col === "tacos") {
    if (adsNoCliente) {
      return col === "ads"
        ? <span className="vf-pb-ads-cli" title="Ads é medido por cliente (todas as contas juntas) — não existe valor por conta, e nada é rateado.">no cliente</span>
        : <ND titulo="Ads é medido por cliente" />;
    }
    if (col === "ads") return <><Valor v={r?.ads} tipo="brl" titulo={nd} />{essencial && <Linha2>{r && !ehAusente(r.tacos) ? `TACoS ${pct(r.tacos)}` : " "}</Linha2>}</>;
    return <Valor v={r?.[col]} tipo="pct" titulo={nd} />;
  }
  return null;
}

function BotaoConta({ cliente, k, onLancar }) {
  if (!k.ativa || !k.podeLancarManual) return null;
  if (!k.resumo) {
    return <button type="button" className="vf-btn vf-btn--sm" aria-label={`Lançar dados — ${k.rotulo}`} onClick={() => onLancar(cliente, k)}>Lançar dados</button>;
  }
  if (k.fonte?.tipo === "manual") {
    return <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" aria-label={`Editar dados — ${k.rotulo}`} onClick={() => onLancar(cliente, k)}>Editar</button>;
  }
  return null;
}

// Semanas reais da conta, dentro do detalhe (lazy, endpoint já existente).
function SemanasDaConta({ cliente, conta, competencia, estado, carregar }) {
  useEffect(() => { if (!estado) carregar(cliente.id, competencia); }, [estado, carregar, cliente.id, competencia]);
  const semanas = estado?.contas?.find((x) => Number(x.contaId) === Number(conta.id))?.semanas;
  return (
    <div className="vf-pb-det__semanas">
      <p className="vf-pb-inv__h">Semanas da conta em {rotularCompetenciaCurta(competencia)}</p>
      {estado?.carregando && <Esqueleto n={2} />}
      {estado?.erro && !estado.carregando && (
        <p className="vf-pb-inv__nota">
          Não foi possível carregar as semanas. {estado.erro.mensagem}{" "}
          <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => carregar(cliente.id, competencia, { forcar: true })}>Tentar de novo</button>
        </p>
      )}
      {Array.isArray(semanas) && semanas.length === 0 && <p className="vf-pb-inv__nota">Sem dados semanais reais para esta conta na competência.</p>}
      {Array.isArray(semanas) && semanas.length > 0 && <TabelaSemanas semanas={semanas} />}
    </div>
  );
}

function TabelaSemanas({ semanas }) {
  return (
    <table className="vf-pb-mini">
      <thead><tr><th>Semana</th><th>FAT</th><th>LC</th><th>MC</th></tr></thead>
      <tbody>
        {semanas.map((s) => (
          <tr key={s.semana}>
            <td>{s.semana} <span className="vf-pb-mini__sub">{String(s.de).slice(8)}–{String(s.ate).slice(8)}</span></td>
            <td>{ehAusente(s.resumo?.fat) ? "—" : brl(s.resumo.fat)}</td>
            <td>{ehAusente(s.resumo?.lc) ? "—" : brl(s.resumo.lc)}</td>
            <td>{ehAusente(s.resumo?.mc) ? "—" : pct(s.resumo.mc)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Esqueleto({ n }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="vf-skeleton vf-skeleton--row" style={{ height: 12, margin: "6px 0", width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

// ── Investigação do cliente ────────────────────────────────────────────────
function atualizacoesTxt(c) {
  let man = null;
  let api = null;
  for (const k of c.contas || []) {
    if (k.manual?.atualizadoEm && k.fonte?.tipo === "manual" && (!man || k.manual.atualizadoEm > man)) man = k.manual.atualizadoEm;
    if (k.fonte?.tipo === "api" && k.atualizadoEm && (!api || k.atualizadoEm > api)) api = k.atualizadoEm;
  }
  return `Última manual: ${man ? formatarDataHora(man) : "—"} · última API: ${api ? formatarDataHora(api) : "—"}`;
}

function BlocoHistorico({ c, competencia, mostrar, ativo = true, estadoMeses, carregarMeses, estadoSemanas, carregarSemanas, onIrParaCompetencia }) {
  const [aba, setAba] = useState("meses");
  const ano = String(competencia).slice(0, 4);
  const mesNum = Number(String(competencia).slice(5));
  useEffect(() => {
    if (!mostrar || !ativo) return;
    if (aba === "meses" && !estadoMeses) carregarMeses(c.id);
    if (aba === "semanas" && !estadoSemanas) carregarSemanas(c.id, competencia);
  }, [mostrar, ativo, aba, estadoMeses, estadoSemanas, carregarMeses, carregarSemanas, c.id, competencia]);

  const cabecalho = (
    <div className="vf-pb-inv__h">
      Histórico do consolidado
      <div className="vf-segmented" role="group" aria-label="Período do histórico">
        <button type="button" className={`vf-segmented__item${aba === "meses" ? " is-active" : ""}`} aria-pressed={aba === "meses"} onClick={() => setAba("meses")}>Meses {ano}</button>
        <button type="button" className={`vf-segmented__item${aba === "semanas" ? " is-active" : ""}`} aria-pressed={aba === "semanas"} onClick={() => setAba("semanas")}>Semanas de {MES3[mesNum - 1]}</button>
      </div>
    </div>
  );
  if (!mostrar) {
    return <>{cabecalho}<p className="vf-pb-inv__nota">O histórico mensal é o snapshot do CONSOLIDADO do cliente — numa seção de marketplace ele mostraria número de outro marketplace. Abra pela aba Consolidado.</p></>;
  }
  if (aba === "semanas") {
    const e = estadoSemanas;
    return (
      <>
        {cabecalho}
        {(!e || e.carregando) && <Esqueleto n={4} />}
        {e?.erro && !e.carregando && <p className="vf-pb-inv__nota">Não foi possível carregar as semanas. {e.erro.mensagem} <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => carregarSemanas(c.id, competencia, { forcar: true })}>Tentar de novo</button></p>}
        {e?.semanas && e.semanas.length === 0 && <p className="vf-pb-inv__nota">Sem dados semanais reais nesta competência.</p>}
        {e?.semanas?.length > 0 && <TabelaSemanas semanas={e.semanas} />}
        {e?.definicaoSemana && <p className="vf-pb-inv__nota">{e.definicaoSemana}.</p>}
      </>
    );
  }
  const e = estadoMeses;
  if (!e || e.carregando) return <>{cabecalho}<Esqueleto n={4} /></>;
  if (e.erro) {
    return <>{cabecalho}<p className="vf-pb-inv__nota">Não foi possível carregar o histórico. {e.erro.mensagem} <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => carregarMeses(c.id, { forcar: true })}>Tentar de novo</button></p></>;
  }
  const meses = (e.meses || []).filter((m) => String(m.competencia).startsWith(ano));
  if (!meses.length) return <>{cabecalho}<p className="vf-pb-inv__nota">Nenhuma competência com dado em {ano}.</p></>;
  const max = Math.max(...meses.map((m) => Number(m.resumo?.fat) || 0)) || 1;
  const porComp = Object.fromEntries(meses.map((m) => [m.competencia, m]));
  const ultimo = Math.max(mesNum, ...meses.map((m) => Number(String(m.competencia).slice(5))));
  const ordenados = [...meses].sort((a, b) => String(a.competencia).localeCompare(String(b.competencia)));
  const idx = ordenados.findIndex((m) => m.competencia === competencia);
  const fim = idx < 0 ? ordenados.length : idx + 1;
  const linhas = ordenados.slice(Math.max(0, fim - 3), fim).reverse();
  return (
    <>
      {cabecalho}
      <div className="vf-pb-serie">
        {Array.from({ length: ultimo }, (_, i) => {
          const comp = `${ano}-${String(i + 1).padStart(2, "0")}`;
          const m = porComp[comp];
          const fat = Number(m?.resumo?.fat) || 0;
          return (
            <button
              key={comp}
              type="button"
              className={`vf-pb-serie__b${comp === competencia ? " is-atual" : ""}${m?.parcial ? " is-parcial" : ""}`}
              onClick={() => onIrParaCompetencia?.(comp)}
              aria-label={`Ir para ${rotularCompetencia(comp)}`}
              title={`${rotularCompetencia(comp)} · ${m ? `FAT ${brl(m.resumo?.fat)} · MC ${ehAusente(m.resumo?.mc) ? "—" : pct(m.resumo.mc)}` : "sem dado"}`}
            >
              <i style={{ height: m ? Math.max(3, Math.round((fat / max) * 56)) : 0 }} />
              <span>{MES3[i]}</span>
            </button>
          );
        })}
      </div>
      <table className="vf-pb-mini">
        <thead><tr><th>Mês</th><th>FAT</th><th>vs. anterior</th><th>MC</th><th>Δ MC</th></tr></thead>
        <tbody>
          {linhas.map((m) => {
            const v = m.variacaoVsMesAnterior;
            return (
              <tr key={m.competencia} className={m.competencia === competencia ? "is-atual" : ""}>
                <td>{rotularCompetenciaCurta(m.competencia)}{m.parcial ? " · parcial" : ""}</td>
                <td>{ehAusente(m.resumo?.fat) ? "—" : brl(m.resumo.fat)}</td>
                <td>{v?.fat && !ehAusente(v.fat.pct) ? formatarVariacaoPercentual(v.fat.pct) : "—"}</td>
                <td>{ehAusente(m.resumo?.mc) ? "—" : pct(m.resumo.mc)}</td>
                <td>{v?.mc && !ehAusente(v.mc.pp) ? formatarPontosPercentuais(v.mc.pp) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="vf-pb-inv__nota">Variação vs. mês anterior: dado do histórico (/meses). Clique numa barra para trocar a competência da tela.</p>
    </>
  );
}

function rotuloCurtoConta(rotulo) {
  const [mp] = partesRotulo(rotulo);
  const m = /^(Mercado Livre|Shopee|TikTok Shop|TikTok) (\d+)$/.exec(mp);
  if (!m) return mp;
  return `${{ "Mercado Livre": "ML", Shopee: "Shopee", "TikTok Shop": "TikTok", TikTok: "TikTok" }[m[1]]} ${m[2]}`;
}

function BlocoComposicao({ c, competencia, estado, carregar, ativo = true }) {
  const [sel, setSel] = useState("soma");
  useEffect(() => { if (ativo && !estado) carregar(c.id, competencia); }, [ativo, estado, carregar, c.id, competencia]);
  const cab = <div className="vf-pb-inv__h">Composição do faturamento</div>;
  if (!estado || estado.carregando) return <>{cab}<Esqueleto n={5} /></>;
  if (estado.erro) {
    return <>{cab}<p className="vf-pb-inv__nota">Não foi possível carregar a composição. {estado.erro.mensagem} <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => carregar(c.id, competencia, { forcar: true })}>Tentar de novo</button></p></>;
  }
  const contas = (estado.contas || []).filter((x) => x.composicao);
  const semComp = (estado.contas || []).filter((x) => !x.composicao);
  const opcoes = [
    ...(contas.length > 1 && estado.somaDasContas ? [{ v: "soma", t: `Soma das contas · ${contas.length}`, comp: estado.somaDasContas }] : []),
    ...contas.map((x) => ({ v: String(x.contaId), t: rotuloCurtoConta(x.rotulo), full: x.rotulo, comp: x.composicao })),
  ];
  const alvo = opcoes.find((o) => o.v === sel) || opcoes[0];
  const fora = (c.contas || []).filter((k) => k.ativa && k.resumo && k.fonte?.tipo === "manual");
  return (
    <>
      <div className="vf-pb-inv__h">
        Composição do faturamento
        {opcoes.length > 1 && (
          <div className="vf-pb-conta-btns" role="group" aria-label="Conta da composição">
            {opcoes.map((o) => {
              const on = alvo?.v === o.v;
              return (
                <button key={o.v} type="button" className={`vf-btn vf-btn--sm ${on ? "vf-btn--primary" : "vf-btn--ghost"}`} aria-pressed={on} title={o.full} onClick={() => setSel(o.v)}>
                  {o.t}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {!alvo ? (
        <p className="vf-pb-inv__nota">Nenhuma conta com pedidos importados nesta competência. Conta com lançamento manual não tem pedidos para compor.</p>
      ) : (
        <table className="vf-pb-mini" data-testid={`composicao-${c.id}`}>
          <tbody>
            <tr><td>Faturamento bruto · {formatarNumero(alvo.comp.bruto?.pedidos ?? 0)} pedidos</td><td>{formatarMoeda(alvo.comp.bruto?.valor ?? 0, { casas: 0 })}</td></tr>
            {LINHAS_EXCLUSAO.filter((l) => !l.soSeExistir || Number(alvo.comp.exclusoes?.[l.chave]?.pedidos) > 0).map((l) => (
              <tr key={l.chave} title={l.ajuda}><td>− {l.rotulo}</td><td>{formatarMoeda(-(Number(alvo.comp.exclusoes?.[l.chave]?.valor) || 0), { casas: 0 })}</td></tr>
            ))}
            <tr className="is-total"><td>FAT · faturamento válido</td><td>{alvo.comp.fat == null ? "—" : formatarMoeda(alvo.comp.fat, { casas: 0 })}</td></tr>
            {alvo.comp.reconciliacao && (
              <tr><td>Conferência</td><td>{alvo.comp.reconciliacao.fecha ? <span className="vf-status is-success">fecha</span> : <span className="vf-status is-danger">{ehAusente(alvo.comp.reconciliacao.diferenca) ? "não confere" : `difere ${formatarMoeda(alvo.comp.reconciliacao.diferenca, { sinalPositivo: true })}`}</span>}</td></tr>
            )}
          </tbody>
        </table>
      )}
      {(fora.length > 0 || semComp.length > 0) && (
        <p className="vf-pb-inv__nota">
          Fora da composição: {[...new Set([...fora.map((k) => `${k.rotulo} (${manualSobreApi(k) ? "manual sobre API" : "manual"})`), ...semComp.filter((x) => !fora.some((k) => k.id === x.contaId)).map((x) => x.rotulo)])].join(", ")} — lançamento manual não tem pedidos.
        </p>
      )}
    </>
  );
}

function LinhaInvestigacao({
  c, span, competencia, competenciaAtual, marketplaceRotulo, podeLancar, onLancarPendentes,
  podeAtualizar, atualizacao, onAtualizar, onRecolher, mostrarHistorico,
  estadoMeses, carregarMeses, estadoSemanas, carregarSemanas, estadoComposicao, carregarComposicao, onIrParaCompetencia,
}) {
  const pend = (c.contas || []).filter(contaAguardaLancamento);
  // Lazy por VISIBILIDADE: abrir vários clientes de uma vez ("Pendentes",
  // "Merece atenção") não dispara histórico/composição de todos — só do que
  // aparece na tela. Sem IntersectionObserver, carrega ao abrir.
  const ref = useRef(null);
  const [visivel, setVisivel] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (visivel || !ref.current || typeof IntersectionObserver === "undefined") return undefined;
    const obs = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) { setVisivel(true); obs.disconnect(); }
    }, { rootMargin: "120px" });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visivel]);
  return (
    <tr className="vf-pb-inv">
      <td colSpan={span}>
        <div ref={ref} className="vf-pb-inv__in" role="region" aria-label={`Investigar ${c.nome}`}>
          <div className="vf-pb-inv__bar">
            <b>Investigar {c.nome}</b>
            <span>{rotularCompetencia(competencia)} · {marketplaceRotulo || "consolidado"}</span>
            <span className="vf-pb-inv__at">{atualizacoesTxt(c)}</span>
            <span className="vf-pb-sp" />
            {pend.length > 0 && podeLancar && (
              <button type="button" className="vf-btn vf-btn--sm" onClick={() => onLancarPendentes(c)}>Lançar pendentes ({pend.length})</button>
            )}
            {podeAtualizar && (
              <BotaoAtualizar cliente={c} competencia={competencia} competenciaAtual={competenciaAtual} atualizacao={atualizacao} onAtualizar={onAtualizar} />
            )}
            <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={onRecolher}>Recolher</button>
          </div>
          <div className="vf-pb-inv__grid">
            <section aria-label="Histórico">
              <BlocoHistorico
                c={c} competencia={competencia} mostrar={mostrarHistorico} ativo={visivel}
                estadoMeses={estadoMeses} carregarMeses={carregarMeses}
                estadoSemanas={estadoSemanas} carregarSemanas={carregarSemanas}
                onIrParaCompetencia={onIrParaCompetencia}
              />
            </section>
            <section aria-label="Composição do faturamento">
              <BlocoComposicao c={c} competencia={competencia} estado={estadoComposicao} carregar={carregarComposicao} ativo={visivel} />
            </section>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Grupo (Squad) ──────────────────────────────────────────────────────────
// Sem soma de dinheiro por Squad (depende do backend): só a situação em contagem.
function LinhaGrupo({ g, cs, fechado, onAlternar }) {
  const cl = g.clientes;
  const comDado = cl.filter((c) => c.resumo).length;
  const nPd = cl.reduce((s, c) => s + (c.contas || []).filter(contaAguardaLancamento).length, 0);
  const nAc = cl.filter((c) => (c.contas || []).some(tecnico)).length;
  return (
    <tr className="vf-pb-g">
      <th scope="rowgroup">
        <button type="button" className="vf-pb-g__btn" aria-expanded={!fechado} onClick={onAlternar}>
          <span className="vf-pb-chev" style={{ transform: `rotate(${fechado ? 0 : 90}deg)` }} aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className="vf-pb-g__nome">Squad {g.nome}</span>
          <span className="vf-pb-g__n">{cl.length} {cl.length === 1 ? "cliente" : "clientes"}</span>
        </button>
      </th>
      {cs.map((k) => (k === "dados"
        ? (
          <td key={k}>
            <span className="vf-pb-dados-l">
              {comDado} de {cl.length} com dados{nPd ? ` · ${nPd} a lançar` : ""}{nAc ? ` · ${nAc} c/ integração` : ""}
            </span>
          </td>
        )
        : <td key={k} className="num" title="Total por squad depende de agregado do servidor" />))}
    </tr>
  );
}

// ── Tabela ─────────────────────────────────────────────────────────────────
export function TabelaCarteira({
  clientes, competencia, competenciaAtual = competencia, vista = "essencial", densidade = "confortavel",
  agrupar = false, ordemSquads = [], expansao, atualizando = false, destaqueId = null, marketplaceRotulo = null,
  podeLancar = false, onLancar = () => {}, onLancarPendentes = () => {},
  podeAtualizar = false, atualizacoes = {}, onAtualizar = () => {}, onDispensarAtualizacao = () => {},
  mostrarHistoricoCliente = true, onIrParaCompetencia,
  mesesPorCliente = {}, carregarMeses = () => {}, semanasPorChave = {}, carregarSemanas = () => {},
  semanasContasPorCliente = {}, carregarSemanasContas = () => {}, composicaoPorCliente = {}, carregarComposicao = () => {},
}) {
  const detalhada = vista === "detalhada";
  const essencial = !detalhada;
  const cs = COLS[detalhada ? "detalhada" : "essencial"];
  const [sort, setSort] = useState({ k: "fat", dir: -1 });
  const [gFechados, setGFechados] = useState(() => new Set());
  const wrapRef = useRef(null);
  const [W, setW] = useState(1100);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const medir = () => setW(el.clientWidth || 1100);
    medir();
    if (typeof ResizeObserver === "undefined") return undefined;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const lista = useMemo(() => ordenarCarteira(clientes, sort), [clientes, sort]);
  const maxFat = Math.max(0, ...lista.map((c) => Number(c.resumo?.fat) || 0));
  const L = larguras(cs, W - 2, detalhada);
  const span = cs.length + 1;

  const grupos = useMemo(() => {
    if (!agrupar) return null;
    const mapa = new Map();
    for (const c of lista) {
      const id = c.squad?.id ?? "sem";
      if (!mapa.has(id)) mapa.set(id, { id, nome: c.squad?.nome || "sem squad", clientes: [] });
      mapa.get(id).clientes.push(c);
    }
    // Ordem dos squads = a do servidor (squadsDisponiveis); o resto por nome.
    const pos = (id) => { const i = ordemSquads.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
    return [...mapa.values()].sort((a, b) => pos(a.id) - pos(b.id) || a.nome.localeCompare(b.nome, "pt-BR"));
  }, [agrupar, lista, ordemSquads]);

  function ordenarPor(k) {
    setSort((s) => (s.k === k ? { k, dir: -s.dir } : { k, dir: k === "nome" ? 1 : -1 }));
  }

  function th({ k, label, titulo, num }) {
    const at = sort.k === k;
    return (
      <th key={k} scope="col" className={num ? "num" : ""} aria-sort={at ? (sort.dir < 0 ? "descending" : "ascending") : "none"} title={titulo}>
        <button type="button" className={`vf-pb-sort${at ? (sort.dir < 0 ? " is-desc" : " is-asc") : ""}`} onClick={() => ordenarPor(k)} aria-label={`Ordenar clientes por ${label}`}>
          {label}
        </button>
      </th>
    );
  }

  function linhasCliente(c) {
    const aberto = expansao.clientesAbertos.has(c.id);
    const atualizacao = atualizacoes[c.id]?.competencia === competencia ? atualizacoes[c.id] : null;
    const emCurso = atualizacaoEmCurso(atualizacao);
    const job = atualizacao?.job;
    const desfecho = !emCurso && atualizacao && (atualizacao.erro || job?.estado === "falhou" || job?.estado === "concluida_com_pendencias");
    const contas = [...(c.contas || [])].sort((a, b) => (b.ativa ? 1 : 0) - (a.ativa ? 1 : 0));
    const meta = [
      !agrupar && c.squad?.nome ? c.squad.nome : null,
      composicaoContas(c),
    ].filter(Boolean).join(" · ");
    const linhas = [
      <tr
        key={`c${c.id}`}
        id={`vf-ph-cliente-${c.id}`}
        className={`vf-pb-cli${aberto ? " is-aberto" : ""}${destaqueId === c.id ? " is-flash" : ""}`}
      >
        <th scope="row">
          <button
            type="button"
            className="vf-pb-tog"
            aria-expanded={aberto}
            aria-label={`Cliente ${c.nome} — ${aberto ? "recolher" : "expandir"} contas`}
            onClick={() => expansao.alternarCliente(c.id)}
          >
            <Chev />
            <span className="vf-pb-cli__txt">
              <span className="vf-pb-cli__nome">{c.nome}</span>
              <span className="vf-pb-cli__meta">{meta}</span>
            </span>
          </button>
        </th>
        {cs.map((k) => (k === "dados"
          ? <td key={k}><DadosCliente c={c} competencia={competencia} atualizacao={atualizacao} /></td>
          : <td key={k} className={`num vf-pb-col-${k}`}>{celulaCliente(c, k, maxFat, essencial)}</td>))}
      </tr>,
    ];
    if (desfecho) {
      linhas.push(<LinhaAtualizacao key={`a${c.id}`} cliente={c} atualizacao={atualizacao} colSpan={span} onAtualizar={onAtualizar} onDispensar={onDispensarAtualizacao} />);
    }
    if (!aberto) return linhas;
    if (!contas.length) {
      linhas.push(
        <tr key={`e${c.id}`} className="vf-pb-estado">
          <td colSpan={span}>Nenhuma conta/operação cadastrada — cadastre a operação em <a href="clientes.html">Clientes e Contas</a> para separar o número por conta.</td>
        </tr>,
      );
    }
    contas.forEach((k, i) => {
      const det = expansao.contasAbertas.has(`${c.id}:${k.id}`);
      const [mp, nome] = partesRotulo(k.rotulo);
      const estadoConta = job?.contas?.find((x) => x.contaId === k.id) || null;
      linhas.push(
        <tr key={`k${k.id}`} className={`vf-pb-conta${k.ativa ? "" : " is-inativa"}${i === contas.length - 1 ? " is-ultima" : ""}`}>
          <th scope="row">
            <button
              type="button"
              className="vf-pb-conta__tog"
              aria-expanded={det}
              aria-label={`Conta ${k.rotulo} — ${det ? "recolher" : "expandir"} detalhes e semanas`}
              onClick={() => expansao.alternarConta(c.id, k.id)}
            >
              <Chev tamanho={8} />
              {nome ? <><span className="vf-pb-conta__mp">{mp} ·</span><span className="vf-pb-conta__nome">{nome}</span></> : <span className="vf-pb-conta__nome">{mp}</span>}
            </button>
          </th>
          {cs.map((col) => (col === "dados"
            ? (
              <td key={col}>
                <div className="vf-pb-dados">
                  <span className="vf-pb-dados__txt"><OrigemConta k={k} estadoConta={estadoConta} emCurso={emCurso} /></span>
                  {podeLancar && <BotaoConta cliente={c} k={k} onLancar={onLancar} />}
                </div>
              </td>
            )
            : <td key={col} className="num">{celulaConta(k, col, essencial)}</td>))}
        </tr>,
      );
      if (det) {
        linhas.push(
          <LinhaDetalheConta key={`d${k.id}`} cliente={c} conta={k} colSpan={span} onLancar={onLancar}>
            <SemanasDaConta
              cliente={c} conta={k} competencia={competencia}
              estado={semanasContasPorCliente[`${c.id}:${competencia}`]} carregar={carregarSemanasContas}
            />
          </LinhaDetalheConta>,
        );
      }
    });
    linhas.push(
      <LinhaInvestigacao
        key={`i${c.id}`}
        c={c} span={span} competencia={competencia} competenciaAtual={competenciaAtual}
        marketplaceRotulo={marketplaceRotulo} podeLancar={podeLancar} onLancarPendentes={onLancarPendentes}
        podeAtualizar={podeAtualizar} atualizacao={atualizacao} onAtualizar={onAtualizar}
        onRecolher={() => expansao.alternarCliente(c.id)} mostrarHistorico={mostrarHistoricoCliente}
        estadoMeses={mesesPorCliente[c.id]} carregarMeses={carregarMeses}
        estadoSemanas={semanasPorChave[`${c.id}:${competencia}`]} carregarSemanas={carregarSemanas}
        estadoComposicao={composicaoPorCliente[`${c.id}:${competencia}`]} carregarComposicao={carregarComposicao}
        onIrParaCompetencia={onIrParaCompetencia}
      />,
    );
    return linhas;
  }

  return (
    <div ref={wrapRef} className={`vf-pb-tabela${atualizando ? " is-atualizando" : ""}`} data-testid="tabela-carteira">
      <table className={`vf-pb-table${densidade === "compacta" ? " is-compacta" : ""}`}>
        <caption className="vf-visually-hidden">Clientes da carteira em {rotularCompetencia(competencia)}. Expanda um cliente para ver as contas.</caption>
        <colgroup>
          <col style={{ width: L.cli }} />
          {cs.map((k) => <col key={k} style={{ width: L.w[k] }} />)}
        </colgroup>
        <thead>
          <tr>
            {th({ k: "nome", label: "Cliente", titulo: "Ordenar por nome" })}
            {cs.map((k) => th({ k: CHAVE_SORT[k] || k, label: ROT[k], titulo: TIT[k], num: k !== "dados" }))}
          </tr>
        </thead>
        <tbody>
          {grupos
            ? grupos.flatMap((g) => [
              <LinhaGrupo
                key={`g${g.id}`} g={g} cs={cs} fechado={gFechados.has(g.id)}
                onAlternar={() => setGFechados((s) => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}
              />,
              ...(gFechados.has(g.id) ? [] : g.clientes.flatMap(linhasCliente)),
            ])
            : lista.flatMap(linhasCliente)}
        </tbody>
      </table>
    </div>
  );
}

