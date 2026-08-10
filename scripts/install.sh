#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${FOSSILSAFE_INSTALL_DIR:-/opt/fossilsafe}"
CONFIG_PATH="${FOSSILSAFE_CONFIG_PATH:-/etc/fossilsafe/config.json}"
DATA_DIR="${FOSSILSAFE_DATA_DIR:-/var/lib/fossilsafe}"
STATE_PATH="${FOSSILSAFE_STATE_PATH:-${DATA_DIR}/state.json}"
DB_PATH="${FOSSILSAFE_DB_PATH:-${DATA_DIR}/lto_backup.db}"
CREDENTIAL_KEY_PATH="${FOSSILSAFE_CREDENTIAL_KEY_PATH:-${DATA_DIR}/credential_key.bin}"
CATALOG_BACKUP_DIR="${FOSSILSAFE_CATALOG_BACKUP_DIR:-${DATA_DIR}/catalog-backups}"
STAGING_DIR="${DATA_DIR}/staging"
UI_PORT="${FOSSILSAFE_UI_PORT:-443}"
BACKEND_PORT="${FOSSILSAFE_BACKEND_PORT:-5000}"
BACKEND_BIND="${FOSSILSAFE_BACKEND_BIND:-127.0.0.1}"
DOMAIN="${FOSSILSAFE_DOMAIN:-fossilsafe.local}"
EMAIL="${FOSSILSAFE_EMAIL:-}"
HEADLESS="${FOSSILSAFE_HEADLESS:-0}"
UI_BUILD_LOG_DIR="${FOSSILSAFE_LOG_DIR:-/var/log/fossilsafe}"
UI_BUILD_LOG="${UI_BUILD_LOG_DIR}/install-frontend.log"
SERVICE_USER="${FOSSILSAFE_SERVICE_USER:-fossilsafe}"
VENV_DIR="${FOSSILSAFE_VENV_DIR:-${INSTALL_DIR}/venv}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="${SOURCE_ROOT}"
STEP_TOTAL=12
CURRENT_STEP=""
CURRENT_CAUSE=""
CURRENT_NEXT=""
CURRENT_COMMAND=""
LAST_CMD=""
IN_EXIT_HANDLER=0
API_KEY_SOURCE="generated"
API_KEY=""
FAILED=0
FAIL_STEP=""
FAIL_CMD=""
FAIL_CODE=0
SKIP_SUMMARY=0
SUMMARY_PRINTED=0
APT_UPDATED=0
HAVE_SYSTEMD=1
SERVICE_HEALTHY=0
HW_TAPE_NODES="unknown"
HW_SG_NODES="unknown"
HW_VENDOR_STRINGS="unknown"
HW_CHANGER_STATUS="unknown"
FUSE_DEVICE_STATUS="unknown"
FUSERMOUNT_STATUS="unknown"
LTFS_STATUS="unknown"
LTFS_MISSING_TOOLS=""
LTFS_BUILD_LOG=""
LTFS_REF_USED=""
LTFS_PREFIX=""
CHANGER_REQUIRED=0
CONFIGURED_CHANGER_PATH=""
INSTALL_MODE=""
INSTALL_MODE_SET=0
NON_INTERACTIVE=0
YES_PROVIDED=0
SELF_TEST=0
BACKEND_PORT_SET=0
UI_PORT_SET=0
BACKEND_BIND_SET=0
DB_PATH_SET=0
HEADLESS_SET=0
SECURE_MODE="relaxed"
SECURE_MODE_SET=0
EXISTING_INSTALL=0
EXISTING_REASONS=()
EXISTING_BACKEND_PIDS=()
REBUILD_VENV=0
RESET_INSTALL_DIR=0
PURGE_PERFORMED=0
# System sanity checks
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

if [[ -n "${FOSSILSAFE_BACKEND_PORT+x}" ]]; then
  BACKEND_PORT_SET=1
fi
if [[ -n "${FOSSILSAFE_UI_PORT+x}" ]]; then
  UI_PORT_SET=1
fi
if [[ -n "${FOSSILSAFE_BACKEND_BIND+x}" ]]; then
  BACKEND_BIND_SET=1
fi
if [[ -n "${FOSSILSAFE_DB_PATH+x}" ]]; then
  DB_PATH_SET=1
fi
if [[ -n "${FOSSILSAFE_HEADLESS+x}" ]]; then
  HEADLESS_SET=1
fi

USE_COLOR=0
USE_UTF8=0
if [[ -t 1 ]]; then
  USE_COLOR=1
  if [[ "${FOSSILSAFE_FORCE_ASCII:-0}" == "1" ]]; then
    USE_UTF8=0
  elif [[ "${FOSSILSAFE_FORCE_UTF8:-0}" == "1" ]]; then
    USE_UTF8=1
  else
    TERM_NAME="${TERM:-}"
    if [[ -n "${TERM_NAME}" && "${TERM_NAME}" != "dumb" && "${TERM_NAME}" != "linux" ]]; then
      if command -v locale >/dev/null 2>&1; then
        if locale charmap 2>/dev/null | grep -qi 'utf-8'; then
          USE_UTF8=1
        fi
      elif [[ "${LANG:-}" == *UTF-8* ]] || [[ "${LC_ALL:-}" == *UTF-8* ]] || [[ "${LC_CTYPE:-}" == *UTF-8* ]]; then
        USE_UTF8=1
      fi
    fi
  fi
fi

if [[ "${USE_COLOR}" -eq 1 ]]; then
  COLOR_RESET=$'\033[0m'
  COLOR_BLUE=$'\033[0;34m'
  COLOR_GREEN=$'\033[0;32m'
  COLOR_YELLOW=$'\033[0;33m'
  COLOR_RED=$'\033[0;31m'
  COLOR_BOLD=$'\033[1m'
else
  COLOR_RESET=""
  COLOR_BLUE=""
  COLOR_GREEN=""
  COLOR_YELLOW=""
  COLOR_RED=""
  COLOR_BOLD=""
fi

if [[ "${USE_UTF8}" -eq 1 ]]; then
  SYMBOL_OK="✅"
  SYMBOL_WARN="⚠️"
  SYMBOL_ERR="❌"
  SYMBOL_INFO="•"
  BOX_TL="┌"
  BOX_TR="┐"
  BOX_BL="└"
  BOX_BR="┘"
  BOX_H="─"
  BOX_V="│"
else
  SYMBOL_OK="[OK]"
  SYMBOL_WARN="[WARN]"
  SYMBOL_ERR="[ERROR]"
  SYMBOL_INFO="*"
  BOX_TL="+"
  BOX_TR="+"
  BOX_BL="+"
  BOX_BR="+"
  BOX_H="-"
  BOX_V="|"
fi

repeat_char() {
  local count="$1"
  local char="$2"
  printf "%*s" "${count}" "" | tr ' ' "${char}"
}

info() {
  printf "%b%s%b\n" "${COLOR_BLUE}" "$1" "${COLOR_RESET}"
}

ok() {
  printf "%b%s %s%b\n" "${COLOR_GREEN}" "${SYMBOL_OK}" "$1" "${COLOR_RESET}"
}

warn() {
  printf "%b%s %s%b\n" "${COLOR_YELLOW}" "${SYMBOL_WARN}" "$1" "${COLOR_RESET}"
}

err() {
  printf "%b%s %s%b\n" "${COLOR_RED}" "${SYMBOL_ERR}" "$1" "${COLOR_RESET}"
}

step_header() {
  local step="$1"
  local description="$2"
  local explanation="$3"
  local cause="$4"
  local next="$5"
  local header_width=80
  local header_inner=$((header_width - 2))
  local header_border
  CURRENT_STEP="${step}"
  CURRENT_CAUSE="${cause}"
  CURRENT_NEXT="${next}"
  header_border="$(repeat_char "${header_inner}" "${BOX_H}")"
  echo ""
  echo "${BOX_TL}${header_border}${BOX_TR}"
  printf "%s %-76s %s\n" "${BOX_V}" "${COLOR_BOLD}${step} ${description}${COLOR_RESET}" "${BOX_V}"
  printf "%s %-76s %s\n" "${BOX_V}" "${SYMBOL_INFO} ${explanation}" "${BOX_V}"
  echo "${BOX_BL}${header_border}${BOX_BR}"
}

record_failure() {
  FAILED=1
  FAIL_STEP="${CURRENT_STEP:-unknown}"
  FAIL_CMD="${1:-${LAST_CMD:-unknown}}"
  FAIL_CODE="${2:-1}"
}

print_summary() {
  local exit_code="${1:-0}"
  local previous_errexit
  local host_ip
  local best_ip
  local service_pid
  local service_enabled
  local service_active
  local backend_health_code
  local nginx_health_code
  local config_status
  local data_status
  local db_status
  local cred_status
  local db_path_from_config
  local status_label
  local status_color
  local summary_title
  local header_width
  local header_inner
  local header_border
  local status_icon
  local mode_label
  local api_line_one
  local api_line_two
  local api_key_display
  if [[ "$-" == *e* ]]; then
    previous_errexit="errexit on"
  else
    previous_errexit="errexit off"
  fi
  set +e
  trap - ERR
  trap - DEBUG

  if [[ -t 1 ]]; then
    if command -v tput >/dev/null 2>&1; then
      tput clear || true
      tput cup 0 0 || true
    else
      printf '\033[2J\033[H'
    fi
  fi

  if [[ "${exit_code}" -ne 0 && "${FAILED}" -eq 0 ]]; then
    record_failure "${LAST_CMD:-${BASH_COMMAND:-unknown}}" "${exit_code}"
  fi

  best_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '/src/ {for (i=1; i<=NF; i++) if ($i=="src") {print $(i+1); exit}}')"
  if [[ -z "${best_ip}" ]]; then
    best_ip="$(ip -4 addr show scope global 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -n 1)"
  fi
  if [[ -z "${best_ip}" ]]; then
    best_ip="127.0.0.1"
  fi
  host_ip="${best_ip}"

  if [[ "${HAVE_SYSTEMD}" -eq 1 ]]; then
    service_enabled="$(systemctl is-enabled fossilsafe 2>/dev/null || true)"
    if [[ -z "${service_enabled}" ]]; then
      service_enabled="unknown"
    fi
    service_active="$(systemctl is-active fossilsafe 2>/dev/null || true)"
    if [[ -z "${service_active}" ]]; then
      service_active="unknown"
    fi
    service_pid="$(systemctl show -p MainPID --value fossilsafe.service 2>/dev/null || true)"
    if [[ -z "${service_pid}" || "${service_pid}" == "0" ]]; then
      service_pid="n/a"
    fi
  else
    service_enabled="systemd unavailable"
    service_active="systemd unavailable"
    service_pid="n/a"
  fi

  backend_health_code="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${BACKEND_PORT}/api/healthz" 2>/dev/null || true)"
  if [[ -z "${backend_health_code}" ]]; then
    backend_health_code="000"
  fi
  nginx_health_code=""
  if [[ "${HEADLESS}" -eq 0 ]]; then
    nginx_health_code="$(curl -s -k -o /dev/null -w "%{http_code}" "https://127.0.0.1:${UI_PORT}/api/healthz" 2>/dev/null || true)"
    if [[ -z "${nginx_health_code}" ]]; then
      nginx_health_code="000"
    fi
  fi

  mode_label="UI"
  if [[ "${HEADLESS}" -eq 1 ]]; then
    mode_label="headless"
  fi

  config_status="missing"
  if [[ -f "${CONFIG_PATH}" ]]; then
    config_status="present"
  fi
  data_status="missing"
  if [[ -d "${DATA_DIR}" ]]; then
    data_status="present"
  fi
  db_path_from_config="$(CONFIG_PATH="${CONFIG_PATH}" python3 - <<'PY'
import json
import os

path = os.environ.get("CONFIG_PATH")
if not path or not os.path.exists(path):
    raise SystemExit(0)
try:
    with open(path, "r") as handle:
        data = json.load(handle) or {}
    db_path = data.get("db_path") or ""
    if isinstance(db_path, str):
        print(db_path)
except Exception:
    pass
