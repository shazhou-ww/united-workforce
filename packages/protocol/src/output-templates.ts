import type { OutputSchemaName } from "./output-schemas.js";

/**
 * Liquid render templates for each CLI output schema. Registered in CAS
 * under `@ocas/template/text/<schemaHash>` so `--format text` (the default)
 * can produce a human-readable rendering for every command.
 *
 * Reserved Liquid context keys: `payload`, `type`. The CLI's renderer also
 * merges top-level payload fields into the root context for ergonomic
 * `{{ field }}` access.
 */

const THREAD_START_TEMPLATE = `Thread  {{ threadId }}
Workflow {{ workflowHash }}`;

const THREAD_STATUS_TEMPLATE = `Thread  {{ threadId }}
Workflow {{ workflowHash }}
Status  {{ status }}
Role    {% if status == "suspended" and suspendedRole %}{{ suspendedRole }}{% elsif currentRole %}{{ currentRole }}{% else %}-{% endif %}
Head    {% if head %}{{ head }}{% else %}-{% endif %}{% if status == "suspended" and suspendMessage %}
Suspend  {{ suspendMessage }}{% endif %}`;

const THREAD_LIST_TEMPLATE = `THREAD                      WORKFLOW       STATUS     ROLE       STARTED
{%- for item in items %}
{{ item.threadId }}  {{ item.workflowHash }}  {{ item.status | append: "          " | slice: 0, 9 }} {{ item.currentRole | default: "-" | append: "          " | slice: 0, 10 }} {% if item.startedAt %}{{ item.startedAt | date: "%Y-%m-%d %H:%M" }}{% else %}-{% endif %}
{%- endfor %}`;

const THREAD_EXEC_TEMPLATE = `{%- for step in steps -%}
Step {{ forloop.index }}  {{ step.role | default: "-" }} → {{ step.status }}{% if step.done %} ✓{% endif %}
{% endfor -%}`;

const STEP_DETAIL_TEMPLATE = `Step    {{ hash }}
Role    {{ role }}
Agent   {{ agent }}
Status  {{ status }}
Duration {% if durationMs == nil %}-{% elsif durationMs >= 1000 %}{{ durationMs | divided_by: 1000.0 | round: 1 }}s{% else %}{{ durationMs }}ms{% endif %}`;

const STEP_LIST_TEMPLATE = `HASH           ROLE        DURATION
{%- for item in items %}
{{ item.hash }}  {{ item.role | append: "          " | slice: 0, 10 }}  {% if item.durationMs == nil %}-{% elsif item.durationMs >= 1000 %}{{ item.durationMs | divided_by: 1000.0 | round: 1 }}s{% else %}{{ item.durationMs }}ms{% endif %}
{%- endfor %}`;

const WORKFLOW_DETAIL_TEMPLATE = `Workflow  {{ name }}
Version   {{ version }}
Hash      {{ hash }}
Roles     {% assign role_names = roles | keys %}{{ role_names | join: ", " }}
Graph     {% assign nodes = graph | graph_path: "$START", 5 %}{{ nodes | join: " → " }}{% if nodes.size >= 5 %} …{% endif %}`;

const WORKFLOW_LIST_TEMPLATE = `NAME          HASH           SOURCE     DESCRIPTION
{%- for item in items %}
{{ item.name | append: "             " | slice: 0, 13 }} {{ item.hash }}  {{ item.source | append: "          " | slice: 0, 10 }} {{ item.description }}
{%- endfor %}`;

const WORKFLOW_ADD_TEMPLATE = `Registered  {{ name }}
Hash        {{ hash }}`;

const VALIDATE_RESULT_TEMPLATE = `{%- if valid -%}
✓ valid
{%- else -%}
✗ invalid ({{ errors.size }} error{% if errors.size != 1 %}s{% endif %})
{%- for err in errors %}
  - {{ err }}
{%- endfor -%}
{%- endif -%}`;

export const OUTPUT_TEMPLATES: Record<OutputSchemaName, string> = {
  "thread-start": THREAD_START_TEMPLATE,
  "thread-status": THREAD_STATUS_TEMPLATE,
  "thread-list": THREAD_LIST_TEMPLATE,
  "thread-exec": THREAD_EXEC_TEMPLATE,
  "step-detail": STEP_DETAIL_TEMPLATE,
  "step-list": STEP_LIST_TEMPLATE,
  "workflow-add": WORKFLOW_ADD_TEMPLATE,
  "workflow-detail": WORKFLOW_DETAIL_TEMPLATE,
  "workflow-list": WORKFLOW_LIST_TEMPLATE,
  "validate-result": VALIDATE_RESULT_TEMPLATE,
};
