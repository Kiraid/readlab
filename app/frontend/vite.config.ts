import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `npm run dev` serves the app on :5173 and forwards the API and chapter pages to the backend on :8000.
// `npm run build` writes dist/, which the backend serves itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000', '/read': 'http://localhost:8000' },
  },
});
