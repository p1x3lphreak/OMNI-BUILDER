import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // MUST exactly match your repo path & case:
  base: '/OMNI-BUILDER/',
  // Make Vite copy static assets from ./public into dist
  publicDir: 'public',
})
