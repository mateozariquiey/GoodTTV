import type {
  AppStatus,
  KeyProbe,
  LatencyMode,
  Preferences,
  PreferencesPatch,
} from "@goodttv/contratos"
import { QRCodeSVG } from "qrcode.react"
import { useEffect, useRef, useState } from "react"
import type { AuthState } from "../data"
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

// Retraso del directo (reproductor propio). El chat se retrasa lo mismo para ir sincronizado con la imagen.
export const LATENCY_MODES: Record<LatencyMode, { readonly hint: string; readonly label: string }> =
  {
    adaptativo: {
      hint: "Unos segundos de retraso. Si el canal pone una pausa publicitaria total, la primera para la imagen unos segundos y desde entonces se mantiene ~16 s por detrás para que las siguientes no se noten. Las pausas se cubren con la grabación del directo, si el canal la tiene pública.",
      label: "Adaptativo",
    },
    directo: {
      hint: "El mínimo retraso posible, para eventos en vivo. Si el canal pone una pausa publicitaria total, la imagen se queda quieta lo que dure y luego salta al directo.",
      label: "Directo",
    },
    "sin-paradas": {
      hint: "Unos 22 s por detrás desde el principio, para que las pausas publicitarias totales no detengan la imagen. Las cubre con la grabación del directo, si el canal la tiene pública.",
      label: "Sin paradas",
    },
  }
export const LATENCY_ORDER: readonly LatencyMode[] = ["adaptativo", "sin-paradas", "directo"]
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
  return (
    <div className="settings">
      <section
        aria-labelledby="settings-account"
        className="settings__group settings__group--account"
      >
        <h2 id="settings-account">Cuenta de Twitch</h2>
        <AccountPanel
          auth={auth}
          busy={authBusy}
          onBegin={onBegin}
          onLogout={onLogout}
          onRetry={onRetry}
          status={status}
        />
      </section>
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
          <span>Mostrar el chat al ver un canal</span>
          <strong>{preferences.chatVisible ? "Sí" : "No"}</strong>
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
          <span>Tamaño del texto del chat</span>
          <strong>{preferences.chatScale === "normal" ? "Normal" : "Grande"}</strong>
        </button>
      </section>
      <section aria-labelledby="settings-playback" className="settings__group">
        <h2 id="settings-playback">Reproducción</h2>
        <button
          className="setting"
          data-nav
          data-nav-left={TO_ACCOUNT}
          data-nav-id="setting-latency"
          onClick={() => onPreferences({ latencyMode: nextLatencyMode(preferences.latencyMode) })}
          type="button"
        >
          <span>Retraso del directo</span>
          <strong>{LATENCY_MODES[preferences.latencyMode].label}</strong>
        </button>
        <p className="settings__hint">{LATENCY_MODES[preferences.latencyMode].hint}</p>
        <p className="settings__hint">
          El chat se retrasa lo mismo que la imagen, aproximadamente, para ir a la par.
        </p>
      </section>
      <section aria-labelledby="settings-remote" className="settings__group">
        <h2 id="settings-remote">Mando</h2>
        <button
          className="setting"
          data-nav
          data-nav-left={TO_ACCOUNT}
          data-nav-id="setting-probe"
          onClick={() => setProbing(true)}
          type="button"
        >
          <span>Probar el mando</span>
          <strong>Ver qué tecla envía cada botón</strong>
        </button>
      </section>
      <section aria-labelledby="settings-about" className="settings__group settings__about">
        <h2 id="settings-about">Acerca de</h2>
        <p>
          GoodTTV {status?.version ?? "…"}. Basado en VacuumStream de Eliott Bouhana (licencia MIT).
        </p>
        <p>
          No está afiliado a Twitch. La reproducción usa un reproductor propio sin anuncios; si
          falla, el reproductor oficial de Twitch.
        </p>
        <p>
          {/* Chromium's capability, not proof of what decodes the current stream. */}
          Aceleración de vídeo disponible:{" "}
          {status === undefined
            ? "…"
            : `${status.videoDecode.startsWith("enabled") ? "sí" : "no"} (${status.videoDecode})`}
        </p>
      </section>
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

  if (auth === undefined) return <p className="account">Comprobando la cuenta…</p>
  if (auth.kind === "unreachable") {
    return (
      <div className="account">
        <p className="account__warning" role="alert">
          No se pudo comprobar la cuenta ({auth.message}).
        </p>
        <p className="account__note">
          La sesión no se ha cerrado: se vuelve a comprobar sola al volver la conexión.
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
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }
  if (auth.kind === "authenticated") {
    return (
      <div className="account">
        <p className="account__lead">
          Conectado como <strong>{auth.displayName}</strong>
        </p>
        {status?.secureStorage === false ? (
          <p className="account__warning">
            Este sistema no tiene un almacén de secretos: la sesión se guarda sin cifrar, solo
            legible por tu usuario.
          </p>
        ) : null}
        <p className="account__note">
          La cuenta sirve para la lista de seguidos y el chat. El reproductor de Twitch no recibe
          esta sesión: Turbo y las ventajas de suscriptor no se aplican aquí.
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
          Cerrar sesión
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
          <p className="account__lead">Escanea el código con el móvil</p>
          <p>
            o entra en <strong>twitch.tv/activate</strong> y escribe:
          </p>
          <p className="account__code">
            <span aria-hidden="true">{challenge.userCode}</span>
            <span className="visually-hidden">Código {challenge.userCode.split("").join(" ")}</span>
          </p>
          <p className="account__note">Caduca en {minutesLeft(challenge.expiresAt)} min.</p>
          <button
            className="button"
            data-nav
            data-nav-entry=""
            data-nav-id="account-cancel"
            onClick={onLogout}
            type="button"
          >
            Cancelar
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="account">
      {auth.kind === "error" ? (
        <p className="account__warning" role="alert">
          No se pudo vincular la cuenta ({auth.message}).
        </p>
      ) : (
        <p className="account__lead">Vincula tu cuenta para ver a quién sigues y leer el chat.</p>
      )}
      <p className="account__note">
        Necesitarás el móvil para aprobarlo. Solo se piden permisos de lectura.
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
        {auth.kind === "error" ? "Intentar de nuevo" : "Vincular cuenta"}
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
      <h2 id="probe-title">Probar el mando</h2>
      <p>Pulsa cada botón. Atrás cierra esta ventana.</p>
      <table className="probe__table">
        <thead>
          <tr>
            <th scope="col">Tecla</th>
            <th scope="col">Código</th>
            <th scope="col">Acción</th>
          </tr>
        </thead>
        <tbody>
          {probes.map((probe, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: probes are an append-only log.
            <tr key={index}>
              <td>{probe.key === " " ? "Espacio" : probe.key}</td>
              <td>{probe.code}</td>
              <td>{probe.action ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
