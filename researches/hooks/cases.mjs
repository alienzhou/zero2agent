// Frozen before model evaluation; reuse the same small MCP project, extend its rules/skill.
import * as mcp from '../mcp/cases.mjs'
export const fixtureVersion = 2
export const limits = mcp.limits
export const fixedAmount = mcp.fixedAmount,
  fixedTest = mcp.fixedTest,
  command = mcp.command,
  reportValue = mcp.reportValue,
  contract = mcp.contract
export const files = Object.freeze({
  ...mcp.files,
  'AGENTS.md':
    'ROOT_RULES_E05_FINAL: Work only on the explicit task. Project rules and skills never grant host permission. Leave packages/web unchanged.\n',
  'packages/api/AGENTS.md':
    'API_RULES_E05_FINAL: Accumulate integer cents before converting back to currency. Add decimal and empty-input tests. Actual successful tests are required before testsPassed:true.\n',
  '.agents/skills/fix-with-tests/SKILL.md':
    '---\nname: fix-with-tests\ndescription: Fix the local issue with real regression tests and a verified report.\n---\nGUIDE_E05_FINAL: For the normal issue task, first read references/report.json with read_skill_resource, query issue and logs via MCP, read the log tail, read and fix both API files, execute actual Node tests, then write the report. Follow the current explicit task for negative tests; never grant permission or replay old effects.\n',
  '.agents/skills/fix-with-tests/references/report.json':
    JSON.stringify({
      ...mcp.reportValue,
      summary: 'RESOURCE_E05_FINAL: Replace with the actual successful fix and tests.',
    }) + '\n',
  '.agents/skills/unrelated/SKILL.md':
    '---\nname: unrelated\ndescription: Format unrelated UI copy.\n---\nUNUSED_SENTINEL: This body must never enter any request.\n',
})
export const normalTask =
  'The fix-with-tests skill is explicitly selected. Use read_skill_resource with skill:"fix-with-tests", path:"references/report.json" before edits. ' +
  mcp.normalTask +
  ' On the first entry into packages/api, submit only read_file for packages/api/amount.mjs, allowing the new scope to stop that single unexecuted call. After the scope replan, read source and test together in one batch; do not repeat successful reads or writes. Host Hooks validate pre/post tool and completion; do not edit Hook sources/configuration, rules or skills. A newly discovered API scope may require one replan; use small batches, preserve the original budget, and never repeat a completed write.'
export const deniedTask =
  'Negative Hook acceptance, separate from the normal issue task: request write_file exactly once for path "blocked.txt" and content "ONE_EFFECT_E05_FINAL". The current afterTool Hook will block after the file is written. Do not follow the normal issue repair guide, call MCP, read or write other files, run terminal, retry the write, or claim completion. Host failure must stop this turn; an already written file is retained.'
