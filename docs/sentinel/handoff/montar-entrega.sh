#!/usr/bin/env bash
# Monta o CÓDIGO de entrega do Sentinel num worktree de entrega, a partir dos 3 worktrees existentes.
#   uso: docs/sentinel/handoff/montar-entrega.sh <DESTINO> [--dry-run]
# DESTINO = worktree git LIMPO criado a partir de origin/main (o script não cria branch, não faz commit, não faz push).
# Regras de segurança (aborta, sem copiar nada, se qualquer uma falhar):
#   · DESTINO precisa estar limpo;
#   · arquivo MODIFICADO na origem só é copiado se, no DESTINO, ainda for idêntico à versão-base da origem (main não mexeu nele);
#   · arquivo NOVO só é copiado se NÃO existir no DESTINO.
set -euo pipefail
D=/home/user/Documentos
FABLE="$D/wt-sentinel-fable"; P0="$D/wt-sentinel-promo-audit"; REC="$D/wt-sentinel-recalc"
DEST="${1:?uso: montar-entrega.sh <worktree-de-entrega> [--dry-run]}"; DRY="${2:-}"
git -C "$DEST" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERRO: $DEST não é um worktree git"; exit 2; }
[ -z "$(git -C "$DEST" status --porcelain)" ] || { echo "ERRO: $DEST não está limpo"; exit 2; }
for w in "$FABLE" "$P0" "$REC"; do [ -d "$w" ] || { echo "ERRO: worktree ausente: $w"; exit 2; }; done

PLANO=()   # origem|arquivo|tipo(M/N)
add() { local src="$1" tipo="$2"; shift 2; for f in "$@"; do PLANO+=("$src|$f|$tipo"); done; }

# 1) Fable — interface nova (base visual; vence qualquer outra alteração em Portal/sentinel.*)
add "$FABLE" M Portal/sentinel.html Portal/sentinel.js Portal/sentinel.css Portal/sentinel-mock.js Portal/sentinel-ui.test.js
add "$FABLE" N docs/sentinel/discovery/01_MAPA_ATUAL.md docs/sentinel/discovery/02_OPORTUNIDADES.md docs/sentinel/discovery/03_BRIEF_FABLE.md docs/sentinel/discovery/04_CONTRATO_AVISOS.md
# 2) P0 — evidência financeira (modo sombra; flag SENTINEL_EVIDENCIA_PROMO_ENABLED desligada)
add "$P0" M server/services/sentinel/sentinelPedidoService.js server/services/sentinel/sentinelSchema.js
add "$P0" N server/services/sentinel/sentinelEvidenciaFinanceira.js server/services/sentinel/sentinelEvidenciaCobertura.js \
  server/sql/migrations/20261117_sentinel_evidencia_financeira.sql \
  server/tests/sentinelEvidenciaFinanceira.test.js server/tests/sentinelEvidenciaIntegracao.test.js server/tests/sentinelEvidenciaCobertura.test.js server/tests/sentinelEvidencia.postgres.cjs \
  docs/sentinel/EVIDENCIA_FINANCEIRA_CONTRATO_V1.md docs/sentinel/PRECISAO_PROMOCIONAL_DIAGNOSTICO.md docs/sentinel/REVISAO_ARQUITETURAL_PRECISAO_PROMOCIONAL.md
# 3) Hotfix — recálculo por base de custos (flag SENTINEL_RECALC_BASE_ENABLED desligada; exige SENTINEL_RECALC_DESDE)
#    NÃO copia Portal/sentinel.js nem Portal/sentinel-ui.test.js do hotfix: substituídos pela interface do Fable (que já trata condicaoAtiva).
add "$REC" M server/services/sentinel/sentinelIncidentes.js server/services/sentinel/sentinelPollingWorker.js
add "$REC" N server/services/sentinel/sentinelRecalculoBase.js server/sql/migrations/20261118_sentinel_recalculo_base.sql \
  server/tests/sentinelRecalculoBase.test.js server/tests/sentinelRecalculoBase.postgres.cjs \
  docs/sentinel/RECALCULO_BASE_CUSTOS.md docs/sentinel/HANDOFF_ENTREGA.md docs/sentinel/handoff/montar-entrega.sh

# validação ANTES de copiar qualquer coisa
erros=0
for item in "${PLANO[@]}"; do
  IFS='|' read -r src f tipo <<<"$item"
  [ -f "$src/$f" ] || { echo "ERRO: não existe na origem: $src/$f"; erros=$((erros+1)); continue; }
  if [ "$tipo" = "M" ]; then
    if ! diff -q <(git -C "$src" show "HEAD:$f") "$DEST/$f" >/dev/null 2>&1; then echo "CONFLITO: $f mudou na main desde a base de $(basename "$src"); integrar à mão (merge de 3 vias)"; erros=$((erros+1)); fi
  else
    [ ! -e "$DEST/$f" ] || { echo "CONFLITO: $f já existe no destino"; erros=$((erros+1)); }
  fi
done
[ "$erros" -eq 0 ] || { echo "ABORTADO: $erros problema(s); nada foi copiado."; exit 3; }

echo "plano validado: ${#PLANO[@]} arquivo(s)"
[ "$DRY" = "--dry-run" ] && { printf '  %s\n' "${PLANO[@]%%|*}" >/dev/null; echo "(dry-run: nada copiado)"; exit 0; }
for item in "${PLANO[@]}"; do
  IFS='|' read -r src f tipo <<<"$item"
  mkdir -p "$DEST/$(dirname "$f")"; cp -p "$src/$f" "$DEST/$f"
done
git -C "$DEST" status --short
