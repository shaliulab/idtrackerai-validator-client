import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

// Port of the Flask backend `npm start` proxies /api to.
const BACKEND_PORT = process.env.REACT_APP_BACKEND_PORT || 5000;

export default defineConfig({
  plugins: [react(), svgr()],
  // REACT_APP_API_BASE (see api.js) keeps working under its CRA name.
  envPrefix: ['VITE_', 'REACT_APP_'],
  // The components are JSX in .js files (create-react-app convention).
  esbuild: { loader: 'jsx', include: /src\/.*\.js$/, exclude: [] },
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
  server: {
    host: true,
    port: 3000,
    proxy: { '/api': `http://localhost:${BACKEND_PORT}` },
  },
  build: {
    outDir: 'build',
    // Same layout as the CRA build: the server and CI expect
    // static/js/main.<hash>.js.
    assetsDir: 'static',
    rollupOptions: {
      input: { main: 'index.html' },
      output: {
        entryFileNames: 'static/js/[name].[hash].js',
        chunkFileNames: 'static/js/[name].[hash].js',
        assetFileNames: ({ names }) => (names[0]?.endsWith('.js')
          ? 'static/js/[name].[hash][extname]'      // plotly.min.js, see plotly.js
          : 'static/media/[name].[hash][extname]'),
        // Large libraries in chunks of their own, each below the 500 kB warning.
        manualChunks: (id) => {
          const lib = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1];
          if (['react', 'react-dom', 'scheduler'].includes(lib)) return 'react';
          if (lib === 'hls.js') return 'hls';
        },
      },
    },
  },
});
