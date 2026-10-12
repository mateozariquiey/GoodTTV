import type { Plugin } from "vite"

// Añade LICENSE y TERCEROS.txt (las licencias de los paquetes de terceros incluidos) a la compilación.
export declare const licencias: () => Plugin