PY
  )"
  if [[ -z "${db_path_from_config}" ]]; then
    db_path_from_config="${DB_PATH}"
  fi

  db_status="missing"
  if [[ -f "${db_path_from_config}" ]]; then
    db_status="present"
  fi
  cred_status="missing"
  if [[ -f "${CREDENTIAL_KEY_PATH}" ]]; then
    cred_status="present"
  fi

  SUMMARY_WIDTH=86
  SUMMARY_INNER=$((SUMMARY_WIDTH - 2))
  SUMMARY_BORDER="$(repeat_char "${SUMMARY_INNER}" "${BOX_H}")"

  if [[ "${exit_code}" -eq 0 ]]; then
    if [[ "${PURGE_PERFORMED}" -eq 1 ]]; then
      status_label="PURGE COMPLETED"
    else
      status_label="INSTALL SUCCEEDED"
    fi
    status_color="${COLOR_GREEN}"
    status_icon="${SYMBOL_OK}"
  else
    status_label="FAILED"
    status_color="${COLOR_RED}"
    status_icon="${SYMBOL_ERR}"
  fi
  summary_title="${status_color}${COLOR_BOLD}${status_label}${COLOR_RESET} (exit ${exit_code})"

  header_width=86
  header_inner=$((header_width - 2))
  header_border="$(repeat_char "${header_inner}" "${BOX_H}")"

  echo ""
  info "${COLOR_BOLD}Installation Summary${COLOR_RESET}"
  echo "${BOX_TL}${header_border}${BOX_TR}"
  printf "%s %-82s %s\n" "${BOX_V}" "${summary_title}" "${BOX_V}"
  echo "${BOX_BL}${header_border}${BOX_BR}"
  echo "${BOX_TL}${SUMMARY_BORDER}${BOX_TR}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${status_icon} Status" "${BOX_V}" "${status_label} (exit ${exit_code})" "${BOX_V}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} Mode" "${BOX_V}" "${mode_label}" "${BOX_V}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} Backend bind/port" "${BOX_V}" "${BACKEND_BIND}:${BACKEND_PORT}" "${BOX_V}"
  if [[ "${HEADLESS}" -eq 0 ]]; then
    printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} UI URL" "${BOX_V}" "https://${host_ip}:${UI_PORT}" "${BOX_V}"
    printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} API URL (UI)" "${BOX_V}" "https://${host_ip}:${UI_PORT}/api" "${BOX_V}"
    printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} API URL (backend)" "${BOX_V}" "http://${BACKEND_BIND}:${BACKEND_PORT}/api" "${BOX_V}"
  else
    printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} API URL" "${BOX_V}" "http://${BACKEND_BIND}:${BACKEND_PORT}/api" "${BOX_V}"
  fi
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} Service enabled" "${BOX_V}" "${service_enabled}" "${BOX_V}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} Service active" "${BOX_V}" "${service_active} (PID ${service_pid})" "${BOX_V}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} Backend health" "${BOX_V}" "http://127.0.0.1:${BACKEND_PORT}/api/healthz (${backend_health_code})" "${BOX_V}"
  if [[ "${HEADLESS}" -eq 0 ]]; then
    printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} UI API health" "${BOX_V}" "https://127.0.0.1:${UI_PORT}/api/healthz (${nginx_health_code})" "${BOX_V}"
  fi
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} Config path" "${BOX_V}" "${CONFIG_PATH} (${config_status})" "${BOX_V}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} State dir" "${BOX_V}" "${DATA_DIR} (${data_status})" "${BOX_V}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} DB path" "${BOX_V}" "${db_path_from_config} (${db_status})" "${BOX_V}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} Credential key" "${BOX_V}" "${CREDENTIAL_KEY_PATH} (${cred_status})" "${BOX_V}"
  echo "${BOX_BL}${SUMMARY_BORDER}${BOX_BR}"

  print_hardware_box

  echo ""
  info "${COLOR_BOLD}LTFS readiness${COLOR_RESET}"
  echo "${BOX_TL}${SUMMARY_BORDER}${BOX_TR}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} LTFS status" "${BOX_V}" "${LTFS_STATUS}" "${BOX_V}"
  if [[ -n "${LTFS_MISSING_TOOLS}" ]]; then
    printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} Missing tools" "${BOX_V}" "${LTFS_MISSING_TOOLS}" "${BOX_V}"
  fi
  if [[ -n "${LTFS_REF_USED}" ]]; then
    printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} LTFS ref" "${BOX_V}" "${LTFS_REF_USED}" "${BOX_V}"
  fi
  if [[ -n "${LTFS_PREFIX}" ]]; then
    printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} LTFS prefix" "${BOX_V}" "${LTFS_PREFIX}" "${BOX_V}"
  fi
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} /dev/fuse" "${BOX_V}" "${FUSE_DEVICE_STATUS}" "${BOX_V}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} fusermount3" "${BOX_V}" "${FUSERMOUNT_STATUS}" "${BOX_V}"
  echo "${BOX_BL}${SUMMARY_BORDER}${BOX_BR}"

  echo ""
  info "${COLOR_BOLD}API key access${COLOR_RESET}"
  echo "${BOX_TL}${SUMMARY_BORDER}${BOX_TR}"
  api_key_display="${API_KEY:-}"
  if [[ -z "${api_key_display}" ]]; then
    api_key_display="(not available)"
  fi
  if [[ "${API_KEY_SOURCE}" == "generated" ]]; then
    printf "%s %-80s %s\n" "${BOX_V}" "New API key: ${api_key_display}" "${BOX_V}"
    if [[ "${api_key_display}" != "(not available)" ]]; then
      printf "%s %-80s %s\n" "${BOX_V}" "Store this now; it will not be shown again." "${BOX_V}"
    else
      printf "%s %-80s %s\n" "${BOX_V}" "API key missing; check /etc/fossilsafe/config.json." "${BOX_V}"
    fi
  else
    printf "%s %-80s %s\n" "${BOX_V}" "API key already set. Retrieve it with:" "${BOX_V}"
    api_line_one="sudo /opt/fossilsafe/venv/bin/python -c 'import json;"
    api_line_two="print(json.load(open(\"/etc/fossilsafe/config.json\"))[\"api_key\"])'"
    printf "%s %-80s %s\n" "${BOX_V}" "${api_line_one}" "${BOX_V}"
    printf "%s %-80s %s\n" "${BOX_V}" "${api_line_two}" "${BOX_V}"
  fi
  printf "%s %-80s %s\n" "${BOX_V}" "The web UI wizard will prompt for the API key." "${BOX_V}"
  echo "${BOX_BL}${SUMMARY_BORDER}${BOX_BR}"

  echo ""
  info "${COLOR_BOLD}Next steps${COLOR_RESET}"
  echo "${BOX_TL}${SUMMARY_BORDER}${BOX_TR}"
  if [[ "${HAVE_SYSTEMD}" -eq 1 ]]; then
    printf "%s %-80s %s\n" "${BOX_V}" "systemctl status fossilsafe" "${BOX_V}"
    printf "%s %-80s %s\n" "${BOX_V}" "journalctl -u fossilsafe -f" "${BOX_V}"
    printf "%s %-80s %s\n" "${BOX_V}" "systemctl restart fossilsafe" "${BOX_V}"
  else
    printf "%s %-80s %s\n" "${BOX_V}" "Manual start (backend):" "${BOX_V}"
    printf "%s %-80s %s\n" "${BOX_V}" "${VENV_DIR}/bin/gunicorn -c ${INSTALL_DIR}/gunicorn.conf.py backend.lto_backend_main:app" "${BOX_V}"
    printf "%s %-80s %s\n" "${BOX_V}" "Manual start (frontend dev): cd ${INSTALL_DIR}/frontend && npm install && npm run dev" "${BOX_V}"
    printf "%s %-80s %s\n" "${BOX_V}" "Manual start (frontend prod): cd ${INSTALL_DIR}/frontend && npm install && npm run build" "${BOX_V}"
  fi
  echo "${BOX_BL}${SUMMARY_BORDER}${BOX_BR}"

  if [[ "${exit_code}" -ne 0 ]]; then
    if [[ -z "${FAIL_STEP}" ]]; then
      FAIL_STEP="${CURRENT_STEP:-unknown}"
    fi
    if [[ -z "${FAIL_CMD}" ]]; then
      FAIL_CMD="${LAST_CMD:-unknown}"
    fi
    echo ""
    info "${COLOR_BOLD}FAILED${COLOR_RESET}"
    echo "${BOX_TL}${SUMMARY_BORDER}${BOX_TR}"
    printf "%s %-80s %s\n" "${BOX_V}" "Step: ${FAIL_STEP} (exit ${FAIL_CODE})" "${BOX_V}"
    printf "%s %-80s %s\n" "${BOX_V}" "Command: ${FAIL_CMD}" "${BOX_V}"
    echo "${BOX_BL}${SUMMARY_BORDER}${BOX_BR}"

    echo ""
    warn "systemctl status fossilsafe --no-pager -l (tail)"
    systemctl status fossilsafe --no-pager -l 2>/dev/null | tail -n 40 || true
    echo ""
    warn "journalctl -u fossilsafe -n 120 --no-pager -l"
    journalctl -u fossilsafe -n 120 --no-pager -l 2>/dev/null || true
  fi

  if [[ "${previous_errexit}" == "errexit on" ]]; then
    set -e
  fi
  SUMMARY_PRINTED=1
}

on_exit() {
  local exit_code="$1"
  IN_EXIT_HANDLER=1
  set +e
  trap - ERR
  trap - DEBUG
  if [[ "${SKIP_SUMMARY}" -eq 1 ]]; then
    return
  fi
  if [[ "${SUMMARY_PRINTED}" -eq 1 ]]; then
    return
  fi
  print_summary "${exit_code}"
  if [[ -t 0 && -t 1 && "${NON_INTERACTIVE}" -eq 0 ]]; then
    read -r -p "Press Enter to exit." _
  fi
}

handle_error() {
  local exit_code="${1:-1}"
  local cmd="${2:-${LAST_CMD:-unknown}}"
  record_failure "${cmd}" "${exit_code}"
  echo ""
  err "${CURRENT_STEP} failed."
  err "Command: ${cmd} (exit ${exit_code})"
  warn "Likely cause: ${CURRENT_CAUSE}"
  warn "Next steps: ${CURRENT_NEXT}"
  warn "Logs: journalctl -u fossilsafe.service -n 120 (if the service started)"
  if [[ "${SERVICE_HEALTHY}" -eq 1 ]]; then
    warn "Installed but verification failed; fossilsafe.service left running."
  fi
  exit "${exit_code}"
}

record_last_cmd() {
  if [[ "${IN_EXIT_HANDLER}" -eq 0 ]]; then
    LAST_CMD="${BASH_COMMAND}"
  fi
}

SHOW_HELP=0
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --headless)
      HEADLESS=1
      HEADLESS_SET=1
      shift
      ;;
    --backend-port)
      if [[ -z "${2:-}" ]]; then
        err "--backend-port requires a value."
        exit 1
      fi
      BACKEND_PORT="$2"
      BACKEND_PORT_SET=1
      shift 2
      ;;
    --ui-port)
      if [[ -z "${2:-}" ]]; then
        err "--ui-port requires a value."
        exit 1
      fi
      UI_PORT="$2"
      UI_PORT_SET=1
      shift 2
      ;;
    --upgrade|--repair|--fresh|--purge)
      if [[ "${INSTALL_MODE_SET}" -eq 1 && "${INSTALL_MODE}" != "${1#--}" ]]; then
        err "Only one install mode can be selected."
        exit 1
      fi
      INSTALL_MODE="${1#--}"
      INSTALL_MODE_SET=1
      shift
      ;;
    --yes)
      NON_INTERACTIVE=1
      YES_PROVIDED=1
      shift
      ;;
    --self-test)
      SELF_TEST=1
      shift
      ;;
    --secure)
      SECURE_MODE="secure"
      SECURE_MODE_SET=1
      shift
      ;;
    --secure)
      SECURE_MODE="secure"
      SECURE_MODE_SET=1
      shift
      ;;
    --help|-h)
      SHOW_HELP=1
      shift
      ;;
    *)
      err "Unknown flag: $1"
      exit 1
      ;;
  esac
done

if [[ ! -t 0 ]]; then
  NON_INTERACTIVE=1
fi

if [[ "${SHOW_HELP}" -eq 1 ]]; then
  echo "Usage: $0 [--headless] [--upgrade|--repair|--fresh|--purge] [--yes]"
  echo "            [--backend-port PORT] [--ui-port PORT] [--domain DOMAIN]"
  echo "            [--email EMAIL] [--self-test]"
  echo "Environment overrides:"
  echo "  FOSSILSAFE_INSTALL_DIR, FOSSILSAFE_CONFIG_PATH, FOSSILSAFE_DATA_DIR, FOSSILSAFE_DB_PATH"
  echo "  FOSSILSAFE_STATE_PATH, FOSSILSAFE_UI_PORT, FOSSILSAFE_BACKEND_PORT, FOSSILSAFE_BACKEND_BIND"
  echo "  FOSSILSAFE_HEADLESS, FOSSILSAFE_CORS_ORIGINS"
  SKIP_SUMMARY=1
  exit 0
fi

trap 'on_exit $?' EXIT
trap 'handle_error $? "${LAST_CMD:-${BASH_COMMAND}}"' ERR
trap 'record_last_cmd' DEBUG

if [[ "${SELF_TEST}" -eq 1 ]]; then
  SKIP_SUMMARY=1
  HAVE_SYSTEMD=0
  if command -v systemctl >/dev/null 2>&1; then
    HAVE_SYSTEMD=1
  fi
  self_backend_port="${BACKEND_PORT:-5000}"
  self_ui_port="${UI_PORT:-8080}"
  detect_existing_install
  if [[ "${INSTALL_MODE_SET}" -eq 1 ]]; then
    detected_mode="${INSTALL_MODE}"
  elif [[ "${EXISTING_INSTALL}" -eq 1 ]]; then
    detected_mode="upgrade"
  else
    detected_mode="install"
  fi
  unit_status="missing"
  if [[ -f "/etc/systemd/system/fossilsafe.service" ]]; then
    unit_status="present"
  fi
  mapfile -t self_backend_pids < <(list_port_listeners "${self_backend_port}")
  mapfile -t self_ui_pids < <(list_port_listeners "${self_ui_port}")
  if ! self_test_port_listeners; then
    exit 1
  fi
  backend_list="none"
  ui_list="none"
  if [[ "${#self_backend_pids[@]}" -gt 0 ]]; then
    backend_list="$(join_by ", " "${self_backend_pids[@]}")"
  fi
  if [[ "${#self_ui_pids[@]}" -gt 0 ]]; then
    ui_list="$(join_by ", " "${self_ui_pids[@]}")"
  fi
  enabled_status="systemd unavailable"
  active_status="systemd unavailable"
  if [[ "${HAVE_SYSTEMD}" -eq 1 ]]; then
    enabled_status="$(systemctl is-enabled fossilsafe.service 2>/dev/null || true)"
    active_status="$(systemctl is-active fossilsafe.service 2>/dev/null || true)"
  fi
  info "Self-test mode"
  printf "  Install mode: %s\n" "${detected_mode}"
  printf "  Unit file: %s\n" "${unit_status}"
  printf "  Backend port (%s): %s\n" "${self_backend_port}" "${backend_list}"
  printf "  UI port (%s): %s\n" "${self_ui_port}" "${ui_list}"
  printf "  systemctl is-enabled: %s\n" "${enabled_status}"
  printf "  systemctl is-active: %s\n" "${active_status}"
  exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
  CURRENT_STEP="[1/${STEP_TOTAL}] Checking prerequisites"
  CURRENT_CAUSE="Root privileges are required to install system packages and configure services."
  CURRENT_NEXT="Re-run with sudo: sudo ./scripts/install.sh"
  handle_error 1 "id -u"
fi

fail() {
  record_failure "$1" 1
  err "$1"
  warn "Likely cause: ${CURRENT_CAUSE}"
  warn "Next steps: ${CURRENT_NEXT}"
  exit 1
}

