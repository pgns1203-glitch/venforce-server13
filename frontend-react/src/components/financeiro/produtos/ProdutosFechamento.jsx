// frontend-react/src/components/financeiro/produtos/ProdutosFechamento.jsx
//
// A investigação detalhada do fechamento — a ÚLTIMA seção da página. Filtros,
// busca e paginação continuam na tabela; aqui só a moldura (título + total).
import { SecaoFinanceira } from "../shared/SecaoFinanceira.jsx";
import { ProdutosFinanceiroTable } from "./ProdutosFinanceiroTable.jsx";

export function ProdutosFechamento({ linhas }) {
  return (
    <SecaoFinanceira
      id="produtos"
      titulo="Produtos do fechamento"
      descricao={`${linhas.length.toLocaleString("pt-BR")} ${linhas.length === 1 ? "linha" : "linhas"} do processamento — para investigar o que explica o resultado.`}
    >
      <ProdutosFinanceiroTable linhas={linhas} />
    </SecaoFinanceira>
  );
}
