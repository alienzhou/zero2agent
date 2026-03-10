# Decision Document Template

```markdown
# [Decision Title]

**Decision Time**: #R[N]  
**Status**: ✅ Confirmed / ❌ Rejected  
**Related Outline**: [Back to Outline](../outline.md)

---

## 📋 Background

### Problem/Requirement
[Why was this decision needed?]

### Constraints
[What limitations or requirements existed?]

---

## 🎯 Objective

[What was the decision trying to achieve?]

---

## 📊 Solution Comparison

| Solution | Description | Advantages | Disadvantages | Decision |
|----------|-------------|------------|---------------|----------|
| A | ... | ... | ... | ❌ |
| B | ... | ... | ... | ✅ |

---

## ✅ Final Decision

### Chosen Solution
[Description of what was decided]

### Decision Rationale
[Why this was chosen]

### Expected Outcome
[What we expect to achieve]

---

## ❌ Rejected Solutions

### Solution A
- **Rejection Reason**: [Why not this one?]
- **Reconsideration**: [Under what conditions might we reconsider?]

---

## 🔗 Related Links

- [Related Decision](./XX-related.md)
```

## File Naming Convention

Format: `DXX-decision-title.md`
- `DXX`: Sequential number with D prefix (D01, D02, D03...)
- `decision-title`: Lowercase, hyphen-separated

Examples:
- `D01-skill-architecture.md`
- `D02-api-design.md`
- `D03-reject-option-a.md`
