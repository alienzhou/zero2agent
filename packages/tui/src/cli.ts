#!/usr/bin/env node
/**
 * zero2agent CLI 入口
 */
import { Agent } from "@zero2agent/core";
import type { LoopEventHandlers } from "@zero2agent/core";
import * as readline from "node:readline";

const SYSTEM_PROMPT = `你是一个文件助手，可以帮助用户查看文件和目录内容。

你有以下工具可以使用：
- read_file: 读取文件内容
- list_directory: 列出目录结构
- grep_search: 搜索文件内容（支持正则表达式）

请根据用户的需求使用这些工具，然后用中文回答。`;

// ── ANSI 样式 ──────────────────────────────────────

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

// ── 工具输出摘要 ──────────────────────────────────

function summarizeToolOutput(toolName: string, output: string): string {
  if (output.startsWith("Error:") || output.startsWith("No ")) {
    return output.split("\n")[0];
  }

  const firstLine = output.split("\n")[0];

  if (toolName === "grep_search" && firstLine.startsWith("Found ")) {
    return firstLine;
  }
  if (toolName === "read_file") {
    return `Read ${output.split("\n").length} lines`;
  }
  if (toolName === "list_directory") {
    return `Listed ${output.split("\n").filter((l) => l.trim()).length} entries`;
  }
  return `${output.length} chars`;
}

function formatToolInput(input: Record<string, unknown>): string {
  return Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => (typeof v === "string" ? `${k}: "${v}"` : `${k}: ${v}`))
    .join(", ");
}

// ── 事件处理 ───────────────────────────────────────

let hasStreamedText = false;

function resetStreamState() {
  hasStreamedText = false;
}

const events: LoopEventHandlers = {
  onText: (text) => {
    if (!hasStreamedText) {
      process.stdout.write("\n");
      hasStreamedText = true;
    }
    process.stdout.write(text);
  },
  onToolStart: (name, input) => {
    if (hasStreamedText) {
      process.stdout.write("\n");
      hasStreamedText = false;
    }
    const params = formatToolInput(input);
    process.stdout.write(`${DIM}  ⚡ ${name}(${params})${RESET}\n`);
  },
  onToolEnd: (name, output, durationMs) => {
    const summary = summarizeToolOutput(name, output);
    process.stdout.write(`${DIM}  ${GREEN}✓${RESET}${DIM} ${summary} (${durationMs}ms)${RESET}\n`);
  },
  onToolError: (_name, error) => {
    process.stdout.write(`${DIM}  ${RED}✗${RESET}${DIM} ${error}${RESET}\n`);
  },
};

// ── 主流程 ─────────────────────────────────────────

async function main() {
  const messageArg = process.argv[2];

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("错误: 请设置 ANTHROPIC_API_KEY 环境变量");
    process.exit(1);
  }

  const agent = new Agent({
    systemPrompt: SYSTEM_PROMPT,
    events,
  });

  if (messageArg) {
    try {
      resetStreamState();
      await agent.run(messageArg);
      console.log();
    } catch (error) {
      console.error("\n执行出错:", (error as Error).message);
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
        resetStreamState();
        await agent.run(trimmed);
        console.log("\n");
      } catch (error) {
        console.error("\n错误:", (error as Error).message, "\n");
      }

      prompt();
    });
  };

  prompt();
}

main();
