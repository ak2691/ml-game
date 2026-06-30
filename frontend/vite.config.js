import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite"
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const configDir = path.dirname(fileURLToPath(import.meta.url))

function baseModelArtifactsPlugin() {
  return {
    name: 'machiner-base-model-artifacts',
    configureServer(server) {
      server.middlewares.use('/artifacts/base-models', (req, res, next) => {
        const artifactRoot = path.resolve(configDir, '../artifacts/base-models')
        const requestPath = decodeURIComponent((req.url ?? '').split('?')[0])
        const resolvedPath = path.resolve(artifactRoot, `.${requestPath}`)

        if (!resolvedPath.startsWith(artifactRoot)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }

        fs.stat(resolvedPath, (statError, stat) => {
          if (statError || !stat.isFile()) {
            next()
            return
          }

          const ext = path.extname(resolvedPath)
          const contentTypes = {
            '.json': 'application/json',
            '.jsonl': 'application/x-ndjson',
            '.keras': 'application/octet-stream',
          }
          res.setHeader('Content-Type', contentTypes[ext] ?? 'application/octet-stream')
          fs.createReadStream(resolvedPath).pipe(res)
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), baseModelArtifactsPlugin()],
})
