import { defineConfig } from "vitest/config";
import { config } from "dotenv";
import path from "node:path";

// 加载项目根目录的 .env.local 文件
config({ path: path.resolve(import.meta.dirname, "../../.env.local") });

export default defineConfig({
  test: {
    // 测试配置
  },
});
