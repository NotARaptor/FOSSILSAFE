#!/bin/bash
# FossilSafe Installation Script
# Generates and installs the systemd service unit from template

set -e

# Defaults (can be overridden via environment or arguments)
INSTALL_DIR="${FOSSILSAFE_INSTALL_DIR:-/opt/fossilsafe}"
SERVICE_USER="${FOSSILSAFE_SERVICE_USER:-fossilsafe}"
SERVICE_GROUP="${FOSSILSAFE_SERVICE_GROUP:-fossilsafe}"
TAPE_GROUP="${FOSSILSAFE_TAPE_GROUP:-tape}"
CONFIG_PATH="${FOSSILSAFE_CONFIG_PATH:-/etc/fossilsafe}"
DATA_DIR="${FOSSILSAFE_DATA_DIR:-/var/lib/fossilsafe}"
BIND_ADDRESS="${FOSSILSAFE_BACKEND_BIND:-0.0.0.0}"
BIND_PORT="${FOSSILSAFE_BACKEND_PORT:-5000}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TEMPLATE="${REPO_ROOT}/packaging/fossilsafe.service"
OUTPUT="/etc/systemd/system/fossilsafe.service"

usage() {
    echo "Usage: $0 [--install-dir DIR] [--user USER] [--group GROUP] [--tape-group GROUP]"
    echo ""
    echo "Generates the systemd unit file from template and installs it."
    echo ""
    echo "Options:"
    echo "  --install-dir DIR     Installation directory (default: /opt/fossilsafe)"
    echo "  --user USER           Service user (default: fossilsafe)"
    echo "  --group GROUP         Service group (default: fossilsafe)"
    echo "  --tape-group GROUP    Tape device group (default: tape)"
    echo "  --config-path DIR     Config directory (default: /etc/fossilsafe)"
    echo "  --data-dir DIR        Data directory (default: /var/lib/fossilsafe)"
    echo "  --help                Show this help"
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --install-dir) INSTALL_DIR="$2"; shift 2;;
        --user) SERVICE_USER="$2"; shift 2;;
        --group) SERVICE_GROUP="$2"; shift 2;;
        --tape-group) TAPE_GROUP="$2"; shift 2;;
        --config-path) CONFIG_PATH="$2"; shift 2;;
        --data-dir) DATA_DIR="$2"; shift 2;;
        --help) usage;;
        *) echo "Unknown option: $1"; usage;;
    esac
done

echo "FossilSafe Service Installer"
echo "============================"
echo "Install directory: $INSTALL_DIR"
echo "Service user: $SERVICE_USER"
echo "Service group: $SERVICE_GROUP"
echo "Tape group: $TAPE_GROUP"
echo "Config path: $CONFIG_PATH"
echo "Data directory: $DATA_DIR"
echo ""

# Check for root
if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script must be run as root (for systemd installation)"
    exit 1
fi

# Check template exists
if [[ ! -f "$TEMPLATE" ]]; then
    echo "ERROR: Template not found: $TEMPLATE"
    exit 1
fi

# Create service user if needed
if ! id "$SERVICE_USER" &>/dev/null; then
    echo "Creating service user: $SERVICE_USER"
    useradd --system --user-group --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# Create directories
echo "Creating directories..."
mkdir -p "$CONFIG_PATH" "$DATA_DIR" /mnt/fossilsafe/nfs /mnt/fossilsafe/external
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$DATA_DIR"
chmod 750 "$DATA_DIR"

# Generate unit file
echo "Generating systemd unit file..."
VENV_DIR="${INSTALL_DIR}/venv"
# CONFIG_PATH may be a dir (/etc/fossilsafe) or the config.json file itself
if [[ -d "${CONFIG_PATH}" ]]; then
    CONFIG_FILE="${CONFIG_PATH%/}/config.json"
else
    CONFIG_FILE="${CONFIG_PATH}"
fi
sed \
    -e "s|{{INSTALL_DIR}}|$INSTALL_DIR|g" \
    -e "s|{{SERVICE_USER}}|$SERVICE_USER|g" \
    -e "s|{{SERVICE_GROUP}}|$SERVICE_GROUP|g" \
    -e "s|{{TAPE_GROUP}}|$TAPE_GROUP|g" \
    -e "s|{{CONFIG_PATH}}|$CONFIG_FILE|g" \
    -e "s|{{DATA_DIR}}|$DATA_DIR|g" \
    -e "s|{{BACKEND_BIND}}|$BIND_ADDRESS|g" \
    -e "s|{{BACKEND_PORT}}|$BIND_PORT|g" \
    -e "s|{{VENV_DIR}}|$VENV_DIR|g" \
    "$TEMPLATE" > "$OUTPUT"

chmod 644 "$OUTPUT"

# Install sudoers if present
SUDOERS_SRC="${SCRIPT_DIR}/sudoers-fossilsafe"
if [[ -f "$SUDOERS_SRC" ]]; then
    echo "Installing sudoers rules..."
    sed -e "s|fossilsafe|$SERVICE_USER|g" "$SUDOERS_SRC" > /etc/sudoers.d/fossilsafe
    chmod 440 /etc/sudoers.d/fossilsafe
fi

# Reload systemd
echo "Reloading systemd daemon..."
systemctl daemon-reload

echo ""
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Copy application files to $INSTALL_DIR"
echo "  2. Install Python dependencies: pip install -r requirements.txt"
echo "  3. Enable service: systemctl enable fossilsafe"
echo "  4. Start service: systemctl start fossilsafe"
echo "  5. Check status: systemctl status fossilsafe"
