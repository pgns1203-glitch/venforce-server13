// frontend-react/src/components/painelContas/VisaoCarteira.jsx
//
// V4 — "Resumo da carteira" + "Merece atenção" num painel só, acima da lista.
//
// Resumo: só CONTAGENS. Os números vêm de `resumoCarteira` (calculado no
// servidor sobre a carteira filtrada, antes do filtro de status) e da lista
// já carregada (contas ativas, clientes por squad). Nenhuma soma de FAT/LC/
// Ads e nenhuma MC/TACoS da carteira é calculada aqui: um total financeiro
// da carteira precisa de um agregado oficial do backend (DEPENDE DE BACKEND)
// para não virar uma segunda definição de FAT/MC no front.
//
// Cada barra de composição FILTRA: squad → filtro de squad · marketplace →
// seção · dados → filtro de status. Os mesmos filtros da barra.
//
// Merece atenção: regras de atencao.js (sem score). Três visíveis + "Ver
// todos (N)" num painel lateral agrupado por regra.

import { useState } from "react";
import { VFDrawer } from "../ui/VFDrawer/index.js";
import { formatarNumero } from "../../utils/numbers.js";
import { rotularCompetenciaCurta } from "../../utils/dates.js";

const CHAVE_RECOLHIDO = "vf:painel-contas:resumo-recolhido";
const MAX_REGRAS_VISIVEIS = 3;
const TONS = ["t1", "t2", "t3", "t4"];

function lerRecolhido() {
  try {
    return window.localStorage.getItem(CHAVE_RECOLHIDO) === "1";
  } catch {
    return false;
  }
}

function gravarRecolhido(valor) {
  try {
    window.localStorage.setItem(CHAVE_RECOLHIDO, valor ? "1" : "0");
  } catch {
    /* preferência visual */
  }
}

function pct(parte, total) {
  return total > 0 ? Math.round((parte / total) * 100) : 0;
}

function Stat({ rotulo, valor, sub, detalhe, quebra = false }) {
  return (
    <div className={`vf-ph-stat${quebra ? " is-quebra" : ""}`}>
      <p className="vf-ph-stat__k">{rotulo}</p>
      <p className="vf-ph-stat__v">{valor}</p>
      {sub && <p className="vf-ph-stat__s">{sub}</p>}
      {detalhe && <p className="vf-ph-stat__d">{detalhe}</p>}
    </div>
  );
}

