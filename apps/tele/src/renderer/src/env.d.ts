/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DISABLE_REACT_DEVTOOLS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