prepare_ui_build_log() {
  install -d -m 0750 -o root -g "${SERVICE_USER}" "${UI_BUILD_LOG_DIR}"
  touch "${UI_BUILD_LOG}"
  chown root:"${SERVICE_USER}" "${UI_BUILD_LOG}"
  chmod 0660 "${UI_BUILD_LOG}"
}

repair_frontend_permissions() {
  local frontend_dir="$1"
  local build_user="$2"
  local build_group="$3"
  local node_modules_dir="${frontend_dir}/node_modules"
  if [[ -d "${node_modules_dir}" ]]; then
    local node_owner
    node_owner="$(stat -c '%u' "${node_modules_dir}")"
    if [[ "${node_owner}" -eq 0 ]]; then
      warn "Frontend node_modules owned by root; removing for clean reinstall."
      rm -rf "${node_modules_dir}"
    fi
  fi
  chown -R "${build_user}:${build_group}" "${frontend_dir}"
}

verify_ui_assets() {
  local root_dir="$1"
  local label="$2"
  local index_path="${root_dir}/index.html"
  local asset
  if [[ ! -f "${index_path}" ]]; then
    fail "UI ${label} missing index.html at ${index_path}"
  fi
  mapfile -t assets < <(grep -Eo 'assets/[^\" ]+' "${index_path}" | sed 's/[?].*//' | sort -u)
  if [[ "${#assets[@]}" -eq 0 ]]; then
    fail "UI ${label} missing asset references in index.html"
  fi
  for asset in "${assets[@]}"; do
    if [[ ! -f "${root_dir}/${asset}" ]]; then
      fail "UI ${label} missing asset ${asset}"
    fi
  done
}

join_by() {
  local delimiter="$1"
  shift
  local result=""
  local item
  for item in "$@"; do
    if [[ -z "${result}" ]]; then
      result="${item}"
    else
      result="${result}${delimiter}${item}"
    fi
  done
  echo "${result}"
}

append_unique() {
  local -n target_array="$1"
  local value="$2"
  local existing
  for existing in "${target_array[@]}"; do
    if [[ "${existing}" == "${value}" ]]; then
      return 0
    fi
  done
  target_array+=("${value}")
}

pid_cmdline() {
  local pid="$1"
  local cmdline=""
  if [[ -z "${pid}" || ! "${pid}" =~ ^[0-9]+$ || "${pid}" == "0" ]]; then
    echo ""
    return 1
  fi
  if [[ -r "/proc/${pid}/cmdline" ]]; then
    cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline")"
  else
    echo ""
    return 1
  fi
  echo "${cmdline}"
}

pid_unit() {
  local pid="$1"
  local unit=""
  if [[ -z "${pid}" || ! "${pid}" =~ ^[0-9]+$ || "${pid}" == "0" ]]; then
    echo ""
    return 1
  fi
  if [[ "${HAVE_SYSTEMD}" -eq 1 ]] && command -v systemctl >/dev/null 2>&1; then
    unit="$(systemctl status --no-pager --pid "${pid}" 2>/dev/null | awk -F': ' '/Unit:/{print $2; exit}')"
  fi
  echo "${unit}"
}

list_port_listeners() {
  local port="$1"
  local line
  local pid
  local found
  local -a pids
  if command -v ss >/dev/null 2>&1; then
    while IFS= read -r line; do
      found=0
      while [[ "${line}" =~ pid=([0-9]+) ]]; do
        found=1
        pid="${BASH_REMATCH[1]}"
        if [[ -n "${pid}" ]]; then
          append_unique pids "${pid}"
        fi
        line="${line#*pid=${pid}}"
      done
      if [[ "${found}" -eq 0 && "${SELF_TEST}" -eq 1 && -n "${line}" ]]; then
        warn "list_port_listeners: unable to parse ss output: ${line}"
      fi
    done < <(ss -H -ltnp "( sport = :${port} )" 2>/dev/null || true)
  elif command -v lsof >/dev/null 2>&1; then
    while IFS= read -r line; do
      pid="$(echo "${line}" | awk '{print $2}')"
      if [[ -n "${pid}" && "${pid}" =~ ^[0-9]+$ ]]; then
        append_unique pids "${pid}"
      fi
    done < <(lsof -n -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | tail -n +2)
  fi
  printf '%s\n' "${pids[@]}"
}

self_test_port_listeners() {
  local port="5000"
  local -a pids
  local pid
  mapfile -t pids < <(list_port_listeners "${port}")
  for pid in "${pids[@]}"; do
    if [[ -z "${pid}" || ! "${pid}" =~ ^[0-9]+$ ]]; then
      err "Self-test: invalid PID output from list_port_listeners ${port}: ${pid}"
      return 1
    fi
  done
  return 0
}

wait_for_port_free() {
  local port="$1"
  local timeout_seconds="${2:-10}"
  local start_time
  local elapsed
  local last_log=-1
  local -a pids

  start_time="$(date +%s)"
  while true; do
    mapfile -t pids < <(list_port_listeners "${port}")
    if [[ "${#pids[@]}" -eq 0 ]]; then
      return 0
    fi
    elapsed="$(( $(date +%s) - start_time ))"
    if (( elapsed >= timeout_seconds )); then
      return 1
    fi
    if (( elapsed != last_log )); then
      info "Waiting for port ${port} to become free (${elapsed}s/${timeout_seconds}s)..."
      last_log="${elapsed}"
    fi
    sleep 0.25
  done
}

is_fossilsafe_process() {
  local pid="$1"
  local cmdline
  if [[ ! -r "/proc/${pid}/cmdline" ]]; then
    return 1
  fi
  cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline")"
  if echo "${cmdline}" | grep -q "backend.lto_backend_main"; then
    return 0
  fi
  if echo "${cmdline}" | grep -q "${INSTALL_DIR}"; then
    return 0
  fi
  if echo "${cmdline}" | grep -q "backend.wsgi"; then
    return 0
  fi
  if echo "${cmdline}" | grep -q "backend.wsgi_safe"; then
    return 0
  fi
  return 1
}

is_fossilsafe_ui_process() {
  local pid="$1"
  local cmdline
  if [[ ! -r "/proc/${pid}/cmdline" ]]; then
    return 1
  fi
  cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline")"
  if ! echo "${cmdline}" | grep -q "nginx"; then
    return 1
  fi
  if [[ ! -f "/etc/nginx/sites-enabled/fossilsafe.conf" ]]; then
    return 1
  fi
  if ! grep -Eq "listen[[:space:]]+${UI_PORT};" /etc/nginx/sites-enabled/fossilsafe.conf 2>/dev/null; then
    return 1
  fi
  return 0
}

stop_fossilsafe_pids() {
  local label="$1"
  shift
  local -a pids=("$@")
  local pid
  for pid in "${pids[@]}"; do
    if kill -0 "${pid}" >/dev/null 2>&1; then
      info "Stopping FossilSafe ${label} process (PID ${pid})..."
      kill -TERM "${pid}" >/dev/null 2>&1 || true
    fi
  done
  sleep 2
  for pid in "${pids[@]}"; do
    if kill -0 "${pid}" >/dev/null 2>&1; then
      warn "PID ${pid} still running; sending SIGKILL."
      kill -KILL "${pid}" >/dev/null 2>&1 || true
    fi
  done
}

systemd_unit_exists() {
  if [[ -f "/etc/systemd/system/fossilsafe.service" ]]; then
    return 0
  fi
  if [[ "${HAVE_SYSTEMD}" -eq 1 ]] && command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files --no-legend 2>/dev/null | awk '{print $1}' | grep -qx "fossilsafe.service"; then
      return 0
    fi
  fi
  return 1
}

detect_existing_install() {
  local -a reasons
  reasons=()
  if [[ -f "${CONFIG_PATH}" ]]; then
    reasons+=("config ${CONFIG_PATH}")
  fi
  if [[ -d "${DATA_DIR}" ]]; then
    reasons+=("data dir ${DATA_DIR}")
  fi
  if [[ -d "${INSTALL_DIR}" ]]; then
    reasons+=("install dir ${INSTALL_DIR}")
  fi
  if systemd_unit_exists; then
    reasons+=("systemd unit fossilsafe.service")
  fi
  EXISTING_REASONS=("${reasons[@]}")
  if [[ "${#reasons[@]}" -gt 0 ]]; then
    EXISTING_INSTALL=1
  else
    EXISTING_INSTALL=0
  fi

  mapfile -t EXISTING_BACKEND_PIDS < <(list_port_listeners "${BACKEND_PORT}")
}

read_existing_config_defaults() {
  local config_values
  local conf_backend_port
  local conf_ui_port
  local conf_backend_bind
  local conf_db_path
  local conf_headless

  if [[ ! -f "${CONFIG_PATH}" ]]; then
    return
  fi

  config_values="$(CONFIG_PATH="${CONFIG_PATH}" python3 - <<'PY'
import json
import os

path = os.environ.get("CONFIG_PATH")
values = ["", "", "", "", ""]
if path and os.path.exists(path):
    try:
        with open(path, "r") as handle:
            data = json.load(handle) or {}
        values = [
            str(data.get("backend_port") or ""),
            str(data.get("ui_port") or ""),
            str(data.get("backend_bind") or ""),
            str(data.get("db_path") or ""),
            "1" if data.get("headless") is True else ("0" if data.get("headless") is False else ""),
        ]
    except Exception:
        pass
print("|".join(values))
PY
  )"

  IFS="|" read -r conf_backend_port conf_ui_port conf_backend_bind conf_db_path conf_headless <<<"${config_values}"

  if [[ "${BACKEND_PORT_SET}" -eq 0 && -n "${conf_backend_port}" ]]; then
    BACKEND_PORT="${conf_backend_port}"
  fi
  if [[ "${UI_PORT_SET}" -eq 0 && -n "${conf_ui_port}" ]]; then
    UI_PORT="${conf_ui_port}"
  fi
  if [[ "${BACKEND_BIND_SET}" -eq 0 && -n "${conf_backend_bind}" ]]; then
    BACKEND_BIND="${conf_backend_bind}"
  fi
  if [[ "${DB_PATH_SET}" -eq 0 && -n "${conf_db_path}" ]]; then
    DB_PATH="${conf_db_path}"
  fi
  if [[ "${HEADLESS_SET}" -eq 0 && -n "${conf_headless}" ]]; then
    HEADLESS="${conf_headless}"
  fi
}

backup_existing_install() {
  local timestamp
  timestamp="$(date -u +"%Y%m%d%H%M%S")"
  if [[ -f "${CONFIG_PATH}" ]]; then
    cp -a "${CONFIG_PATH}" "${CONFIG_PATH}.bak.${timestamp}"
    ok "Backed up config to ${CONFIG_PATH}.bak.${timestamp}"
  fi
  if [[ -f "${DB_PATH}" ]]; then
    cp -a "${DB_PATH}" "${DB_PATH}.bak.${timestamp}"
    ok "Backed up database to ${DB_PATH}.bak.${timestamp}"
  fi
}

purge_installation() {
  PURGE_PERFORMED=1
  info "Purging existing FossilSafe installation artifacts..."
  if [[ "${HAVE_SYSTEMD}" -eq 1 ]]; then
    systemctl stop fossilsafe.service >/dev/null 2>&1 || true
    systemctl disable fossilsafe.service >/dev/null 2>&1 || true
  fi

  rm -f /etc/systemd/system/fossilsafe.service
  rm -f /usr/local/bin/fossilsafe-rotate-key
  rm -f /usr/local/bin/fsafe-cli
  rm -f /etc/udev/rules.d/99-fossilsafe-tape.rules
  rm -f /etc/nginx/sites-available/fossilsafe.conf
  rm -f /etc/nginx/sites-enabled/fossilsafe.conf
  rm -rf /var/www/fossilsafe
  rm -rf "${INSTALL_DIR}" /etc/fossilsafe /var/lib/fossilsafe

  if [[ "${HAVE_SYSTEMD}" -eq 1 ]]; then
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  ok "Purge completed."
}

print_purge_warning() {
  err "!!! PURGE MODE WARNING !!!"
  err "This will stop fossilsafe.service and REMOVE the following paths:"
  err "  - ${INSTALL_DIR}"
  err "  - /etc/fossilsafe"
  err "  - /var/lib/fossilsafe"
  warn "This action is destructive. Back up configs/data before proceeding."
}

