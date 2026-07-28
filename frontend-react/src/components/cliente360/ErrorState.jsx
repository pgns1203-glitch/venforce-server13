// Erro com mensagem específica por código. Nunca usa "0" para representar falha:
// diz o que aconteceu e o que dá para fazer.

const MENSAGENS = {
  nao_autenticado: {
    titulo: "Sessão expirada",
    texto: "Faça login novamente para continuar.",
    acao: null,
  },
  sem_permissao: {
    titulo: "Sem permissão para este cliente",
    texto: "Seu usuário não tem acesso à operação deste cliente. Fale com um administrador.",
    acao: null,
  },
  nao_encontrado: {
    titulo: "Cliente não encontrado",
    texto: "O slug informado não corresponde a nenhum cliente ativo.",
    acao: null,
  },
  rede: {
    titulo: "Sem resposta do servidor",
    texto: "Não foi possível falar com a API. Verifique a conexão e tente de novo.",
    acao: "Tentar novamente",
  },
};

export default function ErrorState({ erro, onTentarNovamente }) {
  const base = MENSAGENS[erro?.codigo] || {
    titulo: "Não foi possível carregar o resultado",
    texto: erro?.mensagem || "Erro inesperado.",
    acao: "Tentar novamente",
  };
  const mostrarDetalhe = erro?.mensagem && erro.mensagem !== base.texto;

  return (
    <div className="vf-empty c360-erro" role="alert">
      <h3 className="vf-empty__title">{base.titulo}</h3>
      <p className="vf-empty__description">{base.texto}</p>
      {mostrarDetalhe && <p className="c360-erro__detalhe">{erro.mensagem}</p>}
      {base.acao && onTentarNovamente && (
        <div className="vf-empty__actions">
          <button type="button" className="vf-btn vf-btn--secondary" onClick={onTentarNovamente}>
            {base.acao}
          </button>
        </div>
      )}
    </div>
  );
}
