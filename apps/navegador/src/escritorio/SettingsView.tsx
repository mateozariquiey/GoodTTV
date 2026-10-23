import type { AppStatus, Preferences, PreferencesPatch } from "@goodttv/contratos"
import { type AuthState, LATENCY_MODES, LATENCY_ORDER } from "@goodttv/interfaz"
import { QRCodeSVG } from "qrcode.react"
import type { ReactNode } from "react"
import { Avatar } from "./Avatar"
import { RetryButton } from "./RetryButton"

type Account = {
  readonly auth: AuthState | undefined
  readonly begin: () => Promise<void>
  readonly busy: boolean
  readonly logout: () => Promise<void>
  readonly reload: () => Promise<void>
}

// Un grupo de opciones con su nombre, en vez de los botones grandes de la tele: radios con aspecto de segmentos
// (las flechas cambian de opción) y un interruptor.
const Segmented = <Value extends string>({
  label,
  name,
  onChange,
  options,
  value,
}: {
  readonly label: string
  readonly name: string
  readonly onChange: (value: Value) => void
  readonly options: readonly { readonly label: string; readonly value: Value }[]
  readonly value: Value
}) => (
  <fieldset className="segmented">
    <legend className="visually-hidden">{label}</legend>
    {options.map((option) => (
      <label key={option.value}>
        <input
          checked={option.value === value}
          name={name}
          onChange={() => onChange(option.value)}
          type="radio"
          value={option.value}
        />
        <span className="segmented__option">{option.label}</span>
      </label>
    ))}
  </fieldset>
)

const Row = ({ children, label }: { readonly children: ReactNode; readonly label: ReactNode }) => (
  <div className="setting">
    <span className="setting__label">{label}</span>
    {children}
  </div>
)

const minutesLeft = (expiresAt: string): number =>
  Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 60_000))

const AccountGroup = ({
  account,
  status,
}: {
  readonly account: Account
  readonly status: AppStatus | undefined
}) => {
  const { auth } = account
  if (auth === undefined) return <p className="page__note">Comprobando la cuenta…</p>
  if (auth.kind === "unreachable") {
    return (
      <>
        <p className="setting__warning" role="alert">
          No se pudo comprobar la cuenta ({auth.message}).
        </p>
        <Row label="La sesión no se ha cerrado: se vuelve a comprobar sola al volver la conexión.">
          {/* Sin red también se puede cerrar: se borra aquí, aunque Twitch no se entere. */}
          <span className="setting__actions">
            <RetryButton onRetry={account.reload} />
            <button
              className="button"
              disabled={account.busy}
              onClick={() => void account.logout()}
              type="button"
            >
              Cerrar sesión
            </button>
          </span>
        </Row>
      </>
    )
  }
  if (auth.kind === "authenticated") {
    return (
      <>
        <Row
          label={
            <>
              <Avatar
                className="avatar avatar--small"
                name={auth.displayName}
                url={auth.profileImageUrl}
              />
              <span>
                Conectado como <b>{auth.displayName}</b>
              </span>
            </>
          }
        >
          <button
            className="button"
            disabled={account.busy}
            onClick={() => void account.logout()}
            type="button"
          >
            Cerrar sesión
          </button>
        </Row>
        {status?.secureStorage === false ? (
          <p className="setting__warning">
            La sesión se guarda sin cifrar en el perfil del navegador: quien pueda leer tus archivos
            podría copiarla.
          </p>
        ) : null}
      </>
    )
  }
  if (auth.kind === "authorizing") {
    const { challenge } = auth
    return (
      <div className="link-code">
        <span className="link-code__qr">
          <QRCodeSVG
            bgColor="#ffffff"
            fgColor="#0b0b0d"
            level="M"
            marginSize={2}
            size={132}
            value={challenge.verificationUri}
          />
        </span>
        <div>
          <p>Abre twitch.tv/activate (o escanea el código con el móvil) y escribe:</p>
          <p className="link-code__code">
            <span aria-hidden="true">{challenge.userCode}</span>
            <span className="visually-hidden">Código {challenge.userCode.split("").join(" ")}</span>
          </p>
          <p className="page__note">Caduca en {minutesLeft(challenge.expiresAt)} min.</p>
          <span className="link-code__actions">
            <a
              className="button button--primary"
              href={challenge.verificationUri}
              rel="noreferrer"
              target="_blank"
            >
              Abrir twitch.tv/activate
            </a>
            <button className="button" onClick={() => void account.logout()} type="button">
              Cancelar
            </button>
          </span>
        </div>
      </div>
    )
  }
  return (
    <>
      {auth.kind === "error" ? (
        <p className="setting__warning" role="alert">
          No se pudo vincular la cuenta ({auth.message}).
        </p>
      ) : null}
      <Row label="Vincula tu cuenta para ver a quién sigues y leer el chat. Solo se piden permisos de lectura.">
        <button
          className="button button--primary"
          disabled={account.busy}
          onClick={() => void account.begin()}
          type="button"
        >
          Vincular cuenta
        </button>
      </Row>
    </>
  )
}

