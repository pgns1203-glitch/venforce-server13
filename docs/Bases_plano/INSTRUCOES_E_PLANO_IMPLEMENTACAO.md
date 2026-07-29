# Instruções e Plano de Implementação — Frontend VenForce

> Documento mestre de execução. Consolida a auditoria (`AUDITORIA_UX_UI_PORTAL.md`), a fundação (`DESIGN_SYSTEM_FUNDACAO.md`) e o plano em fases (`PLANO_IMPLEMENTACAO.md`) em um guia único de trabalho.
> Complementar: `IMPLEMENTACAO_TELA_BASES_PASSO_A_PASSO.md` (execução detalhada da tela piloto).
> Gerado em 2026-07-06.

---

## 1. Decisão estratégica: ordem de execução

A auditoria propõe Fase 1 = tokens globais primeiro. A prioridade de produto é a tela Bases. **Resolução: Bases V1 é o piloto do design system.**

Ordem oficial:

```txt
1. Bases V1        → tela piloto, CSS escopado usando os VALORES finais dos tokens
2. Fase 1 global   → vf-tokens.css + vf-components.css em todas as telas
3. Fase 2          → varredura mecânica de componentes (botões, campos, modais, tabelas)
4. Fase 3          → estrutura de página nas telas mais usadas
5. Fase 4          → refinamento de UX operacional
```

Por que Bases antes da fundação global:

- Valida o design system em uma tela real e complexa antes de espalhar.
- Entrega valor operacional imediato (prioridade do negócio).
- O CSS escopado de Bases usa os **mesmos valores** de `DESIGN_SYSTEM_FUNDACAO.md`; quando `vf-tokens.css` nascer, a migração é troca de `--bases-*` por `--vf-*` (find/replace), não redesign.

Regra de ouro do piloto: **nenhum valor visual inventado**. Toda cor, radius, fonte e espaçamento vem da seção 4 da fundação.

---

## 2. Fonte única de verdade visual

Extraído de `DESIGN_SYSTEM_FUNDACAO.md` — qualquer implementação usa exatamente estes valores:

### Cores

```css
--vf-primary:        #5a2a8f;   /* único roxo */
--vf-primary-hover:  #4a2178;   /* hover escurece, nunca clareia */
--vf-primary-soft:   #f4eef9;
--vf-primary-border: #e2d5f2;

--vf-bg:        #f7f8fb;   --vf-bg-2:      #eef0f6;
--vf-surface:   #ffffff;   --vf-surface-2: #fbfbfe;
--vf-text:      #1b1d28;   --vf-text-m:    #5a6072;   --vf-text-l: #969cad;
--vf-border:    #e7e9f0;   --vf-border-strong: #d6d9e4;

--vf-success: #0f7a52;  --vf-success-bg: #e7f6ef;
--vf-warning: #b25e00;  --vf-warning-bg: #fdf1e3;
--vf-danger:  #c62828;  --vf-danger-bg:  #fdecec;
--vf-info:    #1d5fb8;  --vf-info-bg:    #e8f1fc;
```

### Tipografia

Inter (texto) + IBM Plex Mono (números de tabela, IDs, valores monetários).
Escala: 11 / 12.5 / 14 / 15 / 18 / 22 / ~26px (`--vf-fs-2xs` … `--vf-fs-kpi`).
Números sempre `font-variant-numeric: tabular-nums`.

### Forma e espaço

- Radius: **6px** (controles) / **10px** (cards, tabelas) / **12px** (modais) / pill 999px **somente** status binário.
- Spacing: escala de 4px (`--vf-sp-1` a `--vf-sp-10`). Padding de card 20px, célula de tabela `10px 14px`, gap entre seções 32px.
- Separação por **borda 1px**, não sombra. Sombra só em hover de card clicável e modal/popover.
- Largura de conteúdo: 1200px (gestão) ou 1560px (telas densas). Nada fora dessas duas.

### Regras de componente (resumo operacional)

| Componente | Regra |
|---|---|
| Botão | 1 primary por bloco; secondary = branco+borda; ghost p/ tabela; `--sm` em toolbar/célula |
| Campo | anatomia `.vf-field` (label 12.5px/600 + controle 38px + hint); alinhamento por classe, nunca inline |
| Card | header com borda inferior + body sp-5; sem gradiente |
| Badge | tag com dot + fundo semântico, radius-sm; texto sempre, nunca só cor |
| Tabela | thead sticky uppercase 11px; `.num` à direita tabular-nums; severidade por **fundo de linha** |
| Toolbar | filtros à esquerda, ações de API à direita — nunca misturados |
| KPI | label uppercase + valor tabular + foot; tooltip com definição |
| Estados | empty/loading/error com componentes únicos; transição com fade, nunca `display:none` seco |

### Padrão de página (toda tela interna)

