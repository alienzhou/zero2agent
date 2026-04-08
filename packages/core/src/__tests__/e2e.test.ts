/**
 * 端到端测试 - MVP 版本
 *
 * 这是一个临时的黑盒测试方案，用于验证 Agent 的基本能力。
 *
 * 注意事项：
 * 1. 当前只有读能力（read_file, list_directory, grep_search, find_files），暂无写能力
 * 2. 此为临时 MVP 方案，后续会增强为更全面、健壮的测试体系
 * 3. 需要真实 LLM API 调用，建议手动触发而非 CI 自动跑
 *
 * 运行方式：
 *   pnpm --filter @zero2agent/core test src/__tests__/e2e.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Agent } from "../agent.js";
import { allTools } from "../tools/index.js";
import path from "node:path";

// 测试工作目录：使用项目根目录
const TEST_CWD = path.resolve(import.meta.dirname, "../../../..");

describe("E2E Tests (MVP)", () => {
  let agent: Agent;

  beforeAll(() => {
    agent = new Agent({
      tools: allTools,
      cwd: TEST_CWD,
    });
  });

  /**
   * 测试 1: 文件读取
   * 目标：验证 Agent 能调用 read_file 工具读取文件内容
   */
  it("should read file content", async () => {
    const result = await agent.run("读取 package.json 的内容");

    // 验证：输出应包含项目名称
    expect(result).toContain("zero2agent");
  }, 60000); // 60s 超时，LLM 调用可能较慢

  /**
   * 测试 2: 目录列表
   * 目标：验证 Agent 能调用 list_directory 工具列出目录内容
   */
  it("should list directory contents", async () => {
    const result = await agent.run("列出 packages/core/src 目录下有哪些文件");

    // 验证：输出应包含已知的文件名
    expect(result).toContain("agent.ts");
  }, 60000);

  /**
   * 测试 3: 内容搜索
   * 目标：验证 Agent 能调用 grep_search 工具搜索代码内容
   */
  it("should search code content", async () => {
    const result = await agent.run("在代码里搜索 Agent 类的定义");

    // 验证：输出应包含 Agent 类相关信息
    expect(result.toLowerCase()).toMatch(/agent|class/);
  }, 60000);

  /**
   * 测试 4: 文件查找
   * 目标：验证 Agent 能调用 find_files 工具查找文件
   */
  it("should find files by pattern", async () => {
    const result = await agent.run(
      "找出 packages/core/src 目录下所有 .ts 结尾的文件"
    );

    // 验证：输出应包含 .ts 文件
    expect(result).toMatch(/\.ts/);
  }, 60000);
});
