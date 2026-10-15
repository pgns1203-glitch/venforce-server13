// Ponto único onde os endpoints Shopee da matriz serão plugados quando o
// contrato existir. Hoje NENHUM endpoint é conhecido: toda operação falha de
// forma explícita, sem fazer request.
const { MatrizApiError, CODES } = require("./matrizApiError");

function pendente(operacao) {
  return async function operacaoPendente() {
    throw new MatrizApiError(
      CODES.ENDPOINT_NAO_CONFIGURADO,
      `Contrato da matriz pendente: operação "${operacao}" sem endpoint definido.`
    );
  };
}

module.exports = {
  iniciarAutorizacao: pendente("iniciarAutorizacao"),
  consultarAutorizacao: pendente("consultarAutorizacao"),
  listarLojas: pendente("listarLojas"),
  buscarPedidos: pendente("buscarPedidos"),
  buscarProdutos: pendente("buscarProdutos"),
};
