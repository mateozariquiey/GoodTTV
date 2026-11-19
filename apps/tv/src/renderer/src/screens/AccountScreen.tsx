import type {
  AppStatus,
  KeyProbe,
  LatencyMode,
  Preferences,
  PreferencesPatch,
} from "@goodttv/contratos"
import {
  type AuthState,
  elegirIdioma,
  type IdiomaElegido,
  idiomaActual,
  idiomaElegido,
  LATENCY_MODES,
  LATENCY_ORDER,
  t,
  tMensaje,
  useIdioma,
} from "@goodttv/interfaz"
import { QRCodeSVG } from "qrcode.react"
import { useEffect, useRef, useState } from "react"
import { useLayer } from "../navigation"
import { RetryButton } from "../ui"

type AccountScreenProps = {
  readonly auth: AuthState | undefined
  readonly authBusy: boolean
  readonly onBegin: () => void
  readonly onLogout: () => void
  readonly onPreferences: (patch: PreferencesPatch) => void
  readonly onRetry: () => Promise<void>
  readonly preferences: Preferences
  readonly status: AppStatus | undefined
}

const minutesLeft = (expiresAt: string): number =>
  Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 60_000))

// ← from any setting reaches whichever account action is shown (link, cancel, retry or sign out).
const TO_ACCOUNT = "account-link account-cancel account-retry account-logout"

// El idioma (D35), en el mismo orden que el selector de la extensión y de Android; cada OK pasa al siguiente.
const IDIOMAS: readonly IdiomaElegido[] = ["sistema", "en", "es"]
const NOMBRE_IDIOMA = { en: "English", es: "Español" } as const
const nextIdioma = (valor: IdiomaElegido): IdiomaElegido =>
  IDIOMAS[(IDIOMAS.indexOf(valor) + 1) % IDIOMAS.length] ?? "sistema"

const nextLatencyMode = (mode: LatencyMode): LatencyMode =>
  LATENCY_ORDER[(LATENCY_ORDER.indexOf(mode) + 1) % LATENCY_ORDER.length] ?? "adaptativo"