// Barra fina + legenda clicável. `itens`: { chave, rotulo, n, tom, ativo }.
function Composicao({ titulo, base, itens, onSelecionar }) {
  const total = itens.reduce((s, i) => s + i.n, 0);
  const temSel = itens.some((i) => i.ativo);
  if (total === 0) return null;
  return (
    <div className="vf-ph-mix">
      <p className="vf-ph-mix__k"><span>{titulo}</span><span>{base}</span></p>
      <div className={`vf-ph-bar${temSel ? " tem-sel" : ""}`} aria-hidden="true">
        {itens.filter((i) => i.n > 0).map((i) => (
          <span key={i.chave} className={`vf-ph-bar__seg is-${i.tom}${i.ativo ? " is-sel" : ""}`} style={{ flexGrow: i.n }} />
        ))}
      </div>
      <div className="vf-ph-leg">
        {itens.filter((i) => i.n > 0).map((i) => (
          <button
            key={i.chave}
            type="button"
            aria-pressed={i.ativo}
            onClick={() => onSelecionar(i)}
            title={`${i.rotulo}: ${formatarNumero(i.n)} ${i.n === 1 ? "cliente" : "clientes"}`}
          >
            <i className={`is-${i.tom}`} />
            {i.rotulo} <b>{pct(i.n, total)}%</b>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ResumoCarteira({
  resumoCarteira: r, clientes = [], competencia, status, squadId, marketplace,
  secoesMarketplace = [], mostrarLegado, onStatus, onSquad, onMarketplace, recolhido, onRecolher,
  descricaoEscopo,
}) {
  if (!r) return null;
  const comAlgumDado = (r.comDados || 0) + (r.parciais || 0);
  const contasAtivas = clientes.reduce((s, c) => s + (c.contas || []).filter((x) => x.ativa).length, 0);
  const listaCompleta = status === "todos";

  // Squad: contagem de clientes da lista carregada (só faz sentido sem filtro
  // de squad e sem filtro de status — senão a lista já é um recorte).
  const porSquad = new Map();
  if (squadId == null && listaCompleta) {
    for (const c of clientes) {
      const chave = c.squad?.id ?? "sem";
      const atual = porSquad.get(chave) || { chave, id: c.squad?.id ?? null, rotulo: c.squad?.nome || "Sem squad", n: 0 };
      atual.n += 1;
      porSquad.set(chave, atual);
    }
  }
  const itensSquad = [...porSquad.values()]
    .sort((a, b) => b.n - a.n)
    .map((s, i) => ({ ...s, tom: TONS[i] || "t4", ativo: false }));

  const itensMp = secoesMarketplace.map((s, i) => ({
    chave: s.codigo, codigo: s.codigo, rotulo: s.rotulo, n: s.clientes || 0, tom: TONS[i] || "t4", ativo: marketplace === s.codigo,
  }));

  const itensDados = [
    { chave: "com_dados", rotulo: "Completos", n: r.comDados || 0, tom: "ok", ativo: status === "com_dados" },
    { chave: "parcial", rotulo: "Parciais", n: r.parciais || 0, tom: "parc", ativo: status === "parcial" },
    { chave: "sem_dados", rotulo: "Sem dados", n: r.semDados || 0, tom: "nd", ativo: status === "sem_dados" },
  ];

  return (
    <div className="vf-ph-visao__resumo" data-testid="resumo-carteira">
      <div className="vf-ph-visao__head">
        <h2 className="vf-ph-visao__titulo">Resumo da carteira</h2>
        <span className="vf-ph-visao__sub">{rotularCompetenciaCurta(competencia)} · {descricaoEscopo}</span>
        <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm vf-ph-visao__acao" aria-expanded={!recolhido} onClick={onRecolher}>
          {recolhido ? "Expandir ▾" : "Recolher ▴"}
        </button>
      </div>

      <div className="vf-ph-stats">
        <Stat
          rotulo="Carteira"
          valor={`${formatarNumero(r.operacionais)} ${r.operacionais === 1 ? "cliente" : "clientes"}`}
          sub={listaCompleta ? `${formatarNumero(contasAtivas)} ${contasAtivas === 1 ? "conta ativa" : "contas ativas"}` : null}
          detalhe={!mostrarLegado && r.legadoOcultos > 0 ? `${formatarNumero(r.legadoOcultos)} do legado ocultos` : null}
        />
        <Stat
          rotulo="Dados"
          valor={`${formatarNumero(comAlgumDado)} de ${formatarNumero(r.operacionais)}`}
          sub={`com dados · ${formatarNumero(r.comDados || 0)} completos · ${formatarNumero(r.parciais || 0)} parciais`}
          quebra
        />
        <Stat rotulo="Sem dados" valor={formatarNumero(r.semDados || 0)} sub={`sem número em ${rotularCompetenciaCurta(competencia)}`} />
        <Stat rotulo="Pedem ação" valor={formatarNumero(r.atencao || 0)} sub="conectar, lançar ou investigar" />
        <Stat
          rotulo="Fonte"
          valor={`${formatarNumero(r.manuais || 0)} ${r.manuais === 1 ? "manual" : "manuais"}`}
          sub={`${formatarNumero(r.automaticos || 0)} automáticos (API)`}
        />
      </div>

      {!recolhido && (
        <div className="vf-ph-mixes">
          {itensSquad.length > 1 && (
            <Composicao titulo="Squad" base="por cliente" itens={itensSquad} onSelecionar={(i) => onSquad(i.id)} />
          )}
          {itensMp.length > 0 && (
            <Composicao
              titulo="Marketplace"
              base="clientes com conta"
              itens={itensMp}
              onSelecionar={(i) => onMarketplace(marketplace === i.codigo ? null : i.codigo)}
            />
          )}
          <Composicao
            titulo="Dados"
            base="por cliente"
            itens={itensDados}
            onSelecionar={(i) => onStatus(status === i.chave ? "todos" : i.chave)}
          />
        </div>
      )}
    </div>
  );
}

function NomesClientes({ itens, onCliente, max = 2 }) {
  const visiveis = itens.slice(0, max);
  const resto = itens.length - visiveis.length;
  return (
    <p className="vf-ph-att__nomes">
      {visiveis.map((it, i) => (
        <span key={it.cliente.id}>
          {i > 0 && " · "}
          <button type="button" className="vf-ph-lk" onClick={() => onCliente(it.cliente)} title={it.detalhe || undefined}>
            {it.cliente.nome}
          </button>
        </span>
      ))}
      {resto > 0 && <span className="vf-ph-att__det"> · +{resto}</span>}
    </p>
  );
}

export function MereceAtencao({
  regras, competencia, onAcao, onCliente, pendentesLancamento = 0, onResolver, podeLancar = false,
}) {
  const [todosAberto, setTodosAberto] = useState(false);
  const visiveis = regras.slice(0, MAX_REGRAS_VISIVEIS);
  const ocultas = regras.length - visiveis.length;

  return (
    <div className="vf-ph-visao__atencao" data-testid="merece-atencao">
      <div className="vf-ph-visao__head">
        <h2 className="vf-ph-visao__titulo">Merece atenção</h2>
        <span className="vf-ph-visao__sub">{rotularCompetenciaCurta(competencia)} · regras simples, sem score</span>
        <span className="vf-ph-visao__acao vf-ph-visao__botoes">
          {podeLancar && pendentesLancamento > 0 && (
            <button type="button" className="vf-btn vf-btn--primary vf-btn--sm" onClick={onResolver}>
              Lançar pendentes ({pendentesLancamento})
            </button>
          )}
          {regras.length > 0 && (
            <button type="button" className="vf-btn vf-btn--sm" onClick={() => setTodosAberto(true)}>
              Ver todos ({regras.length})
            </button>
          )}
        </span>
      </div>

      {regras.length === 0 ? (
        <p className="vf-ph-att__vazio">Nenhuma regra com clientes neste recorte.</p>
      ) : (
        <ul className="vf-ph-att">
          {visiveis.map((regra) => (
            <li key={regra.chave} className={`vf-ph-att__item${regra.forte ? " is-forte" : ""}`}>
              <span className="vf-ph-att__n">{regra.itens.length}</span>
              <div className="vf-ph-att__corpo">
                <p className="vf-ph-att__l">
                  {regra.titulo} <small>· {regra.explicacao}</small>
                </p>
                <NomesClientes itens={regra.itens} onCliente={onCliente} />
              </div>
              {(regra.acao.tipo !== "fila" || podeLancar) && (
                <button type="button" className="vf-btn vf-btn--sm vf-ph-att__go" onClick={() => onAcao(regra)}>
                  {regra.acao.rotulo}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {ocultas > 0 && <p className="vf-ph-att__mais-txt">+{ocultas} {ocultas === 1 ? "regra" : "regras"} · use Ver todos</p>}

      {todosAberto && (
        <VFDrawer
          title="Merece atenção"
          subtitle={`${rotularCompetenciaCurta(competencia)} · ${regras.length} ${regras.length === 1 ? "regra" : "regras"} com clientes`}
          onClose={() => setTodosAberto(false)}
          className="vf-ph-drawer vf-ph-att-todos"
        >
          <div className="vf-ph-att-todos__corpo">
            {regras.map((regra) => (
              <section key={regra.chave} className="vf-ph-att-todos__grupo" aria-label={regra.titulo}>
                <header className="vf-ph-att-todos__head">
                  <p className="vf-ph-att__l">
                    {regra.titulo} <small>· {regra.itens.length} · {regra.explicacao}</small>
                  </p>
                  {(regra.acao.tipo !== "fila" || podeLancar) && (
                    <button type="button" className="vf-btn vf-btn--sm" onClick={() => { setTodosAberto(false); onAcao(regra); }}>
                      {regra.acao.rotulo}
                    </button>
                  )}
                </header>
                <ul className="vf-ph-att-todos__lista">
                  {regra.itens.map((it) => (
                    <li key={it.cliente.id}>
                      <span className="vf-ph-att-todos__nome">{it.cliente.nome}</span>
                      {it.detalhe && <span className="vf-ph-att-todos__det">{it.detalhe}</span>}
                      <button
                        type="button"
                        className="vf-btn vf-btn--ghost vf-btn--sm"
                        onClick={() => { setTodosAberto(false); onCliente(it.cliente); }}
                        aria-label={`Ver ${it.cliente.nome} na lista`}
                      >
                        Ver
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </VFDrawer>
      )}
    </div>
  );
}

export { lerRecolhido, gravarRecolhido };
