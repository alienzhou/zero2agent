/**
 * Agent 类 - 封装 ReACT 循环的简化入口
 */
import { runLoop } from "./loop.js";
import type { LoopEventHandlers } from "./loop.js";
import type { Tool } from "./tools/index.js";
import type { LLMConfig } from "./llm/index.js";

export interface AgentOptions {
  config?: LLMConfig;
  tools?: Tool[];
  systemPrompt?: string;
  events?: LoopEventHandlers;
  /** Agent 工作目录，所有工具的相对路径基于此解析。默认 process.cwd() */
  cwd?: string;
}

/**
 * Agent 类，提供简洁的 API 来运行 ReACT 循环
 */
export class Agent {
  private options: AgentOptions;

  constructor(options: AgentOptions = {}) {
    this.options = options;
  }

  /**
   * 运行 Agent 处理用户消息
   */
  async run(message: string): Promise<string> {
    return runLoop(message, {
      config: this.options.config,
      tools: this.options.tools,
      systemPrompt: this.options.systemPrompt,
      events: this.options.events,
      cwd: this.options.cwd,
    });
  }

  /**
   * 静态方法：快速运行一次
   */
  static async run(message: string, options?: AgentOptions): Promise<string> {
    const agent = new Agent(options);
    return agent.run(message);
  }
}