export const AccountScreen = ({
  auth,
  authBusy,
  onBegin,
  onLogout,
  onPreferences,
  onRetry,
  preferences,
  status,
}: AccountScreenProps) => {
  const [probing, setProbing] = useState(false)
  useIdioma()
  const elegido = idiomaElegido()
  return (
    // Dos columnas: la cuenta, el idioma y el mando a la izquierda; lo demás, a la derecha.
    <div className="settings">
      <div className="settings__column">
        <section
          aria-labelledby="settings-account"
          className="settings__group settings__group--account"
        >
          <h2 id="settings-account">{t("Cuenta de Twitch")}</h2>
          <AccountPanel
            auth={auth}
            busy={authBusy}
            onBegin={onBegin}
            onLogout={onLogout}
            onRetry={onRetry}
            status={status}
          />
        </section>
        <section aria-labelledby="settings-language" className="settings__group">
          <h2 id="settings-language">{t("Idioma")}</h2>
          <button
            className="setting"
            data-nav
            data-nav-id="setting-language"
            onClick={() => elegirIdioma(nextIdioma(elegido))}
            type="button"
          >
            <span>{t("Idioma de la interfaz")}</span>
            <strong lang={elegido === "sistema" ? undefined : elegido}>
              {elegido === "sistema"
                ? `${t("Sistema")} (${NOMBRE_IDIOMA[idiomaActual()]})`
                : NOMBRE_IDIOMA[elegido]}
            </strong>
          </button>
        </section>
        <section aria-labelledby="settings-remote" className="settings__group">
          <h2 id="settings-remote">{t("Mando")}</h2>
          <button
            className="setting"
            data-nav
            data-nav-id="setting-probe"
            onClick={() => setProbing(true)}
            type="button"
          >
            <span>{t("Probar el mando")}</span>
            <strong>{t("Ver qué tecla envía cada botón")}</strong>
          </button>
        </section>
      </div>
      <div className="settings__column">
        <section aria-labelledby="settings-chat" className="settings__group">
          <h2 id="settings-chat">Chat</h2>
          <button
            className="setting"
            data-nav
            data-nav-entry=""
            data-nav-left={TO_ACCOUNT}
            data-nav-id="setting-chat-visible"
            onClick={() => onPreferences({ chatVisible: !preferences.chatVisible })}
            type="button"
          >
            <span>{t("Mostrar el chat al ver un canal")}</span>
            <strong>{preferences.chatVisible ? t("Sí") : "No"}</strong>
          </button>
          <button
            className="setting"
            data-nav
            data-nav-left={TO_ACCOUNT}
            data-nav-id="setting-chat-scale"
            onClick={() =>
              onPreferences({ chatScale: preferences.chatScale === "normal" ? "large" : "normal" })
            }
            type="button"
          >
            <span>{t("Tamaño del texto del chat")}</span>
            <strong>{preferences.chatScale === "normal" ? "Normal" : t("Grande")}</strong>
          </button>
        </section>
        <section aria-labelledby="settings-playback" className="settings__group">
          <h2 id="settings-playback">{t("Reproducción")}</h2>
          <button
            className="setting"
            data-nav
            data-nav-left={TO_ACCOUNT}
            data-nav-id="setting-latency"
            onClick={() => onPreferences({ latencyMode: nextLatencyMode(preferences.latencyMode) })}
            type="button"
          >
            <span>{t("Retraso del directo")}</span>
            <strong>{LATENCY_MODES[preferences.latencyMode].label}</strong>
          </button>
          <p className="settings__hint">{LATENCY_MODES[preferences.latencyMode].hint}</p>
          <p className="settings__hint">
            {t("El chat se retrasa lo mismo que la imagen, aproximadamente, para ir a la par.")}
          </p>
        </section>
        <section aria-labelledby="settings-about" className="settings__group settings__about">
          <h2 id="settings-about">{t("Acerca de")}</h2>
          <p>
            {t("GoodTTV {version}. Basado en VacuumStream de Eliott Bouhana (licencia MIT).", {
              version: status?.version ?? "…",
            })}
          </p>
          <p>
            {t(
              "No está afiliado a Twitch. La reproducción usa un reproductor propio sin anuncios.",
            )}
          </p>
          <p>
            {/* Chromium's capability, not proof of what decodes the current stream. */}
            {t("Aceleración de vídeo disponible:")}{" "}
            {status === undefined
              ? "…"
              : `${status.videoDecode.startsWith("enabled") ? t("sí") : "no"} (${status.videoDecode})`}
          </p>
        </section>
      </div>
      {probing ? <RemoteProbe onClose={() => setProbing(false)} /> : null}
    </div>
  )
}

type AccountPanelProps = {
  readonly auth: AuthState | undefined
  readonly busy: boolean
  readonly onBegin: () => void
  readonly onLogout: () => void
  readonly onRetry: () => Promise<void>
  readonly status: AppStatus | undefined
}

