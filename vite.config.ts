import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          admin: path.resolve(__dirname, 'admin.html'),
          user: path.resolve(__dirname, 'user.html'),
          store: path.resolve(__dirname, 'store.html'),
          deliveryboy: path.resolve(__dirname, 'deliveryboy.html'),
          'user-login': path.resolve(__dirname, 'user-login.html'),
          'store-login': path.resolve(__dirname, 'store-login.html'),
          'deliveryboy-login': path.resolve(__dirname, 'deliveryboy-login.html'),
          'admin-login': path.resolve(__dirname, 'admin-login.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
