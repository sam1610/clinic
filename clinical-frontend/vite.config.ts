import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    // Allow the Amazon Connect CCP iframe to communicate with the dev server.
    // amazon-connect-streams uses postMessage between the CCP iframe origin
    // and the host page — Vite's CORS check must permit this origin.
    cors: {
      origin: [
        'https://firsthub.my.connect.aws',
        'http://localhost:5173',
      ],
    },
    // Allow requests from the Connect domain (covers Vite's allowedHosts check)
    allowedHosts: [
      'localhost',
      'firsthub.my.connect.aws',
    ],
  },
})
