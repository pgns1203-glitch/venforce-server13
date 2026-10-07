// server/services/painelContas/painelContasModo.js
// Modo de operação do Painel de Contas (decisão temporária da gestão, 10/2026).
//
// MANUAL (padrão — flag ausente ou qualquer valor diferente de "true"):
//   - o lançamento manual de cliente × conta × competência PREVALECE sobre o
//     import publicado da Central (também no Mercado Livre);
//   - qualquer conta ativa aceita lançamento manual, inclusive ML com import;
//   - o "Atualizar dados" do Painel (única escrita automática PRÓPRIA do
//     Painel) fica desligado.
// AUTOMÁTICO (PAINEL_CONTAS_AUTO_UPDATE_ENABLED=true):
//   - o comportamento anterior: import publicado > manual; manual recusado
//     quando já existe automático; "Atualizar dados" liberado para admin.
//
// Nada aqui desliga a Central de Vendas, o noturno, Ads, Cliente 360 ou a
// Central de Margem: eles continuam gravando as PRÓPRIAS tabelas. O modo só
// decide o que o Painel EXIBE e se o Painel DISPARA sincronização.
//
// Lido a cada chamada (não no load do módulo): reativar é trocar a env e
// reiniciar o serviço, sem deploy de código.

const FLAG = "PAINEL_CONTAS_AUTO_UPDATE_ENABLED";

function autoUpdateHabilitado(env = process.env) {
  return String(env[FLAG] ?? "").trim().toLowerCase() === "true";
}

function modoManual(env = process.env) {
  return !autoUpdateHabilitado(env);
}

function descreverModo(env = process.env) {
  const manual = modoManual(env);
  return {
    codigo: manual ? "manual" : "automatico",
    rotulo: manual ? "Modo manual" : "Modo automático",
    manualPrevalece: manual,
    atualizacaoAutomatica: !manual,
    descricao: manual
      ? "Os valores lançados pela equipe prevalecem sobre a API. A atualização automática do Painel está desligada."
      : "O dado publicado pela API prevalece; o lançamento manual cobre contas sem dado automático.",
  };
}

module.exports = { FLAG, autoUpdateHabilitado, modoManual, descreverModo };
