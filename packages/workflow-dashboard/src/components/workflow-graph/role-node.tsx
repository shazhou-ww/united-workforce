import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { RoleNodeData } from "./types.ts";

function borderColor(state: RoleNodeData["state"]): string {
  switch (state) {
    case "completed":
      return "var(--color-success)";
    case "active":
      return "var(--color-accent)";
    default:
      return "var(--color-border)";
  }
}

function stateIcon(state: RoleNodeData["state"]): string | null {
  if (state === "completed") return "✓";
  if (state === "active") return "●";
  return null;
}

export function RoleNode(props: NodeProps) {
  const data = props.data as RoleNodeData;
  const icon = stateIcon(data.state);
  const isActive = data.state === "active";
  const handleStyle = {
    background: "var(--color-text-muted)",
    width: 6,
    height: 6,
    border: "none",
  } as const;

  return (
    <div
      className={`px-3 py-2 rounded-md border-2 text-xs font-medium ${isActive ? "wf-node-pulse" : ""}`}
      style={{
        width: 180,
        height: 60,
        background: "var(--color-surface)",
        borderColor: borderColor(data.state),
        color: "var(--color-text)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        boxSizing: "border-box",
      }}
      title={data.description}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} isConnectable={false} />
      <div className="flex items-center gap-1.5 font-mono">
        {icon !== null && (
          <span
            style={{
              color: data.state === "active" ? "var(--color-accent)" : "var(--color-success)",
            }}
          >
            {icon}
          </span>
        )}
        <span className="truncate">{data.label}</span>
      </div>
      {data.description !== "" && (
        <div className="text-[10px] truncate mt-0.5" style={{ color: "var(--color-text-muted)" }}>
          {data.description}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={handleStyle} isConnectable={false} />
    </div>
  );
}
