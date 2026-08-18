// Erro sem apagar o último snapshot bom: este componente só aparece quando
// AINDA não existe nenhum dado carregado (ver FullGestaoPage — se já havia
// um snapshot bom, ele continua na tela junto com o aviso de stale/erro).
export default function FullErrorState({ erro, onTentarNovamente }) {
  const mensagem =
    erro?.status === 429
      ? "O Mercado Livre limitou as requisições desta conta. Tente novamente em instantes."
      : erro?.status === 424
      ? "Esta conta não tem uma conexão válida com o Mercado Livre."
      : erro?.mensagem || "Não foi possível carregar os dados.";

  return (
    <div className="full-estado full-estado--erro" role="alert">
      <p>{mensagem}</p>
      <button type="button" className="vf-btn" onClick={onTentarNovamente}>
        Tentar novamente
      </button>
    </div>
  );
}
