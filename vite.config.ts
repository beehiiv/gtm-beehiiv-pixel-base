import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
  build: {
    outDir: 'dist',
    minify: false,
    target: 'esnext',
    // commonjsOptions: {
    //   transformMixedEsModules: true,
    // },
    lib: {
      name: 'pixel_v2',
      formats: ['iife'],
      entry: './src/pixel-v2.js',
      fileName: () => 'pixel-v2.js',
    },
  },
});
