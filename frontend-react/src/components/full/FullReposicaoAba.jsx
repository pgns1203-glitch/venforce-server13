// Aba "Reposição sugerida": escolhe a cobertura (15/30/45/60 dias), revisa a
// quantidade de cada produto e baixa a lista de conferência. O painel ao
// lado é o resumo do envio em montagem.
//
// Nada aqui é salvo nem enviado ao Mercado Livre: o envio ao Full só se cria
// no Seller Center. A lista serve para separar a mercadoria e conferir
// enquanto o envio é montado lá (persistência do plano = fase 3).
import { useMemo, useState } from "react";
import { formatarNumero, AUSENTE } from "../../utils/numbers.js";
import { formatarMoeda } from "../../utils/currency.js";
import { ordenarPorUrgencia } from "../../utils/fullSummary.js";
import {
  COBERTURAS,
  quantidadeSugerida,
  coberturaApos,
  resumirEnvio,
  gerarCsvConferencia,
} from "../../utils/fullReposicao.js";
import { FullACaminho, FullProdutoInfo, FullStatus, FullThumb } from "./FullProduto.jsx";

const PAGINA = 50;

function baixarArquivo(conteudo, nome) {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function nomeDoArquivo(clienteSlug) {
  const hoje = new Date().toISOString().slice(0, 10);
  return `lista-conferencia-full-${clienteSlug || "cliente"}-${hoje}.csv`;
}

export default function FullReposicaoAba({ inventories, cabecalho, clienteSlug, custosDisponiveis }) {
  const [dias, setDias] = useState(30);
  const [busca, setBusca] = useState("");
  const [somenteComVenda, setSomenteComVenda] = useState(true);
  // Só o que o usuário mexeu: quantidade digitada e itens desmarcados. O resto
  // segue a sugestão da cobertura escolhida.
  const [editadas, setEditadas] = useState(() => new Map());
  const [desmarcados, setDesmarcados] = useState(() => new Set());
  const [limite, setLimite] = useState(PAGINA);

  const candidatos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return ordenarPorUrgencia(inventories).filter((inv) => {
      const sugerida = quantidadeSugerida(inv, dias);
      if (!(sugerida > 0) && !editadas.has(inv.inventoryId)) return false;
      if (somenteComVenda && !(inv.sales?.total14d > 0)) return false;
      if (!termo) return true;
      const pilha = [inv.inventoryId, ...(inv.references || []).flatMap((r) => [r.mlb, r.sellerSku, r.title])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return pilha.includes(termo);
    });
  }, [inventories, dias, busca, somenteComVenda, editadas]);

  const linhas = candidatos.map((inv) => {
    const sugerida = quantidadeSugerida(inv, dias);
    const quantidade = editadas.has(inv.inventoryId) ? editadas.get(inv.inventoryId) : sugerida ?? 0;
    return { inv, sugerida, quantidade, selecionada: !desmarcados.has(inv.inventoryId) };
  });
  const selecionadas = linhas.filter((l) => l.selecionada);
  const resumo = resumirEnvio(selecionadas);
  const todasMarcadas = linhas.length > 0 && selecionadas.length === linhas.length;

  function alternar(inventoryId) {
    setDesmarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(inventoryId)) novo.delete(inventoryId);
      else novo.add(inventoryId);
      return novo;
    });
  }

  function alternarTodas() {
    setDesmarcados(todasMarcadas ? new Set(linhas.map((l) => l.inv.inventoryId)) : new Set());
  }

  function editar(inventoryId, texto) {
    const n = Math.max(0, Math.floor(Number(texto)));
    setEditadas((atual) => {
      const novo = new Map(atual);
      novo.set(inventoryId, Number.isFinite(n) ? n : 0);
      return novo;
    });
  }

  const visiveis = linhas.slice(0, limite);
  const comACaminho = useMemo(() => inventories.filter((inv) => inv.inbound?.status === "ok").length, [inventories]);

  return (
    <div className="full-layout">
      <aside className="vf-card full-lateral full-lateral--resumo" aria-labelledby="full-resumo-titulo">
        <div className="full-lateral__cabeca">
          <p className="full-eyebrow">Novo envio</p>
          <h2 className="full-lateral__titulo" id="full-resumo-titulo">Resumo do envio</h2>
        </div>
        <dl className="full-resumo">
          <div><dt>Produtos</dt><dd>{formatarNumero(resumo.produtos)}</dd></div>
          <div><dt>Unidades</dt><dd>{formatarNumero(resumo.unidades)}</dd></div>
          <div><dt>Custo da mercadoria</dt><dd>{formatarMoeda(resumo.custo)}</dd></div>
          <div><dt>Cobertura alvo</dt><dd>{dias} dias</dd></div>
        </dl>
        {custosDisponiveis && resumo.semCusto > 0 ? (
          <p className="full-alerta" role="status">
            {resumo.semCusto === 1 ? "1 produto sem custo" : `${formatarNumero(resumo.semCusto)} produtos sem custo`} na Base: o custo do
            envio fica incompleto. <a href="bases.html">Cadastrar custo</a>
          </p>
        ) : null}
        <div className="full-lateral__pe">
          <button
            type="button"
            className="vf-btn vf-btn--primary full-largura"
            disabled={resumo.produtos === 0}
            onClick={() => baixarArquivo(gerarCsvConferencia(selecionadas), nomeDoArquivo(clienteSlug))}
          >
            Baixar lista de conferência
          </button>
          <p className="full-lateral__nota">
            O envio é criado no Seller Center do Mercado Livre. Use a lista para separar e conferir a mercadoria.
          </p>
        </div>
      </aside>

      <section className="vf-card full-principal">
        {cabecalho}
        <div className="full-toolbar">
          <div className="full-toolbar__filtros">
            <div className="vf-field">
              <span className="vf-field__label" id="full-cobertura-rotulo">Cobrir</span>
              <div className="full-segmentos" role="group" aria-labelledby="full-cobertura-rotulo">
                {COBERTURAS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`full-segmento${d === dias ? " is-active" : ""}`}
                    aria-pressed={d === dias ? "true" : "false"}
                    onClick={() => setDias(d)}
                  >
                    {d} dias
                  </button>
                ))}
              </div>
            </div>
            <div className="vf-field">
              <label className="vf-field__label" htmlFor="full-reposicao-busca">Buscar produtos</label>
              <input
                id="full-reposicao-busca"
                type="search"
                className="vf-input vf-search"
                placeholder="Título, MLB ou SKU"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          </div>
          <label className="full-check">
            <input type="checkbox" checked={somenteComVenda} onChange={(e) => setSomenteComVenda(e.target.checked)} />
            Só com venda nos últimos 14 dias
          </label>
        </div>
        <p className="full-nota-a-caminho">
          {comACaminho === inventories.length
            ? "A sugestão já desconta os envios a caminho do Full informados pelo Mercado Livre."
            : `A sugestão desconta os envios a caminho do Full quando o Mercado Livre informa: ${formatarNumero(comACaminho)} de ${formatarNumero(inventories.length)} produtos. Nos marcados com "a caminho: ?", confira os envios no Seller Center.`}
        </p>

        {linhas.length === 0 ? (
          <p className="full-vazio">Nenhum produto precisa de reposição para cobrir {dias} dias.</p>
        ) : (
          <div className="full-lista full-lista--reposicao" role="table" aria-label="Reposição sugerida">
            <div className="full-lista__cabeca" role="row">
              <span role="columnheader">
                <input type="checkbox" aria-label="Selecionar todos" checked={todasMarcadas} onChange={alternarTodas} />
              </span>
              <span role="columnheader" className="full-lista__col-produto">Produto</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">No Full</span>
              <span role="columnheader">Giro/dia</span>
              <span role="columnheader">Cobertura</span>
              <span role="columnheader">Sugerido</span>
              <span role="columnheader">Enviar</span>
              <span role="columnheader">Custo</span>
            </div>
            {visiveis.map(({ inv, sugerida, quantidade, selecionada }) => {
              const titulo = inv.references?.[0]?.title || inv.inventoryId;
              const editada = editadas.has(inv.inventoryId) && editadas.get(inv.inventoryId) !== sugerida;
              const depois = coberturaApos(inv, quantidade);
              return (
                <div key={inv.inventoryId} className={`full-linha${selecionada ? " is-selecionada" : ""}`} role="row">
                  <span role="cell">
                    <input type="checkbox" aria-label={`Incluir ${titulo}`} checked={selecionada} onChange={() => alternar(inv.inventoryId)} />
                  </span>
                  <span role="cell"><FullThumb inv={inv} /></span>
                  <span role="cell" className="full-linha__produto">
                    <FullProdutoInfo inv={inv} />
                    {editada ? <span className="vf-tag is-primary full-editado">editado</span> : null}
                  </span>
                  <span role="cell"><FullStatus inv={inv} /></span>
                  <span role="cell" className="full-num full-disponivel">
                    {formatarNumero(inv.stock?.available)}
                    <FullACaminho inv={inv} mostrarDesconhecido />
                  </span>
                  <span role="cell" className="full-num">{formatarNumero(inv.dailyTurnover, 2)}</span>
                  <span role="cell" className="full-antes-depois">
                    <span>{formatarNumero(inv.coverageDays, 1)}</span>
                    <span aria-hidden="true">→</span>
                    <strong className={depois !== null && depois >= dias ? "is-success" : ""}>
                      {depois === null ? AUSENTE : `${formatarNumero(depois, 0)} dias`}
                    </strong>
                  </span>
                  <span role="cell" className="full-num full-num--fraco">{sugerida === null ? AUSENTE : formatarNumero(sugerida)}</span>
                  <span role="cell">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      className={`vf-input full-qtd${editada ? " is-editada" : ""}`}
                      aria-label={`Quantidade a enviar de ${titulo}`}
                      value={quantidade}
                      onChange={(e) => editar(inv.inventoryId, e.target.value)}
                    />
                  </span>
                  <span role="cell" className="full-num">
                    {inv.unitCost === null || inv.unitCost === undefined ? (
                      custosDisponiveis ? <span className="vf-tag is-warning">sem custo</span> : AUSENTE
                    ) : (
                      formatarMoeda(inv.unitCost * quantidade)
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="full-lista__rodape">
          <span>
            {formatarNumero(linhas.length)} {linhas.length === 1 ? "sugestão" : "sugestões"} · ordenado por urgência
          </span>
          {linhas.length > limite ? (
            <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" onClick={() => setLimite((n) => n + PAGINA)}>
              Mostrar mais {formatarNumero(Math.min(PAGINA, linhas.length - limite))}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
