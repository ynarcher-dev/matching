/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath, URL } from 'node:url';

// HTTPS=1 일 때만 자체 서명 HTTPS 를 켠다(폰 카메라 등 보안 컨텍스트 수동 테스트용).
// 평소 `npm run dev`/build/test 는 영향받지 않는다.
const useHttps = process.env.HTTPS === '1' || process.env.HTTPS === 'true';

// Tailwind v4 는 @tailwindcss/vite 플러그인으로 통합한다 (dev_conventions.md 1장).
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(useHttps ? [basicSsl()] : [])],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