handle_port_conflict() {
  local port="$1"
  local label="$2"
  local -a pids
  local -a filtered_pids
  local -a fossilsafe_pids
  local -a foreign_pids
  local pid
  local cmdline
  local unit
  local foreign_pid
  local foreign_cmdline
  local foreign_unit

  mapfile -t pids < <(list_port_listeners "${port}")
  filtered_pids=()
  for pid in "${pids[@]}"; do
    if [[ -n "${pid}" && "${pid}" =~ ^[0-9]+$ && "${pid}" != "0" ]]; then
      append_unique filtered_pids "${pid}"
    fi
  done
  if [[ "${#filtered_pids[@]}" -eq 0 ]]; then
    return 0
  fi

  pids=("${filtered_pids[@]}")
  for pid in "${pids[@]}"; do
    if ! cmdline="$(pid_cmdline "${pid}")"; then
      continue
    fi
    unit="$(pid_unit "${pid}")"
    info "Port ${port} listener PID ${pid} (unit: ${unit:-unknown}) cmd: ${cmdline:-unknown}"
  done

  fossilsafe_pids=()
  foreign_pids=()
  for pid in "${pids[@]}"; do
    if ! pid_cmdline "${pid}" >/dev/null; then
      continue
    fi
    if [[ "${label}" == "backend" ]]; then
      if is_fossilsafe_process "${pid}"; then
        append_unique fossilsafe_pids "${pid}"
      else
        append_unique foreign_pids "${pid}"
      fi
    else
      if is_fossilsafe_ui_process "${pid}"; then
        append_unique fossilsafe_pids "${pid}"
      else
        append_unique foreign_pids "${pid}"
      fi
    fi
  done

  if [[ "${#foreign_pids[@]}" -gt 0 ]]; then
    foreign_pid="${foreign_pids[0]}"
    if ! foreign_cmdline="$(pid_cmdline "${foreign_pid}")"; then
      foreign_cmdline=""
    fi
    foreign_unit="$(pid_unit "${foreign_pid}")"
    err "Port ${port} in use by PID ${foreign_pid} (unit: ${foreign_unit:-unknown}) ${foreign_cmdline:-unknown}. Choose another port or stop it."
    return 1
  fi

  if [[ "${#fossilsafe_pids[@]}" -gt 0 ]]; then
    warn "Port ${port} already in use by FossilSafe ${label}."
    if [[ "${HAVE_SYSTEMD}" -eq 1 ]]; then
      if [[ "${label}" == "backend" ]]; then
        systemctl stop fossilsafe.service >/dev/null 2>&1 || true
      fi
    fi
    stop_fossilsafe_pids "${label}" "${fossilsafe_pids[@]}"
  fi

  if ! wait_for_port_free "${port}" 10; then
    mapfile -t pids < <(list_port_listeners "${port}")
    foreign_pids=()
    for pid in "${pids[@]}"; do
      if [[ -z "${pid}" || ! "${pid}" =~ ^[0-9]+$ || "${pid}" == "0" ]]; then
        continue
      fi
      if ! pid_cmdline "${pid}" >/dev/null; then
        continue
      fi
      if [[ "${label}" == "backend" ]]; then
        if ! is_fossilsafe_process "${pid}"; then
          append_unique foreign_pids "${pid}"
        fi
      else
        if ! is_fossilsafe_ui_process "${pid}"; then
          append_unique foreign_pids "${pid}"
        fi
      fi
    done
    if [[ "${#foreign_pids[@]}" -gt 0 ]]; then
      foreign_pid="${foreign_pids[0]}"
      if ! foreign_cmdline="$(pid_cmdline "${foreign_pid}")"; then
        foreign_cmdline=""
      fi
      foreign_unit="$(pid_unit "${foreign_pid}")"
      err "Port ${port} still in use by PID ${foreign_pid} (unit: ${foreign_unit:-unknown}) ${foreign_cmdline:-unknown}."
      return 1
    fi
    warn "Port ${port} still owned by FossilSafe ${label}; continuing."
  fi
  return 0
}

print_hardware_box() {
  local header_width=86
  local header_inner=$((header_width - 2))
  local header_border
  local line
  header_border="$(repeat_char "${header_inner}" "${BOX_H}")"

  echo ""
  info "${COLOR_BOLD}Hardware detected${COLOR_RESET}"
  echo "${BOX_TL}${header_border}${BOX_TR}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} Tape drives" "${BOX_V}" "${HW_TAPE_NODES}" "${BOX_V}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} SCSI generic" "${BOX_V}" "${HW_SG_NODES}" "${BOX_V}"
  printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} Changer present" "${BOX_V}" "${HW_CHANGER_STATUS}" "${BOX_V}"
  if [[ -z "${HW_VENDOR_STRINGS}" || "${HW_VENDOR_STRINGS}" == "none" ]]; then
    printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} Vendor strings" "${BOX_V}" "none" "${BOX_V}"
  else
    while IFS= read -r line; do
      if [[ -n "${line}" ]]; then
        printf "%s %-26s %s %-54s %s\n" "${BOX_V}" "${SYMBOL_INFO} Vendor strings" "${BOX_V}" "${line}" "${BOX_V}"
      fi
    done <<< "${HW_VENDOR_STRINGS}"
  fi
  echo "${BOX_BL}${header_border}${BOX_BR}"
}

detect_hardware() {
  local -a tape_nodes
  local -a sg_nodes
  local lsscsi_output
  local -a vendor_lines
  local changer_present="no"
  local changer_node=""
  local node
  local line
  local sg_inq_line
  local type
  local -a parts
  local sg_for_line

  lsscsi_output=""
  if command -v lsscsi >/dev/null 2>&1; then
    lsscsi_output="$(lsscsi -g 2>/dev/null || true)"
  fi

  if [[ -n "${lsscsi_output}" ]]; then
    while IFS= read -r line; do
      if [[ -z "${line}" ]]; then
        continue
      fi
      read -r -a parts <<< "${line}"
      type="${parts[1]:-}"
      if [[ "${type}" != "tape" && "${type}" != "mediumx" ]]; then
        continue
      fi
      sg_for_line=""
      for node in "${parts[@]}"; do
        if [[ "${node}" =~ ^/dev/(nst|st)[0-9]+$ ]]; then
          append_unique tape_nodes "${node}"
        fi
        if [[ "${node}" =~ ^/dev/sg[0-9]+$ ]]; then
          append_unique sg_nodes "${node}"
          if [[ -z "${sg_for_line}" ]]; then
            sg_for_line="${node}"
          fi
        fi
      done
      if [[ "${type}" == "mediumx" ]]; then
        changer_present="yes"
        if [[ -n "${sg_for_line}" ]]; then
          changer_node="${sg_for_line}"
        fi
      fi
    done <<< "${lsscsi_output}"
  else
    for node in /dev/nst[0-9]* /dev/st[0-9]*; do
      if [[ -e "${node}" && "${node}" =~ ^/dev/(nst|st)[0-9]+$ ]]; then
        append_unique tape_nodes "${node}"
      fi
    done

    if command -v mtx >/dev/null 2>&1; then
      for node in /dev/sg[0-9]*; do
        if [[ ! -e "${node}" ]]; then
          continue
        fi
        if command -v timeout >/dev/null 2>&1; then
          if timeout 2 mtx -f "${node}" status >/dev/null 2>&1; then
            changer_present="yes"
            changer_node="${node}"
            append_unique sg_nodes "${node}"
            break
          fi
        else
          if mtx -f "${node}" status >/dev/null 2>&1; then
            changer_present="yes"
            changer_node="${node}"
            append_unique sg_nodes "${node}"
            break
          fi
        fi
      done
    fi
  fi

  vendor_lines=()
  if command -v sg_inq >/dev/null 2>&1; then
    for node in "${sg_nodes[@]}"; do
      sg_inq_line="$(sg_inq "${node}" 2>/dev/null | awk -F: '
        /Vendor identification/ {vendor=$2}
        /Product identification/ {product=$2}
        END {
          gsub(/^[ \t]+|[ \t]+$/, "", vendor)
          gsub(/^[ \t]+|[ \t]+$/, "", product)
          if (vendor || product) {print vendor, product}
        }')"
      if [[ -n "${sg_inq_line}" ]]; then
        append_unique vendor_lines "${sg_inq_line}"
      fi
    done
  fi

  HW_TAPE_NODES="$(join_by ", " "${tape_nodes[@]}")"
  if [[ -z "${HW_TAPE_NODES}" ]]; then
    HW_TAPE_NODES="none"
  fi
  HW_SG_NODES="$(join_by ", " "${sg_nodes[@]}")"
  if [[ -z "${HW_SG_NODES}" ]]; then
    HW_SG_NODES="none"
  fi
  if [[ "${changer_present}" == "yes" ]]; then
    if [[ -n "${changer_node}" ]]; then
      HW_CHANGER_STATUS="yes (${changer_node})"
    else
      HW_CHANGER_STATUS="yes"
    fi
  else
    HW_CHANGER_STATUS="no"
  fi
  HW_VENDOR_STRINGS="$(join_by $'\n' "${vendor_lines[@]}")"
  if [[ -z "${HW_VENDOR_STRINGS}" ]]; then
    HW_VENDOR_STRINGS="none"
  fi
}

read_config_changer_path() {
  CONFIGURED_CHANGER_PATH="$(CONFIG_PATH="${CONFIG_PATH}" python3 - <<'PY'
import json
import os
import sys

path = os.environ.get("CONFIG_PATH")
if not path or not os.path.exists(path):
    sys.exit(0)
try:
    with open(path, "r") as handle:
        data = json.load(handle) or {}
    changer = data.get("changer_path")
    if isinstance(changer, str) and changer.strip():
        print(changer.strip())
except Exception:
    pass
PY
  )"
}

ensure_mtx_available() {
  local mtx_hint
  if command -v mtx >/dev/null 2>&1; then
    return 0
  fi
  if [[ -x /usr/sbin/mtx ]]; then
    return 0
  fi
  if [[ "${APT_UPDATED}" -eq 0 ]]; then
    apt-get update -y
    APT_UPDATED=1
  fi
  apt-get install -y mtx
  if command -v mtx >/dev/null 2>&1; then
    return 0
  fi
  if [[ -x /usr/sbin/mtx ]]; then
    return 0
  fi
  mtx_hint="/usr/sbin/mtx"
  fail "mtx not found; install package 'mtx' (binary at ${mtx_hint})."
}

check_fuse_requirements() {
  if [[ -e /dev/fuse ]]; then
    FUSE_DEVICE_STATUS="present"
  else
    FUSE_DEVICE_STATUS="missing"
    warn "/dev/fuse not found. Load the fuse kernel module (sudo modprobe fuse)."
  fi

  if command -v fusermount3 >/dev/null 2>&1; then
    FUSERMOUNT_STATUS="present"
  else
    FUSERMOUNT_STATUS="missing"
    warn "fusermount3 not found. Install fuse3 from Debian repos."
  fi
}

apt_package_available() {
  local pkg="$1"
  if apt-cache show "${pkg}" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

check_ltfs_tools() {
  local -a missing_tools
  local -a ltfs_packages
  local tool
  local pkg

  missing_tools=()
  for tool in mkltfs ltfs ltfsck; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
      missing_tools+=("${tool}")
    fi
  done

  if [[ "${#missing_tools[@]}" -eq 0 ]]; then
    LTFS_STATUS="ready"
    LTFS_MISSING_TOOLS=""
    ok "LTFS tools detected."
    return 0
  fi

  LTFS_MISSING_TOOLS="$(join_by ", " "${missing_tools[@]}")"
  warn "LTFS tools missing: ${LTFS_MISSING_TOOLS}"

  ltfs_packages=()
  for pkg in ltfs ltfs-tools; do
    if apt_package_available "${pkg}"; then
      ltfs_packages+=("${pkg}")
    fi
  done

  if [[ "${#ltfs_packages[@]}" -gt 0 ]]; then
    info "Attempting LTFS install via apt (${ltfs_packages[*]})..."
    apt-get install -y "${ltfs_packages[@]}"
  else
    warn "No LTFS packages found in apt repositories for this OS."
  fi

  missing_tools=()
  for tool in mkltfs ltfs ltfsck; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
      missing_tools+=("${tool}")
    fi
  done

  if [[ "${#missing_tools[@]}" -eq 0 ]]; then
    LTFS_STATUS="ready"
    LTFS_MISSING_TOOLS=""
    ok "LTFS tools installed via apt."
    return 0
  fi

  LTFS_MISSING_TOOLS="$(join_by ", " "${missing_tools[@]}")"
  LTFS_STATUS="missing"
  return 1
}

print_ltfs_versions() {
  local tool
  for tool in mkltfs ltfs ltfsck; do
    if command -v "${tool}" >/dev/null 2>&1; then
      "${tool}" --version 2>/dev/null || "${tool}" -V 2>/dev/null || true
    fi
  done
}

build_ltfs_from_source() {
  local ltfs_repo="https://github.com/LinearTapeFileSystem/ltfs.git"
  local ltfs_ref="${FOSSILSAFE_LTFS_REF:-v2.4-stable}"
  local ltfs_dir="/opt/fossilsafe/third_party/ltfs-src"
  local ref_file="${ltfs_dir}/FOSSILSAFE_LTFS_REF.txt"
  local log_dir="${DATA_DIR}"
  local log_file="${log_dir}/ltfs-build.log"
  local install_prefix="/usr/local"
  local fuse_pkg=""
  local fuse_dev_pkg=""
  local icu_module=""
  local icu_line=""
  local icu_configure_ac=""
  local icu_libs=""
  local icu_cflags=""
  local icu_headers_found=0
  local -a missing_link_deps
  local -a missing_link_libs
  local -a build_deps
  local rc=0

  build_deps=(
    build-essential
    automake
    autoconf
    libtool
    libtool-bin
    pkg-config
    uuid-dev
    libxml2-dev
    libsnmp-dev
    libicu-dev
    icu-devtools
    libssl-dev
    libwrap0-dev
    libsensors-dev
    libpci-dev
    git
    ca-certificates
  )

  if apt_package_available "libfuse-dev"; then
    fuse_pkg="fuse"
    fuse_dev_pkg="libfuse-dev"
  elif pkg-config --exists fuse3 >/dev/null 2>&1; then
    fuse_pkg="fuse3"
    fuse_dev_pkg="libfuse3-dev"
  elif pkg-config --exists fuse >/dev/null 2>&1; then
    fuse_pkg="fuse"
    fuse_dev_pkg="libfuse-dev"
  elif apt_package_available "libfuse3-dev"; then
    fuse_pkg="fuse3"
    fuse_dev_pkg="libfuse3-dev"
  fi

  if [[ -n "${fuse_dev_pkg}" ]]; then
    build_deps+=("${fuse_pkg}" "${fuse_dev_pkg}")
  else
    warn "FUSE development headers not found in apt; LTFS build may fail."
  fi

  mkdir -p "${log_dir}"
  LTFS_BUILD_LOG="${log_file}"
  LTFS_REF_USED="${ltfs_ref}"
  LTFS_PREFIX="${install_prefix}"
  : > "${log_file}"
  info "Logging LTFS build output to ${log_file}"
  echo "LTFS ref: ${ltfs_ref}" >>"${log_file}"
  echo "LTFS prefix: ${install_prefix}" >>"${log_file}"

  set +e

  if [[ "${APT_UPDATED}" -eq 0 ]]; then
    apt-get update -y >>"${log_file}" 2>&1
    rc=$?
    if [[ "${rc}" -ne 0 ]]; then
      set -e
      return "${rc}"
    fi
    APT_UPDATED=1
  fi

  info "Installing LTFS build dependencies..."
  apt-get install -y "${build_deps[@]}" >>"${log_file}" 2>&1
  rc=$?
  if [[ "${rc}" -ne 0 ]]; then
    set -e
    return "${rc}"
  fi
  missing_link_deps=()
  missing_link_libs=(
    libwrap.so
    libsensors.so
    libpci.so
    libssl.so
    libcrypto.so
    libfuse.so
  )
  for libname in "${missing_link_libs[@]}"; do
    if ! find /usr/lib /usr/lib64 /lib /lib64 /usr/lib/x86_64-linux-gnu -name "${libname}" -print -quit 2>/dev/null | grep -q .; then
      case "${libname}" in
        libwrap.so)
          append_unique missing_link_deps "libwrap0-dev"
          ;;
        libsensors.so)
          append_unique missing_link_deps "libsensors-dev"
          ;;
        libpci.so)
          append_unique missing_link_deps "libpci-dev"
          ;;
        libssl.so|libcrypto.so)
          append_unique missing_link_deps "libssl-dev"
          ;;
        libfuse.so)
          append_unique missing_link_deps "libfuse-dev"
          ;;
      esac
    fi
  done
  if [[ "${#missing_link_deps[@]}" -gt 0 ]]; then
    err "Missing LTFS link dependencies: ${missing_link_deps[*]}"
    echo "Missing LTFS link dependencies: ${missing_link_deps[*]}" >>"${log_file}"
    set -e
    return 1
  fi

  mkdir -p "$(dirname "${ltfs_dir}")"
  if [[ -d "${ltfs_dir}/.git" ]]; then
    info "Updating existing LTFS source at ${ltfs_dir}..."
    git -C "${ltfs_dir}" fetch --tags >>"${log_file}" 2>&1
    rc=$?
    if [[ "${rc}" -ne 0 ]]; then
      set -e
      return "${rc}"
    fi
  else
    info "Cloning LTFS source into ${ltfs_dir}..."
    git clone "${ltfs_repo}" "${ltfs_dir}" >>"${log_file}" 2>&1
    rc=$?
    if [[ "${rc}" -ne 0 ]]; then
      set -e
      return "${rc}"
    fi
  fi

  info "Checking out LTFS ref ${ltfs_ref}..."
  git -C "${ltfs_dir}" checkout "${ltfs_ref}" >>"${log_file}" 2>&1
  rc=$?
  if [[ "${rc}" -ne 0 ]]; then
    set -e
    return "${rc}"
  fi
  echo "${ltfs_ref}" > "${ref_file}"

  pushd "${ltfs_dir}" >/dev/null
  icu_configure_ac="${ltfs_dir}/configure.ac"
  if [[ -f "${icu_configure_ac}" ]]; then
    if grep -q "Check for ICU" "${icu_configure_ac}" && grep -q "icu-config" "${icu_configure_ac}"; then
      info "Patching LTFS configure.ac ICU check to use pkg-config modules..."
      python3 - <<'PY' "${icu_configure_ac}"