```txt
1. Page header    → kicker + h1 + descrição 1 linha + ações da TELA à direita
2. Toolbar        → filtros globais | chips de filtro ativo
3. Barra de dados → ● origem + idade + [Atualizar]   (todo dado de API)
4. KPIs           → 1 linha, 3–6 indicadores
5. Blocos         → agregado antes de detalhe
6. Tabelas        → toolbar local + sticky + pager
7. Rodapé/status  → exibidos vs. total
```

---

## 3. Regras invioláveis (todas as fases)

```txt
NUNCA alterar layout.js, sidebar, topbar sem tarefa dedicada e aprovada
NUNCA remover/renomear IDs consumidos pelos .js de tela
NUNCA tocar chamadas de API, cálculos ou fluxo de dados em tarefa visual
NUNCA misturar redesign visual com feature de backend na mesma rodada
NUNCA aplicar mudança em produção sem preview aprovado
NUNCA renomear classes existentes — camada nova é aditiva, migração por tela
NUNCA usar estilo inline novo — todo estilo novo vai para CSS escopado
```

Áreas sensíveis que exigem conversa antes: `style.css` global, extensão Chrome, API pública `/api/bases/:baseSlug`, slug de base, cálculos financeiros.

---

## 4. Fluxo de trabalho por tarefa

Toda tarefa visual segue o mesmo ciclo:

```txt
1. Preview estático (docs/previews/) → aprovar aparência
2. Branch dedicada                   → feat/<tela>-<escopo>
3. Implementação por etapa pequena   → 1 commit = 1 preocupação
4. Teste manual com checklist        → da tela + telas vizinhas
5. Merge só com tudo verde
```

Git:

```bash
git checkout main && git pull origin main
git checkout -b feat/bases-central-v1
# trabalho...
git add <arquivos específicos>        # nunca git add .
git commit -m "feat(bases): <etapa>"
git push origin feat/bases-central-v1
```

Rollback planejado: cada etapa deve ser revertível com `git revert` de 1 commit ou remoção de 1 `<link>`.

---

## 5. Plano por fase (com critérios de aceite)

### Fase 0 — Bases V1 (piloto) ← ATUAL

Escopo, etapas e passo a passo completo: ver `IMPLEMENTACAO_TELA_BASES_PASSO_A_PASSO.md`.

**Aceite:** tela Bases no padrão de página, com consulta de custos e ajuste manual funcionando, zero regressão nos fluxos atuais (importar, vincular, excluir, baixar), IDs preservados, nenhum arquivo global alterado.

### Fase 1 — Fundação global

1. Criar `Portal/css/vf-tokens.css` — os valores acima, agora como fonte oficial.
2. Criar `Portal/css/vf-components.css` — componentes do v2 consolidados + aliases de compatibilidade (`.vf-btn-primary` herda de `.vf-btn--primary`).
3. Adicionar os dois `<link>` depois de `style.css` em **todas** as telas internas; onde houver `venforce-ui-v2.css`, substituir.
4. Migrar `bases.css` (do piloto) para consumir `--vf-*` em vez de variáveis locais.
5. Ajuste pontual em `style.css`: gradiente do logo `#7c3aed` → token; `--vf-primary-hover` → `#4a2178`.

**Aceite:** 24 telas internas com mesmo fundo, texto, roxo e cantos; zero regressão funcional. Rollback = remover `<link>`.

### Fase 2 — Varredura de componentes

Ordem (menor risco → maior): scans → callbacks → atividade → ml-tokens → usuarios → clientes → ads → metricas → relatorios → automacoes → promocoes-retorno. (Bases já estará pronta.)

Por tela: botões → família única; campos → `.vf-field`; modais → shell único; tabelas → `.vf-table` sticky + `.num`; estados → `.vf-empty`/`.vf-skel`; remover Bootstrap do `<head>`.

**Aceite por tela:** screenshot antes/depois, checklist funcional da tela, nenhum listener/ID alterado.

### Fase 3 — Estrutura das telas core

Ordem por impacto: fechamentos-api → dashboard → cliente-360 → financeiro → fechamento.
Inclui: barra de estado dos dados, separação filtro × sincronização, migração dos temas escuros para claro com CSS extraído para `Portal/css/pages/`.

### Fase 4 — Refinamento

Barra de dados em todas as telas de API, microcopy e tooltips de KPI, guard rails de fluxo, navegação por grupos de trabalho (só `NAV_GROUPS`), acessibilidade (`role="dialog"`, `aria-live`, status com texto), event delegation.

---

## 6. Definição de pronto (qualquer entrega visual)

- [ ] Usa somente valores da fonte única (seção 2)
- [ ] Zero estilo inline novo; zero classe renomeada
- [ ] IDs consumidos por JS intactos
- [ ] Estados vazio / loading / erro / "filtro sem resultado" presentes
- [ ] Números em tabular-nums, alinhados à direita
- [ ] Status com texto + cor (nunca só cor)
- [ ] Testada em 1366px e mobile; thead sticky funcionando
- [ ] Telas vizinhas verificadas (sem vazamento de CSS)
- [ ] Commit pequeno, branch dedicada, rollback de 1 passo