const AccountPanel = ({ auth, busy, onBegin, onLogout, onRetry, status }: AccountPanelProps) => {
  const [, tick] = useState(0)
  useEffect(() => {
    if (auth?.kind !== "authorizing") return undefined
    const timer = setInterval(() => tick((value) => value + 1), 15_000)
    return () => clearInterval(timer)
  }, [auth])

  if (auth === undefined) return <p className="account">{t("Comprobando la cuenta…")}</p>
  if (auth.kind === "unreachable") {
    return (
      <div className="account">
        <p className="account__warning" role="alert">
          {t("No se pudo comprobar la cuenta ({error}).", { error: tMensaje(auth.message) })}
        </p>
        <p className="account__note">
          {t("La sesión no se ha cerrado: se vuelve a comprobar sola al volver la conexión.")}
        </p>
        <div className="account__actions">
          <RetryButton entry navId="account-retry" onRetry={onRetry} />
          {/* Sin red también se puede cerrar: se borra aquí, aunque Twitch no se entere. Never the default focus. */}
          <button
            className="button"
            data-nav
            data-nav-id="account-logout"
            disabled={busy}
            onClick={onLogout}
            type="button"
          >
            {t("Cerrar sesión")}
          </button>
        </div>
      </div>
    )
  }
  if (auth.kind === "authenticated") {
    return (
      <div className="account">
        <p className="account__lead">
          {t("Conectado como")} <strong>{auth.displayName}</strong>
        </p>
        {status?.secureStorage === false ? (
          <p className="account__warning">
            {t(
              "Este sistema no tiene un almacén de secretos: la sesión se guarda sin cifrar, solo legible por tu usuario.",
            )}
          </p>
        ) : null}
        <p className="account__note">
          {t(
            "La cuenta sirve para la lista de seguidos y el chat. El reproductor no usa esta sesión: Turbo y las ventajas de suscriptor no se aplican aquí.",
          )}
        </p>
        {/* Never a default focus target: one stray OK must not sign the viewer out. */}
        <button
          className="button"
          data-nav
          data-nav-id="account-logout"
          disabled={busy}
          onClick={onLogout}
          type="button"
        >
          {t("Cerrar sesión")}
        </button>
      </div>
    )
  }
  if (auth.kind === "authorizing") {
    const { challenge } = auth
    // Main only ever hands over Twitch's own activation address.
    const uri = challenge.verificationUri
    return (
      <div className="account account--code">
        <div className="account__qr">
          <QRCodeSVG
            bgColor="#ffffff"
            fgColor="#0b0b0d"
            level="M"
            marginSize={2}
            size={220}
            value={uri}
          />
        </div>
        <div>
          <p className="account__lead">{t("Escanea el código con el móvil")}</p>
          <p>
            {t("o entra en")} <strong>twitch.tv/activate</strong> {t("y escribe:")}
          </p>
          <p className="account__code">
            <span aria-hidden="true">{challenge.userCode}</span>
            <span className="visually-hidden">
              {t("Código")} {challenge.userCode.split("").join(" ")}
            </span>
          </p>
          <p className="account__note">
            {t("Caduca en {n} min.", { n: minutesLeft(challenge.expiresAt) })}
          </p>
          <button
            className="button"
            data-nav
            data-nav-entry=""
            data-nav-id="account-cancel"
            onClick={onLogout}
            type="button"
          >
            {t("Cancelar")}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="account">
      {auth.kind === "error" ? (
        <p className="account__warning" role="alert">
          {t("No se pudo vincular la cuenta ({error}).", { error: tMensaje(auth.message) })}
        </p>
      ) : (
        <p className="account__lead">
          {t("Vincula tu cuenta para ver a quién sigues y leer el chat.")}
        </p>
      )}
      <p className="account__note">
        {t("Necesitarás el móvil para aprobarlo. Solo se piden permisos de lectura.")}
      </p>
      <button
        className="button button--primary"
        data-nav
        data-nav-entry=""
        data-nav-id="account-link"
        disabled={busy}
        onClick={onBegin}
        type="button"
      >
        {auth.kind === "error" ? t("Intentar de nuevo") : t("Vincular cuenta")}
      </button>
    </div>
  )
}

// Shows what each button of the physical remote sends, for checking it on the real hardware.
const RemoteProbe = ({ onClose }: { readonly onClose: () => void }) => {
  const root = useRef<HTMLDivElement>(null)
  const [probes, setProbes] = useState<readonly KeyProbe[]>([])
  useEffect(() => {
    void window.api.input.setProbing(true)
    const unsubscribe = window.api.input.onProbe((probe) =>
      setProbes((current) => [probe, ...current].slice(0, 8)),
    )
    return () => {
      unsubscribe()
      void window.api.input.setProbing(false)
    }
  }, [])
  // Every key is only recorded here: OK and the arrows must not trigger anything while testing.
  useLayer({ id: "remote-probe", onAction: (action) => action !== "back", onBack: onClose, root })
  return (
    <div aria-labelledby="probe-title" className="probe" ref={root} role="dialog">
      <h2 id="probe-title">{t("Probar el mando")}</h2>
      <p>{t("Pulsa cada botón. Atrás cierra esta ventana.")}</p>
      <table className="probe__table">
        <thead>
          <tr>
            <th scope="col">{t("Tecla")}</th>
            <th scope="col">{t("Código")}</th>
            <th scope="col">{t("Acción")}</th>
          </tr>
        </thead>
        <tbody>
          {probes.map((probe, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: probes are an append-only log.
            <tr key={index}>
              <td>{probe.key === " " ? t("Espacio") : probe.key}</td>
              <td>{probe.code}</td>
              <td>{probe.action ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
