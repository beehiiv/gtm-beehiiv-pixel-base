import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const entryName = process.env.VITE_BUILD_ENTRY || 'pixel-v2'; // Default to pixel-v2
  const globalName = entryName.replace('-', '_'); // Convert pixel-v1 to pixel_v1 for global name
  console.log(`Building ${entryName} with global name ${globalName} in ${mode} mode`);
  return {
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      minify: false,
      target: 'esnext',
      lib: {
        entry: `./src/${entryName}.js`,
        formats: ['iife'],
        name: globalName,
        fileName: () => `${entryName}.js`,
      },
    },
  };
});
