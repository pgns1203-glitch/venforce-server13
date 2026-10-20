// frontend-react/src/components/financeiro/mesa/ResultadoDestaque.jsx
//
// O topo da mesa (modelo B): o Resultado Final em destaque, à esquerda, e
// seis números do fechamento numa grade ao lado. Cartão claro como os KPIs
// de Anúncios ML — o destaque vem do tamanho do número, da cor pelo sinal e
// do filete lateral. Tudo do `summary`; nada é recalculado.

import { numerosDoDestaque } from "../../../utils/financeiro/mesa.js";
import { formatarValor, tomDoValor } from "../shared/ValorFinanceiro.jsx";
import { VFNumber } from "../../ui/VFNumber/index.js";

function Apoio({ apoio }) {
  if (!apoio) return null;
  if (apoio.texto) return <span className="vf-fin-mesa-kpi__apoio">{apoio.texto}</span>;
  return (
    <span className="vf-fin-mesa-kpi__apoio">
      {apoio.prefixo}
      {formatarValor(apoio.valor, apoio.tipo)}
    </span>
  );
}

export function ResultadoDestaque({ summary, periodoLabel, origem = null }) {
  const s = summary || {};
  const tom = tomDoValor(s.finalResult);
  const numeros = numerosDoDestaque(s);

  return (
    <section className="vf-card vf-fin-mesa-destaque" aria-label="Resultado do fechamento" data-testid="kpis-processamento">
      <div className={`vf-fin-mesa-destaque__resultado is-${tom}`} data-kpi="finalResult">
        <span className="vf-fin-mesa-destaque__rotulo">Resultado final · {periodoLabel}</span>
        <span className="vf-fin-mesa-destaque__valor">
          <VFNumber value={s.finalResult ?? null} format={(v) => formatarValor(v, "moeda")} goodDirection="up" />
        </span>
        <span className="vf-fin-mesa-destaque__apoio">
          MC final <strong>{formatarValor(s.finalMarginCalculated, "fracao")}</strong> · após ADS, Venforce, afiliados e demais custos
        </span>
        {origem && <span className="vf-fin-mesa-destaque__origem">{origem}</span>}
      </div>
      <div className="vf-fin-mesa-destaque__grade">
        {numeros.map((n) => (
          <div key={n.chave} className="vf-fin-mesa-kpi" data-kpi={n.chave}>
            <span className="vf-fin-mesa-kpi__rotulo">{n.rotulo}</span>
            <span className="vf-fin-mesa-kpi__valor">{formatarValor(n.valor, n.tipo)}</span>
            <Apoio apoio={n.apoio} />
          </div>
        ))}
      </div>
    </section>
  );
}
