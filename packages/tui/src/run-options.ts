import { validateRunLimits, type RunLimits } from '@zero2agent/core'

export const RUN_LIMIT_FLAGS = {
  '--max-iterations': 'maxIterations',
  '--max-requests': 'maxRequests',
  '--max-tool-calls': 'maxToolCalls',
  '--max-repeated-failures': 'maxRepeatedFailures',
  '--max-duration-ms': 'maxDurationMs',
  '--request-timeout-ms': 'requestTimeoutMs',
  '--max-retries': 'maxRetries',
  '--retry-base-ms': 'retryBaseMs',
  '--max-retry-delay-ms': 'maxRetryDelayMs',
} as const satisfies Record<string, keyof RunLimits>

export function limitValue(name: string, value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) throw new Error(`${name} requires a non-negative integer`)
  return Number(value)
}

export function runLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): RunLimits {
  const values: RunLimits = {}
  for (const [flag, key] of Object.entries(RUN_LIMIT_FLAGS)) {
    const name = `ZERO2AGENT_${flag.slice(2).replaceAll('-', '_').toUpperCase()}`
    if (env[name] !== undefined) values[key] = limitValue(name, env[name])
  }
  return validateRunLimits(values)
}
