# Cliente 360 DevUI

DevUI estatica e read-only para inspecao tecnica do payload real do Cliente 360.

Esta pagina nao faz parte da navegacao oficial do portal e nao deve ser linkada em menu, sidebar, topbar, dashboard ou qualquer tela de produto.

## Acesso por URL direta

Esta DevUI não é adicionada ao menu oficial do portal.

Ela deve ser acessada manualmente por URL direta:

`/dev-ui/cliente360.html`

ou conforme o ambiente estático do projeto:

`Portal/dev-ui/cliente360.html`

Ela possui bloqueio client-side para ADM usando `vf-user` do localStorage.

Esse bloqueio evita uso acidental, mas não substitui proteção server-side.

Não expor publicamente sem autenticação real.

## Arquivos

```txt
Portal/dev-ui/cliente360.html
Portal/dev-ui/cliente360.js
Portal/dev-ui/cliente360.css
Portal/dev-ui/README.md
```

## Regras

- Somente GET.
- Sem sync.
- Sem escrita.
- Sem alteracao de backend.
- Sem link no portal oficial.
- Sem dependencia de `Portal/layout.js`.
- Sem dependencia de `Portal/cliente-360.js`.
- Sem dependencia de `Portal/cliente-360.css`.

## Roles ADM aceitas

```txt
adm
admin
administrator
```

## Endpoints usados

```txt
GET /operacao/cliente-360/clientes
GET /operacao/cliente-360/:slug
GET /operacao/cliente-360/:slug?competencia=YYYY-MM
```

## Bloqueio client-side

Antes de qualquer chamada API, `cliente360.js` valida:

1. `vf-token` no localStorage.
2. `vf-user` no localStorage.
3. role do usuario.

Sem token, mostra:

```txt
Você precisa estar logado para acessar esta DevUI.
```

Com token, mas sem role ADM, mostra:

```txt
Acesso restrito a administradores.
Esta DevUI é interna e só pode ser usada por ADM.
```
