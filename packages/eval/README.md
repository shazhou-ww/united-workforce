# @united-workforce/eval

Evaluation harness for workflow runs. Installs the `uwf-eval` CLI binary.

## Usage

```bash
uwf-eval run <task-dir> [options]
```

### Debugging

`uwf-eval run` now cleans up `/tmp` workdirs after each run. Use `--keep-workdir` to retain them for debugging.
