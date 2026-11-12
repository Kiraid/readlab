import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `npm run dev` serves the app on :5173 and forwards the API and chapter pages to the backend
// (READLAB_API, default http://127.0.0.1:8000). `npm run build` writes dist/, which the backend serves itself.
const api = process.env.READLAB_API ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    proxy: { '/api': api, '/read': api, '/reader-bridge.js': api },
  },
});
