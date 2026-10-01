// frontend-react/src/components/painelContas/ComposicaoFaturamento.jsx
//
// Demonstrativo do faturamento POR CONTA, dentro da expansão do cliente:
//
//                         Mercado Livre 1   Mercado Livre 2   Soma das contas
//   Faturamento bruto       3.094.153,71        552.142,78      3.646.296,49
//   − Cancelamentos          −183.665,67        −18.601,48       …
//   − Devoluções concluídas …
//   − Devoluções em andamento …
//   − Mediações em aberto   …
//   = FAT                   2.850.010,70        527.989,27      …
//   Conferência             ✓ fecha             ✓ fecha         ✓ fecha
//
// Uma COLUNA por conta: cada operação tem o próprio demonstrativo, e a soma
// fica ao lado, nunca no lugar. Valores em centavos (é uma conferência, não
// um resumo). O FAT é o oficial do import; a conferência só diz se
// bruto − exclusões chega nele. Nada aqui é recalculado no navegador.

import { formatarMoeda } from "../../utils/currency.js";
import { formatarNumero } from "../../utils/numbers.js";
import { formatarData, rotularCompetenciaCurta } from "../../utils/dates.js";

export const LINHAS_EXCLUSAO = [
  { chave: "cancelamentos", rotulo: "Cancelamentos", ajuda: "Pedido cancelado sem reclamação." },
  { chave: "devolucoes", rotulo: "Devoluções concluídas", ajuda: "Reclamação encerrada com devolução ou reembolso." },
  { chave: "devolucoesEmAndamento", rotulo: "Devoluções em andamento", ajuda: "Reclamação aberta com devolução — ainda pode reverter." },
  { chave: "mediacoes", rotulo: "Mediações em aberto", ajuda: "Reclamação aberta sem devolução — ainda pode reverter." },
  { chave: "outrosProblemas", rotulo: "Outros pedidos com problema", ajuda: "Fora do resultado sem tipo de pós-venda identificado.", soSeExistir: true },
];

function pedidos(n) {
  return `${formatarNumero(n)} ${Number(n) === 1 ? "pedido" : "pedidos"}`;
}

function periodoCurto(periodo) {
  if (!periodo?.de || !periodo?.ate) return null;
  return `${formatarData(periodo.de).slice(0, 5)}–${formatarData(periodo.ate).slice(0, 5)}`;
}

function CelulaValor({ grupo, negativo = false, forte = false, soma = false }) {
  const zero = !grupo || Number(grupo.valor) === 0;
  return (
    <td className={`num vf-ph-comp__valor${zero ? " is-zero" : ""}${forte ? " is-forte" : ""}${soma ? " is-soma" : ""}`}>
      <span className="vf-ph-comp__moeda">
        {negativo && !zero ? "− " : ""}{formatarMoeda(grupo?.valor ?? 0)}
      </span>
      <span className="vf-ph-comp__pedidos">{pedidos(grupo?.pedidos ?? 0)}</span>
    </td>
  );
}

function CelulaConferencia({ reconciliacao, soma = false }) {
  if (reconciliacao?.fecha) {
    return (
      <td className={`num vf-ph-comp__conferencia is-ok${soma ? " is-soma" : ""}`}>
        <span className="vf-status is-success">fecha</span>
      </td>
    );
  }
  const dif = reconciliacao?.diferenca;
  return (
    <td className={`num vf-ph-comp__conferencia is-erro${soma ? " is-soma" : ""}`} title="O FAT do import e a soma dos pedidos válidos não batem. Nenhum dos dois foi ajustado.">
      <span className="vf-status is-danger">
        {dif === null || dif === undefined ? "não confere" : `difere ${formatarMoeda(dif, { sinalPositivo: true })}`}
      </span>
    </td>
  );
}

