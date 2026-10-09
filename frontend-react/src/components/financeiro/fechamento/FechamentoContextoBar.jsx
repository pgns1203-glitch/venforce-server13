// frontend-react/src/components/financeiro/fechamento/FechamentoContextoBar.jsx
//
// O que está sendo fechado: marketplace, conta (com o identificador externo)
// e cliente. Tudo vem do Shell — aqui é só LEITURA. Não existe seletor de
// cliente, marketplace ou conta nesta tela: a entrega pertence ao contexto.

export const MK_LABEL = { meli: "Mercado Livre", shopee: "Shopee", tiktok: "TikTok Shop" };

export function rotuloDaConta({ contaNome, contaRotuloExterno, clienteContaId }) {
  const nome = contaNome || (clienteContaId ? `Operação #${clienteContaId}` : null);
  if (!nome) return null;
  return contaRotuloExterno && contaRotuloExterno !== nome ? `${nome} · ${contaRotuloExterno}` : nome;
}

export function FechamentoContextoBar({ clienteNome, marketplace, contaNome, contaRotuloExterno, clienteContaId }) {
  const itens = [
    { rotulo: "Marketplace", valor: MK_LABEL[marketplace] || marketplace || null },
    { rotulo: "Conta", valor: rotuloDaConta({ contaNome, contaRotuloExterno, clienteContaId }) },
    { rotulo: "Cliente", valor: clienteNome || null },
  ].filter((i) => i.valor);

  return (
    <dl className="vf-fin-contexto" data-testid="contexto-fechamento">
      {itens.map((item) => (
        <div key={item.rotulo} className="vf-fin-contexto__item">
          <dt>{item.rotulo}</dt>
          <dd>{item.valor}</dd>
        </div>
      ))}
    </dl>
  );
}