import re
import sys

path = sys.argv[1]
data = open(path, "r", encoding="utf-8").read()
pattern = re.compile(
    r"dnl\\s*\\n+dnl Check for ICU\\n+dnl\\n.*?AC_MSG_CHECKING\\(\\[use latest ICU\\]\\)",
    re.S,
)
replacement = """dnl
dnl Check for ICU
dnl
ICU_MODULE_CFLAGS=""
ICU_MODULE_LIBS=""
PKG_CHECK_MODULES([ICU_MODULE], [icu-uc icu-i18n], [], [
    PKG_CHECK_MODULES([ICU_MODULE], [icu-uc], [], [
        PKG_CHECK_MODULES([ICU_MODULE], [icu-i18n], [], [
            PKG_CHECK_MODULES([ICU_MODULE], [icu >= 0.21])
        ])
    ])
])

AC_MSG_CHECKING([use latest ICU])"""
new_data, count = pattern.subn(replacement, data)
if count:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(new_data)
PY
    fi
    if grep -E -q "PKG_CHECK_MODULES\\(\\[?ICU" "${icu_configure_ac}"; then
      if pkg-config --exists icu-uc >/dev/null 2>&1; then
        icu_module="icu-uc"
      elif pkg-config --exists icu-i18n >/dev/null 2>&1; then
        icu_module="icu-i18n"
      else
        icu_module="icu"
      fi
      icu_line="PKG_CHECK_MODULES([ICU], [${icu_module}])"
      info "Patching LTFS configure.ac ICU check to use ${icu_module}..."
      sed -E -i "s/PKG_CHECK_MODULES\\(\\[?ICU\\]?[^)]*\\)/${icu_line}/" "${icu_configure_ac}"
    fi
  fi
  if [[ -f /usr/include/unicode/utypes.h ]]; then
    icu_headers_found=1
  fi
  if pkg-config --exists icu-uc >/dev/null 2>&1; then
    icu_cflags="$(pkg-config --cflags icu-uc icu-i18n 2>/dev/null || pkg-config --cflags icu-uc 2>/dev/null)"
    icu_libs="$(pkg-config --libs icu-uc icu-i18n 2>/dev/null || pkg-config --libs icu-uc 2>/dev/null)"
  elif pkg-config --exists icu-i18n >/dev/null 2>&1; then
    icu_cflags="$(pkg-config --cflags icu-uc icu-i18n 2>/dev/null || pkg-config --cflags icu-i18n 2>/dev/null)"
    icu_libs="$(pkg-config --libs icu-uc icu-i18n 2>/dev/null || pkg-config --libs icu-i18n 2>/dev/null)"
  fi
  if [[ -n "${icu_libs}" ]]; then
    echo "ICU_CFLAGS=${icu_cflags}" >>"${log_file}"
    echo "ICU_LIBS=${icu_libs}" >>"${log_file}"
  elif [[ "${icu_headers_found}" -eq 1 ]]; then
    err "ICU headers detected but pkg-config did not report ICU libs."
    err "Install libicu-dev and pkg-config (Debian: apt-get install -y libicu-dev pkg-config)."
    echo "ICU headers detected but pkg-config did not report ICU libs." >>"${log_file}"
    echo "Install libicu-dev and pkg-config (Debian: apt-get install -y libicu-dev pkg-config)." >>"${log_file}"
    popd >/dev/null
    set -e
    return 1
  fi
  if [[ -x "./autogen.sh" ]]; then
    ./autogen.sh >>"${log_file}" 2>&1
  else
    autoreconf -fi >>"${log_file}" 2>&1
  fi
  rc=$?
  if [[ "${rc}" -ne 0 ]]; then
    popd >/dev/null
    set -e
    return "${rc}"
  fi

  CFLAGS="${CFLAGS:-} ${icu_cflags}" LIBS="${icu_libs} ${LIBS:-}" ./configure --prefix="${install_prefix}" >>"${log_file}" 2>&1
  rc=$?
  if [[ "${rc}" -ne 0 ]]; then
    popd >/dev/null
    set -e
    return "${rc}"
  fi
  info "Verifying ICU libraries are present in LTFS Makefiles..."
  echo "Verifying ICU libraries are present in LTFS Makefiles..." >>"${log_file}"
  if ! grep -R -E "icuuc|icui18n|icudata" -n "${ltfs_dir}/src/libltfs/Makefile" >>"${log_file}" 2>&1; then
    err "ERROR: ICU libraries not found in LTFS link flags. Aborting build."
    echo "ERROR: ICU libraries not found in LTFS link flags. Aborting build." >>"${log_file}"
    popd >/dev/null
    set -e
    return 1
  fi
  info "Removing stderr redirection from LTFS Makefiles (to surface linker errors)..."
  echo "Removing stderr redirection from LTFS Makefiles (to surface linker errors)..." >>"${log_file}"
  find "${ltfs_dir}" -type f -name Makefile -print0 | xargs -0 -r sed -i 's#[[:space:]]2>[[:space:]]*/dev/null##g'
  if grep -R "2> /dev/null" -n "${ltfs_dir}/src" >>"${log_file}"; then
    err "ERROR: stderr redirection still present in LTFS Makefiles"
    echo "ERROR: stderr redirection still present in LTFS Makefiles" >>"${log_file}"
    popd >/dev/null
    set -e
    return 1
  fi

  make -j"$(nproc)" >>"${log_file}" 2>&1
  rc=$?
  if [[ "${rc}" -ne 0 ]]; then
    popd >/dev/null
    set -e
    return "${rc}"
  fi

  make install >>"${log_file}" 2>&1
  rc=$?
  popd >/dev/null
  if [[ "${rc}" -ne 0 ]]; then
    set -e
    return "${rc}"
  fi

  if ! command -v mkltfs >/dev/null 2>&1 || ! command -v ltfs >/dev/null 2>&1 || ! command -v ltfsck >/dev/null 2>&1; then
    err "LTFS tools missing after build/install (mkltfs/ltfs/ltfsck)."
    echo "LTFS tools missing after build/install (mkltfs/ltfs/ltfsck)." >>"${log_file}"
    set -e
    return 1
  fi

  ldconfig >>"${log_file}" 2>&1
  rc=$?
  set -e
  return "${rc}"
}

print_ltfs_build_log_tail() {
  local log_file="$1"
  local lines="${2:-120}"
  if [[ -n "${log_file}" && -f "${log_file}" ]]; then
    echo "---- LTFS build log (last ${lines} lines) ----"
    tail -n "${lines}" "${log_file}" || true
    echo "--------------------------------------------"
  fi
}

prompt_ltfs_action() {
  local choice
  local default_choice="2"
  local interactive=0

  if [[ -t 0 && -t 1 ]]; then
    interactive=1
  fi

  if [[ "${interactive}" -eq 0 ]]; then
    warn "Non-interactive install detected; attempting LTFS build from source."
    return 0
  fi

  echo ""
  warn "LTFS tools missing: ${LTFS_MISSING_TOOLS}"
  echo "Choose how to proceed:"
  echo "  1) I will install vendor LTFS packages myself (recommended)"
  echo "  2) Build open-source LTFS from source now (advanced, experimental)"
  echo "  3) Abort"

  read -r -p "Select [${default_choice}]: " choice
  choice="${choice:-${default_choice}}"

  case "${choice}" in
    1)
      echo ""
      err "LTFS tools are required but not installed."
      echo "Next steps:"
      echo "  - Install your vendor LTFS package (IBM LTFS, HPE StoreOpen, Quantum LTFS, etc.)."
      echo "  - Re-run this installer afterwards."
      echo "  - Verify with: command -v mkltfs && command -v ltfs && command -v ltfsck"
      exit 1
      ;;
    2)
      warn "Building LTFS from source is an advanced fallback. Vendor packages are preferred."
      return 0
      ;;
    3)
      err "Aborting installer per user request."
      exit 1
      ;;
    *)
      warn "Invalid choice; defaulting to vendor-install path."
      echo "Install vendor LTFS tools, then re-run the installer."
      exit 1
      ;;
  esac
}

fail_ltfs_build() {
  LTFS_STATUS="build-from-source attempted (failed)"
  err "LTFS build failed; see ${LTFS_BUILD_LOG}."
  print_ltfs_build_log_tail "${LTFS_BUILD_LOG}" 120
  if [[ -n "${LTFS_BUILD_LOG}" ]]; then
    err "Build log: ${LTFS_BUILD_LOG}"
  fi
  echo "Next steps:"
  echo "  - Review the build log and install missing build dependencies."
  echo "  - Install vendor LTFS packages (IBM LTFS, HPE StoreOpen, Quantum LTFS, etc.)."
  echo "  - Re-run this installer after LTFS tools are available."
  exit 1
}

attempt_ltfs_build() {
  warn "Attempting LTFS build-from-source fallback."
  if ! build_ltfs_from_source; then
    fail_ltfs_build
  fi
  if check_ltfs_tools; then
    ok "LTFS tools installed from source."
    print_ltfs_versions
    return 0
  fi
  fail_ltfs_build
}

detect_existing_install
if [[ "${EXISTING_INSTALL}" -eq 1 ]]; then
  read_existing_config_defaults
  info "Existing FossilSafe install detected: $(join_by ", " "${EXISTING_REASONS[@]}")"
  if [[ "${#EXISTING_BACKEND_PIDS[@]}" -gt 0 ]]; then
    warn "Backend port ${BACKEND_PORT} has listeners: $(join_by ", " "${EXISTING_BACKEND_PIDS[@]}")"
  fi

  if [[ "${INSTALL_MODE_SET}" -eq 0 ]]; then
    if [[ "${NON_INTERACTIVE}" -eq 1 ]]; then
      INSTALL_MODE="upgrade"
      INSTALL_MODE_SET=1
      info "Non-interactive mode: defaulting to upgrade."
    else
      echo ""
      info "${COLOR_BOLD}Install mode selection${COLOR_RESET}"
      echo "  1) Upgrade (default) - keep config + state, update code, restart services"
      echo "  2) Repair - reinstall code + rebuild venv/UI, keep config + state"
      echo "  3) Fresh - clean install of code + rebuild venv/UI, keep config + state"
      echo "  4) Clean install - requires --purge --yes (removes /opt, /etc, /var/lib)"
      read -r -p "Choose mode [1-3]: " install_mode_reply
      case "${install_mode_reply:-1}" in
        1|"")
          INSTALL_MODE="upgrade"
          ;;
        2)
          INSTALL_MODE="repair"
          ;;
        3)
          INSTALL_MODE="fresh"
          ;;
        4)
          err "Clean install requires --purge --yes. Re-run with those flags."
          exit 1
          ;;
        *)
          err "Invalid selection."
          exit 1
          ;;
      esac
      INSTALL_MODE_SET=1
    fi
  fi
else
  if [[ "${INSTALL_MODE_SET}" -eq 0 ]]; then
    INSTALL_MODE="install"
  fi
fi

if [[ "${INSTALL_MODE}" == "purge" && "${YES_PROVIDED}" -eq 0 ]]; then
  err "--purge requires --yes."
  exit 1
fi

