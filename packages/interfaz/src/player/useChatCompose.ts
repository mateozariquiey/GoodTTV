import { useCallback, useRef, useState } from "react"

// La caja para escribir en el chat (CHAT-1), sin su aspecto: cada versión la pinta a su manera. Enviar vacía el texto;
// si Twitch no lo envía, queda el motivo y el texto, para reintentar. Un envío a la vez.
export const useChatCompose = (
  send: (text: string) => Promise<string | null>,
  onSent: () => void = () => undefined,
) => {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const sending = useRef(false)
  const change = useCallback((value: string) => {
    setText(value)
    setError(null)
  }, [])
  const submit = useCallback(async (): Promise<void> => {
    const message = text.trim()
    if (message === "" || sending.current) return
    sending.current = true
    setError(null)
    const reason = await send(message)
    sending.current = false
    if (reason === null) {
      // Lo que se haya escrito mientras se enviaba se queda.
      setText((current) => (current.trim() === message ? "" : current))
      onSent()
    } else setError(reason)
  }, [onSent, send, text])
  return { change, error, submit, text }
}
