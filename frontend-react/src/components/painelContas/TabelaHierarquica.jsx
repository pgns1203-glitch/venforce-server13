// frontend-react/src/components/painelContas/TabelaHierarquica.jsx
//
// Tabela hierárquica Cliente → Mês → Semana do Painel de Controle de Contas
// por Squad. Não existia nenhum componente pronto para este padrão no
// projeto (Auditoria §16) — construído sobre `.vf-table` (Fundação Global
// V2), só com var(--vf-*) próprias em TabelaHierarquica.css.
//
// Cada nível expande sob demanda: nenhum dado de mês/semana é buscado antes
// do clique na linha (lazy loading real, Auditoria §14). O estado de
// aberto/fechado é local a cada linha; o CACHE do dado já buscado vem do
// hook (usePainelContas) e nunca é descartado ao recolher — reabrir a mesma
// linha não refaz a chamada.

import { useState } from "react";
import { formatarMoeda } from "../../utils/currency.js";
import { formatarPercentual, formatarVariacaoPercentual, formatarPontosPercentuais } from "../../utils/percentage.js";
import { AUSENTE, ehAusente } from "../../utils/numbers.js";
import { rotularCompetenciaCurta } from "../../utils/dates.js";
import "./TabelaHierarquica.css";

const COLUNAS = [
  { chave: "fat", label: "FAT", tipo: "moeda" },
  { chave: "lc", label: "LC", tipo: "moeda" },
  { chave: "mc", label: "MC", tipo: "fracao" },
  { chave: "ads", label: "Invest. Ads", tipo: "moeda" },
  { chave: "acos", label: "ACOS", tipo: "fracao" },
  { chave: "tacos", label: "TACoS", tipo: "fracao" },
  // GAP DE PRODUTO documentado na auditoria (§10) — colunas presentes no
  // layout final, sempre indisponíveis nesta versão. Nunca inventar dado.
  { chave: "com", label: "COM", tipo: "indisponivel" },
  { chave: "atv", label: "ATV", tipo: "indisponivel" },
  { chave: "nps", label: "NPS", tipo: "indisponivel" },
];

function formatarValor(tipo, valor) {
  if (tipo === "indisponivel") return AUSENTE;
  if (tipo === "moeda") return formatarMoeda(valor);
  return formatarPercentual(valor);
}

// fat/lc/ads variam em {abs,pct} -> mostra pct. mc/acos/tacos variam em {pp}.
function formatarVariacao(tipo, variacao) {
  if (!variacao) return null;
  if (tipo === "moeda" && !ehAusente(variacao.pct)) return formatarVariacaoPercentual(variacao.pct);
  if (tipo === "fracao" && !ehAusente(variacao.pp)) return formatarPontosPercentuais(variacao.pp);
  return null;
}

function Celula({ coluna, valor, variacao }) {
  const texto = formatarValor(coluna.tipo, valor);
  const varTexto = formatarVariacao(coluna.tipo, variacao);
  const sinal = varTexto ? (varTexto.startsWith("+") ? "is-positivo" : varTexto.startsWith("−") ? "is-negativo" : "") : "";
  return (
    <td className="num" title={coluna.tipo === "indisponivel" ? "Sem fonte de dado confiável nesta versão" : undefined}>
      <span className="vf-ph-valor">{texto}</span>
      {varTexto && <span className={`vf-ph-delta ${sinal}`}>{varTexto}</span>}
    </td>
  );
}

function Toggle({ aberto, onClick, children, nivel }) {
  return (
    <button type="button" className={`vf-ph-toggle vf-ph-toggle--${nivel}`} onClick={onClick} aria-expanded={aberto}>
      <span className="vf-ph-chevron" data-aberto={aberto ? "true" : "false"} aria-hidden="true">▸</span>
      {children}
    </button>
  );
}

function LinhaSemana({ semana }) {
  return (
    <tr className="vf-ph-row vf-ph-row--semana">
      <td className="vf-table__sticky-cell">
        <span className="vf-ph-indent vf-ph-indent--3">{semana.semana}</span>
        <span className="vf-ph-subtitulo">{String(semana.de).slice(8)}–{String(semana.ate).slice(8)}</span>
      </td>
      <td />
      {COLUNAS.map((c) => (
        <Celula key={c.chave} coluna={c} valor={semana.resumo?.[c.chave] ?? null} />
      ))}
    </tr>
  );
}

