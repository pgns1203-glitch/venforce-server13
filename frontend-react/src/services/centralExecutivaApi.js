import { listarClientes, obterResultado } from "./cliente360Api.js";

const LIMITE_CONCORRENCIA = 4;

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function primeiraMensagem(dados) {
  return dados?.narrativa?.texto
    || dados?.confianca?.alertas?.[0]?.mensagem
    || dados?.estado?.mensagem
    || null;
}

function principalCausa(dados) {
  const linhas = Array.isArray(dados?.ponte?.linhas) ? dados.ponte.linhas : [];
  const materiais = linhas
    .filter((linha) => Number.isFinite(Number(linha?.valor)) && Math.abs(Number(linha.valor)) > 0.01)
    .sort((a, b) => Math.abs(Number(b.valor)) - Math.abs(Number(a.valor)));

  const pior = materiais.find((linha) => Number(linha.valor) < 0) || materiais[0];
  if (pior) {
    return {
      chave: pior.chave || null,
      titulo: pior.label || pior.titulo || "Variação operacional",
      impacto: numero(pior.valor),
    };
  }

  const produto = dados?.produtos?.prejudicaram?.[0];
  if (produto) {
    return {
      chave: "produto",
      titulo: produto.titulo || produto.mlb || "Produto com impacto negativo",
      impacto: numero(produto.impacto ?? produto.deltaResultado ?? produto.resultado),
    };
  }

  return { chave: null, titulo: dados?.estado?.mensagem || "Sem causa material identificada", impacto: null };
}

function classificarSaude(dados) {
  if (!dados || dados?.estado?.chave === "sem_fechamento") return "sem_dados";
  if (dados?.confianca?.nivel === "insuficiente") return "sem_dados";

  const margem = numero(dados?.fechamento?.atual?.margemOperacional);
  const deltaResultado = numero(dados?.fechamento?.variacoes?.resultadoOperacional?.abs);
  const abaixoMeta = Number(dados?.produtos?.totais?.abaixoDaMargem || 0);
  const negativos = Number(dados?.produtos?.totais?.noVermelho || 0);

  if ((margem !== null && margem < 0) || negativos >= 3 || (deltaResultado !== null && deltaResultado < -5000)) {
    return "critico";
  }
  if ((margem !== null && margem < 0.1) || abaixoMeta > 0 || (deltaResultado !== null && deltaResultado < 0)) {
    return "atencao";
  }
  return "saudavel";
}

function normalizarConta(cliente, dados, erro = null) {
  if (erro || !dados) {
    return {
      cliente: { id: cliente.id, nome: cliente.nome, slug: cliente.slug },
      status: "sem_dados",
      erro: erro?.message || "Resultado indisponível.",
      carregado: false,
    };
  }

  const atual = dados.fechamento?.atual || {};
  const variacoes = dados.fechamento?.variacoes || {};
  const causa = principalCausa(dados);

  return {
    cliente: dados.cliente || { id: cliente.id, nome: cliente.nome, slug: cliente.slug },
    status: classificarSaude(dados),
    carregado: true,
    estado: dados.estado || null,
    periodo: dados.periodo || null,
    comparacao: dados.comparacao || null,
    faturamento: numero(atual.faturamento),
    resultadoOperacional: numero(atual.resultadoOperacional),
    resultadoAposAds: numero(atual.resultadoAposAds),
    margemOperacional: numero(atual.margemOperacional),
    margemAposAds: numero(atual.margemAposAds),
    ads: numero(atual.ads),
    deltaFaturamento: numero(variacoes.faturamento?.abs),
    deltaResultado: numero(variacoes.resultadoOperacional?.abs),
    deltaResultadoAposAds: numero(variacoes.resultadoAposAds?.abs),
    deltaMargemPp: numero(variacoes.margemOperacional?.pp),
    confianca: dados.confianca?.nivel || "insuficiente",
    receitaBloqueada: numero(dados.confianca?.receitaBloqueada),
    alertas: dados.confianca?.alertas || [],
    produtosNegativos: Number(dados.produtos?.totais?.noVermelho || 0),
    produtosAbaixoMeta: Number(dados.produtos?.totais?.abaixoDaMargem || 0),
    potencialRecuperacao: numero(dados.oportunidades?.totalRecuperavel),
    causa,
    narrativa: primeiraMensagem(dados),
    href: `cliente-360-react.html?slug=${encodeURIComponent(cliente.slug)}&competencia=${encodeURIComponent(dados.periodo?.competencia || "")}&compararCom=${encodeURIComponent(dados.comparacao?.competencia || "")}`,
  };
}

async function executarComLimite(itens, tarefa, limite = LIMITE_CONCORRENCIA, onProgresso) {
  const resultados = new Array(itens.length);
  let cursor = 0;
  let concluidos = 0;

  async function worker() {
    while (cursor < itens.length) {
      const indice = cursor++;
      resultados[indice] = await tarefa(itens[indice], indice);
      concluidos += 1;
      onProgresso?.({ concluidos, total: itens.length });
    }
  }

  await Promise.all(Array.from({ length: Math.min(limite, itens.length || 1) }, worker));
  return resultados;
}

export async function obterCarteiraExecutiva({ competencia, compararCom, marketplace = "meli", margemAlvo, signal, onProgresso } = {}) {
  const resposta = await listarClientes({ signal });
  const clientes = (resposta?.clientes || []).filter((cliente) => cliente?.ativo !== false);

  const contas = await executarComLimite(clientes, async (cliente) => {
    try {
      const dados = await obterResultado(cliente.slug, {
        competencia,
        compararCom,
        marketplace,
        margemAlvo,
        signal,
      });
      return normalizarConta(cliente, dados);
    } catch (erro) {
      if (erro?.name === "AbortError") throw erro;
      return normalizarConta(cliente, null, erro);
    }
  }, LIMITE_CONCORRENCIA, onProgresso);

  return { clientes, contas };
}
