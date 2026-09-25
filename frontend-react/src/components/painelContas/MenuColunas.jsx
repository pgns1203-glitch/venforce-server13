// frontend-react/src/components/painelContas/MenuColunas.jsx
//
// Controle "Colunas ▾" — liga/desliga GRUPOS de métricas (Financeiro, Ads,
// Operação). Por grupo e não por métrica individual de propósito: nove
// checkboxes soltos viram configuração, três viram decisão. O cabeçalho da
// tabela já agrupa exatamente assim, então o menu fala a mesma língua que a
// tela.
//
// Escolha 100% frontend — nenhuma requisição muda, nenhum parâmetro vai para
// o servidor. É por isso que mora em localStorage e não na URL: descreve a
// pessoa (o que ela cansou de ver), não a investigação (o que está sendo
// olhado). Chave namespaced para não colidir com nada do Portal.
//
// Acessibilidade: <button aria-expanded aria-haspopup> + checkboxes reais
// dentro de um <fieldset> nomeado. Fecha com Escape e devolve o foco ao
// gatilho — quem abriu pelo teclado não fica preso no popover.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { GRUPOS, GRUPOS_PADRAO } from "./colunas.js";

const CHAVE_STORAGE = "vf:painel-contas:grupos-colunas";

function ler() {
  try {
    const bruto = window.localStorage.getItem(CHAVE_STORAGE);
    if (!bruto) return GRUPOS_PADRAO;
    const lista = JSON.parse(bruto);
    if (!Array.isArray(lista)) return GRUPOS_PADRAO;
    // Só aceita chaves que ainda existem: um grupo removido do produto não
    // pode ressuscitar por causa de um localStorage antigo.
    const validos = lista.filter((chave) => GRUPOS.some((g) => g.chave === chave));
    return validos.length ? validos : GRUPOS_PADRAO;
  } catch {
    return GRUPOS_PADRAO; // modo privado / storage bloqueado — nunca quebra a tela
  }
}

function gravar(grupos) {
  try {
    window.localStorage.setItem(CHAVE_STORAGE, JSON.stringify(grupos));
  } catch {
    /* preferência visual: perder não é erro de produto */
  }
}

export function useGruposDeColunas() {
  const [grupos, setGrupos] = useState(ler);

  const alternar = useCallback((chave) => {
    setGrupos((prev) => {
      const proximo = prev.includes(chave) ? prev.filter((g) => g !== chave) : [...prev, chave];
      // Desligar tudo deixaria uma tabela só de nomes. O último grupo ligado
      // não desliga — a interface impede em vez de explicar depois.
      if (proximo.length === 0) return prev;
      gravar(proximo);
      return proximo;
    });
  }, []);

  return { grupos, alternar };
}

export function MenuColunas({ grupos, onAlternar }) {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef(null);
  const gatilhoRef = useRef(null);
  const idMenu = useId();

  const fechar = useCallback(({ devolverFoco = false } = {}) => {
    setAberto(false);
    if (devolverFoco) gatilhoRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!aberto) return undefined;

    function aoTeclar(evento) {
      if (evento.key === "Escape") {
        evento.stopPropagation();
        fechar({ devolverFoco: true });
      }
    }
    function aoClicarFora(evento) {
      if (!containerRef.current?.contains(evento.target)) fechar();
    }

    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("mousedown", aoClicarFora);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.removeEventListener("mousedown", aoClicarFora);
    };
  }, [aberto, fechar]);

  const escondidos = GRUPOS.length - grupos.length;

  return (
    <div className="vf-ph-colunas" ref={containerRef}>
      <button
        type="button"
        ref={gatilhoRef}
        className="vf-btn vf-btn--sm vf-ph-colunas__gatilho"
        aria-expanded={aberto}
        aria-haspopup="true"
        aria-controls={idMenu}
        onClick={() => setAberto((v) => !v)}
      >
        Colunas
        {escondidos > 0 && <span className="vf-ph-colunas__contador">{escondidos}</span>}
        <span className="vf-ph-colunas__seta" aria-hidden="true">▾</span>
      </button>

      {aberto && (
        <div className="vf-menu vf-ph-colunas__menu" id={idMenu}>
          <fieldset className="vf-ph-colunas__fieldset">
            <legend className="vf-menu__label">Grupos de métricas</legend>
            {GRUPOS.map((grupo) => {
              const ativo = grupos.includes(grupo.chave);
              const unicoAtivo = ativo && grupos.length === 1;
              return (
                <label
                  key={grupo.chave}
                  className={`vf-menu__item vf-ph-colunas__item${ativo ? " is-active" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={ativo}
                    disabled={unicoAtivo}
                    onChange={() => onAlternar(grupo.chave)}
                  />
                  <span className="vf-ph-colunas__rotulo">
                    {grupo.label}
                    {grupo.nota && <span className="vf-ph-colunas__nota">{grupo.nota}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        </div>
      )}
    </div>
  );
}
