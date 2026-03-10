/**
 * @zero2agent/shared
 * Shared types and utilities for zero2agent
 */

// Common types
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AgentConfig {
  // TODO: Define in E001
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// Utility functions
export function createMessage(role: Message['role'], content: string): Message {
  return { role, content }
}
