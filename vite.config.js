import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        admin: resolve(__dirname, 'src/admin.html'),
        callback: resolve(__dirname, 'src/callback.html'),
        settings: resolve(__dirname, 'src/settings.html'),
        privacy: resolve(__dirname, 'src/privacy.html'),
        upload: resolve(__dirname, 'src/upload.html'),
      },
    },
  },
});
