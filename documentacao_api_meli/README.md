# Documentação oficial da API do Mercado Livre — snapshot de referência

Cópia local da documentação pública de desenvolvedores do Mercado Livre
(<https://developers.mercadolivre.com.br>), capturada em **15/09/2026**.
149 arquivos `.md`, ~3,7 MB, somente texto.

## Para que serve

É a **base de evidência** das auditorias deste repositório: quando um
documento afirma uma regra do Mercado Livre, ele cita o arquivo e a seção daqui
em vez de descrever a API de memória. Sem o snapshot as citações não são
verificáveis.

Auditorias que dependem desta pasta:

- `docs/AUDITORIA_ANUNCIOS_ML_LISTAGEM_UNIFICADA.md` — hierarquia
  `family_id` → `user_product_id` → `item_id`, e a regra de estoque que decide
  a soma do agrupador. Fontes principais: `user-products.md`,
  `estoque-distribuido.md`, `preco-variacao.md`, `variacoes.md`.

## Regras de uso

**Somente leitura.** Não editar, não corrigir, não traduzir: o valor do
snapshot é ser fiel ao que o Mercado Livre publicou naquela data. Se a API
mudar, capture um snapshot novo e datado — não emende este, ou as citações das
auditorias passam a apontar para um texto que nunca existiu.

**Não é fonte de verdade sobre o comportamento atual da API.** É uma foto. Para
qualquer decisão nova, conferir a documentação online; divergência entre o
snapshot e o site significa que a API mudou depois de 15/09/2026.

## Conteúdo

Só documentação técnica pública: descrição de recursos, campos, exemplos de
`curl` e de payload. Os tokens que aparecem nos exemplos
(`APP_USR-12345678-…`, `TG-…`) são os placeholders da própria documentação do
Mercado Livre — **nenhuma credencial real, nenhum dado de cliente, nenhum dado
do VenForce**. Verificado por varredura antes de entrar no repositório.
