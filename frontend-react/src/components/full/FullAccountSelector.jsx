// Seletor Cliente → Conta Mercado Livre. Puramente controlado pelo hook
// useFullAccountPicker (nenhuma chamada de API aqui) — só decide o que
// mostrar: opções, estados de carregamento/erro e a orientação curta
// quando ainda não há uma conta operacional selecionada. Uma conta sem
// grant válido aparece aqui como "aguardando grant"/"grant com problema",
// nunca é escondida nem gera sozinha a coleta Full.
import { classificarStatusConta } from "../../utils/fullAccountStatus.js";

function rotuloConta(conta) {
  const status = classificarStatusConta(conta);
  return `${status.symbol} ${conta.nome} · ${status.label}`;
}

export default function FullAccountSelector({
  clientes,
  carregandoClientes,
  erroClientes,
  clienteId,
  onClienteChange,
  contas,
  carregandoContas,
  erroContas,
  contaId,
  onContaChange,
  contaSelecionada,
  statusContaSelecionada,
}) {
  return (
    <div className="full-account-picker">
      <div className="full-account-picker-field">
        <label htmlFor="full-picker-cliente">Cliente</label>
        <select
          id="full-picker-cliente"
          className="vf-select"
          value={clienteId}
          onChange={(e) => onClienteChange(e.target.value)}
          disabled={carregandoClientes || clientes.length === 0}
        >
          <option value="">
            {carregandoClientes ? "Carregando clientes…" : clientes.length === 0 ? "Nenhum cliente disponível" : "Selecione um cliente"}
          </option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>

      <div className="full-account-picker-field">
        <label htmlFor="full-picker-conta">Conta Mercado Livre</label>
        <select
          id="full-picker-conta"
          className="vf-select"
          value={contaId}
          onChange={(e) => onContaChange(e.target.value)}
          disabled={!clienteId || carregandoContas || contas.length === 0}
        >
          <option value="">
            {!clienteId
              ? "Selecione um cliente primeiro"
              : carregandoContas
              ? "Carregando contas…"
              : contas.length === 0
              ? "Nenhuma conta Mercado Livre"
              : "Selecione uma conta"}
          </option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>
              {rotuloConta(c)}
            </option>
          ))}
        </select>
      </div>

      {erroClientes && (
        <p className="full-aviso full-aviso--erro" role="alert">
          Não foi possível carregar os clientes ({erroClientes.mensagem}).
        </p>
      )}
      {clienteId && erroContas && (
        <p className="full-aviso full-aviso--erro" role="alert">
          Não foi possível carregar as contas Mercado Livre deste cliente ({erroContas.mensagem}).
        </p>
      )}

      {!clienteId && !carregandoClientes && !erroClientes && (
        <p className="full-account-picker-hint">Selecione um cliente para ver as contas Mercado Livre disponíveis.</p>
      )}
      {clienteId && !carregandoContas && !erroContas && contas.length === 0 && (
        <p className="full-account-picker-hint">Este cliente não tem nenhuma conta Mercado Livre cadastrada.</p>
      )}
      {clienteId && contas.length > 1 && !contaId && (
        <p className="full-account-picker-hint">Este cliente tem mais de uma conta Mercado Livre — selecione qual conta usar.</p>
      )}
      {contaSelecionada && statusContaSelecionada && statusContaSelecionada.code !== "conectado" && (
        <p className="full-aviso" role="status">
          {statusContaSelecionada.symbol} {contaSelecionada.nome}: {statusContaSelecionada.label.toLowerCase()}. Conecte o grant
          desta conta em Clientes antes de usar a Central Full.
        </p>
      )}
    </div>
  );
}
