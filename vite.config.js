import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase')) return 'vendor-firebase';
          if (id.includes('node_modules/html2canvas')) return 'vendor-html2canvas';
          if (id.includes('node_modules/dompurify')) return 'vendor-dompurify';
          if (id.includes('node_modules/canvg') || id.includes('node_modules/rgbcolor') || id.includes('node_modules/stackblur-canvas')) return 'vendor-svg-render';
          if (id.includes('node_modules/jspdf')) return 'vendor-pdf';
          if (id.includes('node_modules/fflate')) return 'vendor-compression';
          if (id.includes('node_modules/write-excel-file') || id.includes('node_modules/read-excel-file')) return 'vendor-excel';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'vendor-react';
          if (id.includes('node_modules/pako')) return 'vendor-pako';
          if (id.includes('node_modules/core-js')) return 'vendor-polyfills';
          if (id.includes('node_modules/@babel')) return 'vendor-babel-helpers';
          if (id.includes('node_modules')) return 'vendor';
        }
      }
    }
  }
});
