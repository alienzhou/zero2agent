/**
 * Anthropic LLM 客户端封装
 * 支持通过 baseURL 切换到兼容 API 提供商（如 MiniMax）
 */
import Anthropic from "@anthropic-ai/sdk";

export interface LLMConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export function createAnthropicClient(config: LLMConfig = {}): Anthropic {
  return new Anthropic({
    apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
    baseURL: config.baseURL ?? process.env.ANTHROPIC_BASE_URL,
  });
}

export function getModelName(config: LLMConfig = {}): string {
  return config.model ?? process.env.MODEL_NAME ?? DEFAULT_MODEL;
}
