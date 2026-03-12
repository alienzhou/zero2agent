#!/usr/bin/env node
/**
 * 简单的 CLI 测试入口
 * 用法: npx tsx examples/simple-agent.ts "你的问题"
 */
import { runLoop } from "../packages/core/src/index.js";

const SYSTEM_PROMPT = `你是一个文件助手，可以帮助用户查看文件和目录内容。

你有以下工具可以使用：
- read_file: 读取文件内容
- list_directory: 列出目录结构

请根据用户的需求使用这些工具，然后用中文回答。`;

async function main() {
  const userMessage = process.argv[2];

  if (!userMessage) {
    console.log("用法: npx tsx examples/simple-agent.ts \"你的问题\"");
    console.log("示例: npx tsx examples/simple-agent.ts \"帮我看看 package.json 的内容\"");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("错误: 请设置 ANTHROPIC_API_KEY 环境变量");
    process.exit(1);
  }

  try {
    const result = await runLoop(userMessage, {
      systemPrompt: SYSTEM_PROMPT,
    });

    console.log("\n" + "=".repeat(60));
    console.log("最终回答:");
    console.log("=".repeat(60));
    console.log(result);
  } catch (error) {
    console.error("执行出错:", (error as Error).message);
    process.exit(1);
  }
}

main();
