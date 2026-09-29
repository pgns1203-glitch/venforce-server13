// Estado de "Atualizar dados" do Painel de Contas — helper puro, usado pelo
// hook (polling) e pela tabela (spinner/progresso). A entrada é o registro
// local por cliente: { competencia, job, erro, iniciando }.

export function atualizacaoEmCurso(a) {
  return Boolean(a && (a.iniciando || a.job?.estado === "executando"));
}
