// frontend-react/src/components/financeiro/pendencias/CorrecaoEmLote.jsx
//
// CORREÇÃO EM LOTE — para quando há muitas pendências. Tudo dentro do
// Financeiro, sem sair da tela e sem perder o resultado processado:
//
//   1. Baixar planilha        XLSX no formato que o importador de Bases lê
//   2. Preencher              "Novo custo" (e "Imposto (%)")
//   3. Enviar a preenchida    lida pelo parser REAL (POST /bases/assistente/preview)
//   4. Importar e atualizar   POST /bases/:slug/custos/upsert, linha a linha,
//                             exatamente como "Bases → Atualizar por planilha"
//   5. Reprocessar            só depois da Base atualizada
//
// Reaproveita os mesmos endpoints, o mesmo parser e a mesma gravação da tela
// Bases — o Financeiro é outra interface para a mesma operação. Acrescenta as
// proteções que a tela Bases não tem: linha ambígua (Shopee: sobrescreveria o
// registro de outra variação; ID repetido com valores diferentes) NÃO é gravada
// e é reportada.

import { useRef, useState } from "react";
import { previewPlanilhaDeCustos, registrarCustoNaBase } from "../../../services/basesCustoApi.js";
import { classificarLinhasPlanilha, normalizarId } from "../../../utils/financeiro/baseCustos.js";

const MAX_DETALHES = 8;

