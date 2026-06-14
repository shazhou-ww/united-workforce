---
scenario: "uwf-sumeru loads its instance + defaultGateway config from ~/.uwf/agents/sumeru.yaml"
feature: agent-sumeru
tags: [agent, sumeru, config, storage]
---

## Given

- `uwf-sumeru` is registered in `~/.uwf/config.yaml`:
  ```yaml
  agents:
    sumeru:
      command: uwf-sumeru
      args: []
  defaultAgent: sumeru
  ```
  The engine spawns it as `uwf-sumeru --thread <id> --role <role> --prompt <text>`.
- The adapter's own config lives at a separate file the adapter owns:
  `<UWF_HOME>/agents/sumeru.yaml` — resolved via
  `@united-workforce/util-agent`'s `resolveStorageRoot(process.env.UWF_HOME ?? null)`
  (per the existing `getConfigPath`/`resolveStorageRoot` convention used by the
  other adapters). Default `UWF_HOME` is `~/.uwf`.
- An example file:
  ```yaml
  instances:
    neko:
      url: https://oc-neko.shazhou.work/sumeru
      default: true
    kuma:
      url: https://oc-kuma.shazhou.work/sumeru
  defaultGateway: claude-code
  ```

## When

- `uwf-sumeru --thread T --role R --prompt P` runs and needs to pick which Sumeru
  instance + gateway to talk to.
- One of the following is true:
  1. `~/.uwf/agents/sumeru.yaml` does not exist.
  2. The file exists but is not valid YAML.
  3. The file exists, parses, but the `instances` map is empty.
  4. The file exists with N instances and none is marked `default: true`.
  5. The file exists with multiple instances marked `default: true`.
  6. `defaultGateway` is missing or empty.
  7. The file is valid: at least one instance, exactly one `default: true` (or
     N=1 instance defaulting to that one), and a non-empty `defaultGateway`.

## Then

- The adapter resolves the config path as
  `join(resolveStorageRoot(process.env.UWF_HOME ?? null), "agents", "sumeru.yaml")`.
  It MUST NOT hard-code `~/.uwf` — `UWF_HOME` overrides are respected.

- For case (1) missing file: the CLI exits non-zero with stderr message
  `sumeru adapter config not found: <path>. Create it with at least one instance and a defaultGateway.` Exit happens BEFORE any HTTP request is made.

- For case (2) invalid YAML: the CLI exits non-zero with stderr message
  `sumeru adapter config <path> is not valid YAML: <parser detail>`.

- For case (3) empty instances: exit non-zero with
  `sumeru adapter config <path> has no instances; declare at least one under 'instances:'`.

- For case (4) no default instance, N>1: exit non-zero with
  `sumeru adapter config <path> has N instances but none is marked default: true; mark exactly one`.

- For case (4) no default instance, N=1: the single instance is used as the
  default — the absence of `default: true` is tolerated when there is exactly one
  candidate.

- For case (5) multiple defaults: exit non-zero with
  `sumeru adapter config <path> has multiple instances marked default: true; mark exactly one`.

- For case (6) missing/empty `defaultGateway`: exit non-zero with
  `sumeru adapter config <path> is missing 'defaultGateway'`.

- For case (7) happy path: an in-memory `SumeruConfig` value is produced with:
  - `instances`: `Record<string, { url: string }>` (URLs trimmed; `default` marker
    consumed and dropped from the value)
  - `defaultInstanceName`: the name of the default instance (string)
  - `defaultGateway`: string (verbatim from file)
  Each instance URL MUST be retained without trailing slash (the adapter
  normalises before joining paths).

- Loading happens lazily (on first need) and is shared across `run()` /
  `continue()` calls within a single `uwf-sumeru` process invocation — the file
  is parsed at most once per process.

- A pure helper function `parseSumeruConfig(yamlText: string): Result<SumeruConfig,
  string>` lives in `packages/agent-sumeru/src/config.ts` and is exported through
  `src/index.ts` so it can be unit-tested without filesystem I/O. Tests in
  `packages/agent-sumeru/__tests__/config.test.ts` cover each of the cases above
  (1)–(7) by passing raw YAML strings and asserting on `Result.error` or
  `Result.value`.