if [[ "${INSTALL_MODE}" == "purge" ]]; then
  print_purge_warning
  if [[ "${NON_INTERACTIVE}" -eq 0 ]]; then
    read -r -p "Type PURGE to continue: " purge_confirm
    if [[ "${purge_confirm}" != "PURGE" ]]; then
      err "Purge aborted; confirmation did not match."
      exit 1
    fi
  fi
  purge_installation
  INSTALL_MODE="fresh"
  RESET_INSTALL_DIR=1
  REBUILD_VENV=1
  EXISTING_INSTALL=0
fi

if [[ "${INSTALL_MODE}" == "repair" || "${INSTALL_MODE}" == "fresh" ]]; then
  REBUILD_VENV=1
fi
if [[ "${INSTALL_MODE}" == "repair" || "${INSTALL_MODE}" == "fresh" ]]; then
  RESET_INSTALL_DIR=1
fi
if [[ "${EXISTING_INSTALL}" -eq 1 ]]; then
  case "${INSTALL_MODE}" in
    upgrade)
      info "Upgrade mode: keep config + state, update code, restart services."
      ;;
    repair)
      info "Repair mode: rebuild venv/UI, keep config + state."
      ;;
    fresh)
      info "Fresh mode: clean code install + rebuild venv/UI, keep config + state."
      ;;
  esac
fi

step_header "[1/${STEP_TOTAL}] Checking prerequisites" \
  "Checking prerequisites" \
  "Ensures required tools are available before installing anything." \
  "Missing system tools or running on an unsupported distro." \
  "Use Debian/Ubuntu with systemd, then re-run with sudo."

command -v apt-get >/dev/null || fail "apt-get is required to install dependencies."
if ! command -v systemctl >/dev/null; then
  warn "systemd not detected. The installer will generate a service file but will not enable it."
  HAVE_SYSTEMD=0
fi
ok "Prerequisites look good."

if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home "${INSTALL_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

step_header "[2/${STEP_TOTAL}] Detecting tape hardware" \
  "Detecting tape hardware" \
  "Installs diagnostics and checks for tape drives/changers safely." \
  "Hardware is offline or diagnostics packages are unavailable." \
  "Verify cabling/power and re-run after installing lsscsi/sg3-utils."

if [[ "${APT_UPDATED}" -eq 0 ]]; then
  apt-get update -y
  APT_UPDATED=1
fi
apt-get install -y lsscsi sg3-utils mt-st
detect_hardware
read_config_changer_path
if [[ -n "${CONFIGURED_CHANGER_PATH}" ]]; then
  CHANGER_REQUIRED=1
fi
if [[ "${HW_CHANGER_STATUS}" == yes* ]]; then
  CHANGER_REQUIRED=1
fi
if [[ "${CHANGER_REQUIRED}" -eq 1 ]]; then
  ensure_mtx_available
fi
if [[ "${HW_TAPE_NODES}" == "none" && "${HW_CHANGER_STATUS}" == "no" ]]; then
  warn "No tape hardware detected; continuing (hardware absence is a warning only)."
fi
print_hardware_box

step_header "[3/${STEP_TOTAL}] Configuration" \
  "Configuration" \
  "Collects the default ports, mode, and database location for your appliance." \
  "Invalid input or missing configuration defaults." \
  "Re-run the installer and accept defaults if unsure."

DEFAULT_HEADLESS=0
DEFAULT_BACKEND_PORT=5000
DEFAULT_UI_PORT=8080
DEFAULT_BACKEND_BIND="127.0.0.1"
DEFAULT_DB_PATH="${DATA_DIR}/lto_backup.db"

if [[ "${EXISTING_INSTALL}" -eq 1 ]]; then
  DEFAULT_HEADLESS="${HEADLESS}"
  DEFAULT_BACKEND_PORT="${BACKEND_PORT:-${DEFAULT_BACKEND_PORT}}"
  if [[ -n "${UI_PORT}" ]]; then
    DEFAULT_UI_PORT="${UI_PORT}"
  fi
  DEFAULT_BACKEND_BIND="${BACKEND_BIND:-${DEFAULT_BACKEND_BIND}}"
  DEFAULT_DB_PATH="${DB_PATH:-${DEFAULT_DB_PATH}}"
fi

BACKEND_PORT="${BACKEND_PORT:-${DEFAULT_BACKEND_PORT}}"
DB_PATH="${DB_PATH:-${DEFAULT_DB_PATH}}"
if [[ -z "${UI_PORT}" ]]; then
  UI_PORT="${DEFAULT_UI_PORT}"
fi

if [[ -t 0 && "${NON_INTERACTIVE}" -eq 0 ]]; then
  DEFAULTS_WIDTH=70
  DEFAULTS_INNER=$((DEFAULTS_WIDTH - 2))
  DEFAULTS_BORDER="$(repeat_char "${DEFAULTS_INNER}" "${BOX_H}")"

  echo ""
  info "${COLOR_BOLD}Defaults${COLOR_RESET}"
  echo "${BOX_TL}${DEFAULTS_BORDER}${BOX_TR}"
  printf "%s %-18s %s %-45s %s\n" "${BOX_V}" "Mode" "${BOX_V}" "UI (nginx + frontend)" "${BOX_V}"
  printf "%s %-18s %s %-45s %s\n" "${BOX_V}" "UI port" "${BOX_V}" "${DEFAULT_UI_PORT}" "${BOX_V}"
  printf "%s %-18s %s %-45s %s\n" "${BOX_V}" "Backend bind" "${BOX_V}" "${DEFAULT_BACKEND_BIND}" "${BOX_V}"
  printf "%s %-18s %s %-45s %s\n" "${BOX_V}" "Backend port" "${BOX_V}" "${DEFAULT_BACKEND_PORT}" "${BOX_V}"
  printf "%s %-18s %s %-45s %s\n" "${BOX_V}" "DB path" "${BOX_V}" "${DEFAULT_DB_PATH}" "${BOX_V}"
  echo "${BOX_BL}${DEFAULTS_BORDER}${BOX_BR}"

  read -r -p "Use defaults? [Y/n]: " use_defaults_reply
  if [[ "${use_defaults_reply:-}" =~ ^[Nn]$ ]]; then
    read -r -p "Install in headless mode (API only, no UI)? [y/N]: " headless_reply
    if [[ "${headless_reply:-}" =~ ^[Yy]$ ]]; then
      HEADLESS=1
    else
      HEADLESS=0
    fi

    if [[ "${HEADLESS}" -eq 0 ]]; then
      read -r -p "Enter UI port [${UI_PORT}]: " ui_port_reply
      if [[ -n "${ui_port_reply}" ]]; then
        UI_PORT="${ui_port_reply}"
      fi
    fi

    read -r -p "Enter backend port [${BACKEND_PORT}]: " backend_port_reply
    if [[ -n "${backend_port_reply}" ]]; then
      BACKEND_PORT="${backend_port_reply}"
    fi

    read -r -p "Enter backend bind [${DEFAULT_BACKEND_BIND}]: " backend_bind_reply
    if [[ -n "${backend_bind_reply}" ]]; then
      BACKEND_BIND="${backend_bind_reply}"
    fi

    if [[ "${HEADLESS}" -eq 1 && "${BACKEND_BIND}" == "0.0.0.0" ]]; then
      warn "Binding to 0.0.0.0 exposes the API on your LAN."
    elif [[ "${HEADLESS}" -eq 0 && "${BACKEND_BIND}" == "0.0.0.0" ]]; then
      if [[ "${EXISTING_INSTALL}" -eq 0 ]]; then
        warn "UI mode keeps the backend private. Forcing bind to 127.0.0.1."
        BACKEND_BIND="${DEFAULT_BACKEND_BIND}"
      else
        warn "UI mode with backend bound to 0.0.0.0 exposes the API on your LAN."
      fi
    fi

    read -r -p "Enter database path [${DB_PATH}]: " db_path_reply
    if [[ -n "${db_path_reply}" ]]; then
      DB_PATH="${db_path_reply}"
    fi

  else
    HEADLESS="${DEFAULT_HEADLESS}"
    BACKEND_PORT="${DEFAULT_BACKEND_PORT}"
    UI_PORT="${DEFAULT_UI_PORT}"
    BACKEND_BIND="${DEFAULT_BACKEND_BIND}"
    DB_PATH="${DEFAULT_DB_PATH}"
  fi
fi

BACKEND_PORT="${BACKEND_PORT:-${DEFAULT_BACKEND_PORT}}"
DB_PATH="${DB_PATH:-${DEFAULT_DB_PATH}}"

if [[ "${HEADLESS}" -eq 0 ]]; then
  UI_PORT="${UI_PORT:-${DEFAULT_UI_PORT}}"
  if [[ "${EXISTING_INSTALL}" -eq 0 ]]; then
    BACKEND_BIND="${DEFAULT_BACKEND_BIND}"
  else
    BACKEND_BIND="${BACKEND_BIND:-${DEFAULT_BACKEND_BIND}}"
  fi
else
  BACKEND_BIND="${BACKEND_BIND:-${DEFAULT_BACKEND_BIND}}"
fi

if [[ "${HEADLESS}" -eq 1 && "${BACKEND_BIND}" == "0.0.0.0" ]]; then
  warn "Binding to 0.0.0.0 exposes the API on your LAN."
elif [[ "${HEADLESS}" -eq 0 && "${BACKEND_BIND}" == "0.0.0.0" ]]; then
  if [[ "${EXISTING_INSTALL}" -eq 0 ]]; then
    warn "UI mode keeps the backend private. Forcing bind to 127.0.0.1."
    BACKEND_BIND="${DEFAULT_BACKEND_BIND}"
  else
    warn "UI mode with backend bound to 0.0.0.0 exposes the API on your LAN."
  fi
fi

ok "Configuration captured."

wait_for_url() {
  local url="$1"
  local name="$2"
  local max_seconds="${3:-60}"
  local start_time
  local elapsed

  start_time="$(date +%s)"
  while true; do
    if curl -fsS -k --max-time 2 "${url}" >/dev/null; then
      return 0
    fi
    elapsed="$(( $(date +%s) - start_time ))"
    if (( elapsed >= max_seconds )); then
      break
    fi
    sleep 2
  done

  warn "Timed out waiting for ${name} at ${url} after ${max_seconds}s"
  return 1
}

verify_installation() {
  local unit_path="/etc/systemd/system/fossilsafe.service"
  local enabled_status
  local active_status
  local health_code

  if [[ ! -f "${unit_path}" ]]; then
    err "Missing systemd unit at ${unit_path}."
    return 1
  fi
  if [[ "${HAVE_SYSTEMD}" -ne 1 ]]; then
    err "systemd not available; cannot verify service state."
    return 1
  fi
  enabled_status="$(systemctl is-enabled fossilsafe.service 2>/dev/null || true)"
  if [[ "${enabled_status}" != "enabled" ]]; then
    err "FossilSafe service is not enabled (status: ${enabled_status})."
    return 1
  fi
  active_status="$(systemctl is-active fossilsafe.service 2>/dev/null || true)"
  if [[ "${active_status}" != "active" ]]; then
    err "FossilSafe service is not active (status: ${active_status})."
    return 1
  fi
  health_code="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${BACKEND_PORT}/api/healthz" 2>/dev/null || true)"
  if [[ "${health_code}" != "200" ]]; then
    err "Backend health check failed (HTTP ${health_code})."
    return 1
  fi
  return 0
}

step_header "[4/${STEP_TOTAL}] Installing system packages" \
  "Installing system packages" \
  "Installs OS packages required for the backend, UI, and tape tooling." \
  "Package installation failed or apt sources are unavailable." \
  "Check network connectivity and apt sources, then re-run the installer."
SYSTEM_PACKAGES=(
  acl
  coreutils
  curl
  fuse3
  gzip
  lsscsi
  mt-st
  nginx
  python3
  python3-venv
  rsync
  sg3-utils
  smbclient
  cifs-utils
  tar
  util-linux
  nodejs
  npm
  certbot
  python3-certbot-nginx
)

if [[ "${HEADLESS}" -eq 1 ]]; then
  SYSTEM_PACKAGES=(
    acl
    coreutils
    curl
    fuse3
    gzip
    lsscsi
    mt-st
    python3
    python3-venv
    rsync
    sg3-utils
    smbclient
    cifs-utils
    tar
    util-linux
  )
fi

# Debian 12 ships libfuse3-3; Debian 13+ ships libfuse3-4.
if apt_package_available "libfuse3-4"; then
  SYSTEM_PACKAGES+=(libfuse3-4)
elif apt_package_available "libfuse3-3"; then
  SYSTEM_PACKAGES+=(libfuse3-3)
else
  warn "No libfuse3 runtime package found in apt; FUSE/LTFS may not work."
fi

if [[ "${CHANGER_REQUIRED}" -eq 1 ]]; then
  SYSTEM_PACKAGES+=(mtx)
fi

if [[ "${APT_UPDATED}" -eq 0 ]]; then
  apt-get update -y
  APT_UPDATED=1
fi
apt-get install -y "${SYSTEM_PACKAGES[@]}"
ok "System packages installed."

step_header "[5/${STEP_TOTAL}] Configuring sudoers hardening" \
  "Configuring sudoers hardening" \
  "Installs restricted sudo permissions for FossilSafe operations." \
  "Failed to install sudoers rule." \
  "Verify /etc/sudoers.d permissions."

SUDOERS_SRC="${SOURCE_ROOT}/scripts/setup/sudoers-fossilsafe"
if [[ -f "$SUDOERS_SRC" ]]; then
    sed -e "s|fossilsafe|${SERVICE_USER}|g" "$SUDOERS_SRC" > /etc/sudoers.d/fossilsafe
    chmod 440 /etc/sudoers.d/fossilsafe
    ok "Sudoers rules installed."
else
    warn "Sudoers source not found at ${SUDOERS_SRC}; skipping hardening."
fi
check_fuse_requirements

command -v python3 >/dev/null || fail "python3 is required"
command -v curl >/dev/null || fail "curl is required"

if [[ "${HEADLESS}" -eq 0 ]]; then
  command -v npm >/dev/null || fail "npm is required for UI build"
  command -v nginx >/dev/null || fail "nginx is required for UI mode"
