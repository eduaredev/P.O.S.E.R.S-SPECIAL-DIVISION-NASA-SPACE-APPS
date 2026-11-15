// Genera un unico index.html autonomo (dist-single/index.html) que se abre con doble clic.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'dist-single' },
});
