import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the client talks to the game server through this proxy, so
// VITE_SOCKET_URL can stay empty and phones on the LAN can play too.
const devServer = process.env.DEV_SERVER_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/socket.io': { target: devServer, ws: true, changeOrigin: true },
      '/api': { target: devServer, changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
