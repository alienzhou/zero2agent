import type { Tool } from './types.js'
import { MAX_RESULT_READ_BYTES, ResultStoreError } from '../result-store.js'

/** Only malformed read ranges are correctable; permission/lifecycle failures retain their meaning. */
export class ResultReadInputError extends Error {
  constructor() {
    super(
      'INVALID_RESULT_RANGE: No evidence was returned. For the final page use {reference, tail:true, limit:4096} and OMIT offset. For a byte range use {reference, offset, limit} and OMIT tail. Offset must be a nonnegative byte position within the saved body; limit must be 4..4096. Correct the read before concluding that evidence is unavailable.'
    )
    this.name = 'ResultReadInputError'
  }
}

export const readToolResultTool: Tool = {
  name: 'read_tool_result',
  permission: { effect: 'read' },
  // The host resolves saved source paths before authorization; model input cannot replace them.
  readPaths: async (input, ctx) => {
    if (!ctx.results) throw new Error('Result storage is unavailable in this host.')
    return ctx.results.readPaths(input.reference)
  },
  description:
    'Read the saved body, even if its source file is gone. Choose tail {reference,tail:true} OR range {reference,offset:0}; never both. A receipt is metadata, not a partial copy. Current source permissions apply. Never replay the source tool.',
  input_schema: {
    type: 'object',
    properties: {
      reference: {
        type: 'string',
        description: 'Exact reference from the receipt.',
      },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Byte offset or next_offset. OMIT for tail:true. Default 0.',
      },
      tail: {
        type: 'boolean',
        description: 'Final page; OMIT offset. Default false.',
      },
      limit: {
        type: 'integer',
        minimum: 4,
        maximum: MAX_RESULT_READ_BYTES,
        description: `Byte limit, default ${MAX_RESULT_READ_BYTES}.`,
      },
    },
    required: ['reference'],
  },
  execute: async (input, ctx) => {
    if (!ctx.results) throw new Error('Result storage is unavailable in this host.')
    if (
      (input.tail !== undefined && typeof input.tail !== 'boolean') ||
      input.offset === 'tail' ||
      (input.tail === true && input.offset !== undefined)
    )
      throw new ResultReadInputError()
    try {
      return await ctx.results.read(
        input.reference,
        input.tail ? 'tail' : input.offset,
        input.limit,
        ctx.signal
      )
    } catch (error) {
      if (error instanceof ResultStoreError && error.code === 'INVALID_RESULT_RANGE')
        throw new ResultReadInputError()
      throw error
    }
  },
}
