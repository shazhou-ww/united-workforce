import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { TerminalNodeData } from "./types.ts";

function borderColor(state: TerminalNodeData["state"]): string {
  switch (state) {
    case "completed":
      return "var(--color-success)";
    case "active":
      return "var(--color-accent)";
    default:
      return "var(--color-border)";
  }
}

function bgColor(state: TerminalNodeData["state"]): string {
  if (state === "completed") return "var(--color-success)";
  if (state === "active") return "var(--color-accent)";
  return "var(--color-surface)";
}

export function TerminalNode(props: NodeProps) {
  const data = props.data as TerminalNodeData;
  const isStart = data.kind === "start";
  const isActive = data.state === "active";
  const handleStyle = {
    background: "var(--color-text-muted)",
    width: 6,
    height: 6,
    border: "none",
  } as const;

  return (
    <div
      className={`rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${isActive ? "wf-node-pulse" : ""} ${data.state !== "default" ? "cursor-pointer" : ""}`}
      style={{
        width: 40,
        height: 40,
        background: bgColor(data.state),
        borderColor: borderColor(data.state),
        color: data.state === "default" ? "var(--color-text-muted)" : "var(--color-bg)",
      }}
      title={isStart ? "Start" : "End"}
    >
      {isStart ? (
        <Handle
          type="source"
          position={Position.Bottom}
          id="bottom-out"
          style={handleStyle}
          isConnectable={false}
        />
      ) : (
        <Handle type="target" position={Position.Top} id="top-in" style={handleStyle} isConnectable={false} />
      )}
      {isStart ? "▶" : "■"}
    </div>
  );
}
