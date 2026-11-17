/* Sentinel — Central de Proteção Operacional e Financeira (sobre a API /sentinel V0-b).
   Camada de dados única: criarApi() (HTTP real) ou SENTINEL_MOCK.api (somente com ?demo=1,
   com selo). Com backend não existe mock nenhum no caminho.
   Regra da tela: só mostra o que a API entrega. Não há destinatário, entrega nem leitura de
   aviso no backend — "quem está tratando" é quem RECONHECEU o caso (campo real). */
(function (root) {
  "use strict";

  const TIPOS = { margem_negativa: "Margem negativa", custo_pendente: "Custo pendente", leitura_atrasada: "Leitura atrasada" };
  const STATUS = { aberto: "Aberto", reconhecido: "Reconhecido", resolvido: "Resolvido", reaberto: "Reaberto" };
  const SEV = { critica: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };
  const SEV_RANK = { critica: 0, alta: 1, media: 2, baixa: 3 };
  // Regra de produto: "calculado" = claims NÃO verificadas — nunca "confirmada".
  const CONF = {
    calculado: ["Calculado", "contribuição calculada; devoluções e reclamações (claims) não verificadas"],
    pendente: ["Provisório", "cálculo com componente faltando; o valor pode mudar"],
    confirmado: ["Confirmado", "contribuição verificada, inclusive devoluções"],
    inconclusivo: ["Inconclusivo", "dados insuficientes para calcular a margem"],
    operacional: ["Operacional", "falha de leitura, não de margem"],
  };
  const IMPACTO = {
    perda_contribuicao: ["Perda calculada", "contribuição negativa dos pedidos; sujeita a devoluções"],
    receita_sem_custo: ["Receita sem custo", "NÃO é prejuízo: falta custo para calcular a margem"],
  };
  const SITUACAO = { ok: ["is-success", "Em dia"], atrasada: ["is-warning", "Atrasada"], erro: ["is-danger", "Com erro"], nunca_lida: ["is-empty", "Nunca lida"], ok_com_erro: ["is-warning", "Em dia, com erro"], nao_monitorada: ["is-empty", "Fora do monitoramento"], desativada: ["is-empty", "Desativada"] };
  const PERIODOS = { "24h": 24, "7d": 168, "30d": 720, todos: 0 };
  const OFF_TXT = "conta desativada — não monitorada";
  const STALE_MS = 30 * 60 * 1000;
  const TELA_VELHA_MS = 5 * 60 * 1000;
  const LIMITE_LISTA = 200;
  const VISOES = {
    acao: ["Precisa de ação", "Casos abertos da sua carteira que ninguém reconheceu ainda. Ordem: severidade, depois impacto."],
    tratamento: ["Em tratamento", "Casos que alguém reconheceu e ainda não resolveu."],
    resolvidos: ["Resolvidos", "Histórico. O Sentinel reabre um caso se aparecer pedido novo com o mesmo problema."],
  };
  // Atalhos de motivo: só preenchem o campo de texto que a API já exige (motivo livre).
  const MOTIVOS = {
    margem_negativa: ["Preço ajustado", "Promoção encerrada", "Custo corrigido na base", "Anúncio pausado", "Decisão consciente (ex.: queima de estoque)", "Dado incorreto / falso positivo"],
    custo_pendente: ["Custo cadastrado na base", "Custo desambiguado (variação/SKU)", "Produto descontinuado", "Dado incorreto / falso positivo"],
    leitura_atrasada: ["Conta reconectada", "Leitura normalizada", "Conta fora de operação"],
  };

  /* ── Lógica pura (testável em node) ─────────────────────────────────── */
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const r2 = (n) => Math.round(Number(n) * 100) / 100;
  const brl = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
  const pct = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%");
  function duracao(ms) {
    const m = Math.max(0, ms) / 60000;
    if (m < 60) return Math.max(1, Math.round(m)) + " min";
    const h = m / 60;
    if (h < 48) return Math.round(h) + " h";
    return Math.round(h / 24) + " d";
  }
  const tempo = (iso) => (iso ? new Date(iso).getTime() : 0);
  const desde = (iso, agora) => (iso ? duracao((agora == null ? Date.now() : agora) - new Date(iso).getTime()) : "—");
  const plural = (n, um, varios) => n + " " + (Number(n) === 1 ? um : varios);
  const nomeAtor = (s) => String(s == null ? "" : s).replace(/\s*\(#[\w-]+\)\s*$/, "");

  // MLB só vai na URL quando o incidente é de UM anúncio (chave no formato de identificador;
  // "conta" e chaves compostas "MLB1+MLB2" ficam de fora). A Central de Margem usa o valor
  // apenas para pré-preencher a busca; cliente/conta continuam validados pelo Shell e pela API.
  const MLB_URL = /^[A-Za-z0-9_-]{3,40}$/;
  const linkCentral = (i) => "central-margem.html?cliente=" + encodeURIComponent(i.clienteSlug) + "&conta=" + encodeURIComponent(i.contaId) + (i.chave && i.chave !== "conta" && MLB_URL.test(i.chave) ? "&mlb=" + encodeURIComponent(i.chave) : "");
  const linkBases = (i) => "bases.html?cliente=" + encodeURIComponent(i.clienteSlug);

  function periodoParaDesde(periodo, agora) {
    const h = PERIODOS[periodo];
    return h ? new Date((agora == null ? Date.now() : agora) - h * 3600000).toISOString() : null;
  }

  // Por que o caso tem esta prioridade (severidade vem do backend; aqui só se explica).
  function prioridadeExplicada(i) {
    const p = ["Severidade " + SEV[i.severidade].toLowerCase()];
    if (i.impacto && i.impacto.valor != null) p.push((IMPACTO[i.impacto.tipo] || ["Impacto"])[0].toLowerCase() + " de " + brl(i.impacto.valor));
    if (i.pedidosAfetados) p.push(i.pedidosAfetados + " pedido(s) afetado(s)");
    if (i.vezesReaberto) p.push("reaberto " + i.vezesReaberto + "×");
    if (i.status === "reconhecido") p.push("já reconhecido por " + (i.reconhecido ? nomeAtor(i.reconhecido.por) : "alguém"));
    return p.join(" · ");
  }

  // Estado da tela (precedência): erro → carregando → sem contas → monitoramento
  // desativado → dados desatualizados / sem incidentes / ok.
  function estadoDaTela(s, agora) {
    if (s.erro) return { tela: "erro" };
    if (s.carregando) return { tela: "carregando" };
    if (!s.contas || s.contas.length === 0) return { tela: "sem_dados" };
    if (s.resumo && s.resumo.monitoramentoAtivo === false) return { tela: "desativado" };
    const t = s.resumo && s.resumo.ultimaAtualizacao ? new Date(s.resumo.ultimaAtualizacao).getTime() : null;
    const desatualizado = t == null || (agora == null ? Date.now() : agora) - t > STALE_MS;
    const prob = s.contas.filter((c) => c.ativo !== false && (c.situacao === "atrasada" || c.situacao === "erro" || c.situacao === "nunca_lida" || c.situacao === "ok_com_erro")).length; // conta desativada não conta como "atrasada"
    return { tela: s.incidentes && s.incidentes.total === 0 ? "sem_incidentes" : "ok", desatualizado, contasComProblema: prob };
  }

  const WORKER = { ativo: ["is-success", "Ativo", "O worker do Sentinel está lendo dentro do intervalo esperado."], atrasado: ["is-warning", "Atrasado", "A última execução passou do intervalo esperado, mas ainda dentro do limite de leitura."], parado: ["is-danger", "Parado", "Nenhuma execução dentro do limite de leitura: as margens podem estar desatualizadas."], sem_dados: ["is-empty", "Sem dados", "Ainda não há execução registrada para as contas do seu recorte."] };
  const NIVEL = { critico: ["is-danger", "Crítico"], aviso: ["is-warning", "Aviso"], info: ["is-info", "Info"] };
  function idadeTxt(seg) { return seg == null ? "—" : duracao(seg * 1000); }
  function agruparAlertas(alertas) {
    const g = { critico: [], aviso: [], info: [] };
    (alertas || []).forEach((a) => (g[a.nivel] || g.info).push(a));
    return g;
  }

  // Estado do motor em UMA frase + fatos. `confiavel` só é true quando há leitura em dia em
  // todas as contas monitoradas: é o que autoriza dizer "nenhum caso" sem ressalva.
  function estadoMotor(s) {
    const ativas = (s.contas || []).filter((c) => c.ativo !== false);
    const monit = ativas.filter((c) => c.monitorada);
    const fora = ativas.length - monit.length;
    const semLeitura = monit.filter((c) => c.situacao === "atrasada" || c.situacao === "erro" || c.situacao === "nunca_lida").length;
    const emDia = monit.length - semLeitura;
    const fatos = [];
    if (monit.length) fatos.push({ n: emDia + " de " + monit.length, texto: monit.length === 1 ? "conta com leitura em dia" : "contas com leitura em dia", nivel: semLeitura ? "" : "ok" });
    if (semLeitura) fatos.push({ n: semLeitura, texto: semLeitura === 1 ? "conta sem leitura confiável" : "contas sem leitura confiável", nivel: "warn" });
    if (fora) fatos.push({ n: fora, texto: fora === 1 ? "conta da carteira fora do monitoramento" : "contas da carteira fora do monitoramento", nivel: "muted" });
    const base = { fatos, monitoradas: monit.length, semLeitura, fora, confiavel: false };
    if (!monit.length || (s.resumo && s.resumo.monitoramentoAtivo === false)) {
      return Object.assign(base, { nivel: "off", titulo: "Nenhuma conta sendo monitorada", detalhe: "O Sentinel não está lendo pedidos das contas da sua carteira. Lista vazia aqui não significa operação saudável." });
    }
    if (s.saudeErro || !s.saude || !s.saude.worker) {
      return Object.assign(base, { nivel: "unknown", titulo: "Estado do monitoramento desconhecido", detalhe: "Não foi possível consultar o motor agora. A ausência de casos não comprova que está tudo bem." });
    }
    const w = s.saude.worker, idade = w.idadeSegundos == null ? null : idadeTxt(w.idadeSegundos);
    if (w.estado === "parado") return Object.assign(base, { nivel: "danger", titulo: "Monitoramento parado", detalhe: "Nenhuma leitura há " + (idade || "muito tempo") + ". Vendas novas não estão sendo conferidas; os casos abaixo são da última avaliação." });
    if (w.estado === "atrasado") return Object.assign(base, { nivel: "warn", titulo: "Monitoramento atrasado", detalhe: "Última leitura há " + idade + ", acima do intervalo esperado. Os números podem não incluir as vendas mais recentes." });
    if (w.estado !== "ativo") return Object.assign(base, { nivel: "unknown", titulo: "Sem leitura registrada", detalhe: "Ainda não há execução do Sentinel para as contas do seu recorte." });
    if (semLeitura) return Object.assign(base, { nivel: "warn", titulo: "Monitoramento ativo, com ressalva", detalhe: "Última leitura há " + idade + ". " + plural(semLeitura, "conta está", "contas estão") + " sem leitura confiável: os números dela(s) podem estar desatualizados." });
    return Object.assign(base, { nivel: "ok", confiavel: true, titulo: "Monitoramento ativo", detalhe: "Última leitura há " + idade + "." });
  }

  // Separa a lista nas três visões. O backend ordena por status (não resolvidos primeiro): se a
  // página cortou e o último item ainda não é "resolvido", até os abertos estão incompletos.
  function particionar(itens, total) {
    const l = itens || [], acao = [], tratamento = [], resolvidos = [];
    l.forEach((i) => (i.status === "resolvido" ? resolvidos : i.status === "reconhecido" ? tratamento : acao).push(i));
    const ativo = (i) => (i.condicaoAtiva === false ? 1 : 0);
    const valor = (i) => (i.impacto && i.impacto.valor) || 0;
    const ord = (a, b) => SEV_RANK[a.severidade] - SEV_RANK[b.severidade] || ativo(a) - ativo(b) || valor(b) - valor(a) || tempo(b.ultimaOcorrencia) - tempo(a.ultimaOcorrencia);
    acao.sort(ord); tratamento.sort(ord);
    resolvidos.sort((a, b) => tempo(b.resolvido && b.resolvido.em) - tempo(a.resolvido && a.resolvido.em));
    const faltam = Math.max(0, (total == null ? l.length : total) - l.length);
    const abertosParciais = faltam > 0 && l.length > 0 && l[l.length - 1].status !== "resolvido";
    return { acao, tratamento, resolvidos, faltam, abertosParciais, totalResolvidos: abertosParciais ? null : resolvidos.length + faltam };
  }

  // Agrupa casos por conta (visão "por cliente"): pior severidade primeiro; perda e receita
  // sem custo somadas SEPARADAS (nunca num número só).
  function agruparPorConta(itens) {
    const m = new Map();
    (itens || []).forEach((i) => {
      const g = m.get(i.contaId) || { contaId: i.contaId, clienteNome: i.clienteNome, contaNome: i.contaNome, clienteSlug: i.clienteSlug, squad: i.squad, contaAtiva: i.contaAtiva, itens: [], perda: 0, semCusto: 0, pior: 9 };
      g.itens.push(i);
      g.pior = Math.min(g.pior, SEV_RANK[i.severidade]);
      if (i.impacto && i.impacto.valor != null && i.condicaoAtiva !== false) {
        if (i.impacto.tipo === "perda_contribuicao") g.perda = r2(g.perda + i.impacto.valor);
        if (i.impacto.tipo === "receita_sem_custo") g.semCusto = r2(g.semCusto + i.impacto.valor);
      }
      m.set(i.contaId, g);
    });
    return [...m.values()].sort((a, b) => a.pior - b.pior || b.perda - a.perda || b.semCusto - a.semCusto || String(a.clienteNome).localeCompare(String(b.clienteNome)));
  }

  // "O problema continua acontecendo?" — só com o que a API diz (condicaoAtiva + datas).
  function atividade(i, agora, semLeitura) {
    const ag = agora == null ? Date.now() : agora;
    if (i.status === "resolvido") return { nivel: "encerrado", texto: "Resolvido há " + desde(i.resolvido && i.resolvido.em, ag) };
    if (i.condicaoAtiva === false) return { nivel: "encerrado", texto: "Condição encerrada: não aparece mais nos dados" };
    if (i.tipo === "leitura_atrasada") return { nivel: "ativo", texto: "Continua sem leitura" };
    if (!i.ultimaOcorrencia) return { nivel: "parado", texto: "Sem data de ocorrência" };
    const h = (ag - tempo(i.ultimaOcorrencia)) / 3600000;
    const oque = i.tipo === "custo_pendente" ? "pedido sem custo" : "venda negativa";
    // Sem leitura em dia não dá para afirmar que continua (nem que parou): só o último dado conhecido.
    if (semLeitura) return { nivel: "incerto", texto: "Sem leitura recente · último " + oque.replace("venda negativa", "registro de venda negativa") + " há " + desde(i.ultimaOcorrencia, ag) };
    return h <= 48 ? { nivel: "ativo", texto: "Continua ocorrendo · " + oque + " há " + desde(i.ultimaOcorrencia, ag) } : { nivel: "parado", texto: "Sem ocorrência nova há " + desde(i.ultimaOcorrencia, ag) };
  }

  // Valor em destaque do caso. Perda só com cálculo provisório NÃO é mostrada como perda.
  function impactoVisivel(i) {
    const t = i.impacto && i.impacto.tipo, v = i.impacto ? i.impacto.valor : null, d = i.detalhes || {};
    if (t === "perda_contribuicao") {
      if (!v && d.perdaPendente) return { valor: brl(d.perdaPendente), natureza: "perda provisória — fora do total", tom: "muted" };
      return { valor: brl(v), natureza: "perda calculada", tom: v ? "danger" : "muted" };
    }
    if (t === "receita_sem_custo") return { valor: brl(v), natureza: "receita sem custo · não é prejuízo", tom: "warn" };
    return { valor: null, natureza: "sem valor em R$", tom: "muted" };
  }

  function coberturaInfo(cob) {
    const pc = (cob && cob.porConfiabilidade) || {};
    const calculadas = (pc.calculado || 0) + (pc.confirmado || 0), provisorias = pc.pendente || 0, inconclusivas = pc.inconclusivo || 0;
    const vendas = cob && cob.vendas != null ? cob.vendas : calculadas + provisorias + inconclusivas;
    const excluidos = Object.values((cob && cob.excluidos) || {}).reduce((a, b) => a + b, 0);
    return { vendas, calculadas, provisorias, inconclusivas, confirmadas: pc.confirmado || 0, excluidos, pctCalculadas: vendas ? Math.round((calculadas / vendas) * 100) : null };
  }

  // Composição financeira somada dos pedidos do caso. Componente ausente em algum pedido NÃO é
  // somado como zero: fica sem total e diz em quantos pedidos falta.
  const COMPONENTES = [["faturamento", "Receita dos itens"], ["comissao", "Comissão e tarifas"], ["frete", "Frete do vendedor"], ["custo", "Custo dos produtos"], ["imposto", "Imposto"]];
  function composicao(pedidos) {
    const l = pedidos || [];
    if (!l.length) return null;
    const soma = (k) => { const aus = l.filter((p) => p[k] == null).length; return { valor: aus ? null : r2(l.reduce((s, p) => s + Number(p[k]), 0)), ausentes: aus }; };
    const fat = soma("faturamento");
    const linhas = COMPONENTES.map(([chave, rotulo]) => { const s = soma(chave); return { chave, rotulo, valor: s.valor, ausentes: s.ausentes, pctReceita: s.valor != null && fat.valor ? r2((s.valor / fat.valor) * 100) : null }; });
    const m = soma("margemValor");
    const completos = linhas.every((x) => x.valor != null) && m.valor != null;
    const [f, ...custos] = linhas;
    // Diferença entre (receita − componentes exibidos) e a contribuição do motor: outros
    // componentes do cálculo que esta tela não detalha. Mostrada, nunca escondida.
    const outros = completos ? r2(m.valor - (f.valor - custos.reduce((s, x) => s + x.valor, 0))) : null;
    return { pedidos: l.length, linhas, contribuicao: m.valor, contribuicaoAusentes: m.ausentes, pctContribuicao: m.valor != null && fat.valor ? r2((m.valor / fat.valor) * 100) : null, outros: outros != null && Math.abs(outros) >= 0.01 ? outros : null };
  }

  // Sinais determinísticos nos pedidos do caso. "fato" = leitura direta dos dados;
  // "hipotese" = por onde começar a investigar (nunca causa comprovada).
  function sinais(pedidos) {
    const l = pedidos || [], out = [];
    if (!l.length) return out;
    const comp = composicao(l);
    const pesos = comp.linhas.slice(1).filter((x) => x.pctReceita != null).sort((a, b) => b.pctReceita - a.pctReceita);
    if (pesos.length) out.push({ tipo: "fato", area: pesos[0].chave, texto: "Maior peso sobre a receita: " + pesos[0].rotulo.toLowerCase() + " (" + pct(pesos[0].pctReceita) + ")." });
    const porItem = new Map();
    let custoAcima = 0;
    l.forEach((p) => (p.itens || []).forEach((it) => {
      if (it.preco != null) { const a = porItem.get(it.itemId) || []; a.push(Number(it.preco)); porItem.set(it.itemId, a); }
      if (it.preco != null && it.custoUnitario != null && Number(it.custoUnitario) >= Number(it.preco)) custoAcima += 1;
    }));
    porItem.forEach((precos, id) => {
      const mn = Math.min(...precos), mx = Math.max(...precos);
      if (mx > 0 && (mx - mn) / mx >= 0.05) {
        out.push({ tipo: "fato", area: "preco", texto: "Preço unitário de " + id + " variou de " + brl(mn) + " a " + brl(mx) + " entre os pedidos." });
        out.push({ tipo: "hipotese", area: "preco", texto: "Vendas a preço menor podem indicar desconto ou promoção. O Sentinel não sabe quem bancou o desconto; confira na Central de Margem." });
      }
    });
    if (custoAcima) {
      out.push({ tipo: "fato", area: "custo", texto: "Em " + plural(custoAcima, "item", "itens") + ", o custo unitário cadastrado é igual ou maior que o preço de venda." });
      out.push({ tipo: "hipotese", area: "custo", texto: "Confira se o custo da base está certo (kit, variação, unidade) ou se o preço está abaixo do custo." });
    }
    const fretes = l.map((p) => p.frete).filter((v) => v != null).map(Number);
    const semFrete = l.length - fretes.length;
    if (fretes.length >= 2) {
      const mn = Math.min(...fretes), mx = Math.max(...fretes);
      if (mx - mn >= 5 && mx >= 2 * Math.max(mn, 0.01)) {
        out.push({ tipo: "fato", area: "frete", texto: "Frete por pedido variou de " + brl(mn) + " a " + brl(mx) + "." });
        out.push({ tipo: "hipotese", area: "frete", texto: "O frete pode pesar só em parte dos pedidos (faixa de frete ou envio compartilhado). Compare os pedidos de maior frete." });
      }
    }
    if (semFrete) out.push({ tipo: "fato", area: "frete", texto: plural(semFrete, "pedido sem valor de frete", "pedidos sem valor de frete") + ": a contribuição dele(s) é provisória." });
    return out;
  }

  // Evento do histórico em linguagem de operação.
  function eventoTxt(e) {
    const d = e.dados || {}, quem = nomeAtor(e.ator);
    if (e.evento === "aberto") return { titulo: "Caso aberto pelo Sentinel", nota: "" };
    if (e.evento === "reaberto") { const n = Array.isArray(d.novaOcorrencia && d.novaOcorrencia.pedidosNovos) ? d.novaOcorrencia.pedidosNovos.length : null; return { titulo: "Reaberto pelo Sentinel", nota: n ? plural(n, "pedido novo", "pedidos novos") + " com o mesmo problema depois da resolução." : "Nova ocorrência depois da resolução." }; }
    if (e.evento === "atualizado") { const sev = d.severidadeAntes && d.severidadeDepois && d.severidadeAntes !== d.severidadeDepois ? "Severidade: " + (SEV[d.severidadeAntes] || d.severidadeAntes) + " → " + (SEV[d.severidadeDepois] || d.severidadeDepois) + "." : ""; return { titulo: "Evidência atualizada", nota: sev }; }
    if (e.evento === "reconhecido") return { titulo: "Reconhecido por " + quem, nota: d.observacao || "" };
    if (e.evento === "resolvido") return { titulo: "Resolvido por " + quem, nota: [d.motivo ? "Motivo: " + d.motivo : "", d.observacao || ""].filter(Boolean).join(" · ") };
    if (e.evento === "condicao_encerrada") return { titulo: "Condição deixou de ocorrer", nota: "O problema não aparece mais nos dados. O caso continua no estado em que estava: quem encerra é a operação." };
    return { titulo: e.evento, nota: "" };
  }

  // Caso reconhecido pelo usuário logado? O ator é gravado como "Nome (#id)" pelo backend.
  const ehMeu = (i, me) => !!(me && me.id != null && i.reconhecido && String(i.reconhecido.por || "").endsWith("(#" + me.id + ")"));

  function criarApi({ base, getToken, fetchImpl }) {
    const f = fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    async function req(method, path, { params, body } = {}) {
      const qs = new URLSearchParams();
      Object.entries(params || {}).forEach(([k, v]) => { if (v !== "" && v != null) qs.set(k, v); });
      const url = base + "/sentinel" + path + (qs.toString() ? "?" + qs : "");
      const headers = { Authorization: "Bearer " + getToken() };
      if (body) headers["Content-Type"] = "application/json";
      const r = await f(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      let j = null;
      try { j = await r.json(); } catch (e) { /* corpo vazio */ }
      if (!r.ok) throw Object.assign(new Error((j && j.erro) || "Erro " + r.status), { status: r.status, code: j && j.code });
      return j;
    }
    return {
      resumo: (q) => req("GET", "/resumo", { params: q }).then((j) => j.resumo),
      contas: (q) => req("GET", "/contas", { params: q }).then((j) => j.contas),
      saude: (q) => req("GET", "/saude", { params: q }).then((j) => j.saude),
      incidentes: (q) => req("GET", "/incidentes", { params: q }),
      incidente: (id) => req("GET", "/incidentes/" + encodeURIComponent(id)).then((j) => j.incidente),
      reconhecer: (id, body) => req("POST", "/incidentes/" + encodeURIComponent(id) + "/reconhecer", { body: body || {} }).then((j) => j.incidente),
      resolver: (id, body) => req("POST", "/incidentes/" + encodeURIComponent(id) + "/resolver", { body }).then((j) => j.incidente),
    };
  }

  const api0 = { OFF_TXT, agruparAlertas, idadeTxt, WORKER, NIVEL, esc, brl, pct, duracao, desde, linkCentral, linkBases, periodoParaDesde, prioridadeExplicada, estadoDaTela, criarApi, TIPOS, STATUS, SEV, CONF, IMPACTO,
    VISOES, MOTIVOS, estadoMotor, particionar, agruparPorConta, atividade, impactoVisivel, coberturaInfo, composicao, sinais, eventoTxt, ehMeu, nomeAtor };
  if (typeof module !== "undefined" && module.exports) module.exports = api0;
  root.Sentinel = api0;
  if (typeof document === "undefined") return;

  /* ── UI ─────────────────────────────────────────────────────────────── */
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const DEMO = params.get("demo") === "1";
  const TOKEN_KEY = "vf-token", USER_KEY = "vf-user";
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* sem storage */ } };
  const eu = () => { if (DEMO) return { id: 0 }; try { return JSON.parse(lsGet(USER_KEY) || "{}") || {}; } catch (e) { return {}; } };

  function apiBase() {
    const m = document.querySelector('meta[name="vf-api-base"]');
    if (m && m.content.trim()) return m.content.trim().replace(/\/+$/, "");
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return location.origin;
    return "https://venforce-server.onrender.com";
  }

  let api = null;
  const S = { carregando: true, atualizando: false, erro: null, saude: null, saudeErro: false, resumo: null, contas: [], incidentes: null, carregadoEm: null,
    aba: "fila", visao: "acao", agrupar: "prioridade", soMeus: false, filaErro: null, ocupadoId: null,
    detalhe: null, form: null, acaoErro: null, pedTodos: false };
  const F = { squad: "", conta: "", tipo: "", severidade: "", periodo: "todos", busca: "" };
  const F0 = Object.assign({}, F);
  let lastFocus = null, reqSeq = 0;
  const filtrosAtivos = () => Object.keys(F0).some((k) => F[k] !== F0[k]);

  const dt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
  const dia = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—");
  const offBadge = (ativa) => (ativa === false ? '<span class="sn-off" title="O Sentinel não lê pedidos desta conta; o caso fica para consulta e decisão humana.">' + OFF_TXT + "</span>" : "");
  const sevTag = (s, titulo) => '<span class="sn-sev sn-sev--' + esc(s) + '"' + (titulo ? ' title="' + esc(titulo) + '"' : "") + ">" + esc(SEV[s] || s) + "</span>";
  const confTag = (c) => '<span class="sn-conf sn-conf--' + esc(c) + '" title="' + esc((CONF[c] || ["", ""])[1]) + '">' + esc((CONF[c] || [c])[0]) + "</span>";
  const contaDe = (id) => S.contas.find((c) => String(c.contaId) === String(id)) || null;
  const leituraRuim = (c) => !!c && c.ativo !== false && (c.situacao === "atrasada" || c.situacao === "erro" || c.situacao === "nunca_lida");
  // Caso financeiro cuja conta (ou o motor inteiro) está sem leitura em dia.
  const semLeituraDe = (i) => { const n = estadoMotor(S).nivel; return i.tipo !== "leitura_atrasada" && i.contaAtiva !== false && (n === "danger" || n === "off" || leituraRuim(contaDe(i.contaId))); };
  const ehToken = (i) => /token/i.test(String((i.detalhes && (i.detalhes.categoria || i.detalhes.ultimoErro)) || "") + " " + String(i.motivo || ""));
  // Título de leitura atrasada gravado pelo backend congela a duração do momento da abertura:
  // aqui o título é neutro e a duração vem AO VIVO de /contas.
  const tituloCaso = (i) => (i.tipo === "leitura_atrasada" ? (ehToken(i) ? "Conexão com o Mercado Livre indisponível" : "Conta sem leitura do Sentinel") : i.titulo);
  const skusTxt = (i) => { const s = (i.detalhes && i.detalhes.skus) || []; return s.length ? "SKU " + s.slice(0, 2).join(", ") + (s.length > 2 ? " +" + (s.length - 2) : "") : ""; };

  function ctxLinks(i, cls) {
    const b = (href, txt, forte) => '<a class="vf-btn vf-btn--sm ' + (forte ? "vf-btn--secondary" : "vf-btn--ghost") + " " + (cls || "") + '" href="' + esc(href) + '">' + txt + "</a>";
    if (i.tipo === "leitura_atrasada") return ehToken(i) ? b("clientes.html", "Abrir Clientes", true) : "";
    if (i.tipo === "custo_pendente") return b(linkBases(i), "Abrir Bases de custo", true) + b(linkCentral(i), "Central de Margem");
    return b(linkCentral(i), "Abrir na Central de Margem", true) + b(linkBases(i), "Bases de custo");
  }

  function filtroParams() {
    return { squad: F.squad, conta: F.conta, tipo: F.tipo, severidade: F.severidade, busca: F.busca.trim(), desde: periodoParaDesde(F.periodo), limit: LIMITE_LISTA };
  }

  async function carregar(silencioso) {
    const seq = ++reqSeq;
    const temTela = !!S.incidentes && silencioso;
    S.carregando = !temTela; S.atualizando = temTela; S.erro = null; render();
    try {
      const escopo = { squad: F.squad, conta: F.conta };
      // A saúde é complementar: se ela falhar, a fila continua (e a faixa do motor avisa).
      const saudeP = api.saude(escopo).then((x) => ({ x }), (e) => (e.status === 401 ? Promise.reject(e) : { erro: true }));
      const [resumo, contas, incidentes, sd] = await Promise.all([api.resumo(escopo), api.contas({}), api.incidentes(filtroParams()), saudeP]);
      if (seq !== reqSeq) return; // resposta de um filtro antigo
      Object.assign(S, { resumo, contas, incidentes, saude: sd.x || null, saudeErro: !!sd.erro, carregando: false, atualizando: false, carregadoEm: Date.now() });
    } catch (e) {
      if (seq !== reqSeq) return;
      if (e.status === 401) { lsDel(TOKEN_KEY); lsDel(USER_KEY); location.replace("index.html"); return; }
      S.carregando = false; S.atualizando = false;
      S.erro = e.status === 403 ? "Seu perfil não tem acesso ao Sentinel." : e.message || "Falha ao carregar.";
    }
    render();
  }

  /* ── Render: cabeçalho, motor, síntese ──────────────────────────────── */
  function renderFrescor() {
    const el = $("#sn-frescor");
    if (S.carregando && !S.carregadoEm) { el.innerHTML = ""; return; }
    const velho = S.carregadoEm && Date.now() - S.carregadoEm > TELA_VELHA_MS;
    el.innerHTML = '<span class="sn-frescor__txt' + (velho ? " is-velho" : "") + '">' + (S.atualizando ? "Atualizando…" : S.carregadoEm ? (Date.now() - S.carregadoEm < 60000 ? "Tela atualizada agora" : "Tela atualizada há " + duracao(Date.now() - S.carregadoEm)) + (velho ? " — pode estar defasada" : "") : "") + "</span>" +
      '<button type="button" class="vf-btn vf-btn--sm vf-btn--secondary" id="sn-atualizar"' + (S.atualizando ? " disabled" : "") + ">Atualizar</button>";
  }

  function renderMotor() {
    const el = $("#sn-motor");
    if (S.erro) { el.hidden = true; return; }
    el.hidden = false;
    if (S.carregando && !S.resumo) { el.className = "sn-motor is-unknown"; el.innerHTML = '<div class="sn-motor__estado"><span class="sn-motor__dot" aria-hidden="true"></span><div><strong>Consultando o motor…</strong></div></div>'; return; }
    const m = estadoMotor(S), g = agruparAlertas(S.saude && S.saude.alertas);
    // Um alerta crítico por conta (o backend emite token + leitura atrasada para a mesma conta).
    const vistos = new Set();
    g.critico = g.critico.filter((x) => { const k = x.contaId == null ? x.codigo : "c" + x.contaId; if (vistos.has(k)) return false; vistos.add(k); return true; });
    el.className = "sn-motor is-" + m.nivel;
    el.innerHTML = '<div class="sn-motor__estado"><span class="sn-motor__dot" aria-hidden="true"></span><div><strong>' + esc(m.titulo) + "</strong><span>" + esc(m.detalhe) + "</span></div></div>" +
      (m.fatos.length ? '<ul class="sn-motor__fatos">' + m.fatos.map((f) => '<li class="' + (f.nivel ? "is-" + f.nivel : "") + '"><b>' + esc(f.n) + "</b> " + esc(f.texto) + "</li>").join("") + "</ul>" : "") +
      (S.aba === "motor" ? "" : '<button type="button" class="vf-btn vf-btn--sm vf-btn--ghost sn-motor__mais" data-tab="motor">Motor e contas</button>') +
      (g.critico.length ? '<ul class="sn-motor__criticos" id="sn-banners">' + g.critico.slice(0, 3).map((a) => '<li role="alert">' + esc(a.mensagem) + (a.contaId ? ' <button type="button" class="sn-link" data-alerta-conta="' + esc(a.contaId) + '">ver casos da conta</button>' : "") + "</li>").join("") + (g.critico.length > 3 ? "<li>+ " + (g.critico.length - 3) + " alerta(s) crítico(s) em Motor e contas</li>" : "") + "</ul>" : "");
  }

  function barraCobertura(c) {
    if (!c.vendas) return "";
    const seg = (n, cls, rot) => (n ? '<span class="sn-cob__seg ' + cls + '" style="flex:' + n + '" title="' + esc(n + " " + rot) + '"></span>' : "");
    return '<div class="sn-cob__bar" role="img" aria-label="' + esc(c.calculadas + " calculadas, " + c.provisorias + " provisórias, " + c.inconclusivas + " sem margem, de " + c.vendas + " vendas lidas") + '">' + seg(c.calculadas, "is-calc", "calculadas") + seg(c.provisorias, "is-prov", "provisórias") + seg(c.inconclusivas, "is-inc", "sem margem") + "</div>";
  }

  function renderSintese() {
    const el = $("#sn-sintese"), r = S.resumo;
    if (!r || S.erro) { el.innerHTML = ""; el.hidden = true; return; }
    el.hidden = false;
    const c = coberturaInfo(r.cobertura), dias = r.janelaDias || 30;
    const fig = (rot, val, pe, tom) => '<div class="sn-fig"><span class="sn-fig__rot">' + rot + '</span><span class="sn-fig__val' + (tom ? " is-" + tom : "") + '">' + val + '</span><span class="sn-fig__pe">' + pe + "</span></div>";
    el.innerHTML =
      fig("Perda calculada em casos abertos", brl(r.perdaContribuicaoObservada), "contribuição negativa nos últimos " + dias + " dias · sujeita a devoluções", r.perdaContribuicaoObservada > 0 ? "danger" : "") +
      fig("Receita sem custo conferido", brl(r.receitaCustoPendente), "não é prejuízo: falta custo para calcular a margem", "") +
      fig("Casos abertos", esc(r.incidentesAbertos), plural(r.incidentesCriticos || 0, "crítico", "críticos") + " · inclui os já reconhecidos", "") +
      '<div class="sn-fig sn-fig--cob"><span class="sn-fig__rot">Margem calculável</span><span class="sn-fig__val">' + (c.vendas ? esc(c.calculadas) + '<small> de ' + esc(c.vendas) + " vendas lidas</small>" : "—") + "</span>" + barraCobertura(c) +
      '<span class="sn-fig__pe">' + (c.vendas ? esc(c.provisorias) + " provisórias · " + esc(c.inconclusivas) + " sem margem · " + esc(c.excluidos) + " fora (cancelados/não pagos)" : "nenhuma venda lida no período") + "</span></div>";
  }

  /* ── Render: fila de casos ──────────────────────────────────────────── */
  function quemTrata(i) {
    if (i.status === "resolvido") return "Resolvido por " + esc(nomeAtor(i.resolvido && i.resolvido.por)) + (i.resolvido && i.resolvido.motivo ? " — " + esc(i.resolvido.motivo) : "");
    if (i.status === "reconhecido") return "Em tratamento por <strong>" + esc(nomeAtor(i.reconhecido && i.reconhecido.por)) + "</strong> · há " + desde(i.reconhecido && i.reconhecido.em);
    return "Ninguém reconheceu ainda · aberto há " + desde(i.reabertoEm || i.abertoEm);
  }

  function cardCaso(i, semOnde) {
    const imp = impactoVisivel(i), at = atividade(i, null, semLeituraDe(i)), conta = contaDe(i.contaId);
    const lado = i.tipo === "leitura_atrasada"
      ? '<div class="sn-case__valor is-muted">' + (conta && conta.atrasoSegundos != null && i.condicaoAtiva !== false ? esc(idadeTxt(conta.atrasoSegundos)) : "—") + '</div><div class="sn-case__natureza">sem leitura · vendas não conferidas</div>'
      : '<div class="sn-case__valor is-' + imp.tom + '">' + esc(imp.valor) + '</div><div class="sn-case__natureza">' + esc(imp.natureza) + (i.pedidosAfetados ? " · " + plural(i.pedidosAfetados, "pedido", "pedidos") : "") + "</div>";
    const podeReconhecer = i.status === "aberto" || i.status === "reaberto";
    return '<article class="sn-case sn-row sn-case--' + esc(i.severidade) + (i.status === "resolvido" ? " is-resolvido" : "") + '" tabindex="0" data-inc="' + esc(i.id) + '" aria-label="' + esc(SEV[i.severidade] + ": " + tituloCaso(i) + " — " + i.clienteNome) + '">' +
      '<div class="sn-case__main">' +
        '<div class="sn-case__meta">' + sevTag(i.severidade, prioridadeExplicada(i)) + '<span class="sn-case__tipo">' + esc(TIPOS[i.tipo] || i.tipo) + "</span>" + (i.status === "reaberto" || i.vezesReaberto ? '<span class="sn-tag">reaberto ' + esc(i.vezesReaberto || 1) + "×</span>" : "") + '<span class="sn-ativ sn-ativ--' + at.nivel + '">' + esc(at.texto) + "</span></div>" +
        '<h3 class="sn-case__titulo">' + esc(tituloCaso(i)) + "</h3>" +
        (semOnde ? "" : '<div class="sn-case__onde"><strong>' + esc(i.clienteNome) + "</strong> · " + esc(i.contaNome) + (i.squad ? " · " + esc(i.squad.nome) : "") + (skusTxt(i) ? " · " + esc(skusTxt(i)) : "") + " " + offBadge(i.contaAtiva) + "</div>") +
        '<p class="sn-case__motivo">' + esc(i.motivo) + "</p>" +
        '<p class="sn-case__acao"><span aria-hidden="true">→</span> ' + esc(i.proximaAcao) + "</p>" +
      "</div>" +
      '<div class="sn-case__lado">' + lado +
        '<div class="sn-case__conf">' + confTag(i.confiabilidade) + "</div>" +
        '<div class="sn-case__quem">' + quemTrata(i) + "</div>" +
        '<div class="sn-case__btns">' + (podeReconhecer ? '<button type="button" class="vf-btn vf-btn--sm vf-btn--secondary" data-reconhecer="' + esc(i.id) + '"' + (S.ocupadoId === i.id ? " disabled" : "") + ' title="Registra que você viu e está tratando este caso">' + (S.ocupadoId === i.id ? "Registrando…" : "Reconhecer") + "</button>" : "") +
        '<button type="button" class="vf-btn vf-btn--sm vf-btn--primary" data-abrir="' + esc(i.id) + '">Investigar</button></div>' +
      "</div></article>";
  }

  function listaCasos(itens) {
    if (S.agrupar !== "cliente") return '<div class="sn-lista">' + itens.map((i) => cardCaso(i)).join("") + "</div>";
    return agruparPorConta(itens).map((g) => {
      const c = contaDe(g.contaId), sit = c ? (c.ativo === false ? null : SITUACAO[c.situacao]) : null;
      return '<section class="sn-grupo"><header class="sn-grupo__head"><div><h3>' + esc(g.clienteNome) + ' <span>· ' + esc(g.contaNome) + (g.squad ? " · " + esc(g.squad.nome) : "") + "</span></h3>" + offBadge(g.contaAtiva) + (sit ? '<span class="vf-status ' + sit[0] + '">Leitura ' + esc(sit[1].toLowerCase()) + "</span>" : "") + "</div>" +
        '<div class="sn-grupo__nums"><span>' + plural(g.itens.length, "caso", "casos") + "</span>" + (g.perda ? '<span class="is-danger">perda calculada ' + brl(g.perda) + "</span>" : "") + (g.semCusto ? "<span>sem custo " + brl(g.semCusto) + "</span>" : "") + "</div></header>" +
        '<div class="sn-lista">' + g.itens.map((i) => cardCaso(i, true)).join("") + "</div></section>";
    }).join("");
  }

  function vazioFila(P) {
    const m = estadoMotor(S), filtrado = filtrosAtivos();
    if (S.visao === "acao" && !filtrado) {
      if (m.confiavel) return vazio("Nada pede ação agora", "Nenhum caso aberto sem reconhecimento. " + esc(m.detalhe) + (P.tratamento.length ? " Há " + plural(P.tratamento.length, "caso", "casos") + " em tratamento." : ""));
      return vazio("Nenhum caso aberto — mas isso não comprova saúde", esc(m.titulo) + ". " + esc(m.detalhe), '<button type="button" class="vf-btn vf-btn--sm vf-btn--secondary" data-tab="motor">Ver motor e contas</button>');
    }
    return vazio(filtrado ? "Nenhum caso com esses filtros" : "Nenhum caso em “" + VISOES[S.visao][0] + "”", filtrado ? "Os filtros valem para as três visões." : "", filtrado ? '<button type="button" class="vf-btn vf-btn--sm vf-btn--secondary" data-limpar>Limpar filtros</button>' : "");
  }

  function painelFila() {
    const P = particionar(S.incidentes.itens, S.incidentes.total), me = eu();
    let itens = P[S.visao];
    const meus = P.tratamento.filter((i) => ehMeu(i, me)).length;
    if (S.visao === "tratamento" && S.soMeus) itens = itens.filter((i) => ehMeu(i, me));
    const n = { acao: P.acao.length + (P.abertosParciais ? "+" : ""), tratamento: P.tratamento.length + (P.abertosParciais ? "+" : ""), resolvidos: P.totalResolvidos == null ? P.resolvidos.length + "+" : P.totalResolvidos };
    const seg = Object.keys(VISOES).map((k) => '<button type="button" class="vf-segmented__item' + (S.visao === k ? " is-active" : "") + '" role="tab" aria-selected="' + (S.visao === k) + '" data-visao="' + k + '">' + VISOES[k][0] + ' <span class="sn-n">' + esc(n[k]) + "</span></button>").join("");
    const agr = ["prioridade", "cliente"].map((k) => '<button type="button" class="vf-segmented__item' + (S.agrupar === k ? " is-active" : "") + '" aria-pressed="' + (S.agrupar === k) + '" data-agrupar="' + k + '">' + (k === "prioridade" ? "Por prioridade" : "Por cliente") + "</button>").join("");
    const avisos =
      (S.filaErro ? '<div class="sn-aviso is-danger" role="alert">' + esc(S.filaErro) + "</div>" : "") +
      (P.abertosParciais ? '<div class="sn-aviso is-warn" role="status">Há mais casos abertos do que os ' + S.incidentes.itens.length + " carregados (" + S.incidentes.total + " no total). A lista e as contagens estão incompletas: filtre por conta ou tipo.</div>" : "") +
      (S.visao === "resolvidos" && P.faltam && !P.abertosParciais ? '<div class="sn-aviso" role="status">Mostrando os ' + P.resolvidos.length + " resolvidos mais recentes de " + P.totalResolvidos + ". Use período, conta ou busca para ver os demais.</div>" : "");
    return '<div class="sn-fila-head"><div class="vf-segmented" role="tablist" aria-label="Visão da fila">' + seg + '</div><div class="vf-segmented sn-agr" aria-label="Organização">' + agr + "</div></div>" +
      '<p class="sn-visao-desc">' + esc(VISOES[S.visao][1]) + (S.visao === "tratamento" && me.id != null && meus ? ' <label class="sn-meus"><input type="checkbox" id="sn-so-meus"' + (S.soMeus ? " checked" : "") + "> só os que eu reconheci (" + meus + ")</label>" : "") + "</p>" +
      avisos + (itens.length ? listaCasos(itens) : vazioFila(P));
  }

  /* ── Render: motor e contas ─────────────────────────────────────────── */
  function painelMotor() {
    const m = estadoMotor(S), h = S.saude, cob = coberturaInfo((h && h.cobertura) || (S.resumo && S.resumo.cobertura));
    const abertosPorConta = new Map();
    ((S.incidentes && S.incidentes.itens) || []).forEach((i) => { if (i.status !== "resolvido") abertosPorConta.set(i.contaId, (abertosPorConta.get(i.contaId) || 0) + 1); });
    const parcial = S.incidentes && particionar(S.incidentes.itens, S.incidentes.total).abertosParciais;
    const cs = S.contas.filter((c) => (!F.squad || (c.squad && String(c.squad.id) === F.squad)) && (!F.conta || String(c.contaId) === F.conta));
    const item = (rot, val) => "<div><dt>" + rot + "</dt><dd>" + val + "</dd></div>";
    const motor = '<section class="sn-bloco"><h2 class="sn-h2">Motor de leitura</h2>' +
      (h && h.worker ? '<dl class="sn-facts">' + item("Estado", '<span class="vf-status ' + (WORKER[h.worker.estado] || WORKER.sem_dados)[0] + '">Worker ' + (WORKER[h.worker.estado] || WORKER.sem_dados)[1] + "</span>") + item("Última execução", h.worker.ultimaExecucaoEm ? "há " + idadeTxt(h.worker.idadeSegundos) : "—") + item("Última coleta sem erro", h.ultimaColetaOkEm ? "há " + desde(h.ultimaColetaOkEm) : "—") + item("Maior atraso entre contas", idadeTxt(h.checkpointIdadeMaxSegundos)) + (h.limiteLeituraMin ? item("Limite de leitura", esc(h.limiteLeituraMin) + " min") : "") + (h.worker.intervaloEsperadoSegundos ? item("Intervalo esperado", "até " + idadeTxt(2 * h.worker.intervaloEsperadoSegundos)) : "") + "</dl>" +
        '<p class="sn-nota">' + esc((WORKER[h.worker.estado] || WORKER.sem_dados)[2]) + "</p>"
        : '<p class="sn-nota">' + esc(m.detalhe) + ' <button type="button" class="sn-link" id="sn-retry">Tentar de novo</button></p>') + "</section>";
    const g = agruparAlertas(h && h.alertas);
    const alertas = ["critico", "aviso", "info"].map((nv) => g[nv].map((a) => '<li class="sn-alerta"><span class="vf-status ' + NIVEL[nv][0] + '">' + NIVEL[nv][1] + "</span><span>" + esc(a.mensagem) + "</span>" + (a.contaId && contaDe(a.contaId) ? '<button type="button" class="sn-link" data-alerta-conta="' + esc(a.contaId) + '">ver casos da conta</button>' : "") + "</li>").join("")).join("");
    const contas = '<section class="sn-bloco"><h2 class="sn-h2">Contas da carteira <span>' + cs.length + '</span></h2><div class="vf-table-wrap"><div class="vf-table-scroll"><table class="vf-table vf-table--compact sn-contas"><thead><tr><th>Cliente · conta</th><th>Squad</th><th>Leitura</th><th>Última execução</th><th>Último erro</th><th class="sn-num">Casos abertos</th><th></th></tr></thead><tbody>' +
      cs.map((c) => {
        const s = c.ativo === false ? null : c.monitorada ? SITUACAO[c.situacao] || ["is-empty", c.situacao] : SITUACAO.nao_monitorada;
        const n = abertosPorConta.get(c.contaId) || 0;
        return "<tr><td><strong>" + esc(c.clienteNome) + '</strong><div class="sn-sub">' + esc(c.contaNome) + "</div></td><td>" + esc(c.squad ? c.squad.nome : "—") + "</td><td>" + (s ? '<span class="vf-status ' + s[0] + '">' + esc(s[1]) + "</span>" + (leituraRuim(c) && c.atrasoSegundos != null ? '<div class="sn-sub">sem avançar há ' + esc(idadeTxt(c.atrasoSegundos)) + "</div>" : "") : offBadge(false)) + "</td><td>" + (c.ultimaExecucaoEm ? "há " + desde(c.ultimaExecucaoEm) : "—") + '</td><td class="sn-sub sn-erro">' + esc(c.ultimoErro || "—") + '</td><td class="sn-num">' + (n ? '<button type="button" class="sn-link" data-alerta-conta="' + esc(c.contaId) + '">' + n + (parcial ? "+" : "") + "</button>" : parcial ? "?" : "0") + '</td><td class="sn-actions"><a class="vf-btn vf-btn--sm vf-btn--ghost" href="' + esc(linkCentral({ clienteSlug: c.clienteSlug, contaId: c.contaId })) + '">Central de Margem</a></td></tr>';
      }).join("") + "</tbody></table></div></div>" +
      (m.fora ? '<p class="sn-nota">' + plural(m.fora, "conta ativa não está", "contas ativas não estão") + " na lista de contas monitoradas: o Sentinel não lê pedidos dela(s) e nunca abrirá casos para ela(s). A inclusão é uma decisão de operação.</p>" : "") + "</section>";
    const limites = '<section class="sn-bloco"><h2 class="sn-h2">Cobertura e limites do que você vê</h2>' +
      (cob.vendas ? '<div class="sn-cob">' + barraCobertura(cob) + '<ul class="sn-cob__leg"><li><i class="is-calc"></i><b>' + cob.calculadas + "</b> com margem calculada" + (cob.pctCalculadas != null ? " (" + cob.pctCalculadas + "%)" : "") + '</li><li><i class="is-prov"></i><b>' + cob.provisorias + '</b> provisórias (componente faltando)</li><li><i class="is-inc"></i><b>' + cob.inconclusivas + "</b> sem margem (custo ausente ou ambíguo, frete de pack incompleto)</li><li><b>" + cob.excluidos + "</b> pedidos fora da conta (cancelados ou não pagos)</li></ul></div>" : '<p class="sn-nota">Nenhuma venda lida no período para o seu recorte.</p>') +
      '<ul class="sn-limites">' +
        (cob.confirmadas ? "" : "<li>Devoluções e reclamações não são consultadas. Por isso nenhum valor aparece como “confirmado”: perda calculada pode mudar depois da venda.</li>") +
        "<li>A cobertura acima é sobre os pedidos que o Sentinel leu. Não há conferência diária contra o Mercado Livre para provar que nenhum pedido ficou de fora.</li>" +
        "<li>Receita sem custo não entra em perda. São dois números separados e não devem ser somados.</li>" +
        "<li>O Sentinel só observa: não altera preço, anúncio nem promoção.</li>" +
      "</ul></section>";
    return '<div class="sn-motor-painel">' + motor + contas + limites + '<section class="sn-bloco"><h2 class="sn-h2">Avisos do motor</h2>' + (alertas ? '<ul class="sn-alertas">' + alertas + "</ul>" : '<p class="sn-nota">' + (h ? "Nenhum aviso." : "Indisponível agora.") + "</p>") + "</section></div>";
  }

  const vazio = (t, d, acoes) => '<div class="vf-empty"><div class="vf-empty__title">' + t + "</div>" + (d ? '<div class="vf-empty__description">' + d + "</div>" : "") + (acoes ? '<div class="vf-empty__actions">' + acoes + "</div>" : "") + "</div>";
  const esqueleto = () => '<div class="sn-lista" aria-hidden="true">' + [0, 1, 2].map(() => '<div class="sn-case sn-case--skel"><div class="sn-case__main"><span class="vf-skeleton vf-skeleton--title"></span><span class="vf-skeleton vf-skeleton--row"></span><span class="vf-skeleton vf-skeleton--row"></span></div></div>').join("") + '</div><span class="sn-sr">Carregando casos…</span>';

  function renderFiltros() {
    const squads = [...new Map(S.contas.filter((c) => c.squad).map((c) => [c.squad.id, c.squad])).values()];
    const contas = S.contas.filter((c) => !F.squad || (c.squad && String(c.squad.id) === F.squad));
    const op = (v, l, sel) => '<option value="' + esc(v) + '"' + (sel ? " selected" : "") + ">" + esc(l) + "</option>";
    $("#sn-f-squad").innerHTML = op("", "Todos os squads", !F.squad) + squads.map((s) => op(s.id, s.nome, String(s.id) === F.squad)).join("");
    $("#sn-f-squad").hidden = squads.length < 2;
    $("#sn-f-conta").innerHTML = op("", "Todas as contas", !F.conta) + contas.map((c) => op(c.contaId, c.clienteNome + " · " + c.contaNome + (c.ativo === false ? " (desativada)" : ""), String(c.contaId) === F.conta)).join("");
    $("#sn-f-tipo").innerHTML = op("", "Todos os tipos", !F.tipo) + Object.keys(TIPOS).map((k) => op(k, TIPOS[k], k === F.tipo)).join("");
    $("#sn-f-sev").innerHTML = op("", "Toda severidade", !F.severidade) + Object.keys(SEV).map((k) => op(k, SEV[k], k === F.severidade)).join("");
    $("#sn-f-periodo").value = F.periodo;
    if (document.activeElement !== $("#sn-f-busca")) $("#sn-f-busca").value = F.busca;
    $("#sn-clear").hidden = !filtrosAtivos();
  }

  function render() {
    const est = estadoDaTela(S);
    $("#sn-demo-seal").hidden = !DEMO;
    renderFrescor(); renderMotor(); renderSintese();
    const temContas = S.contas.length > 0;
    $("#sn-abas").hidden = est.tela === "erro" || (!temContas && est.tela !== "carregando");
    $("#sn-filtros").hidden = !temContas || S.aba !== "fila" || est.tela === "erro";
    if (temContas) renderFiltros();
    document.querySelectorAll("#sn-abas [data-tab]").forEach((b) => { const on = b.dataset.tab === S.aba; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on); });
    const painel = $("#sn-painel");
    painel.setAttribute("aria-busy", est.tela === "carregando");
    if (est.tela === "carregando") painel.innerHTML = esqueleto();
    else if (est.tela === "erro") painel.innerHTML = vazio("Não foi possível carregar o Sentinel", esc(S.erro), '<button class="vf-btn vf-btn--primary" id="sn-retry">Tentar de novo</button>');
    else if (est.tela === "sem_dados") painel.innerHTML = vazio("Nenhuma conta monitorável na sua carteira", "O Sentinel acompanha contas do Mercado Livre dos clientes do(s) seu(s) Squad(s). Peça a um admin para conferir seu vínculo a um Squad.");
    else if (S.aba === "motor") painel.innerHTML = painelMotor();
    else painel.innerHTML = painelFila();
    if (S.detalhe) renderDrawer();
  }

  /* ── Drawer: diagnóstico ────────────────────────────────────────────── */
  const sec = (n, titulo, corpo) => (corpo ? '<section class="sn-sec"><h3 class="sn-sec__h"><span>' + n + "</span>" + titulo + "</h3>" + corpo + "</section>" : "");

  function secResumo(i) {
    const imp = impactoVisivel(i), at = atividade(i, null, semLeituraDe(i)), conta = contaDe(i.contaId);
    const numero = i.tipo === "leitura_atrasada"
      ? '<div class="sn-kv"><span class="sn-kv__v">' + (conta && conta.atrasoSegundos != null && i.condicaoAtiva !== false ? esc(idadeTxt(conta.atrasoSegundos)) : "—") + '</span><span class="sn-kv__r">sem leitura agora — vendas novas desta conta não estão sendo conferidas</span></div>'
      : '<div class="sn-kv"><span class="sn-kv__v is-' + imp.tom + '">' + esc(imp.valor) + '</span><span class="sn-kv__r">' + esc(imp.natureza) + " — " + esc((IMPACTO[i.impacto && i.impacto.tipo] || ["", ""])[1]) + "</span></div>";
    const outros = ((S.incidentes && S.incidentes.itens) || []).filter((x) => x.contaId === i.contaId && x.id !== i.id && x.status !== "resolvido");
    return (i.contaAtiva === false ? '<div class="sn-aviso is-warn" role="status"><strong>' + OFF_TXT + ".</strong> Você pode consultar, reconhecer e resolver; o Sentinel não coleta pedidos novos desta conta.</div>" : "") +
      (i.tipo !== "leitura_atrasada" && leituraRuim(conta) ? '<div class="sn-aviso is-warn" role="status"><strong>A leitura desta conta não está em dia</strong> (última há ' + desde(conta.ultimaExecucaoEm) + "). Os números deste caso podem não incluir as vendas mais recentes.</div>" : "") +
      numero + '<p class="sn-lead">' + esc(i.motivo) + "</p>" +
      '<dl class="sn-facts sn-facts--3">' +
        "<div><dt>Onde</dt><dd>" + esc(i.clienteNome) + " · " + esc(i.contaNome) + (i.squad ? '<span class="sn-sub"> · ' + esc(i.squad.nome) + "</span>" : "") + "</dd></div>" +
        (i.chave !== "conta" ? "<div><dt>Anúncio</dt><dd><code>" + esc(i.chave) + "</code>" + (skusTxt(i) ? '<span class="sn-sub"> · ' + esc(skusTxt(i)) + "</span>" : "") + "</dd></div>" : "") +
        "<div><dt>Continua acontecendo?</dt><dd><span class=\"sn-ativ sn-ativ--" + at.nivel + '">' + esc(at.texto) + "</span></dd></div>" +
        "<div><dt>Quem está tratando</dt><dd>" + quemTrata(i) + "</dd></div>" +
        "<div><dt>Por que esta prioridade</dt><dd>" + esc(prioridadeExplicada(i)) + '<span class="sn-sub"> · os limites de severidade são configurados no motor</span></dd></div>' +
        (i.primeiraOcorrencia ? "<div><dt>Período</dt><dd>" + dt(i.primeiraOcorrencia) + (i.tipo === "leitura_atrasada" ? " (início do atraso)" : " → " + dt(i.ultimaOcorrencia)) + "</dd></div>" : "") +
      "</dl>" +
      (outros.length ? '<p class="sn-nota">Mais ' + plural(outros.length, "caso aberto", "casos abertos") + " nesta conta: " + outros.slice(0, 4).map((x) => '<button type="button" class="sn-link" data-abrir="' + esc(x.id) + '">' + esc(TIPOS[x.tipo]) + (x.chave !== "conta" ? " " + esc(x.chave) : "") + "</button>").join(", ") + (outros.length > 4 ? "…" : "") + "</p>" : "");
  }

  function secCalculo(i) {
    const d = i.detalhes || {}, c = CONF[i.confiabilidade] || [i.confiabilidade, ""];
    if (i.tipo === "leitura_atrasada") {
      const conta = contaDe(i.contaId);
      return '<dl class="sn-facts sn-facts--3">' + "<div><dt>Última leitura</dt><dd>" + (conta && conta.ultimaExecucaoEm ? "há " + desde(conta.ultimaExecucaoEm) : d.ultimaExecucaoEm ? "há " + desde(d.ultimaExecucaoEm) : "—") + "</dd></div>" +
        (d.limiteMin ? "<div><dt>Limite de leitura</dt><dd>" + esc(d.limiteMin) + " min</dd></div>" : "") + "<div><dt>Último erro registrado</dt><dd>" + esc((conta && conta.ultimoErro) || d.ultimoErro || "nenhum") + "</dd></div></dl>" +
        '<p class="sn-nota">Este caso não tem valor em R$: ele indica que a conta está sem conferência. Enquanto durar, a falta de casos financeiros nesta conta não significa que não há problema.</p>';
    }
    const linhas = [];
    if (i.tipo === "margem_negativa") {
      if (d.pedidosObservados != null) linhas.push(["Pedidos com cálculo completo", esc(d.pedidosObservados) + " — só eles entram na perda"]);
      if (d.pedidosPendentes) linhas.push(["Pedidos com cálculo provisório", esc(d.pedidosPendentes) + " — " + brl(d.perdaPendente) + " ficam fora da perda"]);
      if (d.faturamentoObservado != null) linhas.push(["Receita desses pedidos", brl(d.faturamentoObservado)]);
      if (d.margemMediaPct != null) linhas.push(["Margem de contribuição média", pct(d.margemMediaPct)]);
    } else {
      const mot = d.motivos || {};
      if (mot.sem_custo) linhas.push(["Itens sem custo na base", esc(mot.sem_custo)]);
      if (mot.custo_ambiguo) linhas.push(["Itens com custo ambíguo", esc(mot.custo_ambiguo) + " — mesmo anúncio com custos diferentes, sem variação que desempate"]);
      if (d.itensSemPreco) linhas.push(["Itens sem preço", esc(d.itensSemPreco) + " — fora da soma da receita"]);
      if ((d.skus || []).length) linhas.push(["SKUs envolvidos", esc(d.skus.join(", "))]);
    }
    if (d.janelaDias) linhas.push(["Janela considerada", "últimos " + esc(d.janelaDias) + " dias"]);
    return '<p class="sn-conf-linha">' + confTag(i.confiabilidade) + " <span>" + esc(c[1]) + ".</span></p>" +
      (linhas.length ? '<dl class="sn-facts sn-facts--3">' + linhas.map((r) => "<div><dt>" + r[0] + "</dt><dd>" + r[1] + "</dd></div>").join("") + "</dl>" : "") +
      '<p class="sn-nota">' + (i.tipo === "custo_pendente" ? "Sem custo confiável não há margem: o valor em destaque é receita, não prejuízo. O resultado real só aparece depois que o custo for corrigido." : "Contribuição = receita − comissão − frete − custo − imposto, pelo mesmo motor da Central de Vendas. Não é lucro final: devoluções e reclamações posteriores não entram.") + "</p>";
  }

  function secComposicao(i) {
    const ped = i.pedidos || [], comp = composicao(ped);
    if (!comp || i.tipo === "leitura_atrasada") return "";
    const fat = comp.linhas[0].valor;
    const barra = (p) => (p == null ? "" : '<span class="sn-comp__bar"><i style="width:' + Math.min(100, Math.max(0, p)) + '%"></i></span>');
    const linha = (rot, val, p, aus, cls) => '<div class="sn-comp__row ' + (cls || "") + '"><span class="sn-comp__rot">' + rot + '</span><span class="sn-comp__viz">' + barra(p) + '</span><span class="sn-comp__pct">' + (p == null ? "" : pct(p)) + '</span><span class="sn-comp__val">' + (val == null ? '<em title="Ausência não é zero">ausente em ' + aus + " de " + comp.pedidos + "</em>" : brl(val)) + "</span></div>";
    const sg = sinais(ped);
    return '<div class="sn-comp" role="table" aria-label="Composição financeira dos pedidos do caso">' +
      linha(comp.linhas[0].rotulo, fat, fat != null ? 100 : null, comp.linhas[0].ausentes, "is-receita") +
      comp.linhas.slice(1).map((x) => linha("− " + x.rotulo, x.valor, x.pctReceita, x.ausentes)).join("") +
      (comp.outros != null ? linha("± Outros componentes do motor", comp.outros, null, 0, "is-outros") : "") +
      linha("= Contribuição", comp.contribuicao, null, comp.contribuicaoAusentes, "is-total" + (comp.contribuicao != null && comp.contribuicao < 0 ? " is-neg" : "")) + "</div>" +
      '<p class="sn-nota">Soma dos ' + plural(comp.pedidos, "pedido listado", "pedidos listados") + " abaixo; percentuais sobre a receita." + (comp.pctContribuicao != null ? " Contribuição: " + pct(comp.pctContribuicao) + " da receita." : "") + (comp.outros != null ? " “Outros componentes” é a diferença entre os itens exibidos e a contribuição calculada pelo motor; esta tela não os detalha." : "") + "</p>" +
      (sg.length ? '<h4 class="sn-h4">Sinais nos dados</h4><ul class="sn-sinais">' + sg.map((s) => '<li class="is-' + s.tipo + '"><span class="sn-sinais__tag">' + (s.tipo === "hipotese" ? "Hipótese" : "Fato") + "</span>" + esc(s.texto) + "</li>").join("") + '</ul><p class="sn-nota">Hipóteses são pontos de partida para investigar, não causas comprovadas. O Sentinel não identifica promoção, rebate nem subsídio.</p>' : "");
  }

  function secEvidencias(i) {
    const ped = i.pedidos || [], d = i.detalhes || {};
    if (i.tipo === "leitura_atrasada") return "";
    const evol = Array.isArray(d.evolucao) && d.evolucao.length > 1 ? d.evolucao : null;
    const maxPerda = evol ? Math.max(...evol.map((e) => Number(e.perda) || 0), 0.01) : 0;
    const v = (x) => (x == null ? '<span class="sn-aus" title="Ausente — não é zero">—</span>' : brl(x));
    const mostrados = S.pedTodos ? ped : ped.slice(0, 8);
    const total = (d.pedidos || []).length || ped.length;
    return (evol ? '<h4 class="sn-h4">Evolução semanal</h4><div class="sn-evol">' + evol.map((e) => '<div class="sn-evol__col" title="' + esc(e.semana + ": " + e.pedidos + " pedido(s), " + brl(e.perda)) + '"><span class="sn-evol__val">' + brl(e.perda) + '</span><span class="sn-evol__bar"><i style="height:' + Math.round(((Number(e.perda) || 0) / maxPerda) * 100) + '%"></i></span><span class="sn-evol__rot">' + esc(String(e.semana).replace(/^\d{4}-/, "")) + " · " + esc(e.pedidos) + " ped.</span></div>").join("") + "</div>" : "") +
      (ped.length ? '<h4 class="sn-h4">Pedidos relacionados <span>' + ped.length + (i.pedidosAfetados > ped.length ? " de " + i.pedidosAfetados : "") + '</span></h4><div class="vf-table-scroll"><table class="vf-table vf-table--compact sn-ped"><thead><tr><th>Pedido</th><th>Data</th><th class="sn-num">Receita</th><th class="sn-num">Comissão</th><th class="sn-num">Frete</th><th class="sn-num">Custo</th><th class="sn-num">Imposto</th><th class="sn-num">Contribuição</th><th>Confiança</th></tr></thead><tbody>' +
        mostrados.map((p) => "<tr><td><code>" + esc(p.pedidoId) + "</code></td><td>" + dia(p.dataPedido) + '</td><td class="sn-num">' + v(p.faturamento) + '</td><td class="sn-num">' + v(p.comissao) + '</td><td class="sn-num">' + v(p.frete) + '</td><td class="sn-num">' + v(p.custo) + '</td><td class="sn-num">' + v(p.imposto) + '</td><td class="sn-num' + (p.margemValor != null && p.margemValor < 0 ? " is-neg" : "") + '">' + (p.margemValor == null ? v(null) : brl(p.margemValor) + ' <span class="sn-sub">' + pct(p.margemPct) + "</span>") + "</td><td>" + confTag(p.confiabilidade) + "</td></tr>").join("") + "</tbody></table></div>" +
        (ped.length > 8 ? '<button type="button" class="sn-link" id="sn-ped-todos">' + (S.pedTodos ? "Mostrar só os 8 mais recentes" : "Mostrar os " + ped.length + " pedidos") + "</button>" : "") +
        (i.pedidosAfetados > total ? '<p class="sn-nota">O caso tem ' + i.pedidosAfetados + " pedidos; o detalhe traz os " + total + " mais recentes.</p>" : "")
        : '<p class="sn-nota">Nenhum pedido detalhado disponível para este caso.</p>');
  }

  function secAcao(i) {
    const extra = i.tipo === "custo_pendente" && i.chave !== "conta" ? '<p class="sn-nota">Em Bases, o link abre o cliente; procure o anúncio <code>' + esc(i.chave) + "</code> na lista de custos da base dele.</p>" : "";
    return '<p class="sn-acao-lead"><span aria-hidden="true">→</span> ' + esc(i.proximaAcao) + "</p>" + extra + '<div class="sn-acao-links">' + ctxLinks(i) + "</div>";
  }

  function secHistorico(i) {
    const ev = i.eventos || [];
    const form = S.form === "resolver"
      ? '<form id="sn-resolver-form" class="sn-form"><label class="vf-field__label" for="sn-motivo">O que resolveu o caso? <span class="vf-field__required">*</span></label>' +
        '<div class="sn-chips" role="group" aria-label="Motivos frequentes">' + (MOTIVOS[i.tipo] || []).map((m) => '<button type="button" class="sn-chip" data-motivo="' + esc(m) + '">' + esc(m) + "</button>").join("") + "</div>" +
        '<textarea class="vf-textarea" id="sn-motivo" required maxlength="500" rows="2" placeholder="Escolha um motivo acima ou descreva"></textarea>' +
        '<label class="vf-field__label" for="sn-obs">Observação (opcional)</label><textarea class="vf-textarea" id="sn-obs" maxlength="1000" rows="2" placeholder="O que foi feito, por quem, onde"></textarea>' +
        '<p class="sn-nota">Se aparecer pedido novo com o mesmo problema depois da resolução, o Sentinel reabre este caso automaticamente.</p>' +
        '<div class="sn-form__acoes"><button type="submit" class="vf-btn vf-btn--primary">Confirmar resolução</button><button type="button" class="vf-btn vf-btn--ghost" id="sn-resolver-cancel">Cancelar</button></div></form>'
      : "";
    return '<ol class="sn-hist">' + (ev.length ? ev.map((e) => { const t = eventoTxt(e); return '<li class="sn-hist__item sn-hist__item--' + esc(e.evento) + '"><div><strong>' + esc(t.titulo) + '</strong> <span class="sn-sub">' + dt(e.criadoEm) + "</span></div>" + (t.nota ? '<div class="sn-hist__nota">' + esc(t.nota) + "</div>" : "") + "</li>"; }).join("") : '<li class="sn-sub">Sem eventos registrados.</li>') + "</ol>" + form;
  }

  function renderDrawer() {
    const i = S.detalhe;
    $("#sn-drawer-title").textContent = tituloCaso(i);
    $("#sn-drawer-sub").innerHTML = sevTag(i.severidade) + '<span class="sn-case__tipo">' + esc(TIPOS[i.tipo] || i.tipo) + '</span><span class="sn-status sn-status--' + esc(i.status) + '">' + esc(STATUS[i.status]) + '</span><span class="sn-sub">caso #' + esc(i.id) + "</span>";
    $("#sn-drawer-body").innerHTML =
      (S.acaoErro ? '<div class="sn-aviso is-danger" role="alert">' + esc(S.acaoErro) + "</div>" : "") +
      sec(1, "O que aconteceu", secResumo(i)) +
      sec(2, i.tipo === "leitura_atrasada" ? "Estado da leitura" : "Como este número foi calculado", secCalculo(i)) +
      sec(3, "Composição financeira", secComposicao(i)) +
      sec(i.tipo === "leitura_atrasada" ? 3 : 4, "Evidências", secEvidencias(i)) +
      sec(i.tipo === "leitura_atrasada" ? 3 : 5, "O que fazer agora", secAcao(i)) +
      sec(i.tipo === "leitura_atrasada" ? 4 : 6, "Histórico e tratamento", secHistorico(i));
    const encerrado = i.status === "resolvido", podeRec = i.status === "aberto" || i.status === "reaberto";
    $("#sn-drawer-foot").innerHTML = encerrado
      ? '<span class="sn-sub">Caso resolvido. Ele reabre sozinho se o problema voltar.</span>'
      : (S.form ? "" : (podeRec ? '<button type="button" class="vf-btn vf-btn--secondary" id="sn-reconhecer" title="Registra que você viu e está tratando este caso">Reconhecer</button>' : "") + '<button type="button" class="vf-btn vf-btn--primary" id="sn-resolver">Resolver…</button>');
  }

  function urlCaso(id) {
    try { const u = new URL(location.href); if (id == null) u.searchParams.delete("caso"); else u.searchParams.set("caso", id); history.replaceState(null, "", u); } catch (e) { /* sem history */ }
  }

  async function abrirDrawer(id) {
    if (!$("#sn-drawer").classList.contains("is-open")) lastFocus = document.activeElement;
    Object.assign(S, { detalhe: null, form: null, acaoErro: null, pedTodos: false });
    $("#sn-drawer").classList.add("is-open"); $("#sn-backdrop").classList.add("is-open"); $("#sn-drawer").setAttribute("aria-hidden", "false");
    $("#sn-drawer-title").textContent = "Carregando…"; $("#sn-drawer-sub").textContent = ""; $("#sn-drawer-body").innerHTML = '<div class="vf-loading-state"><span class="vf-spinner"></span></div>'; $("#sn-drawer-foot").innerHTML = "";
    $("#sn-drawer-close").focus();
    urlCaso(id);
    try { S.detalhe = await api.incidente(id); renderDrawer(); $("#sn-drawer-body").scrollTop = 0; }
    catch (e) { $("#sn-drawer-title").textContent = "Caso indisponível"; $("#sn-drawer-body").innerHTML = "<p>" + esc(e.status === 404 ? "Caso não encontrado ou fora da sua carteira." : e.message) + "</p>"; }
  }
  function fecharDrawer() {
    if (!$("#sn-drawer").classList.contains("is-open")) return;
    S.detalhe = null;
    $("#sn-drawer").classList.remove("is-open"); $("#sn-backdrop").classList.remove("is-open"); $("#sn-drawer").setAttribute("aria-hidden", "true");
    urlCaso(null);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  async function acao(fn) {
    S.acaoErro = null;
    const id = S.detalhe.id;
    try { await fn(); S.form = null; S.detalhe = await api.incidente(id); }
    catch (e) { S.acaoErro = e.message; }
    if (S.detalhe) renderDrawer();
    carregar(true);
  }
  async function reconhecerNaFila(id) {
    S.filaErro = null; S.ocupadoId = id; render();
    try { await api.reconhecer(id); }
    catch (e) { S.filaErro = "Não foi possível reconhecer o caso: " + e.message; }
    S.ocupadoId = null;
    carregar(true);
  }

  function bind() {
    const map = { "sn-f-squad": "squad", "sn-f-conta": "conta", "sn-f-tipo": "tipo", "sn-f-sev": "severidade", "sn-f-periodo": "periodo" };
    Object.keys(map).forEach((id) => $("#" + id).addEventListener("change", (e) => {
      F[map[id]] = e.target.value;
      if (map[id] === "squad") F.conta = ""; // filtro pai invalida conta incompatível
      carregar(true);
    }));
    let t = null;
    $("#sn-f-busca").addEventListener("input", (e) => { F.busca = e.target.value; clearTimeout(t); t = setTimeout(() => carregar(true), 300); });
    const limpar = () => { Object.assign(F, F0); carregar(true); };
    $("#sn-clear").addEventListener("click", limpar);
    document.addEventListener("change", (e) => { if (e.target.id === "sn-so-meus") { S.soMeus = e.target.checked; render(); } });
    document.addEventListener("click", (e) => {
      const alvo = (sel) => e.target.closest(sel);
      let x;
      if ((x = alvo("[data-tab]"))) { S.aba = x.dataset.tab; render(); if (x.classList.contains("sn-motor__mais")) $("#sn-abas").scrollIntoView({ block: "start", behavior: "smooth" }); return; }
      if ((x = alvo("[data-visao]"))) { S.visao = x.dataset.visao; render(); return; }
      if ((x = alvo("[data-agrupar]"))) { S.agrupar = x.dataset.agrupar; render(); return; }
      if (alvo("[data-limpar]")) return limpar();
      if (alvo("#sn-retry") || alvo("#sn-atualizar")) return carregar(!!S.incidentes);
      if ((x = alvo("[data-alerta-conta]"))) { F.conta = x.dataset.alertaConta; S.aba = "fila"; if (S.detalhe) fecharDrawer(); return carregar(true); }
      if ((x = alvo("[data-reconhecer]"))) return reconhecerNaFila(Number(x.dataset.reconhecer));
      if (alvo("#sn-reconhecer")) return acao(() => api.reconhecer(S.detalhe.id));
      if (alvo("#sn-resolver")) { S.form = "resolver"; renderDrawer(); const m = $("#sn-motivo"); if (m) { m.focus(); m.scrollIntoView({ block: "center" }); } return; }
      if (alvo("#sn-resolver-cancel")) { S.form = null; renderDrawer(); return; }
      if ((x = alvo("[data-motivo]"))) { const m = $("#sn-motivo"); m.value = x.dataset.motivo; m.focus(); return; }
      if (alvo("#sn-ped-todos")) { S.pedTodos = !S.pedTodos; renderDrawer(); return; }
      if ((x = alvo("[data-abrir]"))) return abrirDrawer(x.dataset.abrir);
      const row = alvo("[data-inc]");
      if (row && !alvo("a, button, input, label")) abrirDrawer(row.dataset.inc);
    });
    document.addEventListener("submit", (e) => {
      if (e.target.id !== "sn-resolver-form") return;
      e.preventDefault();
      const motivo = $("#sn-motivo").value.trim(), observacao = $("#sn-obs").value.trim();
      if (!motivo) { S.acaoErro = "Informe o motivo da resolução."; renderDrawer(); return; }
      acao(() => api.resolver(S.detalhe.id, observacao ? { motivo, observacao } : { motivo }));
    });
    document.addEventListener("keydown", (e) => {
      const aberto = $("#sn-drawer").classList.contains("is-open");
      if (e.key === "Escape") fecharDrawer();
      else if (e.key === "Enter" && e.target.matches && e.target.matches("article[data-inc]")) abrirDrawer(e.target.dataset.inc);
      else if (e.key === "Tab" && aberto) { // foco preso no drawer enquanto aberto
        const f = [...$("#sn-drawer").querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex="0"]')].filter((n) => n.offsetParent !== null);
        if (!f.length) return;
        const pri = f[0], ult = f[f.length - 1];
        if (e.shiftKey && document.activeElement === pri) { e.preventDefault(); ult.focus(); }
        else if (!e.shiftKey && document.activeElement === ult) { e.preventDefault(); pri.focus(); }
      }
    });
    $("#sn-drawer-close").addEventListener("click", fecharDrawer);
    $("#sn-backdrop").addEventListener("click", fecharDrawer);
    // Sem timer de polling (as rotas de resumo/saúde varrem pedidos): a tela se atualiza quando
    // a aba volta ao foco com dados velhos, e mostra há quanto tempo foi carregada.
    document.addEventListener("visibilitychange", () => { if (!document.hidden && api && S.carregadoEm && Date.now() - S.carregadoEm > TELA_VELHA_MS && !S.detalhe) carregar(true); });
    setInterval(() => { if (!document.hidden && S.carregadoEm) renderFrescor(); }, 60000);
  }

  function iniciar() {
    api = DEMO ? root.SENTINEL_MOCK.api : criarApi({ base: apiBase(), getToken: () => lsGet(TOKEN_KEY) });
    carregar().then(() => { const c = params.get("caso"); if (c && /^\d+$/.test(c) && !S.erro) abrirDrawer(c); });
  }

  function boot() {
    document.body.classList.toggle("sn-demo", DEMO);
    const cen = params.get("cenario") || "";
    document.querySelectorAll(".sn-cenarios a").forEach((a) => { if (a.dataset.cenario === cen) a.setAttribute("aria-current", "true"); });
    bind();
    if (DEMO) return iniciar();
    if (!lsGet(TOKEN_KEY)) return; // sem token o Shell já está redirecionando p/ o login do Portal
    iniciar();
  }

  if (DEMO) {
    const s = document.createElement("script");
    s.src = "sentinel-mock.js"; s.onload = boot; s.onerror = () => { S.carregando = false; S.erro = "Dados de exemplo indisponíveis."; render(); };
    document.head.appendChild(s);
  } else boot();
})(typeof window !== "undefined" ? window : globalThis);
