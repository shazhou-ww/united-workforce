# Issue #418: ACP session/resume 返回空文本

## 调研日期: 2026-05-23

## 根因

`session/resume` 在 restore 路径下 `_make_agent()` 失败，异常被静默吞掉。

### 完整调用链

```
resume_session(sid)
  → update_cwd(sid)
    → get_session(sid) → _restore(sid)
      → _make_agent()
        → resolve_runtime_provider("custom") 失败（line 548-561）
        → AIAgent() 抛出 "No LLM provider configured"（line 564）
      → except Exception 静默吞掉（line 482-484）→ return None
    → return None
  → state is None → fallback: create_session()（新 sid，无历史）
```

### 关键代码位置（acp_adapter/session.py）

- `_restore()` line 426-498: 从 DB 恢复 session，但 except 太宽泛
- `_make_agent()` line 520-568: provider 解析在 restore 路径下不完整
- Line 548-561: `resolve_runtime_provider("custom")` 失败后，`base_url` 虽然从 DB 取到了但没传给 AIAgent

### 实测行为

1. Phase 1: `session/new` + `prompt` → 正常，有 `agent_message_chunk`
2. Phase 2: `session/resume` + `prompt`
   - resume 返回成功，但 `available_commands_update` 里 sessionId 是新的（create_session fallback）
   - 用原始 sid 发 prompt → `stopReason: "refusal"`（session 不在内存中）
   - 用新 sid 发 prompt → 能跑但无历史（agent 回答"不知道 secret code"）

### 验证脚本

```python
# 直接调用 _restore 验证
cd ~/.hermes/hermes-agent
python3 -c "
import sys; sys.path.insert(0, '.')
from acp_adapter.session import SessionManager
sm = SessionManager()
result = sm._restore('SESSION_ID_HERE')
print(result)  # None — _make_agent 抛异常被吞掉
"
```

### 两个 bug

1. **`_make_agent` provider fallback 不完整**: restore 时 DB 里有 `base_url` 和 `api_mode`，但 `resolve_runtime_provider` 失败后这些值没被正确传递给 AIAgent
2. **`_restore` 的 except 太宽泛**: 静默吞掉所有异常，连 warning 都只在 debug 级别，导致 resume 失败完全无感知

### Hermes 版本

- v0.10.0 (2026.4.16) — 初始测试
- v0.14.0 (2026.5.16) — 更新后重新测试，bug 仍在
- 代码路径: ~/.hermes/hermes-agent/acp_adapter/session.py

### v0.14.0 测试结果 (2026-05-23)

- `_restore` 仍因 `custom` provider 解析失败返回 None
- 日志更清晰了：`WARNING: Failed to recreate agent for ACP session ...`
- resume fallback 创建新 session（新 sid），但 agent 居然能回答之前的问题（可能通过 memory/session search）
- 核心问题不变：sessionId 变了，client 用旧 sid 发 prompt → refusal

### 上游 Issue

- https://github.com/NousResearch/hermes-agent/issues/13489 — 已评论根因分析
- https://github.com/NousResearch/hermes-agent/issues/8083 — resume 静默创建新 session
- https://github.com/NousResearch/hermes-agent/issues/18452 — _make_agent fallback 不完整