export function DemonstrativoComposicao({ contas = [], somaDasContas = null, competencia }) {
  const comComposicao = contas.filter((c) => c.composicao);
  const semComposicao = contas.filter((c) => !c.composicao);
  const colunas = comComposicao.map((c) => ({ chave: c.contaId, rotulo: c.rotulo, comp: c.composicao }));
  if (somaDasContas && comComposicao.length > 1) {
    colunas.push({ chave: "soma", rotulo: "Soma das contas", comp: somaDasContas, soma: true });
  }
  const exclusoes = LINHAS_EXCLUSAO.filter(
    (l) => !l.soSeExistir || colunas.some((c) => Number(c.comp.exclusoes?.[l.chave]?.pedidos) > 0)
  );
  const notas = [];
  if (somaDasContas?.periodo?.diferente) {
    notas.push("As contas cobrem períodos diferentes (ver o período de cada uma) — a soma junta esses períodos como estão.");
  }
  if (Number(somaDasContas?.sobreposicao?.pedidos) > 0) {
    const n = Number(somaDasContas.sobreposicao.pedidos);
    notas.push(`${n === 1 ? "1 pedido aparece" : `${formatarNumero(n)} pedidos aparecem`} em mais de uma conta (${formatarMoeda(somaDasContas.sobreposicao.valor)} a mais na soma). A soma não deduplica: confira o cadastro das contas.`);
  }
  const semValor = comComposicao.reduce((s, c) => s + (Number(c.composicao.pedidosSemValor) || 0), 0);
  if (semValor > 0) {
    notas.push(`${semValor === 1 ? "1 pedido sem valor registrado entra" : `${formatarNumero(semValor)} pedidos sem valor registrado entram`} na contagem com R$ 0,00.`);
  }

  if (!comComposicao.length) {
    return (
      <p className="vf-ph-comp__vazio">
        Nenhuma conta tem pedidos importados em {rotularCompetenciaCurta(competencia)} — não há o que compor.
        {semComposicao.length > 0 && " Contas com lançamento manual informam só o FAT."}
      </p>
    );
  }

  return (
    <div className="vf-ph-comp">
      <table className="vf-ph-comp__tabela">
        <caption className="vf-visually-hidden">
          Composição do faturamento por conta em {rotularCompetenciaCurta(competencia)}: faturamento bruto, exclusões e FAT.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="vf-ph-comp__rotulo-col">
              <span className="vf-visually-hidden">Linha</span>
            </th>
            {colunas.map((c) => (
              <th key={c.chave} scope="col" className={`num${c.soma ? " is-soma" : ""}`}>
                <span className="vf-ph-comp__conta">{c.rotulo}</span>
                {periodoCurto(c.comp.periodo) && (
                  <span className="vf-ph-comp__periodo">
                    {periodoCurto(c.comp.periodo)}
                    {c.soma && c.comp.periodo?.diferente ? " · períodos diferentes" : ""}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="vf-ph-comp__linha is-bruto">
            <th scope="row">
              Faturamento bruto
              <span className="vf-ph-comp__ajuda">todos os pedidos, cancelados inclusos · regra da Cliente 360 V1</span>
            </th>
            {colunas.map((c) => <CelulaValor key={c.chave} grupo={c.comp.bruto} forte soma={c.soma} />)}
          </tr>
          {exclusoes.map((l) => (
            <tr key={l.chave} className="vf-ph-comp__linha is-exclusao">
              <th scope="row" title={l.ajuda}>− {l.rotulo}</th>
              {colunas.map((c) => <CelulaValor key={c.chave} grupo={c.comp.exclusoes?.[l.chave]} negativo soma={c.soma} />)}
            </tr>
          ))}
          <tr className="vf-ph-comp__linha is-total">
            <th scope="row">
              = FAT
              <span className="vf-ph-comp__ajuda">pedidos válidos · Central de Vendas</span>
            </th>
            {colunas.map((c) => (
              <td key={c.chave} className={`num vf-ph-comp__valor is-forte${c.soma ? " is-soma" : ""}`}>
                <span className="vf-ph-comp__moeda">{c.comp.fat === null ? "—" : formatarMoeda(c.comp.fat)}</span>
                <span className="vf-ph-comp__pedidos">{pedidos(c.comp.validos?.pedidos ?? 0)}</span>
              </td>
            ))}
          </tr>
          <tr className="vf-ph-comp__linha is-conferencia">
            <th scope="row" title="Faturamento bruto menos as exclusões, comparado ao FAT oficial do import.">Conferência</th>
            {colunas.map((c) => <CelulaConferencia key={c.chave} reconciliacao={c.comp.reconciliacao} soma={c.soma} />)}
          </tr>
        </tbody>
      </table>

      <ul className="vf-ph-comp__notas">
        {semComposicao.map((c) => (
          <li key={c.contaId}>{c.rotulo}: {c.motivo || "sem pedidos para compor"} — fora do demonstrativo.</li>
        ))}
        {notas.map((n) => <li key={n}>{n}</li>)}
        <li>
          Mesmo import e mesmos pedidos do FAT de cada conta; cada pedido cai em um só grupo. O valor do pedido é a soma
          dos itens (a base do FAT) — a Cliente 360 V1 ao vivo usa o total do pedido.
        </li>
      </ul>
    </div>
  );
}
