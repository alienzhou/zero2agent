import { defineConfig } from 'vitest/config'
import path from 'node:path'

// 加载仓库根目录的 .env.local，让 isLiveEnabled() 能读到 API KEY
// 用 Node 22 内置能力，与 CLI 侧保持一致，不额外引入 dotenv
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '..', '.env.local'))
} catch {
  // 文件不存在时忽略，真实 LLM 层的用例会自动跳过
}

export default defineConfig({
  test: {
    // E2E 会 spawn 真实进程、真实 LLM 层还要等网络，给足超时
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // 每个文件串行，避免多个 CLI 进程争抢同一临时目录
    fileParallelism: false,
  },
})
