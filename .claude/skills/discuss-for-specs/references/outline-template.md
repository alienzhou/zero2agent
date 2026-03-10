# Outline Template

Use this state-priority order:

```markdown
# Discussion: [Topic]

> Status: In Progress | Round: R[N] | Date: YYYY-MM-DD

## 🔵 Current Focus

- **[Primary question being discussed right now]**
- **[Secondary question if applicable]**

## ⚪ Pending

- [ ] Question A
- [ ] Question B

## ✅ Confirmed

| Decision | Description | Document |
|----------|-------------|----------|
| Decision Title | Brief description | [D01](./decisions/D01-xxx.md) |

## ❌ Rejected

- Decision title (reason) → [D02](./decisions/D02-xxx.md)

## 📁 Archive

| Question | Conclusion | Details |
|----------|-----------|---------|
| Topic X | Brief conclusion | [→ notes](./notes/xxx.md) |
```

## Key Principles

1. **State-first ordering**: Current Focus at top, Archive at bottom
2. **High information density**: Outline is an index, not a content container
3. **Link to details**: Use `decisions/` for decided items, `notes/` for reference materials
4. **Checkbox for pending**: Makes it clear what needs discussion

## Visual Standards

**✅ DO Use**:
- Standard Markdown: `#`, `##`, `###`
- Horizontal rules: `---`
- Tables: `| Header | Header |`
- Lists: `-`, `*`, `1.`
- Code blocks: ` ``` `
- Bold: `**text**`
- Checkboxes: `- [ ]`, `- [x]`

**❌ DON'T Use**:
- Unicode box drawing: `╭╮╰╯│═─┌┐└┘`
- Custom ASCII art
- Emoji overuse (keep minimal)
- Complex nested structures
