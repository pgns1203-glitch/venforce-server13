// frontend-react/src/components/cliente360v3/dossie/ProdutosCentral.jsx
//
// Central analítica de produtos — UMA tabela, quatro modos de leitura.
//
// A versão anterior tinha quatro blocos visuais diferentes (ajudaram /
// prejudicaram / no vermelho / abaixo da meta) e o mesmo produto aparecia em
// mais de um deles com colunas diferentes em cada. Para responder "o Produto 2
// é grande? está no vermelho? quanto ele custou de resultado?" era preciso
// caçar o item em três tabelas e reconstruir a história de cabeça.
//
// Aqui cada produto é UMA linha. Os modos não trocam de interface: eles
// filtram e reordenam a mesma tabela (§13), e o Status muda de fonte só no
// modo Margem — que é declarado no cabeçalho do bloco.

import { formatarMoeda, formatarVariacaoMoeda } from "../../../utils/currency.js";
import { formatarPercentual } from "../../../utils/percentage.js";
import { AUSENTE, formatarNumero, plural } from "../../../utils/numbers.js";
import { MODOS_PRODUTOS, STATUS_MARGEM } from "../../../utils/dossie.js";
import TabelaDensa, { CelulaProdutoDensa, FaixaAbc } from "./TabelaDensa.jsx";
import { Proporcao, Indisponivel, Esqueleto } from "./Primitivos.jsx";

const LIMITE_PADRAO = 10;

function StatusCelula({ linha, margemPorMlb }) {
  // No modo Margem o Status passa a vir do Motor de Margem — outra fonte,
  // outra pergunta ("este item dá lucro?" em vez de "este item mexeu o
  // resultado do mês?"). A troca é anunciada no cabeçalho da seção.
  if (margemPorMlb) {
    const info = margemPorMlb[linha.mlb];
    if (!info) return <span className="vf-status is-empty">Não consultado</span>;
    if (info.identidade === "missing") {
      return (
        <span className="c360d-status is-empty" title={info.motivo}>
          Sem custo
        </span>
      );
    }
    const mapa = STATUS_MARGEM[info.status] || { label: info.statusLabel || info.status, tom: "neutral" };
    return <span className={`c360d-status is-${mapa.tom}`} title={info.problemaPrincipal || undefined}>{mapa.label}</span>;
  }

  return (
    <span className={`c360d-status is-${linha.status.tom}`} title={linha.problema || undefined}>
      {linha.status.label}
    </span>
  );
}

export function colunasProdutos({ onAbrirProduto, margemPorMlb, comProblema = false }) {
  const colunas = [
    {
      key: "produto",
      header: "Produto",
      width: comProblema ? "25%" : "30%",
      cabecalhoDeLinha: true,
      render: (l) => (
        <CelulaProdutoDensa
          linha={l}
          onAbrir={onAbrirProduto}
          marcadores={
            l.curvaA && (l.status.chave === "vermelho" || l.status.chave === "abaixo")
              ? [{ label: "A em risco", tom: "danger", titulo: "Curva A com problema de margem — o caso mais caro da operação" }]
              : []
          }
        />
      ),
    },
    { key: "abc", header: "ABC", width: "6%", titulo: "Curva ABC por faturamento acumulado do período", render: (l) => <FaixaAbc valor={l.curvaAbc} /> },
    {
      key: "faturamento", header: "Faturamento", width: "15%", align: "right", ordenarPor: "faturamento",
      render: (l) => formatarMoeda(l.faturamento, { casas: 0 }),
    },
    {
      key: "participacao", header: "Part.", width: "10%", align: "right", ordenarPor: "participacao",
      titulo: "Participação no faturamento da competência",
      render: (l) => (
        <span className="c360d-part">
          <Proporcao fracao={l.participacao} />
          {formatarPercentual(l.participacao, 1)}
        </span>
      ),
    },
    {
      key: "contribuicao", header: "Impacto", width: comProblema ? "13%" : "14%", align: "right", ordenarPor: "contribuicao",
      titulo: "Contribuição do item para a variação do resultado (fonte: ponte)",
      render: (l) =>
        l.contribuicao == null
          ? <span className="c360d-ausente" title="Item fora da ponte desta competência">{AUSENTE}</span>
          : formatarVariacaoMoeda(l.contribuicao, 0),
      cellClassName: (l) => (l.contribuicao == null ? "" : l.contribuicao >= 0 ? "is-positivo" : "is-negativo"),
    },
    {
      key: "margem", header: "MC%", width: "9%", align: "right", ordenarPor: "margem",
      titulo: "Margem de contribuição realizada no período",
      render: (l) => formatarPercentual(l.margem, 1),
      cellClassName: (l) => (l.margem != null && l.margem < 0 ? "is-negativo" : ""),
    },
    { key: "status", header: "Status", width: comProblema ? "14%" : "16%", render: (l) => <StatusCelula linha={l} margemPorMlb={margemPorMlb} /> },
  ];

  if (comProblema) {
    colunas.push({
      key: "problema", header: "Problema", width: "17%",
      render: (l) => (
        <span className="c360d-fraco c360d-truncar" title={l.problema || undefined}>
          {l.problemaCurto || AUSENTE}
        </span>
      ),
    });
  }
  return colunas;
}

