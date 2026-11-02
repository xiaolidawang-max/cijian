import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  base:'./', plugins:[react()],
  ...(mode === 'android' ? { publicDir:false, build:{ outDir:'dist-android' } } : {}),
}))
