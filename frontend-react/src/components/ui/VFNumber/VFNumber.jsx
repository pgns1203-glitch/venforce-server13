// @ts-check
// VFNumber — número que mostra a própria mudança.
//
// Quando `value` muda com o componente na tela (recarga, reprocessamento,
// edição), o número desliza do valor antigo para o novo (≤ 400 ms) e o fundo
// acende e apaga (`.vf-motion-flash`). É o que deixa a tela "viva" sem
// enfeite: o movimento só acontece quando o dado mudou, e mostra o quanto.
//
// Regras (docs/specs/2026-10-16-ui-etapa1-componentes-plano.md §1):
//   - formata SEMPRE com os formatadores de utils/ (ou o `format` que vier);
//   - ausente vira "—" e nunca anima;
//   - durante a animação o texto visível é aria-hidden e o valor FINAL fica
//     num irmão vf-visually-hidden — leitor de tela, teste e print nunca
//     pegam um intermediário. Parado, é um único nó de texto;
//   - destaque neutro por padrão; verde/vermelho só com `goodDirection`
//     (subir nem sempre é bom: custo subindo é ruim);
//   - prefers-reduced-motion: sem interpolação e sem destaque.

import { useEffect, useRef, useState } from "react";
import { cx } from "../../../utils/cx.js";
import { formatarMoeda, formatarMoedaCompacta } from "../../../utils/currency.js";
import { formatarNumero, ehAusente, AUSENTE } from "../../../utils/numbers.js";
import { formatarPercentual } from "../../../utils/percentage.js";
import { useAnimatedNumber } from "../../../hooks/useAnimatedNumber.js";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion.js";

/**
 * @typedef {"brl" | "brl-compacta" | "pct" | "int" | "num" | ((v: number) => string)} Formato
 */

/**
 * @param {Formato} format
 * @param {number | undefined} casas
 * @returns {(v: number) => string}
 */
function formatador(format, casas) {
  if (typeof format === "function") return format;
  switch (format) {
    case "brl":
      return (v) => formatarMoeda(v, casas == null ? undefined : { casas });
    case "brl-compacta":
      return (v) => formatarMoedaCompacta(v);
    case "pct": // fração: 0.18 → 18,0%
      return (v) => formatarPercentual(v, casas ?? 1);
    case "int":
      return (v) => formatarNumero(Math.round(v));
    default:
      return (v) => formatarNumero(v, casas ?? 0);
  }
}

/**
 * "R$ 1.234" → [símbolo, resto]. Mantém o −.
 * @param {string} texto
 */
function separarMoeda(texto) {
  const m = texto.match(/^([−-]?R\$)\s(.+)$/);
  return m ? [m[1], m[2]] : null;
}

/**
 * @param {object} props
 * @param {number | null | undefined} props.value
 * @param {Formato} [props.format="num"]
 * @param {number} [props.casas]
 * @param {boolean} [props.animate=true]
 * @param {boolean} [props.highlight=true]  Acende o fundo quando o valor muda.
 * @param {"up" | "down"} [props.goodDirection] Sentido bom; sem ele o destaque é neutro.
 * @param {string} [props.currencyClassName] Põe o "R$" num <span> com esta classe.
 * @param {string} [props.className]
 */
export function VFNumber({
  value,
  format = "num",
  casas,
  animate = true,
  highlight = true,
  goodDirection,
  currencyClassName,
  className,
  ...rest
}) {
  const reduzido = usePrefersReducedMotion();
  // String numérica da API ("12.5") vale; lixo ("abc") é ausente como NaN.
  const bruto = ehAusente(value) ? NaN : Number(value);
  const numero = Number.isFinite(bruto) ? bruto : null;
  const exibido = useAnimatedNumber(numero, { desativado: reduzido || !animate });

  // Destaque: conta mudanças reais (os dois lados números) depois da montagem.
  const anterior = useRef(numero);
  const [pulso, setPulso] = useState({ n: 0, tom: /** @type {string | null} */ (null) });
  useEffect(() => {
    const de = anterior.current;
    anterior.current = numero;
    if (reduzido || !highlight || de == null || numero == null || de === numero) return;
    const subiu = numero > de;
    const tom = goodDirection ? (subiu === (goodDirection === "up") ? "is-success" : "is-danger") : null;
    setPulso((p) => ({ n: p.n + 1, tom }));
  }, [numero, reduzido, highlight, goodDirection]);

  const fmt = formatador(format, casas);
  const final = numero == null ? AUSENTE : fmt(numero);
  const animando = numero != null && typeof exibido === "number" && exibido !== numero;
  const visivel = animando ? fmt(/** @type {number} */ (exibido)) : final;

  /** @param {string} texto */
  const comMoeda = (texto) => {
    const partes = currencyClassName ? separarMoeda(texto) : null;
    if (!partes) return texto;
    return (
      <>
        <span className={currencyClassName}>{partes[0]}</span>
        {partes[1]}
      </>
    );
  };

  return (
    <span
      key={pulso.n}
      className={cx(pulso.n > 0 && "vf-motion-flash", pulso.n > 0 && pulso.tom, className)}
      {...rest}
    >
      {animando ? (
        <>
          <span aria-hidden="true">{comMoeda(visivel)}</span>
          <span className="vf-visually-hidden">{final}</span>
        </>
      ) : (
        comMoeda(final)
      )}
    </span>
  );
}
