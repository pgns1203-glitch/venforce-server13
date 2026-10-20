#!/usr/bin/env bash
# Publica, troca ou reverte o release do gateway no Droplet. Rodar com sudo.
#
#   sudo bash release.sh deploy   <sha> /opt/shopee-gateway/incoming/shopee-gateway-<sha>.tar.gz
#   sudo bash release.sh rollback            # volta para o release anterior
#   sudo bash release.sh status
#
# deploy: extrai em releases/<sha>, roda os testes ali, instala a unit systemd,
# troca o symlink `current`, reinicia e confere /health. Se /health falhar,
# volta sozinho para o release anterior.
set -euo pipefail

APP_DIR="/opt/shopee-gateway"
UNIT="/etc/systemd/system/shopee-gateway.service"
HEALTH="http://127.0.0.1:8787/health"
[ "$(id -u)" -eq 0 ] || { echo "rode com sudo"; exit 1; }

current_target() { readlink -f "${APP_DIR}/current" 2>/dev/null || true; }

health_ok() {
  for _ in $(seq 1 15); do
    if curl -fsS --max-time 2 "${HEALTH}" | grep -q '"ok":true'; then return 0; fi
    sleep 1
  done
  return 1
}

switch_to() {
  ln -sfn "$1" "${APP_DIR}/current.tmp"
  mv -T "${APP_DIR}/current.tmp" "${APP_DIR}/current"
  systemctl restart shopee-gateway
}

case "${1:-}" in
  deploy)
    SHA="${2:?sha}"
    TARBALL="${3:?tarball}"
    [[ "${SHA}" =~ ^[0-9a-f]{7,40}$ ]] || { echo "sha inválido"; exit 1; }
    DEST="${APP_DIR}/releases/${SHA}"
    PREV="$(current_target)"
    rm -rf "${DEST}.tmp"
    install -d "${DEST}.tmp"
    tar -xzf "${TARBALL}" -C "${DEST}.tmp" --strip-components=1
    [ -f "${DEST}.tmp/src/server.js" ] || { echo "tarball não contém shopee-gateway/src/server.js"; exit 1; }
    (cd "${DEST}.tmp" && node --test >/dev/null) || { echo "testes falharam no release ${SHA}; nada trocado"; exit 1; }
    rm -rf "${DEST}"
    mv "${DEST}.tmp" "${DEST}"
    chown -R root:root "${DEST}"
    chmod -R a+rX,go-w "${DEST}"
    install -m 0644 "${DEST}/deploy/shopee-gateway.service.example" "${UNIT}"
    systemctl daemon-reload
    systemctl enable shopee-gateway >/dev/null 2>&1
    switch_to "${DEST}"
    if health_ok; then
      echo "OK: release ${SHA} no ar (anterior: ${PREV:-nenhum})"
    else
      echo "FALHA: /health não respondeu no release ${SHA}"
      journalctl -u shopee-gateway -n 30 --no-pager || true
      if [ -n "${PREV}" ] && [ -d "${PREV}" ]; then
        switch_to "${PREV}"
        health_ok && echo "revertido para ${PREV}" || echo "ATENÇÃO: anterior também não respondeu"
      fi
      exit 1
    fi
    # mantém os 5 releases mais recentes
    ls -1dt "${APP_DIR}"/releases/*/ | tail -n +6 | while read -r old; do
      [ "$(readlink -f "${old}")" = "$(current_target)" ] || rm -rf "${old}"
    done
    ;;
  rollback)
    CUR="$(current_target)"
    PREV="$(ls -1dt "${APP_DIR}"/releases/*/ | sed 's#/$##' | grep -vx "${CUR}" | head -n 1 || true)"
    [ -n "${PREV}" ] || { echo "não há release anterior"; exit 1; }
    switch_to "${PREV}"
    health_ok && echo "OK: rollback para ${PREV}" || { echo "FALHA no rollback"; exit 1; }
    ;;
  status)
    echo "current -> $(current_target)"
    ls -1dt "${APP_DIR}"/releases/*/ 2>/dev/null || true
    systemctl --no-pager --lines=0 status shopee-gateway || true
    curl -fsS --max-time 2 "${HEALTH}" && echo
    ;;
  *)
    echo "uso: release.sh deploy <sha> <tarball> | rollback | status"; exit 1 ;;
esac
