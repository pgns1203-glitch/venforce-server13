// frontend-react/src/components/financeiro/shared/ValorFinanceiro.jsx
//
// Um número do fechamento, formatado pelo TIPO. Ausente → "—"; zero real →
// "R$ 0,00" / "0,0%". Nenhuma conta aqui além da unidade.

import { formatarMoeda } from "../../../utils/currency.js";
import { formatarPercentual, pontosParaFracao } from "../../../utils/percentage.js";
import { formatarNumero, AUSENTE } from "../../../utils/numbers.js";
import { numOuNull } from "../../../utils/financeiro/resumoFechamento.js";

export function formatarValor(valor, tipo) {
  const n = numOuNull(valor);
  if (n === null) return AUSENTE;
  if (tipo === "fracao") return formatarPercentual(n);
  if (tipo === "pontos") return formatarPercentual(pontosParaFracao(n));
  if (tipo === "numero") return formatarNumero(n);
  return formatarMoeda(n);
}

export function tomDoValor(valor) {
  const n = numOuNull(valor);
  if (n === null || n === 0) return "neutro";
  return n > 0 ? "positivo" : "negativo";
}

export function ValorFinanceiro({ valor, tipo = "moeda", className = "" }) {
  return (
    <span className={`vf-fin-valor is-${tomDoValor(valor)} ${className}`.trim()}>{formatarValor(valor, tipo)}</span>
  );
}
