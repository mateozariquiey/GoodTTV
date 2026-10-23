import type { AppStatus, Preferences, PreferencesPatch } from "@goodttv/contratos"
import { type AuthState, LATENCY_MODES, LATENCY_ORDER } from "@goodttv/interfaz"
import { ArrowSquareOutIcon, CopyIcon } from "@phosphor-icons/react"
import type { ReactNode } from "react"
import { android } from "../api"
import { Avatar, Barra, Reintentar } from "./comun"

// La cuenta y los ajustes, desde el avatar de Inicio: la cuenta de Twitch (se vincula con un código, que se acepta en
// twitch.tv/activate en una Custom Tab, Paginas.kt), el retraso del directo y el chat.

type Account = {
  readonly auth: AuthState | undefined
  readonly begin: () => Promise<void>
  readonly busy: boolean
  readonly logout: () => Promise<void>
  readonly reload: () => Promise<void>
}

const webview = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? "?"

// Un grupo de opciones, como segmentos a todo el ancho.
const Segmentos = <Value extends string>({
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
  <fieldset className="segmentos">
    <legend className="oculto">{label}</legend>
    {options.map((option) => (
      <label key={option.value}>
        <input
          checked={option.value === value}
          name={name}
          onChange={() => onChange(option.value)}
          type="radio"
          value={option.value}
        />
        <span className="segmentos__opcion">{option.label}</span>
      </label>
    ))}
  </fieldset>
)

const Fila = ({ children, label }: { readonly children: ReactNode; readonly label: ReactNode }) => (
  <div className="ajuste">
    <span className="ajuste__nombre">{label}</span>
    {children}
  </div>
)

const minutesLeft = (expiresAt: string): number =>
  Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 60_000))

const CuentaTwitch = ({ account }: { readonly account: Account }) => {
  const { auth } = account
  if (auth === undefined) return <p className="nota">Comprobando la cuenta…</p>
  if (auth.kind === "unreachable") {
    return (
      <>
        <p className="ajuste__alerta" role="alert">
          No se pudo comprobar la cuenta ({auth.message}). La sesión no se ha cerrado: se vuelve a
          comprobar sola al volver la conexión.
        </p>
        {/* Sin red también se puede cerrar: se borra aquí, aunque Twitch no se entere. */}
        <div className="botones">
          <Reintentar onRetry={account.reload} />
          <button
            className="boton"
            disabled={account.busy}
            onClick={() => void account.logout()}
            type="button"
          >
            Cerrar sesión
          </button>
        </div>
      </>
    )
  }
  if (auth.kind === "authenticated") {
    return (
      <div className="conectado">
        <Avatar
          className="avatar avatar--cuenta"
          name={auth.displayName}
          url={auth.profileImageUrl}
        />
        <span className="conectado__nombre">
          Conectado como <b>{auth.displayName}</b>
        </span>
        <button
          className="boton"
          disabled={account.busy}
          onClick={() => void account.logout()}
          type="button"
        >
          Cerrar sesión
        </button>
      </div>
    )
  }
  if (auth.kind === "authorizing") {
    const { challenge } = auth
    return (
      <div className="codigo">
        <p>Acepta este código en twitch.tv/activate:</p>
        <p className="codigo__letras">
          <span aria-hidden="true">{challenge.userCode}</span>
          <span className="oculto">Código {challenge.userCode.split("").join(" ")}</span>
        </p>
        <p className="nota">Caduca en {minutesLeft(challenge.expiresAt)} min.</p>
        <div className="botones">
          <a className="boton boton--principal" href={challenge.verificationUri}>
            <ArrowSquareOutIcon aria-hidden="true" size={20} />
            Abrir Twitch
          </a>
          <button
            className="boton"
            onClick={() => android.copiar(challenge.userCode)}
            type="button"
          >
            <CopyIcon aria-hidden="true" size={20} />
            Copiar el código
          </button>
          <button className="boton" onClick={() => void account.logout()} type="button">
            Cancelar
          </button>
        </div>
      </div>
    )
  }
  return (
    <>
      {auth.kind === "error" ? (
        <p className="ajuste__alerta" role="alert">
          No se pudo vincular la cuenta ({auth.message}).
        </p>
      ) : null}
      <p className="ajuste__pista">
        Vincula tu cuenta para ver a quién sigues y leer el chat. Solo se piden permisos de lectura.
      </p>
      <button
        className="boton boton--principal boton--ancho"
        disabled={account.busy}
        onClick={() => void account.begin()}
        type="button"
      >
        Vincular la cuenta de Twitch
      </button>
    </>
  )
}

export const Cuenta = ({
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
  <div className="pantalla">
    <Barra>
      <h1 className="barra__titulo">Cuenta y ajustes</h1>
    </Barra>
    <main className="ajustes">
      <section className="grupo">
        <h2 className="grupo__titulo">Cuenta de Twitch</h2>
        <CuentaTwitch account={account} />
      </section>
      <section className="grupo">
        <h2 className="grupo__titulo">Retraso del directo</h2>
        <Segmentos
          label="Retraso del directo"
          name="latencia"
          onChange={(latencyMode) => onPreferences({ latencyMode })}
          options={LATENCY_ORDER.map((mode) => ({ label: LATENCY_MODES[mode].label, value: mode }))}
          value={preferences.latencyMode}
        />
        <p className="ajuste__pista">{LATENCY_MODES[preferences.latencyMode].hint}</p>
      </section>
      <section className="grupo">
        <h2 className="grupo__titulo">Chat</h2>
        <Fila label="Mostrar el chat al abrir un canal">
          <button
            aria-checked={preferences.chatVisible}
            aria-label="Mostrar el chat al abrir un canal"
            className="interruptor"
            onClick={() => onPreferences({ chatVisible: !preferences.chatVisible })}
            role="switch"
            type="button"
          />
        </Fila>
        <Fila label="Tamaño del texto">
          <Segmentos
            label="Tamaño del texto del chat"
            name="tamano-chat"
            onChange={(chatScale) => onPreferences({ chatScale })}
            options={[
              { label: "Normal", value: "normal" as const },
              { label: "Grande", value: "large" as const },
            ]}
            value={preferences.chatScale}
          />
        </Fila>
      </section>
      <section className="grupo">
        <h2 className="grupo__titulo">Acerca de</h2>
        <p className="ajuste__pista">
          GoodTTV {status?.version ?? "…"} para Android, con WebView {webview}. Basado en
          VacuumStream de Eliott Bouhana (licencia MIT). No está afiliado a Twitch. La reproducción
          usa un reproductor propio sin anuncios.
        </p>
      </section>
    </main>
  </div>
)
