import { QRCodeSVG } from "qrcode.react"
import { useEffect, useRef, useState } from "react"
import type {
  AppStatus,
  AuthSnapshot,
  KeyProbe,
  Preferences,
  PreferencesPatch,
} from "../../../shared/contracts"
import { useLayer } from "../navigation"

type AccountScreenProps = {
  readonly auth: AuthSnapshot | undefined
  readonly authBusy: boolean
  readonly onBegin: () => void
  readonly onLogout: () => void
  readonly onPreferences: (patch: PreferencesPatch) => void
  readonly preferences: Preferences
  readonly status: AppStatus | undefined
}

const minutesLeft = (expiresAt: string): number =>
  Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 60_000))

// ← from any setting reaches whichever account action is shown (link, cancel or sign out).
const TO_ACCOUNT = "account-link account-cancel account-logout"

export const AccountScreen = ({
  auth,
  authBusy,
  onBegin,
  onLogout,
  onPreferences,
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
        <p>No está afiliado a Twitch. La reproducción usa el reproductor oficial de Twitch.</p>
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
  readonly auth: AuthSnapshot | undefined
  readonly busy: boolean
  readonly onBegin: () => void
  readonly onLogout: () => void
  readonly status: AppStatus | undefined
}

const AccountPanel = ({ auth, busy, onBegin, onLogout, status }: AccountPanelProps) => {
  const [, tick] = useState(0)
  useEffect(() => {
    if (auth?.kind !== "authorizing") return undefined
    const timer = setInterval(() => tick((value) => value + 1), 15_000)
    return () => clearInterval(timer)
  }, [auth])

  if (auth === undefined) return <p className="account">Comprobando la cuenta…</p>
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
