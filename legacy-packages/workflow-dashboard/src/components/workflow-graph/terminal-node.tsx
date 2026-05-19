import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Play, Square } from "lucide-react";
import type { TerminalNodeData } from "./types.ts";

function borderColor(state: TerminalNodeData["state"]): string {
  switch (state) {
    case "completed":
      return "hsl(var(--success))";
    case "active":
      return "hsl(var(--ring))";
    default:
      return "hsl(var(--border))";
  }
}

function bgColor(state: TerminalNodeData["state"]): string {
  if (state === "completed") return "hsl(var(--success))";
  if (state === "active") return "hsl(var(--ring))";
  return "hsl(var(--card))";
}

export function TerminalNode(props: NodeProps) {
  const data = props.data as TerminalNodeData;
  const isStart = data.kind === "start";
  const isActive = data.state === "active";
  const handleStyle = {
    background: "hsl(var(--muted-foreground))",
    width: 6,
    height: 6,
    border: "none",
  } as const;

  return (
    <div
      className={`rounded-full border-2 flex items-center justify-center ${isActive ? "wf-node-pulse" : ""} ${data.state !== "default" ? "cursor-pointer" : ""}`}
      style={{
        width: 40,
        height: 40,
        background: bgColor(data.state),
        borderColor: borderColor(data.state),
        color:
          data.state === "default"
            ? "hsl(var(--muted-foreground))"
            : "hsl(var(--primary-foreground))",
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
        <>
          <Handle
            type="target"
            position={Position.Top}
            id="top-in"
            style={handleStyle}
            isConnectable={false}
          />
          <Handle
            type="target"
            position={Position.Left}
            id="left-in"
            style={handleStyle}
            isConnectable={false}
          />
          <Handle
            type="target"
            position={Position.Right}
            id="right-in"
            style={handleStyle}
            isConnectable={false}
          />
        </>
      )}
      {isStart ? <Play className="h-3 w-3" /> : <Square className="h-3 w-3" />}
    </div>
  );
}