fi

step_header "[5/${STEP_TOTAL}] LTFS readiness" \
  "LTFS readiness" \
  "Verifies mkltfs/ltfs/ltfsck and offers a safe fallback if missing." \
  "LTFS tools missing or vendor packages unavailable." \
  "Install vendor LTFS packages or choose the build-from-source option."

if ! check_ltfs_tools; then
  prompt_ltfs_action
  attempt_ltfs_build
fi
if [[ "${LTFS_STATUS}" == "ready" ]]; then
  print_ltfs_versions
fi

step_header "[6/${STEP_TOTAL}] Creating virtualenv" \
  "Creating virtualenv" \
  "Isolates Python dependencies from the system to keep upgrades safe." \
  "Virtualenv creation failed." \
  "Ensure python3-venv is installed and re-run the installer."

if [[ "${RESET_INSTALL_DIR}" -eq 1 && -d "${INSTALL_DIR}" ]]; then
  info "Removing existing install directory for fresh install."
  rm -rf "${INSTALL_DIR}"
fi

if [[ "${REBUILD_VENV}" -eq 1 && -d "${VENV_DIR}" ]]; then
  info "Removing existing virtualenv for rebuild."
  rm -rf "${VENV_DIR}"
fi

mkdir -p "${INSTALL_DIR}"

if [[ ! -d "${VENV_DIR}" ]]; then
  # Use a virtualenv to avoid Debian 12's PEP 668 externally-managed environment.
  python3 -m venv "${VENV_DIR}"
fi
ok "Virtual environment ready at ${VENV_DIR}."

install -d -m 0750 -o root -g "${SERVICE_USER}" "$(dirname "${CONFIG_PATH}")"
install -d -m 0700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DATA_DIR}"
DB_DIR="$(dirname "${DB_PATH}")"
install -d -m 0700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DB_DIR}"
install -d -m 0700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${STAGING_DIR}"
install -d -m 0700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${CATALOG_BACKUP_DIR}"

if [[ "${EXISTING_INSTALL}" -eq 1 ]]; then
  info "Backing up existing config/database before changes..."
  backup_existing_install
fi

API_KEY="${FOSSILSAFE_API_KEY:-}"
ALLOWED_ORIGINS="${FOSSILSAFE_CORS_ORIGINS:-}"

if [[ -n "${API_KEY}" ]]; then
  API_KEY_SOURCE="provided"
else
  API_KEY_SOURCE="existing"
  API_KEY="$(CONFIG_PATH="${CONFIG_PATH}" python3 - <<'PY'
import json
import os
import sys

path = os.environ.get("CONFIG_PATH")
if not path or not os.path.exists(path):
    sys.exit(0)
try:
    with open(path, "r") as handle:
        data = json.load(handle) or {}
    key = data.get("api_key") or data.get("API_KEY") or ""
    if isinstance(key, str):
        print(key)
except Exception:
    pass
PY
  )"
fi

if [[ -z "${API_KEY}" ]]; then
  API_KEY_SOURCE="generated"
  API_KEY="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
  )"
fi

API_KEY="${API_KEY}" \
CONFIG_PATH="${CONFIG_PATH}" \
DB_PATH="${DB_PATH}" \
CREDENTIAL_KEY_PATH="${CREDENTIAL_KEY_PATH}" \
CATALOG_BACKUP_DIR="${CATALOG_BACKUP_DIR}" \
BACKEND_PORT="${BACKEND_PORT}" \
BACKEND_BIND="${BACKEND_BIND}" \
UI_PORT="${UI_PORT}" \
HEADLESS="${HEADLESS}" \
ALLOWED_ORIGINS="${ALLOWED_ORIGINS}" \
SECURE_MODE="${SECURE_MODE}" \
python3 - <<'PY'
import json
import os

path = os.environ["CONFIG_PATH"]
db_path = os.environ["DB_PATH"]
credential_key_path = os.environ["CREDENTIAL_KEY_PATH"]
catalog_backup_dir = os.environ["CATALOG_BACKUP_DIR"]
api_key = os.environ["API_KEY"]
backend_port = int(os.environ["BACKEND_PORT"])
backend_bind = os.environ["BACKEND_BIND"]
ui_port = os.environ.get("UI_PORT")
headless = os.environ.get("HEADLESS") == "1"
origins_raw = os.environ.get("ALLOWED_ORIGINS") or ""

data = {}
if os.path.exists(path):
    try:
        with open(path, "r") as handle:
            data = json.load(handle) or {}
    except Exception:
        data = {}

allowed_origins = [o.strip() for o in origins_raw.split(",") if o.strip()] if origins_raw else []

uppercase_keys = [
    "DB_PATH",
    "CREDENTIAL_KEY_PATH",
    "CATALOG_BACKUP_DIR",
    "API_KEY",
    "BACKEND_PORT",
    "BACKEND_BIND",
    "UI_PORT",
    "HEADLESS",
    "ALLOWED_ORIGINS",
]
for key in uppercase_keys:
    data.pop(key, None)

data["db_path"] = db_path
data["credential_key_path"] = credential_key_path
data["catalog_backup_dir"] = catalog_backup_dir
data["api_key"] = api_key
data["backend_port"] = backend_port
data["backend_bind"] = backend_bind
data["ui_port"] = int(ui_port) if ui_port else None
data["headless"] = headless
data["allowed_origins"] = allowed_origins

data["setup_mode"] = os.environ.get("SECURE_MODE") or "relaxed"

with open(path, "w") as handle:
    json.dump(data, handle, indent=2, sort_keys=True)
PY

chown root:"${SERVICE_USER}" "${CONFIG_PATH}"
chmod 0640 "${CONFIG_PATH}"

step_header "[7/${STEP_TOTAL}] Installing Python dependencies" \
  "Installing Python dependencies" \
  "Installs backend requirements into the virtualenv." \
  "Copying application files or installing dependencies failed." \
  "Verify disk space and re-run the installer."

SOURCE_REQUIREMENTS="${SOURCE_ROOT}/requirements.txt"
SOURCE_BACKEND_ENTRYPOINT="${SOURCE_ROOT}/backend/lto_backend_main.py"

if [[ ! -f "${SOURCE_REQUIREMENTS}" ]]; then
  fail "Missing requirements.txt at ${SOURCE_REQUIREMENTS}"
fi

if [[ ! -f "${SOURCE_BACKEND_ENTRYPOINT}" ]]; then
  fail "Missing backend entrypoint at ${SOURCE_BACKEND_ENTRYPOINT}"
fi

if [[ ! -f "${SOURCE_REQUIREMENTS}" ]]; then
  fail "Missing requirements.txt at ${SOURCE_REQUIREMENTS}"
fi

"${VENV_DIR}/bin/pip" install -r "${SOURCE_REQUIREMENTS}"
ok "Python dependencies installed."

step_header "[8/${STEP_TOTAL}] Installing FossilSafe files" \
  "Installing FossilSafe files" \
  "Copies backend and UI source files into the install directory." \
  "Copying application files failed." \
  "Verify disk space and re-run the installer."

if command -v rsync >/dev/null; then
  rsync -a --delete "${SOURCE_ROOT}/backend" "${INSTALL_DIR}/"
  rsync -a --delete "${SOURCE_ROOT}/frontend" "${INSTALL_DIR}/"
  rsync -a --delete "${SOURCE_ROOT}/packaging" "${INSTALL_DIR}/"
  rsync -a "${SOURCE_ROOT}/gunicorn.conf.py" "${INSTALL_DIR}/gunicorn.conf.py"
  rsync -a "${SOURCE_ROOT}/scripts/fossilsafe_cli.py" "${INSTALL_DIR}/fsafe-cli.py"
  rsync -a "${SOURCE_REQUIREMENTS}" "${INSTALL_DIR}/requirements.txt"
else
  rm -rf "${INSTALL_DIR}/backend" "${INSTALL_DIR}/frontend" "${INSTALL_DIR}/packaging"
  cp -a "${SOURCE_ROOT}/backend" "${INSTALL_DIR}/backend"
  cp -a "${SOURCE_ROOT}/frontend" "${INSTALL_DIR}/frontend"
  cp -a "${SOURCE_ROOT}/packaging" "${INSTALL_DIR}/packaging"
  cp -a "${SOURCE_ROOT}/gunicorn.conf.py" "${INSTALL_DIR}/gunicorn.conf.py"
  cp -a "${SOURCE_ROOT}/scripts/fossilsafe_cli.py" "${INSTALL_DIR}/fsafe-cli.py"
  cp -a "${SOURCE_REQUIREMENTS}" "${INSTALL_DIR}/requirements.txt"
fi

if [[ ! -f "${INSTALL_DIR}/requirements.txt" ]]; then
  fail "requirements.txt was not copied to ${INSTALL_DIR}"
fi

if [[ ! -f "${INSTALL_DIR}/backend/lto_backend_main.py" ]]; then
  fail "Backend entrypoint missing at ${INSTALL_DIR}/backend/lto_backend_main.py"
fi
if [[ ! -f "${INSTALL_DIR}/gunicorn.conf.py" ]]; then
  fail "Gunicorn config missing at ${INSTALL_DIR}/gunicorn.conf.py"
fi

if [[ ! -f "${INSTALL_DIR}/backend/__init__.py" ]]; then
  info "backend/__init__.py missing in install tree; creating placeholder."
  touch "${INSTALL_DIR}/backend/__init__.py"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}/backend/__init__.py"
  chmod 0644 "${INSTALL_DIR}/backend/__init__.py"
fi

ok "Application files installed to ${INSTALL_DIR}."

step_header "[9/${STEP_TOTAL}] Validating backend imports" \
  "Validating backend imports" \
  "Checks the backend entrypoint can import cleanly." \
  "Backend import validation failed." \
  "Reinstall dependencies or verify backend package imports."

if ! sudo -u "${SERVICE_USER}" bash -lc "cd ${INSTALL_DIR@Q} && ${VENV_DIR@Q}/bin/python -c \"from backend.lto_backend_main import app; print('IMPORT_OK')\""; then
  fail "Backend import check failed."
fi
ok "Backend import validation passed."

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  fail "Virtualenv python not found at ${VENV_DIR}/bin/python"
fi

step_header "[10/${STEP_TOTAL}] Configuring services" \
  "Configuring services" \
  "Writes configuration, sets permissions, and prepares systemd/nginx." \
  "Configuration or systemd unit creation failed." \
  "Verify permissions under /etc and try again."

python3 - <<PY
import json
from pathlib import Path

state_path = Path(${STATE_PATH@Q})
state_path.parent.mkdir(parents=True, exist_ok=True)
if not state_path.exists():
    state_path.write_text(json.dumps({}, indent=2, sort_keys=True))
PY

if [[ ! -f "${DB_PATH}" ]]; then
  info "Database not found; initializing new database at ${DB_PATH}."
  if ! sudo -u "${SERVICE_USER}" env DB_PATH="${DB_PATH}" PYTHONPATH="${INSTALL_DIR}" \
    "${VENV_DIR}/bin/python" - <<'PY'
import os
from backend.database import Database

Database(os.environ["DB_PATH"])
PY
  then
    fail "Database initialization failed."
  fi
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${CATALOG_BACKUP_DIR}"
chmod 0750 "${DATA_DIR}"
chmod 0750 "${CATALOG_BACKUP_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
chown root:"${SERVICE_USER}" "$(dirname "${CONFIG_PATH}")"
chmod 0750 "$(dirname "${CONFIG_PATH}")"
chown root:"${SERVICE_USER}" "${CONFIG_PATH}"
chmod 0640 "${CONFIG_PATH}"
chmod 600 "${STATE_PATH}"

if [[ ! -f "${CREDENTIAL_KEY_PATH}" ]]; then
  info "Credential key not found; creating at ${CREDENTIAL_KEY_PATH}."
  if ! sudo -u "${SERVICE_USER}" env CREDENTIAL_KEY_PATH="${CREDENTIAL_KEY_PATH}" \
    "${VENV_DIR}/bin/python" - <<'PY'
import os
from pathlib import Path

from cryptography.fernet import Fernet

key_path = Path(os.environ["CREDENTIAL_KEY_PATH"])
key_path.parent.mkdir(parents=True, exist_ok=True)
if not key_path.exists():
    key = Fernet.generate_key()
    key_path.write_bytes(key)
    os.chmod(key_path, 0o600)
PY
  then
    fail "Credential key creation failed."
  fi
fi

# Install fsafe-cli wrapper
F_CLI_BIN="/usr/local/bin/fsafe-cli"
info "Installing unified CLI to ${F_CLI_BIN}"
cat > "${F_CLI_BIN}" <<EOF
#!/usr/bin/env bash
# FossilSafe Unified CLI Wrapper
export FOSSILSAFE_API_URL="http://127.0.0.1:${BACKEND_PORT}"
${VENV_DIR}/bin/python ${INSTALL_DIR}/fsafe-cli.py "\$@"
EOF
chmod 0755 "${F_CLI_BIN}"

ROTATE_SCRIPT="/usr/local/bin/fossilsafe-rotate-key"
cat > "${ROTATE_SCRIPT}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${FOSSILSAFE_CONFIG_PATH:-/etc/fossilsafe/config.json}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This command must be run as root. Try: sudo fossilsafe-rotate-key" >&2
  exit 1
fi

NEW_KEY="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
)"

python3 - <<PY
import json
import os
import sys

config_path = ${CONFIG_PATH@Q}
new_key = ${NEW_KEY@Q}
domain = ${DOMAIN@Q}
email = ${EMAIL@Q}

if not os.path.exists(config_path):
    print(f"Config file not found at {config_path}.", file=sys.stderr)
    sys.exit(1)

with open(config_path, "r") as handle:
    data = json.load(handle) or {}
data.pop("API_KEY", None)
data["api_key"] = new_key
if domain and domain != "fossilsafe.local":
    data["domain"] = domain
if email:
    data["email"] = email

with open(config_path, "w") as handle:
    json.dump(data, handle, indent=2, sort_keys=True)
PY

