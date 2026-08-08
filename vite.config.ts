// Vite（ビルド）と Vitest（テスト）の共通設定
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./", // 相対パス出力（任意の場所に配置してもアセット解決できるように）
  test: {
    environment: "node", // core は DOM 非依存の純粋ロジックなので node 環境でテスト
    include: ["tests/**/*.test.ts"],
  },
});