function LinhaMes({ clienteId, mes, semanasPorChave, carregarSemanas }) {
  const [aberto, setAberto] = useState(false);
  const chave = `${clienteId}:${mes.competencia}`;
  const estado = semanasPorChave[chave];

  function alternar() {
    const proximo = !aberto;
    setAberto(proximo);
    if (proximo && !estado) carregarSemanas(clienteId, mes.competencia);
  }

  return (
    <>
      <tr className="vf-ph-row vf-ph-row--mes">
        <td className="vf-table__sticky-cell">
          <Toggle aberto={aberto} onClick={alternar} nivel="mes">
            <span className="vf-ph-indent vf-ph-indent--2">{rotularCompetenciaCurta(mes.competencia)}</span>
          </Toggle>
        </td>
        <td className="vf-ph-sincronizado">
          {mes.sincronizadoEm ? new Date(mes.sincronizadoEm).toLocaleDateString("pt-BR") : AUSENTE}
        </td>
        {COLUNAS.map((c) => (
          <Celula key={c.chave} coluna={c} valor={mes.resumo?.[c.chave] ?? null} variacao={mes.variacaoVsMesAnterior?.[c.chave]} />
        ))}
      </tr>
      {aberto && estado?.carregando && (
        <tr className="vf-ph-row vf-ph-row--estado"><td colSpan={COLUNAS.length + 2}>Carregando semanas…</td></tr>
      )}
      {aberto && estado?.erro && (
        <tr className="vf-ph-row vf-ph-row--estado is-erro"><td colSpan={COLUNAS.length + 2}>Não foi possível carregar as semanas. {estado.erro.mensagem}</td></tr>
      )}
      {aberto && estado?.semanas && estado.semanas.length === 0 && (
        <tr className="vf-ph-row vf-ph-row--estado"><td colSpan={COLUNAS.length + 2}>Sem semanas para esta competência.</td></tr>
      )}
      {aberto && estado?.semanas?.map((s) => <LinhaSemana key={s.semana} semana={s} />)}
    </>
  );
}

function LinhaCliente({ cliente, mesesPorCliente, carregarMeses, semanasPorChave, carregarSemanas }) {
  const [aberto, setAberto] = useState(false);
  const estado = mesesPorCliente[cliente.id];

  function alternar() {
    const proximo = !aberto;
    setAberto(proximo);
    if (proximo && !estado) carregarMeses(cliente.id);
  }

  return (
    <>
      <tr className="vf-ph-row vf-ph-row--cliente">
        <td className="vf-table__sticky-cell">
          <Toggle aberto={aberto} onClick={alternar} nivel="cliente">
            <span className="vf-ph-cliente-nome">{cliente.nome}</span>
          </Toggle>
        </td>
        <td>
          {cliente.squad
            ? <span className="vf-tag is-neutral">{cliente.squad.nome}</span>
            : <span className="vf-ph-sem-squad">{AUSENTE}</span>}
        </td>
        {COLUNAS.map((c) => (
          <Celula key={c.chave} coluna={c} valor={cliente.resumo?.[c.chave] ?? null} />
        ))}
      </tr>
      {aberto && !cliente.resumo && (
        <tr className="vf-ph-row vf-ph-row--estado"><td colSpan={COLUNAS.length + 2}>Cliente sem sincronização registrada — nada para expandir ainda.</td></tr>
      )}
      {aberto && cliente.resumo && estado?.carregando && (
        <tr className="vf-ph-row vf-ph-row--estado"><td colSpan={COLUNAS.length + 2}>Carregando meses…</td></tr>
      )}
      {aberto && cliente.resumo && estado?.erro && (
        <tr className="vf-ph-row vf-ph-row--estado is-erro"><td colSpan={COLUNAS.length + 2}>Não foi possível carregar os meses. {estado.erro.mensagem}</td></tr>
      )}
      {aberto && cliente.resumo && estado?.meses && estado.meses.length === 0 && (
        <tr className="vf-ph-row vf-ph-row--estado"><td colSpan={COLUNAS.length + 2}>Sem competências sincronizadas neste ano.</td></tr>
      )}
      {aberto && cliente.resumo && estado?.meses?.map((mes) => (
        <LinhaMes
          key={mes.competencia}
          clienteId={cliente.id}
          mes={mes}
          semanasPorChave={semanasPorChave}
          carregarSemanas={carregarSemanas}
        />
      ))}
    </>
  );
}

export function TabelaHierarquica({ clientes, mesesPorCliente, carregarMeses, semanasPorChave, carregarSemanas }) {
  return (
    <div className="vf-table-wrap vf-ph-wrap">
      <table className="vf-table vf-ph-table">
        <thead>
          <tr>
            <th className="vf-table__sticky-cell">Cliente</th>
            <th>Squad · Sincronização</th>
            {COLUNAS.map((c) => (
              <th key={c.chave} className="num">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clientes.map((cliente) => (
            <LinhaCliente
              key={cliente.id}
              cliente={cliente}
              mesesPorCliente={mesesPorCliente}
              carregarMeses={carregarMeses}
              semanasPorChave={semanasPorChave}
              carregarSemanas={carregarSemanas}
            />
          ))}
        </tbody>
      </table>
      <p className="vf-ph-legenda">
        COM, ATV e NPS ainda não têm fonte de dado confiável e auditada — aparecem como colunas do layout final,
        sempre "—" nesta versão. Nenhum valor é inventado.
      </p>
    </div>
  );
}
