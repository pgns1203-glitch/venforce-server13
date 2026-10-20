// frontend-react/src/components/financeiro/mesa/CustoRapido.jsx
//
// Célula de custo de um produto SEM CUSTO na lista do Financeiro: o "+ Custo"
// da lista de Anúncios ML. Enter grava na base vinculada, Esc ou clicar fora
// cancela (nunca grava por distração). Depois de gravar mostra o valor com
// "na base" — o LC/MC só mudam ao reprocessar.
//
// Identidade que não é "segura" (sem ID do Item, registro ambíguo) não abre
// campo: o botão leva às Pendências, onde a escolha é feita, ou explica o
// motivo quando o fechamento não foi processado nesta sessão.
//
// A linha da lista é um botão (expande a composição): todo clique e tecla
// aqui dentro para de propagar.

import { useRef, useState } from "react";
import { parseMoedaBR } from "../../../utils/fechamentoPayload.js";
import { formatarMoeda } from "../../../utils/currency.js";

const parar = (e) => e.stopPropagation();

export function CustoRapido({ linha, custoRapido, onAbrirPendencias, onVerMotivo }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [fase, setFase] = useState("parado"); // parado | salvando
  const [erro, setErro] = useState(null);
  // O input fica disabled durante o envio e isso dispara blur: o ref (e não
  // o estado, que ainda não mudou no closure) impede o blur de cancelar.
  const salvandoRef = useRef(false);

  const salvo = custoRapido.salvoDe(linha);
  if (salvo) {
    return (
      <span className="vf-fin-custo-rapido is-salvo" title="Custo salvo na base de custos. Reprocesse o fechamento para atualizar o LC e a MC.">
        {formatarMoeda(salvo.custo)}
        <span className="vf-fin-custo-rapido__tag">na base</span>
      </span>
    );
  }

  const identidade = custoRapido.identidade(linha);
  if (!identidade) return null;

  if (identidade.classe !== "segura") {
    const abrir = (e) => {
      e.stopPropagation();
      if (onAbrirPendencias) onAbrirPendencias();
      else onVerMotivo?.();
    };
    return (
      <button type="button" className="vf-fin-custo-rapido__add" title={identidade.motivo || undefined} onClick={abrir} onKeyDown={parar}>
        + Custo
      </button>
    );
  }

  if (!editando) {
    return (
      <button
        type="button"
        className="vf-fin-custo-rapido__add"
        title="Cadastrar o custo deste produto na base de custos"
        onKeyDown={parar}
        onClick={(e) => {
          e.stopPropagation();
          setEditando(true);
          setErro(null);
        }}
      >
        + Custo
      </button>
    );
  }

  const custo = parseMoedaBR(valor);
  const cancelar = () => {
    setEditando(false);
    setValor("");
    setErro(null);
  };
  async function gravar() {
    if (custo === null || custo <= 0) {
      setErro("Use um valor maior que zero, ex.: 42,90");
      return;
    }
    salvandoRef.current = true;
    setFase("salvando");
    setErro(null);
    try {
      await custoRapido.salvar(linha, custo);
      setEditando(false);
    } catch (e) {
      setErro(e?.message || "Não foi possível salvar o custo.");
    } finally {
      salvandoRef.current = false;
      setFase("parado");
    }
  }

  return (
    <span className="vf-fin-custo-rapido" onClick={parar}>
      <span className="vf-fin-custo-rapido__campo">
        <span className="vf-fin-custo-rapido__prefixo" aria-hidden="true">R$</span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="vf-fin-custo-rapido__input"
          placeholder="0,00"
          value={valor}
          disabled={fase === "salvando"}
          aria-label="Custo do produto. Enter salva na base de custos, Esc cancela."
          aria-invalid={erro ? true : undefined}
          title="Enter salva na base de custos, Esc cancela"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onChange={(e) => setValor(e.target.value)}
          onBlur={() => {
            if (!salvandoRef.current && !erro) cancelar();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              gravar();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelar();
            }
          }}
        />
      </span>
      {fase === "salvando" && <span className="vf-fin-custo-rapido__nota" aria-live="polite">Salvando…</span>}
      {erro && <span className="vf-fin-custo-rapido__erro" role="alert">{erro}</span>}
    </span>
  );
}
