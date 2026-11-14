import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 페이지가 여러 개다: scene-demo.html(씬 데모)와 index.html(앱, 있을 때만).
const pages: Record<string, string> = { 'scene-demo': at('./scene-demo.html') };
if (existsSync(at('./index.html'))) pages.index = at('./index.html');

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: { input: pages },
  },
  // npm run dev(5173) 의 /api 요청을 npm run dev:api(wrangler, 8787)로 넘긴다
  server: { host: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
});
