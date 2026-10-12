#!/usr/bin/env bash
# Diagnóstico de solo lectura para el mini PC. No cambia nada del sistema.
# Uso: bash scripts/diagnostico.sh > diagnostico.txt
section() { printf '\n== %s ==\n' "$1"; }

section "Sistema"
uname -sr
. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
echo "Sesión: ${XDG_SESSION_TYPE:-?} ${XDG_CURRENT_DESKTOP:-}"

section "GPU"
lspci 2>/dev/null | grep -iE 'vga|display|3d' || echo "lspci no disponible"
if command -v vainfo >/dev/null; then
  vainfo 2>/dev/null | grep -E 'Driver version|VAProfileH264|VAProfileHEVC|VAProfileAV1' || echo "vainfo sin perfiles"
else
  echo "vainfo no instalado (paquete libva-utils): no se puede comprobar VA-API"
fi

section "Pantallas"
if command -v wlr-randr >/dev/null; then wlr-randr 2>/dev/null | grep -E '^[^ ]|current'
elif command -v xrandr >/dev/null; then xrandr 2>/dev/null | grep -E ' connected|\*'
else echo "ni wlr-randr ni xrandr disponibles"; fi

section "Audio"
if command -v wpctl >/dev/null; then wpctl status 2>/dev/null | sed -n '/Sinks:/,/Sources:/p'
elif command -v pactl >/dev/null; then pactl list short sinks 2>/dev/null
else echo "ni wpctl ni pactl disponibles"; fi

section "Mando"
echo "Abre GoodTTV → Ajustes → Probar el mando y pulsa cada botón: la tabla muestra la tecla."
grep -iE 'Name=' /proc/bus/input/devices 2>/dev/null | sed 's/^N: //'
