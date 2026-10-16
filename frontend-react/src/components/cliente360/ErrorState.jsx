// Erro com mensagem específica por código. Nunca usa "0" para representar falha:
// diz o que aconteceu e o que dá para fazer. Aqui mora só o TEXTO de cada
// código; a forma é do VFError (Fundação V2).

import { VFError } from "../ui/VFEstados/index.js";

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
    <VFError
      title={base.titulo}
      detail={mostrarDetalhe ? erro.mensagem : null}
      onRetry={base.acao ? onTentarNovamente : undefined}
      retryLabel={base.acao || undefined}
    >
      {base.texto}
    </VFError>
  );
}
