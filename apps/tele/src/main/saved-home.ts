import { type SavedHome, SavedHomeSchema } from "@goodttv/contratos"
import { type OwnerFile, ownerFile } from "./local-store"

// Inicio de la última vez (window.api.home), en saved-home.json de la carpeta de datos de la app. No va en
// localStorage, como en la extensión: el servidor de la interfaz cambia de puerto en cada arranque, y con él el origen
// de la página. Lo que no se entienda (otra versión, un archivo roto) cuenta como nada guardado. Las operaciones van en
// fila: un «olvidar» no se cruza con un «guardar».
// Unos 100 kB con 100 seguidos en directo. El tope deja de sobra y evita que se guarde (y se lea al abrir) algo
// desmesurado: solo lo escribe esta app, y siempre por aquí.
export const SAVED_HOME_MAX_CHARS = 1_000_000

export type SavedHomeStore = {
  readonly forget: () => Promise<void>
  readonly save: (home: SavedHome) => Promise<void>
  readonly saved: () => Promise<SavedHome | null>
}

export const createSavedHomeStore = (file: OwnerFile): SavedHomeStore => {
  let operations: Promise<unknown> = Promise.resolve()
  const serialize = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = operations.then(operation, operation)
    operations = result.catch(() => undefined)
    return result
  }
  return {
    forget: () => serialize(() => file.remove()),
    save: (home) =>
      serialize(async () => {
        const text = `${JSON.stringify(SavedHomeSchema.parse(home))}\n`
        if (text.length > SAVED_HOME_MAX_CHARS)
          throw new RangeError("Inicio guardado demasiado grande")
        await file.write(text)
      }),
    saved: () =>
      serialize(async () => {
        try {
          const text = await file.read()
          if (text === undefined) return null
          const parsed = SavedHomeSchema.safeParse(JSON.parse(text))
          return parsed.success ? parsed.data : null
        } catch {
          return null
        }
      }),
  }
}

export const savedHomeStore = (directory: string): SavedHomeStore =>
  createSavedHomeStore(ownerFile(directory, "saved-home.json"))
