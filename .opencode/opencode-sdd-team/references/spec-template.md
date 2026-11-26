# Spec template (load only when drafting spec.md)

Keep it terse: tables and one-line statements. Every item gets a stable ID.

```markdown
# Spec: <Project name>

## 1. Vision and scope
- Goal (1-2 lines). Users. Out of scope.

## 2. Requirements
| ID | Requirement | Priority |
|---|---|---|
| REQ-001 | ... | must |

## 3. Contracts
### API
| ID | Method | Path | Request | Response | Errors |
|---|---|---|---|---|---|
| API-001 | POST | /x | {...} | 201 {...} | 400, 409 |
### Data
| ID | Entity | Fields (type, constraints) | Relations |
|---|---|---|---|
| DB-001 | ... | ... | ... |
### UI (if any)
| ID | Route/Screen | Components | API used |
|---|---|---|---|

## 4. Acceptance criteria (BDD)
- AC-001 (REQ-001): Given ..., When ..., Then ...

## 5. Non-functional
- Performance, security, accessibility limits as measurable numbers.

## 6. Decisions and open questions
- D-001: decision + reason. Q-001: unresolved (blocks: REQ-00X).
```

`tasks.md` (written by orchestrator):

```markdown
| Task | Owner | Files | Spec refs | Done when | Status |
|---|---|---|---|---|---|
| T-001 | tech-lead | src/app/** | REQ-001, DB-001 | scaffold builds | todo |
```

Status values: `todo`, `doing`, `review`, `fix`, `done`, `blocked`.
