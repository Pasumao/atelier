# <Change Title> — Intent & Acceptance

> Human-owned file. The agent reads this before editing anything and may propose edits, but you decide.
> Read `specs/constitution.md` first — specs that violate it are rejected (cite the clause).
> Acceptance uses **EARS** syntax; every statement lands as an executable test (`.atr.spec.ts`)
> — spec = executable test (Atelier 对位 Spec Kit 的核心差异点).

## Goal
(one paragraph — what this change is for, in product terms)

## Constraints
(only what this change adds beyond `constitution.md` — H1-H6 etc. are already in force there)

## Acceptance (EARS — Easy Approach to Requirements Syntax)

- [ ] WHEN <trigger / event> THE SYSTEM SHALL <observable response> — spec: `<name>.atr.spec.ts`
- [ ] IF <precondition / state> THE SYSTEM SHALL <response> — spec: `<name>.atr.spec.ts`
- [ ] WHILE <ongoing state> THE SYSTEM SHALL <response> — spec: `<name>.atr.spec.ts`（可选）
- [ ] WHERE <feature / location> THE SYSTEM SHALL <response> — spec: `<name>.atr.spec.ts`（可选）

> 写法要点：一条语句一个可观察行为；SHALL 后用现在时动词；spec 列填承接用例（没有就先补用例）。
