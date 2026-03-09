# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | ⬜ To fill |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | ⬜ To fill |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | ⬜ To fill |
| [State Management](./state-management.md) | Local state, global state, server state | ⬜ To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | ⬜ To fill |
| [Type Safety](./type-safety.md) | Type patterns, validation | ⬜ To fill |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

## Pre-Development Checklist

Before writing frontend code, read the relevant guidelines based on your task:

- Component work → [component-guidelines.md](./component-guidelines.md)
- Hook work → [hook-guidelines.md](./hook-guidelines.md)
- State management → [state-management.md](./state-management.md)
- Type questions → [type-safety.md](./type-safety.md)

---

## Quality Check

After writing code, verify against these guidelines:

1. Run `git diff --name-only` to see what you changed
2. Read the relevant guidelines above for each changed area
3. Always check [quality-guidelines.md](./quality-guidelines.md)
4. Run lint and typecheck

---

**Language**: All documentation should be written in **English**.
