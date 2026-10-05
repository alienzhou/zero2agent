/** Explicit host configuration for older non-TTY live regression tasks. */
export function liveCliEnv(access: 'read' | 'edit' | 'terminal'): Record<string, string> {
  return {
    ZERO2AGENT_SKIP_LOCAL_ENV: '1',
    CONTEXT_WINDOW: process.env.CONTEXT_WINDOW ?? '30000',
    MAX_INPUT_TOKENS: process.env.MAX_INPUT_TOKENS ?? '24000',
    MAX_OUTPUT_TOKENS: process.env.MAX_OUTPUT_TOKENS ?? '2048',
    CONTEXT_COUNTING: 'conservative',
    ...(process.env.MODEL_NAME ? { MODEL_NAME: process.env.MODEL_NAME } : {}),
    PERMISSION_MODE: access === 'edit' ? 'accept-edits' : 'default',
    PERMISSION_RULES: JSON.stringify(
      access === 'terminal' ? [{ tool: 'terminal', action: 'allow' }] : []
    ),
  }
}
