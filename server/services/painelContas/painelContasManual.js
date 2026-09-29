// server/services/painelContas/painelContasManual.js
// Validação PURA do lançamento manual do Painel de Contas (conta × competência)
// — para marketplace sem integração automática ou conta sem dado da API.
//
// Unidades (as mesmas do resto do Painel):
//   faturamento / lucroContribuicao / investimentoAds / gmvAds → R$
//   margemContribuicao → FRAÇÃO (0.18 = 18%). O frontend converte o % digitado.
//
// Derivações (só quando o operador não informou o campo):
//   FAT + LC      → MC = LC / FAT
//   FAT + MC      → LC = FAT × MC
//   FAT + LC + MC → precisam concordar (tolerância de 0,5 p.p.), senão recusa
// ACOS/TACoS NÃO são gravados: são derivados na leitura pelas funções oficiais
// (calcularAcos / calcularTacos), como para o dado automático.
//
// Ausência é null, zero é zero: campo vazio nunca vira 0.

const { asFiniteOrNull, round2 } = require("./painelContasMetricas");

const TOLERANCIA_MC = 0.005; // 0,5 ponto percentual
const OBSERVACAO_MAX = 500;
const CAMPOS = ["faturamento", "lucroContribuicao", "margemContribuicao", "investimentoAds", "gmvAds"];

function competenciaValida(valor) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(valor || ""));
  if (!m) return false;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  return ano > 2000 && ano < 2100 && mes >= 1 && mes <= 12;
}

function falha(codigo, mensagem, campo = null) {
  return { ok: false, codigo, mensagem, campo };
}

// Aceita número ou texto numérico com ponto decimal. "" / null / undefined =
// ausente. Qualquer outra coisa é inválida (nunca coerção silenciosa).
function lerNumero(valor) {
  if (valor === null || valor === undefined || valor === "") return { ausente: true, valor: null };
  if (typeof valor !== "number" && typeof valor !== "string") return { invalido: true };
  if (typeof valor === "string" && !/^\s*-?\d+(\.\d+)?\s*$/.test(valor)) return { invalido: true };
  const n = asFiniteOrNull(valor);
  return n === null ? { invalido: true } : { ausente: false, valor: n };
}

function validarLancamento(entrada = {}) {
  const v = {};
  for (const campo of CAMPOS) {
    const lido = lerNumero(entrada[campo]);
    if (lido.invalido) return falha("MANUAL_INVALIDO", `Valor inválido em ${campo}.`, campo);
    v[campo] = lido.valor;
  }

  for (const campo of ["faturamento", "investimentoAds", "gmvAds"]) {
    if (v[campo] !== null && v[campo] < 0) return falha("MANUAL_INVALIDO", `${campo} não pode ser negativo.`, campo);
  }
  if (v.margemContribuicao !== null && Math.abs(v.margemContribuicao) > 1) {
    return falha("MANUAL_INVALIDO", "Margem de contribuição deve ser uma fração entre -1 e 1 (ex.: 0.18 = 18%).", "margemContribuicao");
  }
  if (CAMPOS.every((c) => v[c] === null)) {
    return falha("MANUAL_VAZIO", "Informe ao menos uma métrica.");
  }

  const derivados = [];
  const fat = v.faturamento;
  if (fat !== null && fat > 0 && v.lucroContribuicao !== null && v.margemContribuicao !== null) {
    if (Math.abs(v.lucroContribuicao / fat - v.margemContribuicao) > TOLERANCIA_MC) {
      return falha(
        "MANUAL_INCONSISTENTE",
        "FAT, LC e MC não batem: MC deve ser LC ÷ FAT (tolerância de 0,5 p.p.). Informe só dois deles para o terceiro ser calculado.",
        "margemContribuicao"
      );
    }
  } else if (fat !== null && fat > 0 && v.lucroContribuicao !== null) {
    v.margemContribuicao = v.lucroContribuicao / fat;
    derivados.push("margemContribuicao");
  } else if (fat !== null && v.margemContribuicao !== null && v.lucroContribuicao === null) {
    v.lucroContribuicao = fat * v.margemContribuicao;
    derivados.push("lucroContribuicao");
  }

  const observacao = String(entrada.observacao ?? "").trim().slice(0, OBSERVACAO_MAX) || null;

  return {
    ok: true,
    derivados,
    valores: {
      faturamento: round2(v.faturamento),
      lucroContribuicao: round2(v.lucroContribuicao),
      margemContribuicao: v.margemContribuicao === null ? null : Math.round(v.margemContribuicao * 1e6) / 1e6,
      investimentoAds: round2(v.investimentoAds),
      gmvAds: round2(v.gmvAds),
      observacao,
    },
  };
}

module.exports = { validarLancamento, competenciaValida, TOLERANCIA_MC, OBSERVACAO_MAX };
