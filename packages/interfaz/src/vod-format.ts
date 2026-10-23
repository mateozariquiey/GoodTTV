// Tiempos de los VOD (VOD-1; la extensión y Android): la posición y la duración como un reloj (1:02:03, 58:02) y la fecha
// como «hace 3 días».

export const formatClock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, "0")
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`
}

export const formatAgo = (iso: string, now = Date.now()): string => {
  const hours = Math.floor((now - Date.parse(iso)) / 3_600_000)
  if (!Number.isFinite(hours)) return ""
  if (hours < 1) return "hace menos de una hora"
  if (hours < 24) return hours === 1 ? "hace 1 hora" : `hace ${hours} horas`
  const days = Math.floor(hours / 24)
  if (days < 30) return days === 1 ? "ayer" : `hace ${days} días`
  const months = Math.floor(days / 30)
  return months === 1 ? "hace 1 mes" : `hace ${months} meses`
}
