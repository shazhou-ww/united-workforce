---
"@united-workforce/cli": patch
---

fix: preset provider base-url auto-fill, bootstrap ACP docs, friendlier name mismatch error

- `uwf setup --provider dashscope` now auto-fills `--base-url` from preset list (#106)
- Bootstrap guide documents uwf-hermes ACP dependency (`pip install hermes-agent[acp]`) (#107)
- Bootstrap verify step uses inline workflow instead of missing `examples/eval-simple.yaml` (#107)
- Workflow filename mismatch error now suggests how to fix it (#108)
