# Auditoria de Frontend — Portal VenForce

> Gerada em 2026-07-02. Auditoria completa de UX/UI, **sem nenhuma alteração de código**.
> Escopo: `Portal/*.html`, `Portal/*.js`, `Portal/*.css`, `layout.js`, `style.css`.

## Arquivos desta auditoria

| Arquivo | Conteúdo |
|---|---|
| [AUDITORIA_UX_UI_PORTAL.md](AUDITORIA_UX_UI_PORTAL.md) | Mapa das telas + problemas visuais + problemas de UX (seções 1–3) |
| [DESIGN_SYSTEM_FUNDACAO.md](DESIGN_SYSTEM_FUNDACAO.md) | Design system proposto + padrão ideal de página (seções 4–5) |
| [PLANO_IMPLEMENTACAO.md](PLANO_IMPLEMENTACAO.md) | Prioridades + plano em 4 fases + arquivos a criar/reorganizar (seções 6–7) |

## Diagnóstico em uma frase

O portal parece inconsistente porque **roda pelo menos 4 gerações visuais ao mesmo tempo**:

1. **v1** — `style.css` (5.926 linhas): a maioria das ~24 telas internas.
2. **v2** — `venforce-ui-v2.css`: carregado em apenas **5 telas** (`dashboard`, `cliente-360`, `cliente-operacao`, `fechamentos-api`, `clickup-executivo`) e que **redefine os tokens raiz** (`--vf-bg`, `--vf-text`, `--vf-radius`...) — essas 5 telas têm cores, radius e tipografia levemente diferentes de todas as outras.
3. **Tema escuro `.fc-`** — `fechamento.html` (~770 linhas de CSS dentro do HTML) e `financeiro.html` (~1.370 linhas dentro do HTML): visual escuro com gradientes, oposto ao resto do portal.
4. **Ilhas independentes** — `anuncios-meli.css` (`.am-`), `control-center.css` (`.vfc-`, dark), `seller.css` (`.sl-`), `relatorio-publico.css` (`.rp-`), `guia-vendedor.html` (~770 linhas inline, editorial serif).

No total existem **~12 prefixos de componente** (`vf-`, `fapi-`, `fc-`, `am-`, `vfc-`, `sl-`, `rp-`, `gv-`, `c360-`, `vfop-`, `vu-`, `ads-`...), **5 tons de roxo primário**, **10 valores de border-radius**, **nenhum token de font-size ou spacing**, e Bootstrap 5.3.3 carregado sem ser usado.

## Boa notícia

Já existe uma direção de design definida e parcialmente implementada (`_frontend-redesign-reference/` + `Portal/venforce-ui-v2.css` com 40+ componentes prontos: KPI, tags, banners, skeletons, empty states, segmented control). **Não é preciso inventar um design system novo — é preciso consolidar o v2 como fonte única, ajustar os tokens ao gosto atual (menos arredondado, roxo mais discreto) e migrar tela a tela.**
