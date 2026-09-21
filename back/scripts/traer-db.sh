#!/usr/bin/env bash
#
# Trae desde el servidor una copia *consistente* de la base de Trilium.
#
# Por qué no basta un scp: Trilium corre en journal_mode=wal, así que las
# escrituras recientes viven en document.db-wal hasta el siguiente checkpoint.
# Copiar sólo document.db se trae el estado del último checkpoint, no lo que
# se ve en la interfaz — y falla en silencio: llegan los cambios viejos, no
# los de las últimas horas. `sqlite3 .backup` en el servidor resuelve el
# snapshot con el WAL incluido (es lo mismo que hace el cron de producción).
#
# Configuración: exportar las dos variables, o dejarlas en un .env en la raíz
# del repo (no versionado):
#
#   TRILIUM_SSH_HOST=<alias-de-ssh-config>
#   TRILIUM_REMOTE_DB=/ruta/en/el/servidor/trilium-data/document.db
#
# Uso: ./back/scripts/traer-db.sh

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[ -f "$RAIZ/.env" ] && set -a && . "$RAIZ/.env" && set +a

: "${TRILIUM_SSH_HOST:?falta TRILIUM_SSH_HOST (exportarla o ponerla en .env)}"
: "${TRILIUM_REMOTE_DB:?falta TRILIUM_REMOTE_DB (exportarla o ponerla en .env)}"

DESTINO="$RAIZ/back/database/document.db"
TMP_REMOTO="/tmp/tres-snapshot-$$.db"

echo "→ snapshot consistente en el servidor"
ssh "$TRILIUM_SSH_HOST" "sqlite3 '$TRILIUM_REMOTE_DB' \".backup '$TMP_REMOTO'\""

echo "→ copiando a back/database/"
scp "$TRILIUM_SSH_HOST:$TMP_REMOTO" "$DESTINO"
ssh "$TRILIUM_SSH_HOST" "rm -f '$TMP_REMOTO'"

# Un -wal/-shm viejo junto a una base nueva sí corrompe: se borran siempre.
rm -f "$DESTINO-wal" "$DESTINO-shm"

echo "→ última modificación registrada (UTC): $(sqlite3 "$DESTINO" 'select max(utcDateModified) from notes;')"
echo "   (la máquina es CST/UTC−6; si esto queda muy atrás, el snapshot no trajo el WAL)"
echo
echo "Listo. Reiniciar la app si estaba corriendo: la ruta de la BD se resuelve al cargar el módulo."
