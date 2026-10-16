// @ts-check
// VFKpi — cartão de indicador da Fundação Global V2.
//
// Wrapper fino sobre `.vf-kpi` (Portal/css/vf-components-v2.css): nenhum CSS
// próprio. O valor é um VFNumber, então o cartão mostra a própria mudança
// (desliza + destaque) quando o dado muda com a tela aberta.
//
// Movimento extra: `enterIndex` faz o cartão entrar com `.vf-motion-enter`
// atrasado 30 ms por posição — numa grade, os cartões aparecem em sequência
// na montagem. Interativo (`onClick`) ganha elevação no hover pela classe
// (sombra como resposta a estado, nunca em repouso — DESIGN.md).
//
// Não é a "figura" da Visão (.vf-visao-figure, sem caixa): a Visão V3 decidiu
// não usar cards KPI. Lá o dinamismo entra com o VFNumber direto.

import { cx } from "../../../utils/cx.js";
import { VFNumber } from "../VFNumber/index.js";

const TONS = new Set(["warning", "danger", "success"]);
const TONS_RODAPE = new Set(["success", "warning", "danger"]);
const ATRASO_POR_POSICAO = 30; // ms

/**
 * @param {object} props
 * @param {import("react").ReactNode} props.label
 * @param {number | null | undefined} props.value
 * @param {import("../VFNumber/VFNumber.jsx").Formato} [props.format="num"]
 * @param {number} [props.casas]
 * @param {"up" | "down"} [props.goodDirection]
 * @param {import("react").ReactNode} [props.trend]   Pílula de tendência (com sinal no texto).
 * @param {"success" | "warning" | "danger"} [props.trendTone]
 * @param {import("react").ReactNode} [props.foot]
 * @param {"success" | "warning" | "danger"} [props.footTone]
 * @param {"warning" | "danger" | "success"} [props.tone] Filete lateral de alerta.
 * @param {boolean} [props.featured]
 * @param {boolean} [props.active]
 * @param {() => void} [props.onClick] Vira <button> interativo.
 * @param {number} [props.enterIndex]  Posição na grade, para a entrada em sequência.
 * @param {string} [props.className]
 */
export function VFKpi({
  label,
  value,
  format = "num",
  casas,
  goodDirection,
  trend,
  trendTone,
  foot,
  footTone,
  tone,
  featured = false,
  active = false,
  onClick,
  enterIndex,
  className,
  style,
  ...rest
}) {
  const moeda = format === "brl" || format === "brl-compacta";
  const entra = typeof enterIndex === "number";
  const classes = cx(
    "vf-kpi",
    tone && TONS.has(tone) && `vf-kpi--${tone}`,
    featured && "vf-kpi--featured",
    onClick && "vf-kpi--interactive",
    active && "is-active",
    entra && "vf-motion-enter",
    className,
  );
  const estilo = entra ? { ...style, "--vf-motion-delay": `${enterIndex * ATRASO_POR_POSICAO}ms` } : style;

  const conteudo = (
    <>
      <span className="vf-kpi__label">{label}</span>
      <span className={cx("vf-kpi__value", moeda && "vf-kpi__value--currency")}>
        <VFNumber
          value={value}
          format={format}
          casas={casas}
          goodDirection={goodDirection}
          currencyClassName={moeda ? "vf-kpi__currency" : undefined}
        />
      </span>
      {trend != null && (
        <span className={cx("vf-kpi__trend", trendTone && TONS_RODAPE.has(trendTone) && `is-${trendTone}`)}>{trend}</span>
      )}
      {foot != null && (
        <span className={cx("vf-kpi__foot", footTone && TONS_RODAPE.has(footTone) && `is-${footTone}`)}>{foot}</span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} style={estilo} aria-pressed={active} onClick={onClick} {...rest}>
        {conteudo}
      </button>
    );
  }
  return (
    <div className={classes} style={estilo} {...rest}>
      {conteudo}
    </div>
  );
}
