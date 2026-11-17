# Sentinel — Contrato técnico de avisos (proposta para missão posterior)

Status: **PROPOSTA**. Nada aqui existe no backend em `b0ada21d`. A Central de ações (`Portal/sentinel.*`) não simula nenhum destes dados: hoje ela mostra "Ninguém reconheceu ainda" ou "Em tratamento por X", que vêm de `reconhecido_por` (campo real).

## 1. Princípio
Fonte única: `sentinel_incidente_eventos`. O aviso é derivado de um evento, gravado **na mesma transação** que o evento. Não há segundo detector nem segunda fila.

## 2. Tabela `sentinel_avisos` (aditiva)
| Coluna | Regra |
|---|---|
| `id` | bigserial |
| `incidente_id`, `evento_id` | FK; o evento que originou o aviso |
| `user_id` | destinatário (FK de usuário), congelado no momento da geração |
| `origem_roteamento` | `gestor` \| `coordenador` \| `admin_fallback` |
| `motivo` | `aberto` \| `agravado` \| `reaberto` \| `escalado` |
| `severidade` | severidade do incidente naquele evento |
| `chave_dedupe` | UNIQUE: `incidente_id + user_id + motivo + severidade + vezes_reaberto` |
| `criado_em`, `exibido_em`, `aberto_em` | carimbos; nulos até acontecer |
| `escalado_de` | aviso anterior, quando `motivo = escalado` |

"Reconhecido" e "resolvido" **não** são colunas: continuam sendo o estado do incidente.

## 3. Quando gerar
- Evento `aberto` ou `reaberto`, ou `atualizado` em que a severidade **subiu**.
- Somente severidade `critica`/`alta` e confiabilidade `calculado`, `confirmado` ou `operacional`. O resto fica na fila, sem aviso.
- Nunca por pedido. Reavaliação sem mudança de evidência não gera evento, logo não gera aviso.
- `custo_pendente`: um aviso por conta (não por anúncio). Exige regra de agrupamento a definir.

## 4. Destinatário
1. Gestor ativo do cliente em `cliente_responsaveis`.
2. Sem gestor: coordenador do Squad ativo do cliente. **HIPÓTESE A VALIDAR:** como o coordenador é identificado em `squad_members`; não verifiquei o campo.
3. Sem ninguém: admins, com `origem_roteamento = admin_fallback`.

Responsabilidade não é autorização: o destinatário precisa passar por `sentinelAcesso` para aquela conta; se não passar, cai no próximo nível.

## 5. API (escopo sempre `req.user.id`; a query nunca informa usuário)
- `GET /sentinel/avisos?estado=pendentes` → avisos do usuário cujo incidente não está reconhecido nem resolvido. O servidor grava `exibido_em` ao responder.
- `GET /sentinel/avisos/contagem` → `{ pendentes, criticos }`, barato, para a superfície escolhida (card na tela inicial ou contador no Shell).
- `POST /sentinel/avisos/:id/aberto` → grava `aberto_em`. Chamado quando o caso é aberto a partir do aviso.
- DTO de incidente ganha `responsavel: { userId, nome, origem } | null`.

Estados: gerado → exibido → aberto → (incidente) reconhecido. **Exibido não é lido**: significa só que o servidor entregou o item àquele usuário.

## 6. Escalonamento
Tick fora do worker (o mesmo processo do vigia): aviso `critica` sem reconhecimento depois do prazo gera novo aviso `escalado` ao nível seguinte. Prazo é decisão de produto pendente.

## 7. O que a tela já tem pronto
- Link direto `sentinel.html?caso=<id>` abre o diagnóstico (implementado); é o destino do aviso.
- Filtro "só os que eu reconheci" usa o ator real `Nome (#id)`. Com `responsavel` no DTO, a visão "Precisa de ação" ganha o recorte "atribuídos a mim" sem mudar de layout.

## 8. Outras dependências de backend vistas na Central
- Título do anúncio no DTO (hoje só há MLB e SKU).
- `status` aceitar lista em `GET /incidentes` (o serviço aceita; o controller valida valor único) e contagem por status, para não depender do teto de 200 itens.
- Duração do atraso em `leitura_atrasada` vem congelada no título; a tela usa `/contas` ao vivo.

## 9. Aceite mínimo
Mesmo evento reprocessado não duplica aviso; troca de gestor não reescreve avisos antigos; usuário sem carteira nunca recebe; conta desativada não gera aviso; aviso some dos pendentes ao reconhecer; teste de isolamento entre Squads.