const SHORTCUTS: readonly (readonly [readonly string[], string])[] = [
  [["Espacio"], "Pausa y reanuda"],
  [["←", "→"], "Retrocede o avanza 10 s"],
  [["Fin"], "Vuelve al directo, si has retrocedido"],
  [["M"], "Silencio"],
  [["T"], "Modo teatro: el vídeo y el chat ocupan la ventana"],
  [["F"], "Pantalla completa: solo el vídeo"],
  [["C"], "Muestra u oculta el chat"],
  [["↑", "↓"], "Canal anterior y siguiente de la lista"],
  [["/"], "Buscar"],
  [["Esc"], "Volver"],
]

export const SettingsView = ({
  account,
  onPreferences,
  preferences,
  status,
}: {
  readonly account: Account
  readonly onPreferences: (patch: PreferencesPatch) => void
  readonly preferences: Preferences
  readonly status: AppStatus | undefined
}) => (
  <div className="page page--narrow">
    <h1 className="page__title">Ajustes</h1>
    <section className="settings-group">
      <h2 className="settings-group__title">Cuenta</h2>
      <AccountGroup account={account} status={status} />
    </section>
    <section className="settings-group">
      <h2 className="settings-group__title">Reproducción</h2>
      <Row label="Retraso del directo">
        <Segmented
          label="Retraso del directo"
          name="latencia"
          onChange={(latencyMode) => onPreferences({ latencyMode })}
          options={LATENCY_ORDER.map((mode) => ({ label: LATENCY_MODES[mode].label, value: mode }))}
          value={preferences.latencyMode}
        />
      </Row>
      <p className="setting__hint">{LATENCY_MODES[preferences.latencyMode].hint}</p>
    </section>
    <section className="settings-group">
      <h2 className="settings-group__title">Chat</h2>
      <Row label="Mostrar el chat al abrir un canal">
        <button
          aria-checked={preferences.chatVisible}
          aria-label="Mostrar el chat al abrir un canal"
          className="switch"
          onClick={() => onPreferences({ chatVisible: !preferences.chatVisible })}
          role="switch"
          type="button"
        />
      </Row>
      <Row label="Tamaño del texto">
        <Segmented
          label="Tamaño del texto del chat"
          name="tamano-chat"
          onChange={(chatScale) => onPreferences({ chatScale })}
          options={[
            { label: "Normal", value: "normal" as const },
            { label: "Grande", value: "large" as const },
          ]}
          value={preferences.chatScale}
        />
      </Row>
    </section>
    <section className="settings-group">
      <h2 className="settings-group__title">Atajos de teclado</h2>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={action}>
            <dt>
              {keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </section>
    <section className="settings-group">
      <h2 className="settings-group__title">Acerca de</h2>
      <p className="setting__hint">
        GoodTTV {status?.version ?? "…"}. Basado en VacuumStream de Eliott Bouhana (licencia MIT).
        No está afiliado a Twitch. La reproducción usa un reproductor propio sin anuncios.
      </p>
    </section>
  </div>
)
