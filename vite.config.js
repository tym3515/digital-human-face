import { defineConfig } from 'vite';

// 纯 JS + Three.js，没有框架插件。模型按注册表从 public/avatars 相对路径加载。
export default defineConfig({
  server: { proxy: { '/api': { target: 'https://jason-digital-human-face.linghai2025001.workers.dev', changeOrigin: true } } },
  // three.js 本体约 1 MB，单独拆包意义不大，放宽体积提示
  build: { chunkSizeWarningLimit: 1200 },
});
