/** Awaited host control boundary. Unlike display observers, failure blocks the mutation. */
export interface FileMutation {
  cwd: string
  paths: string[]
  toolName: string
  toolCallId: string
  operationId?: string
  sessionId?: string
  signal?: AbortSignal
}
export type FileMutationHandler = (
  mutation: FileMutation,
  execute: () => Promise<string>
) => Promise<string>
