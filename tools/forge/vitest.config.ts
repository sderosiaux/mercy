// Tests de la Forge. La configuration racine (vitest.config.ts) ne couvre que src et scripts : la Forge a la
// sienne tant que les portes ne l'incluent pas (requête F1).
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['tools/forge/**/*.test.ts'],
    environment: 'node',
    reporters: ['dot'],
  },
})
