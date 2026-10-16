// Erro sem apagar o último snapshot bom: este componente só aparece quando
// AINDA não existe nenhum dado carregado (ver FullGestaoPage — se já havia
// um snapshot bom, ele continua na tela junto com o aviso de stale/erro).
// Aqui mora só o TEXTO por status do Mercado Livre; a forma é do VFError.
import { VFError } from "../ui/VFEstados/index.js";

export default function FullErrorState({ erro, onTentarNovamente }) {
  const mensagem =
    erro?.status === 429
      ? "O Mercado Livre limitou as requisições desta conta. Tente novamente em instantes."
      : erro?.status === 424
      ? "Esta conta não tem uma conexão válida com o Mercado Livre."
      : erro?.mensagem || "Não foi possível carregar os dados.";

  return (
    <VFError title="Não foi possível carregar os inventários" onRetry={onTentarNovamente}>
      {mensagem}
    </VFError>
  );
}
