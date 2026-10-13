// frontend-react/src/utils/financeiro/entregaConteudo.js
//
// Conteúdo MANUAL da entrega ao cliente (destaques, pontos de atenção e plano
// de prioridades), no MESMO formato que o relatório público lê
// (Portal/relatorio-publico.js extractData → payload_json.entrega):
//
//   entrega.destaques   string[]
//   entrega.atencoes    string[]
//   entrega.prioridades { alta|media|baixa: [{ titulo, desc, data }] }
//
// O legado gravava 3 slots fixos por nível (vazios inclusive); o público
// filtra por `titulo`, então gravar só as ações preenchidas é compatível.

export const NIVEIS_PRIORIDADE = [
  { id: "alta", label: "Alta prioridade" },
  { id: "media", label: "Média prioridade" },
  { id: "baixa", label: "Baixa prioridade" },
];

const txt = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

export function conteudoVazio() {
  return { destaques: [], atencoes: [], prioridades: { alta: [], media: [], baixa: [] } };
}

export function conteudoDoPayload(entregaSalva) {
  const e = entregaSalva && typeof entregaSalva === "object" ? entregaSalva : {};
  const lista = (v) => (Array.isArray(v) ? v.map(txt).filter((s) => s.trim()) : []);
  const prio = e.prioridades && typeof e.prioridades === "object" ? e.prioridades : {};
  const acoes = (v) =>
    (Array.isArray(v) ? v : [])
      .map((a) => ({ titulo: txt(a?.titulo), desc: txt(a?.desc), data: txt(a?.data) }))
      .filter((a) => a.titulo.trim() || a.desc.trim() || a.data.trim());
  return {
    destaques: lista(e.destaques),
    atencoes: lista(e.atencoes),
    prioridades: { alta: acoes(prio.alta), media: acoes(prio.media), baixa: acoes(prio.baixa) },
  };
}

// O que vai para payload_json.entrega. Identidade (cliente/competência) é
// a do contexto, só para leitura do relatório — não é editável na tela.
export function conteudoParaPayload(conteudo, { cliente = null, periodo = null } = {}) {
  const limpa = (lista) => (lista || []).map((s) => txt(s).trim()).filter(Boolean);
  const acoes = (lista) =>
    (lista || [])
      .map((a) => ({ titulo: txt(a.titulo).trim(), desc: txt(a.desc).trim(), data: txt(a.data).trim() }))
      .filter((a) => a.titulo);
  return {
    ...(cliente ? { cliente } : {}),
    ...(periodo ? { periodo } : {}),
    destaques: limpa(conteudo?.destaques),
    atencoes: limpa(conteudo?.atencoes),
    prioridades: {
      alta: acoes(conteudo?.prioridades?.alta),
      media: acoes(conteudo?.prioridades?.media),
      baixa: acoes(conteudo?.prioridades?.baixa),
    },
  };
}

export function mesmoConteudo(a, b) {
  return JSON.stringify(conteudoParaPayload(a)) === JSON.stringify(conteudoParaPayload(b));
}
