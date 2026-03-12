#!/usr/bin/env node
/**
 * zero2agent CLI 入口
 */
import { Agent } from "@zero2agent/core";
import * as readline from "node:readline";

const SYSTEM_PROMPT = `你是一个文件助手，可以帮助用户查看文件和目录内容。

你有以下工具可以使用：
- read_file: 读取文件内容
- list_directory: 列出目录结构

请根据用户的需求使用这些工具，然后用中文回答。`;

async function main() {
  // 检查是否有命令行参数
  const messageArg = process.argv[2];

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("错误: 请设置 ANTHROPIC_API_KEY 环境变量");
    process.exit(1);
  }

  const agent = new Agent({
    systemPrompt: SYSTEM_PROMPT,
  });

  // 如果有命令行参数，直接执行
  if (messageArg) {
    try {
      const result = await agent.run(messageArg);
      console.log("\n" + "=".repeat(60));
      console.log("回答:");
      console.log("=".repeat(60));
      console.log(result);
    } catch (error) {
      console.error("执行出错:", (error as Error).message);
      process.exit(1);
    }
    return;
  }

  // 交互模式
  console.log("zero2agent - 文件助手");
  console.log("输入你的问题，输入 exit 退出\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question("你: ", async (input) => {
      const trimmed = input.trim();

      if (trimmed === "exit" || trimmed === "quit") {
        console.log("再见！");
        rl.close();
        return;
      }

      if (!trimmed) {
        prompt();
        return;
      }

      try {
        const result = await agent.run(trimmed);
        console.log("\n助手:", result, "\n");
      } catch (error) {
        console.error("错误:", (error as Error).message, "\n");
      }

      prompt();
    });
  };

  prompt();
}

main();
