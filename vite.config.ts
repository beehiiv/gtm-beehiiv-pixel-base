import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const entryName = process.env.VITE_BUILD_ENTRY || 'pixel-v2'; // Default to pixel-v2
  const globalName = entryName.replace(/-/g, '_'); // Convert pixel-v1 to pixel_v1 for global name
  // pixel-js is legacy JavaScript; everything else is TypeScript
  const ext = entryName === 'pixel-js' ? '.js' : '.ts';
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
        entry: `./src/${entryName}${ext}`,
        formats: ['iife'],
        name: globalName,
        fileName: () => `${entryName}.js`,
      },
      rollupOptions: {
        output: {
          // For pixel-shopify, inject the PIXEL_ID placeholder at the very top
          // of the IIFE body — right after `use strict` and the inlined
          // `version` constant — so the advertiser can spot it immediately
          // when they open dist/pixel-shopify.js to paste into Shopify's
          // Customer Events UI. The intro is wrapped in a banner comment to
          // call attention to it. Source declares it as `declare const` so
          // TypeScript is happy without emitting a duplicate.
          intro:
            entryName === 'pixel-shopify'
              ? "  // ─── REPLACE 'PIXEL_ID' BELOW WITH YOUR BEEHIIV PIXEL ID ───\n  const pixelId = 'PIXEL_ID';\n"
              : undefined,
        },
      },
    },
  };
});