chmod 0640 "${CONFIG_PATH}"
chown root:"${SERVICE_USER}" "${CONFIG_PATH}"

systemctl restart fossilsafe.service
echo "New API key (save this now): ${NEW_KEY}"
EOF
chmod 750 "${ROTATE_SCRIPT}"

TAPE_GROUP="fossilsafe-tape"
UDEV_RULES_FILE="/etc/udev/rules.d/99-fossilsafe-tape.rules"
cat > "${UDEV_RULES_FILE}" <<EOF
SUBSYSTEM=="scsi_generic", ATTRS{type}=="8", SYMLINK+="fossilsafe-changer", GROUP="${TAPE_GROUP}", MODE="0660"
SUBSYSTEM=="scsi_generic", ATTRS{type}=="1", SYMLINK+="fossilsafe-drive-sg", GROUP="${TAPE_GROUP}", MODE="0660"
SUBSYSTEM=="scsi_tape", KERNEL=="nst*", SYMLINK+="fossilsafe-drive-nst", GROUP="${TAPE_GROUP}", MODE="0660"
SUBSYSTEM=="scsi_tape", KERNEL=="st*", GROUP="${TAPE_GROUP}", MODE="0660"
EOF

if ! getent group "${TAPE_GROUP}" >/dev/null 2>&1; then
  groupadd --system "${TAPE_GROUP}"
fi
usermod -aG "${TAPE_GROUP}" "${SERVICE_USER}"

if ! getent group "${TAPE_GROUP}" >/dev/null 2>&1; then
  fail "Required group ${TAPE_GROUP} was not created; create it and re-run installer."
fi
if ! id -nG "${SERVICE_USER}" | tr ' ' '\n' | grep -qx "${TAPE_GROUP}"; then
  fail "User ${SERVICE_USER} is not in ${TAPE_GROUP}; add with: usermod -aG ${TAPE_GROUP} ${SERVICE_USER}"
fi

if ! udevadm control --reload-rules; then
  warn "Failed to reload udev rules. You may need to run: sudo udevadm control --reload-rules"
fi
if ! udevadm trigger --subsystem-match=scsi_generic --subsystem-match=scsi_tape --subsystem-match=tape; then
  warn "Failed to trigger udev for tape devices. You may need to replug the tape hardware."
fi

SERVICE_FILE="/etc/systemd/system/fossilsafe.service"
SERVICE_TEMPLATE="${SOURCE_ROOT}/packaging/fossilsafe.service"
if [[ ! -f "${SERVICE_TEMPLATE}" ]]; then
  fail "Missing systemd service template at ${SERVICE_TEMPLATE}"
fi
if [[ "${HAVE_SYSTEMD}" -eq 1 ]]; then
  if ! handle_port_conflict "${BACKEND_PORT}" "backend"; then
    record_failure "handle_port_conflict ${BACKEND_PORT} backend" 1
    exit 1
  fi
fi
SERVICE_TEMPLATE="${SERVICE_TEMPLATE}" \
INSTALL_DIR="${INSTALL_DIR}" \
CONFIG_PATH="${CONFIG_PATH}" \
DATA_DIR="${DATA_DIR}" \
BACKEND_BIND="${BACKEND_BIND}" \
BACKEND_PORT="${BACKEND_PORT}" \
SERVICE_USER="${SERVICE_USER}" \
TAPE_GROUP="${TAPE_GROUP}" \
VENV_DIR="${VENV_DIR}" \
python3 - <<'PY'
import os
from pathlib import Path

template_path = Path(os.environ["SERVICE_TEMPLATE"])
service_path = Path("/etc/systemd/system/fossilsafe.service")

replacements = {
    "{{INSTALL_DIR}}": os.environ["INSTALL_DIR"],
    "{{CONFIG_PATH}}": os.environ["CONFIG_PATH"],
    "{{DATA_DIR}}": os.environ["DATA_DIR"],
    "{{BACKEND_BIND}}": os.environ["BACKEND_BIND"],
    "{{BACKEND_PORT}}": os.environ["BACKEND_PORT"],
    "{{SERVICE_USER}}": os.environ["SERVICE_USER"],
    "{{TAPE_GROUP}}": os.environ["TAPE_GROUP"],
    "{{VENV_DIR}}": os.environ["VENV_DIR"],
}

content = template_path.read_text()
for token, value in replacements.items():
    content = content.replace(token, value)

service_path.write_text(content)
PY

if [[ "${HAVE_SYSTEMD}" -eq 1 ]]; then
  systemctl daemon-reload
fi

if [[ "${HEADLESS}" -eq 0 ]]; then
  UI_SOURCE_DIR="${INSTALL_DIR}/frontend"
  WEB_ROOT="/var/www/fossilsafe"
  SKIP_UI_BUILD=0

  if [[ "${FOSSILSAFE_PREBUILT:-0}" -eq 1 ]]; then
    info "FOSSILSAFE_PREBUILT=1 detected, skipping frontend build."
    SKIP_UI_BUILD=1
  elif [[ -d "${UI_SOURCE_DIR}/dist" ]]; then
    info "Pre-built frontend assets found in ${UI_SOURCE_DIR}/dist, skipping build."
    SKIP_UI_BUILD=1
  fi

  if [[ "${SKIP_UI_BUILD}" -eq 0 ]]; then
    info "Building frontend assets (this can take a few minutes)..."
    NPM_CACHE_DIR="${INSTALL_DIR}/.npm-cache"
    prepare_ui_build_log
    : > "${UI_BUILD_LOG}"
    repair_frontend_permissions "${UI_SOURCE_DIR}" "${SERVICE_USER}" "${SERVICE_USER}"
    install -d -m 0750 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${NPM_CACHE_DIR}"
    # Enforce lockfile-backed installs for deterministic UI builds.
    if [[ ! -f "${UI_SOURCE_DIR}/package-lock.json" ]]; then
      fail "Missing frontend/package-lock.json. Run: cd frontend && npm install && commit package-lock.json"
    fi
    if ! sudo -u "${SERVICE_USER}" -H env NPM_CONFIG_CACHE="${NPM_CACHE_DIR}" \
      bash -lc "cd ${UI_SOURCE_DIR@Q} && npm ci --no-audit --no-fund" >>"${UI_BUILD_LOG}" 2>&1; then
      err "Frontend dependency install failed. Last 120 lines:"
      tail -n 120 "${UI_BUILD_LOG}" >&2 || true
      warn "Full npm output: ${UI_BUILD_LOG}"
      record_failure "npm ci --no-audit --no-fund" 1
      exit 1
    fi
    if ! sudo -u "${SERVICE_USER}" -H env NPM_CONFIG_CACHE="${NPM_CACHE_DIR}" \
      bash -lc "cd ${UI_SOURCE_DIR@Q} && npm run build" >>"${UI_BUILD_LOG}" 2>&1; then
      err "Frontend build failed. Last 120 lines:"
      tail -n 120 "${UI_BUILD_LOG}" >&2 || true
      warn "Full npm output: ${UI_BUILD_LOG}"
      record_failure "npm run build" 1
      exit 1
    fi
    verify_ui_assets "${UI_SOURCE_DIR}/dist" "build output"
  fi

  mkdir -p "${WEB_ROOT}"
  rm -rf "${WEB_ROOT:?}/"*
  cp -a "${UI_SOURCE_DIR}/dist/." "${WEB_ROOT}/"
  verify_ui_assets "${WEB_ROOT}" "web root"

  NGINX_CONF="/etc/nginx/sites-available/fossilsafe.conf"
  CERT_PATH="/etc/fossilsafe/certs/server.crt"
  KEY_PATH="/etc/fossilsafe/certs/server.key"

  # Certificate generation/presence check
  if [[ ! -f "${CERT_PATH}" || ! -f "${KEY_PATH}" ]]; then
    info "SSL certificates not found. Generating self-signed certificates for ${DOMAIN}..."
    bash "${SOURCE_ROOT}/scripts/setup/generate-cert.sh" "${DOMAIN}"
  fi

  {
    # Always redirect HTTP to HTTPS
    cat <<EOF
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name ${DOMAIN} _;
  return 301 https://\$host\$request_uri;
}
EOF

    cat <<EOF
server {
  listen ${UI_PORT} ssl http2;
  listen [::]:${UI_PORT} ssl http2;
  server_name ${DOMAIN};

  ssl_certificate ${CERT_PATH};
  ssl_certificate_key ${KEY_PATH};

  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
  ssl_prefer_server_ciphers off;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 1d;
  ssl_session_tickets off;

  # Security Headers
  add_header X-Frame-Options DENY always;
  add_header X-Content-Type-Options nosniff always;
  add_header X-XSS-Protection "1; mode=block" always;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'; connect-src 'self' ws: wss: http: https:;" always;

  root ${WEB_ROOT};
  index index.html;

  location / {
    try_files \$uri /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:${BACKEND_PORT};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /socket.io/ {
    proxy_pass http://127.0.0.1:${BACKEND_PORT};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF
  } > "${NGINX_CONF}"

  rm -f /etc/nginx/sites-enabled/default
  ln -sf "${NGINX_CONF}" /etc/nginx/sites-enabled/fossilsafe.conf

  if [[ -n "${EMAIL}" && "${DOMAIN}" != "fossilsafe.local" && "${DOMAIN}" != "localhost" ]]; then
    info "Attempting to obtain Let's Encrypt certificate for ${DOMAIN}..."
    if command -v certbot >/dev/null; then
      if certbot --nginx --non-interactive --agree-tos --email "${EMAIL}" -d "${DOMAIN}"; then
        ok "Let's Encrypt certificate obtained and installed."
      else
        warn "Certbot failed to obtain a certificate. Falling back to self-signed."
      fi
    else
      warn "Certbot not found; skipping Let's Encrypt setup."
    fi
  fi

  if [[ "${HAVE_SYSTEMD}" -eq 1 ]]; then
    if ! handle_port_conflict "${UI_PORT}" "ui"; then
      record_failure "handle_port_conflict ${UI_PORT} ui" 1
      exit 1
    fi
  fi
  nginx -t
  systemctl restart nginx
  ok "UI assets built and nginx configured."
else
  warn "Headless mode enabled; skipping UI build and nginx."
fi

if [[ "${HAVE_SYSTEMD}" -eq 1 ]]; then
  if ! systemctl enable --now fossilsafe.service >/dev/null 2>&1; then
    err "Failed to enable/start fossilsafe.service."
    warn "systemctl status fossilsafe --no-pager -l"
    systemctl status fossilsafe --no-pager -l || true
    warn "journalctl -u fossilsafe -n 120 --no-pager -l"
    journalctl -u fossilsafe -n 120 --no-pager -l || true
    record_failure "systemctl enable --now fossilsafe.service" 1
    exit 1
  fi
fi

step_header "[11/${STEP_TOTAL}] Starting & verifying" \
  "Starting & verifying" \
  "Starts FossilSafe and confirms the backend is responding." \
  "The service failed to start or systemd could not enable it." \
  "Check: systemctl status fossilsafe.service"

if [[ "${HAVE_SYSTEMD}" -eq 1 ]]; then
  SERVICE_ACTIVE="$(systemctl is-active fossilsafe.service 2>/dev/null || true)"
  if [[ "${SERVICE_ACTIVE}" != "active" ]]; then
    err "FossilSafe service failed to start."
    warn "systemctl status fossilsafe --no-pager -l"
    systemctl status fossilsafe --no-pager -l || true
    warn "journalctl -u fossilsafe -n 120 --no-pager -l"
    journalctl -u fossilsafe -n 120 --no-pager -l || true
    record_failure "systemctl is-active fossilsafe.service" 1
    exit 1
  fi

  if wait_for_url "http://127.0.0.1:${BACKEND_PORT}/api/healthz" "Backend health endpoint" 60; then
    ok "Backend health endpoint is responding."
    SERVICE_HEALTHY=1
  else
    err "Backend did not become healthy."
    warn "journalctl -u fossilsafe -n 120 --no-pager -l"
    journalctl -u fossilsafe -n 120 --no-pager -l || true
    record_failure "curl http://127.0.0.1:${BACKEND_PORT}/api/healthz" 1
    exit 1
  fi

  if ! verify_installation; then
    warn "systemctl status fossilsafe --no-pager -l"
    systemctl status fossilsafe --no-pager -l || true
    warn "journalctl -u fossilsafe -n 120 --no-pager -l"
    journalctl -u fossilsafe -n 120 --no-pager -l || true
    record_failure "final verification" 1
    exit 1
  fi
else
  err "systemd not available; cannot verify service state."
  record_failure "systemd unavailable" 1
  exit 1
fi

if [[ -x "${SCRIPT_DIR}/smoke_test.sh" ]]; then
  info "Running smoke tests..."
  smoke_output="$(mktemp)"
  smoke_status=0
  smoke_env=(
    "API_KEY=${API_KEY}"
    "BACKEND_PORT=${BACKEND_PORT}"
    "UI_PORT=${UI_PORT}"
    "HEADLESS=${HEADLESS}"
    "PYTHON_BIN=${VENV_DIR}/bin/python"
  )
  set +e
  env "${smoke_env[@]}" "${SCRIPT_DIR}/smoke_test.sh" >"${smoke_output}" 2>&1
  smoke_status=$?
  set -e
  if [[ "${smoke_status}" -ne 0 ]]; then
    err "Smoke tests failed (exit ${smoke_status})."
    err "Smoke test command: env ${smoke_env[*]} ${SCRIPT_DIR}/smoke_test.sh"
    err "Smoke test output (tail):"
    tail -n 120 "${smoke_output}" >&2 || true
    err "Rerun command: env ${smoke_env[*]} ${SCRIPT_DIR}/smoke_test.sh"
    rm -f "${smoke_output}"
    record_failure "smoke tests" "${smoke_status}"
    exit "${smoke_status}"
  fi
  cat "${smoke_output}"
  rm -f "${smoke_output}"
  ok "Smoke tests passed."
else
  warn "Smoke test script not found at ${SCRIPT_DIR}/smoke_test.sh"
fi

echo ""
ok "FossilSafe install complete."
exit 0
