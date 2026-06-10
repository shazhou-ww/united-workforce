# 沙洲工作室 — 内部开发指南

所有开发工作在 **Gitea** (`git.shazhou.work`) 上进行。GitHub 仅作为开源镜像，发版时同步。

## Setup

```bash
git clone https://git.shazhou.work/shazhou/united-workforce.git
cd united-workforce
pnpm install
pnpm run build
pnpm test
```

## 日常开发

```bash
pnpm run build     # TypeScript 编译（all packages）
pnpm run check     # tsc + biome lint + log tag 校验
pnpm run format    # Biome 自动格式化
pnpm test          # 跑全部测试
```

`build`、`check`、`test` 三项全过才能提 PR。pre-push hook 会自动跑 `check` + `test`。

## Issue → Branch → PR

1. **在 Gitea 开 Issue** — 所有工作从 Issue 开始，必须挂 milestone
2. **Branch** from `main`: `git checkout -b feat/123-short-description`
3. **实现** — 写代码 + 写测试
4. **检查**: `pnpm run check && pnpm test`
5. **Commit** — 消息里引用 Issue: `Fixes #123`
6. **Push** to Gitea，开 PR

### tea CLI

用 `tea` 操作 Gitea：

```bash
tea issues                              # 列出 open issues
tea issues create -t "title" -d "desc"  # 开 issue
tea pr create -t "title" -d "desc"      # 开 PR
tea pr 5 --comments                     # 查看 PR 评论
```

## 编码规范

详见 [CLAUDE.md](CLAUDE.md)。要点：

- **Functional-first** — `function` + `type`，不用 `class` + `interface`
- **No optional properties** — 用 `T | null`，不用 `?:`
- **Named exports only** — 不用 default export
- **No `console.log`** — 用 `@united-workforce/util` 的 structured logger
- **Static imports only** — 生产代码不用 `await import()`
- **Biome** — lint + format，提交前跑 `pnpm run check`

## Commit Messages

```
<type>(<scope>): <description>

type: feat | fix | refactor | docs | chore | test
scope: cli | moderator | agent-kit | hermes | builtin | claude-code | util | protocol | dashboard
```

## PR Description

```markdown
## What
做了什么。

## Why
为什么要做。

## Changes
- `path/to/file.ts` — 改了什么，为什么

## Ref
Fixes #N
```

## Changeset

**仅用户可感知的变更** 需要 changeset：

- ✅ `feat`、`fix`、breaking changes
- ❌ `chore`、`test`、`docs`（除非影响 public API）

```bash
pnpm changeset
```

`.changeset/` 下生成的 markdown 文件会在发版时消费，自动 bump 版本号和生成 CHANGELOG。

## GitHub 同步

发版或重要更新后，将 Gitea main 同步到 GitHub：

```bash
git push github main --tags
```

GitHub 是下游镜像，不要在 GitHub 上直接操作。

## 项目结构

```
packages/
  protocol/          # 共享类型和 JSON Schema
  util/              # 编码、ID、日志、frontmatter
  util-agent/        # createAgent 工厂、extract pipeline
  agent-hermes/      # Hermes ACP agent
  agent-builtin/     # Built-in LLM agent
  agent-claude-code/ # Claude Code agent
  cli/               # uwf CLI
  dashboard/         # Web UI（private, alpha）
```

依赖从下往上流 — 底层包不依赖上层。详见 [CLAUDE.md](CLAUDE.md)。