export function CorrecaoEmLote({ marketplace, base, itensBase, pendencias, planilha, onBaixar, onAplicado, onReprocessar, reprocessando = false, gravadas = 0 }) {
  const entrada = useRef(null);
  const [arquivo, setArquivo] = useState(null);
  const [lendo, setLendo] = useState(false);
  const [previa, setPrevia] = useState(null); // { classificacao, resumo, alertas }
  const [erroLeitura, setErroLeitura] = useState(null);
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [resultado, setResultado] = useState(null); // { atualizados, criados, falhas[], ignoradas, ambiguas[] }

  async function aoEscolher(e) {
    const f = e.target.files?.[0] || null;
    setArquivo(f);
    setPrevia(null);
    setResultado(null);
    setErroLeitura(null);
    if (!f) return;
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) {
      setErroLeitura("Arquivo inválido. Envie .xlsx, .xls ou .csv.");
      return;
    }
    setLendo(true);
    try {
      const r = await previewPlanilhaDeCustos(f, { marketplace });
      const dados = Array.isArray(r.dados_importacao) ? r.dados_importacao : [];
      const classificacao = classificarLinhasPlanilha({ marketplace, dados, itensBase });
      setPrevia({ classificacao, resumo: r.resumo || {}, alertas: Array.isArray(r.alertas) ? r.alertas : [] });
    } catch (err) {
      setErroLeitura(err?.message || "Não foi possível ler a planilha.");
    } finally {
      setLendo(false);
    }
  }

  const gravaveis = previa ? previa.classificacao.linhas.filter((l) => l.acao !== "ambigua") : [];
  const ambiguas = previa ? previa.classificacao.linhas.filter((l) => l.acao === "ambigua") : [];
  const idsPendentes = new Set((pendencias || []).map((p) => normalizarId(marketplace, p.itemId)).filter(Boolean));
  const cobrem = gravaveis.filter((l) => idsPendentes.has(l.produtoId)).length;
  const erroDeColuna = previa?.alertas.find((a) => a.nivel === "erro");

  async function importar() {
    setImportando(true);
    setProgresso(0);
    const falhas = [];
    let atualizados = 0;
    let criados = 0;
    for (let i = 0; i < gravaveis.length; i += 1) {
      const l = gravaveis[i];
      try {
        const r = await registrarCustoNaBase(base.slug, {
          produtoId: l.produtoId,
          custoProduto: l.custo,
          impostoFracao: l.imposto,
          idModel: marketplace === "shopee" ? l.idModel : null,
          produtoNome: l.nome,
        });
        if (r?.acao === "criado") criados += 1;
        else atualizados += 1;
      } catch (err) {
        falhas.push({ produtoId: l.produtoId, erro: err?.message || "erro" });
      }
      setProgresso(i + 1);
    }
    const res = {
      atualizados,
      criados,
      falhas,
      ignoradas: Number(previa.resumo.linhas_ignoradas || 0),
      ambiguas,
    };
    setResultado(res);
    setImportando(false);
    // A base mudou: o pai recarrega os itens e passa a contar as correções.
    onAplicado?.({ gravadas: atualizados + criados });
  }

  const concluiu = !!resultado;
  const totalGravado = resultado ? resultado.atualizados + resultado.criados : 0;

  return (
    <div className="vf-fin-lote" aria-label="Correção em lote">
      <ol className="vf-fin-lote__passos">
        <li className="vf-fin-lote__passo" data-passo="baixar">
          <div className="vf-fin-lote__titulo"><strong>Baixar planilha</strong></div>
          <p className="vf-field__hint">
            {planilha.incluidas} {planilha.incluidas === 1 ? "pendência" : "pendências"} na planilha, no formato que o importador de Bases lê (ID como texto, Novo custo em branco).
            {planilha.semId > 0 && <> {planilha.semId} sem ID do Item ficam de fora — não há como o importador saber qual registro atualizar.</>}
            {planilha.ambiguas > 0 && <> {planilha.ambiguas} com custo ambíguo ficam de fora — resolva em Bases de Custo.</>}
          </p>
          <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={onBaixar} disabled={planilha.incluidas === 0}>
            Baixar XLSX
          </button>
        </li>

        <li className="vf-fin-lote__passo" data-passo="preencher">
          <div className="vf-fin-lote__titulo"><strong>Preencher</strong></div>
          <p className="vf-field__hint">
            Preencha <strong>Novo custo</strong> (e <strong>Imposto (%)</strong>, se quiser mudar). Não troque os cabeçalhos nem os IDs. Linha com Novo custo em branco é ignorada — nada é zerado.
          </p>
        </li>

        <li className="vf-fin-lote__passo" data-passo="enviar">
          <div className="vf-fin-lote__titulo"><strong>Enviar a planilha preenchida</strong></div>
          <input ref={entrada} className="vf-visually-hidden" type="file" accept=".xlsx,.xls,.csv" aria-label="Planilha de custos preenchida" onChange={aoEscolher} />
          <div className="vf-cluster">
            <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" disabled={lendo || importando} onClick={() => entrada.current?.click()}>
              {arquivo ? "Trocar arquivo" : "Selecionar arquivo"}
            </button>
            {arquivo && <span className="vf-field__hint vf-mono">{arquivo.name}</span>}
            {lendo && <span className="vf-field__hint" role="status">Lendo a planilha…</span>}
          </div>
          {erroLeitura && <span className="vf-status is-danger" role="alert">{erroLeitura}</span>}
          {previa && (
            <div className="vf-fin-lote__previa" data-previa>
              <p className="vf-fin-lote__resumo">
                <span className="is-ok">{previa.classificacao.resumo.atualizar} para atualizar</span>
                <span className="is-ok">{previa.classificacao.resumo.adicionar} para adicionar</span>
                <span className="is-aviso">{Number(previa.resumo.linhas_ignoradas || 0)} sem Novo custo (ignoradas)</span>
                <span className="is-erro">{previa.classificacao.resumo.ambiguas} ambíguas (não serão gravadas)</span>
              </p>
              {gravaveis.length > 0 && (
                <p className="vf-field__hint">
                  {cobrem} {cobrem === 1 ? "linha corrige" : "linhas corrigem"} pendências desta tela ({idsPendentes.size} no total).
                </p>
              )}
              {erroDeColuna && <span className="vf-status is-danger" role="alert">{erroDeColuna.mensagem}</span>}
              {ambiguas.length > 0 && (
                <details className="vf-fin-disclosure vf-fin-disclosure--leve">
                  <summary>Ver as {ambiguas.length} linhas ambíguas</summary>
                  <ul className="vf-fin-leitura">
                    {ambiguas.slice(0, 50).map((l) => (
                      <li key={l.produtoId} className="vf-fin-leitura__item is-danger"><span aria-hidden="true">×</span> <span className="vf-mono">{l.produtoId}</span> — {l.motivo}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </li>

        <li className="vf-fin-lote__passo" data-passo="importar">
          <div className="vf-fin-lote__titulo"><strong>Atualizar a Base de Custos</strong></div>
          <p className="vf-field__hint">Grava na base <strong>{base.nome || base.slug}</strong> — a base vinculada, não um valor só deste fechamento.</p>
          <button type="button" className="vf-btn vf-btn--primary vf-btn--sm" disabled={!previa || gravaveis.length === 0 || importando || concluiu || !!erroDeColuna} aria-busy={importando ? "true" : undefined} onClick={importar}>
            {importando ? `Atualizando… ${progresso}/${gravaveis.length}` : "Importar e atualizar base"}
          </button>
          {concluiu && (
            <div className="vf-fin-lote__resultado" role="status" data-resultado>
              <p className={totalGravado > 0 ? "is-ok" : "is-aviso"}>✓ {totalGravado} {totalGravado === 1 ? "custo atualizado" : "custos atualizados"} na base{resultado.criados > 0 ? ` (${resultado.criados} novos, ${resultado.atualizados} existentes)` : ""}</p>
              {resultado.ignoradas > 0 && <p className="is-aviso">⚠ {resultado.ignoradas} {resultado.ignoradas === 1 ? "linha ignorada" : "linhas ignoradas"} (sem Novo custo)</p>}
              {resultado.ambiguas.length > 0 && <p className="is-erro">✕ {resultado.ambiguas.length} {resultado.ambiguas.length === 1 ? "linha ambígua, não gravada" : "linhas ambíguas, não gravadas"}</p>}
              {resultado.falhas.length > 0 && (
                <div role="alert">
                  <p className="is-erro">✕ {resultado.falhas.length} {resultado.falhas.length === 1 ? "linha falhou" : "linhas falharam"}</p>
                  <ul className="vf-fin-leitura">
                    {resultado.falhas.slice(0, MAX_DETALHES).map((f) => (
                      <li key={f.produtoId} className="vf-fin-leitura__item is-danger"><span className="vf-mono">{f.produtoId}</span> — {f.erro}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </li>

        <li className="vf-fin-lote__passo" data-passo="reprocessar">
          <div className="vf-fin-lote__titulo"><strong>Reprocessar</strong></div>
          <p className="vf-field__hint">O fechamento só reflete a base nova depois de reprocessar.</p>
          {onReprocessar && (
            <button type="button" className={`vf-btn ${gravadas > 0 ? "vf-btn--primary" : "vf-btn--secondary"} vf-btn--sm`} disabled={reprocessando} onClick={onReprocessar}>
              {reprocessando ? "Reprocessando…" : "Reprocessar fechamento"}
            </button>
          )}
        </li>
      </ol>
    </div>
  );
}
