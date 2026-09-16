// frontend-react/src/components/cliente360v3/dossie/PonteWaterfall.jsx
//
// A ponte do resultado como BRIDGE CHART de verdade — a pergunta "por que o
// resultado mudou?" respondida em ~2 segundos, não numa lista de <details>.
//
// Modelo do gráfico (e por que ele é assim):
//
//   O eixo vertical é o DELTA em relação ao resultado anterior. A linha zero
//   não é um zero arbitrário: ELA É o resultado do período comparado, rotulado
//   na régua acima do gráfico. Um waterfall com eixo ancorado em R$ 0 seria
//   ilegível aqui — a operação varia 2 mil sobre uma base de 20 mil, e todas
//   as barras virariam fios de cabelo no topo da tela.
//
//   Direção NÃO depende de cor (§28), em três camadas redundantes:
//     · POSIÇÃO — o passo positivo SOBE a partir do acumulado anterior, o
//       negativo DESCE dele (é o que um waterfall faz; ninguém precisa da cor
//       para ver um degrau descendo);
//     · TEXTURA — positivo sólido, negativo hachurado, resíduo em cinza
//       hachurado;
//     · SINAL — o valor sempre traz + ou − explícito, acima ou abaixo da barra.
//
//   A soma dos fatores pode não reconstruir o delta do fechamento — o contrato
//   prevê isso (`ponte.fecha`/`ponte.residuo`). Quando não fecha, a diferença
//   vira uma coluna própria, "não explicado", em vez de ser diluída nos outros
//   fatores. Número não é forçado a fechar.

import { formatarMoeda, formatarVariacaoMoeda } from "../../../utils/currency.js";
import { rotularCompetencia } from "../../../utils/dates.js";
import { Indisponivel } from "./Primitivos.jsx";

const ALTURA = 150; // px úteis de gráfico — o resto do bloco é régua e rótulo

function montarPassos(ponte) {
  const passos = [];
  let acumulado = 0;
  for (const linha of ponte.linhas || []) {
    const de = acumulado;
    acumulado += linha.impacto;
    passos.push({ ...linha, de, para: acumulado });
  }

  const deltaTotal = ponte.fim - ponte.inicio;
  const naoExplicado = deltaTotal - acumulado;
  if (Math.abs(naoExplicado) > 0.01) {
    passos.push({
      chave: "nao_explicado",
      label: "Não explicado",
      impacto: naoExplicado,
      de: acumulado,
      para: deltaTotal,
      naoExplicado: true,
      descricao:
        "A soma dos fatores não reconstrói a variação do resultado. A diferença é mostrada como está, nunca redistribuída entre os fatores.",
    });
  }
  return { passos, deltaTotal };
}

export default function PonteWaterfall({ ponte, periodo, comparacao, confianca, narrativa, onAbrirFator }) {
  if (!ponte) {
    return (
      <Indisponivel
        titulo="Ponte indisponível nesta competência"
        motivo={
          confianca?.motivoOcultarPonte ||
          "Não há dados suficientes nos dois períodos para explicar a variação sem inventar número."
        }
      />
    );
  }

  const { passos, deltaTotal } = montarPassos(ponte);

  const valores = [0, deltaTotal, ...passos.flatMap((p) => [p.de, p.para])];
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const folga = (max - min) * 0.12 || 1;
  const piso = min - folga;
  const teto = max + folga;
  const y = (v) => ((v - piso) / (teto - piso)) * 100;
  const zero = y(0);

  // A última coluna é a VARIAÇÃO total, não o resultado absoluto: o eixo é o
  // delta contra o mês anterior. O valor absoluto de chegada está na régua
  // acima, alinhado à direita, exatamente sobre esta coluna.
  const colunas = [...passos, { chave: "__total", total: true, label: "Variação total", impacto: deltaTotal, de: 0, para: deltaTotal }];

  return (
    <div className="c360d-ponte">
      {/* Régua textual: o "de → para" literal, que o gráfico decompõe abaixo. */}
      <div className="c360d-ponte__regua">
        <span className="c360d-ponte__extremo">
          <span className="c360d-ponte__extremo-rot">{rotularCompetencia(comparacao?.competencia)}</span>
          <span className="c360d-ponte__extremo-val">{formatarMoeda(ponte.inicio, { casas: 0 })}</span>
        </span>
        <span className={`c360d-ponte__delta is-${deltaTotal >= 0 ? "positivo" : "negativo"}`}>
          <span aria-hidden="true">{deltaTotal >= 0 ? "▲" : "▼"}</span>
          {formatarVariacaoMoeda(deltaTotal, 0)}
        </span>
        <span className="c360d-ponte__extremo is-fim">
          <span className="c360d-ponte__extremo-rot">{rotularCompetencia(periodo?.competencia)}</span>
          <span className="c360d-ponte__extremo-val">{formatarMoeda(ponte.fim, { casas: 0 })}</span>
        </span>
      </div>

      <div className="c360d-ponte__grafico" style={{ height: ALTURA }}>
        {/* Linha do resultado anterior — a referência de tudo que está acima/abaixo */}
        <span className="c360d-ponte__zero" style={{ bottom: `${zero}%` }} aria-hidden="true" />

        <div className="c360d-ponte__colunas" style={{ gridTemplateColumns: `repeat(${colunas.length}, minmax(0, 1fr))` }}>
          {colunas.map((col, i) => {
            const positivo = col.impacto >= 0;
            const proxima = colunas[i + 1];
            const base = Math.min(y(col.de), y(col.para));
            const altura = Math.max(1.5, Math.abs(y(col.para) - y(col.de)));
            const clicavel = !col.total && !!onAbrirFator;
            const rotulo = `${col.label}: ${formatarVariacaoMoeda(col.impacto, 0)}`;

            const Elemento = clicavel ? "button" : "div";
            return (
              <Elemento
                key={col.chave}
                type={clicavel ? "button" : undefined}
                className={[
                  "c360d-ponte__col",
                  col.total ? "is-total" : positivo ? "is-positivo" : "is-negativo",
                  col.naoExplicado ? "is-residuo" : "",
                  clicavel ? "is-clicavel" : "",
                ].filter(Boolean).join(" ")}
                onClick={clicavel ? () => onAbrirFator(col) : undefined}
                aria-label={clicavel ? `${rotulo}. Abrir detalhe.` : rotulo}
                title={col.total ? undefined : col.descricao}
              >
                <span
                  className="c360d-ponte__barra"
                  style={{ bottom: `${base}%`, height: `${altura}%` }}
                  aria-hidden="true"
                />
                {/* Conector até o próximo passo: é o que faz as barras lerem
                    como um caminho, e não como colunas avulsas. */}
                {proxima && !proxima.total && (
                  <span className="c360d-ponte__conector" style={{ bottom: `${y(col.para)}%` }} aria-hidden="true" />
                )}
                <span
                  className="c360d-ponte__valor"
                  style={positivo ? { bottom: `${base + altura}%` } : { top: `${100 - base}%` }}
                  aria-hidden="true"
                >
                  {formatarVariacaoMoeda(col.impacto, 0)}
                </span>
              </Elemento>
            );
          })}
        </div>
      </div>

      <div className="c360d-ponte__rotulos" style={{ gridTemplateColumns: `repeat(${colunas.length}, minmax(0, 1fr))` }}>
        {colunas.map((col) => (
          <span key={col.chave} className={`c360d-ponte__rotulo${col.total ? " is-total" : ""}`} title={col.label}>
            {col.label}
          </span>
        ))}
      </div>

      {narrativa?.texto && <p className="c360d-ponte__narrativa">{narrativa.texto}</p>}
    </div>
  );
}