export default function ProdutosCentral({
  linhas,
  linhasTotais,
  modo,
  onTrocarModo,
  ordenacao,
  onOrdenar,
  onAbrirProduto,
  produtoAberto,
  margem,
  totais,
  margemAlvo,
  onVerTodos,
}) {
  const emMargem = modo === "margem";
  const margemPorMlb = emMargem && margem?.dados?.aplicavel ? margem.dados.porMlb : null;
  const visiveis = linhas.slice(0, LIMITE_PADRAO);
  const ocultas = linhas.length - visiveis.length;

  const contagens = {
    problemas: linhasTotais.filter((l) => l.status.chave === "vermelho" || l.status.chave === "abaixo").length,
  };

  return (
    <div className="c360d-produtos">
      <div className="c360d-produtos__barra">
        <div className="vf-segmented" role="group" aria-label="Modo de leitura dos produtos">
          {MODOS_PRODUTOS.map((m) => (
            <button
              key={m.chave}
              type="button"
              className={`vf-segmented__item${modo === m.chave ? " is-active" : ""}`}
              aria-pressed={modo === m.chave}
              onClick={() => onTrocarModo(m.chave)}
            >
              {m.label}
              {m.chave === "problemas" && contagens.problemas > 0 && (
                <span className="vf-badge is-danger">{contagens.problemas}</span>
              )}
            </button>
          ))}
        </div>

        <span className="c360d-fonte">
          {margemPorMlb
            ? "Status por item: Motor de Margem"
            : `Status por item: classificação do fechamento · alvo de margem ${formatarPercentual(margemAlvo ?? 0.15, 0)}`}
        </span>
      </div>

      {emMargem && margem?.carregando && !margem?.dados && <Esqueleto linhas={4} />}

      {emMargem && margem?.dados && !margem.dados.aplicavel && (
        <Indisponivel
          compacto
          titulo="Margem indisponível para esta conta"
          motivo={margem.dados.motivo}
        />
      )}

      {(!emMargem || !margem?.carregando || margem?.dados) && (
        <TabelaDensa
          legenda="Produtos da competência"
          colunas={colunasProdutos({ onAbrirProduto, margemPorMlb })}
          linhas={visiveis}
          chave={(l) => l.mlb}
          onSelecionar={onAbrirProduto}
          selecionada={produtoAberto}
          ordenacao={ordenacao}
          onOrdenar={onOrdenar}
          classeLinha={(l) => (l.status.chave === "vermelho" ? "is-critica" : "")}
          vazio={
            modo === "problemas"
              ? "Nenhum produto no vermelho nem abaixo do alvo nesta competência."
              : "Nenhum produto material nesta competência."
          }
        />
      )}

      <div className="c360d-produtos__rodape">
        <span className="c360d-fraco">
          {plural(linhas.length, "item", "itens")} nesta leitura
          {totais?.analisados != null && <> · {formatarNumero(totais.analisados)} analisados na competência</>}
          {/* O payload da 360 carrega os itens MATERIAIS (topo de cada
              classificação), não o catálogo inteiro — dizer isso evita que
              "Ver todos" prometa uma lista que o contrato não entrega. */}
        </span>
        {ocultas > 0 && (
          <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={onVerTodos}>
            Ver os {linhas.length} itens
          </button>
        )}
      </div>
    </div>
  );
}
