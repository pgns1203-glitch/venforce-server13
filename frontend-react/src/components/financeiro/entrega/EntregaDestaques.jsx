// Destaques positivos e pontos de atenção — linhas livres, nenhuma
// obrigatória. Uma linha vazia sempre à mão para começar a digitar.
function ListaEditavel({ titulo, rotuloItem, itens, onChange, somenteLeitura, placeholder }) {
  const linhas = itens.length ? itens : [""];
  const atualizar = (i, v) => onChange(linhas.map((x, j) => (j === i ? v : x)));
  const remover = (i) => onChange(linhas.filter((_, j) => j !== i));
  return (
    <fieldset className="vf-fin-entrega__lista">
      <legend className="vf-fin-bloco__titulo">{titulo}</legend>
      {somenteLeitura ? (
        itens.length ? (
          <ul className="vf-fin-leitura">{itens.map((t, i) => <li key={i} className="vf-fin-leitura__item is-neutral">{t}</li>)}</ul>
        ) : (
          <p className="vf-field__hint">Nenhum registrado.</p>
        )
      ) : (
        <>
          {linhas.map((valor, i) => (
            <div className="vf-cluster vf-fin-entrega__linha" key={i}>
              <input
                className="vf-input vf-input--sm"
                type="text"
                aria-label={`${rotuloItem} ${i + 1}`}
                placeholder={placeholder}
                value={valor}
                onChange={(e) => atualizar(i, e.target.value)}
              />
              {linhas.length > 1 && (
                <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" aria-label={`Remover ${rotuloItem.toLowerCase()} ${i + 1}`} onClick={() => remover(i)}>
                  Remover
                </button>
              )}
            </div>
          ))}
          <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => onChange([...linhas, ""])}>
            + Adicionar linha
          </button>
        </>
      )}
    </fieldset>
  );
}

export function EntregaDestaques({ conteudo, onChange, somenteLeitura }) {
  return (
    <div className="vf-fin-blocos vf-fin-blocos--2">
      <ListaEditavel
        titulo="Destaques positivos"
        rotuloItem="Destaque"
        placeholder="ex: Crescimento de receita acima da meta"
        itens={conteudo.destaques}
        somenteLeitura={somenteLeitura}
        onChange={(destaques) => onChange({ ...conteudo, destaques })}
      />
      <ListaEditavel
        titulo="Pontos de atenção"
        rotuloItem="Ponto de atenção"
        placeholder="ex: Ruptura de estoque no produto X"
        itens={conteudo.atencoes}
        somenteLeitura={somenteLeitura}
        onChange={(atencoes) => onChange({ ...conteudo, atencoes })}
      />
    </div>
  );
}
