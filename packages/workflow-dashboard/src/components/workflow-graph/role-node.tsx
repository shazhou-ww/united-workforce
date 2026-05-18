import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Check, Circle } from "lucide-react";
import type { RoleNodeData } from "./types.ts";

function borderColor(state: RoleNodeData["state"]): string {
  switch (state) {
    case "completed":
      return "hsl(var(--success))";
    case "active":
      return "hsl(var(--ring))";
    default:
      return "hsl(var(--border))";
  }
}

export function RoleNode(props: NodeProps) {
  const data = props.data as RoleNodeData;
  const isActive = data.state === "active";
  const handleStyle = {
    background: "hsl(var(--muted-foreground))",
    width: 6,
    height: 6,
    border: "none",
  } as const;

  return (
    <div
      className={`px-3 py-2 rounded-md border-2 text-xs font-medium ${data.state !== "default" ? "cursor-pointer" : ""} ${isActive ? "wf-node-pulse" : ""}`}
      style={{
        width: 180,
        height: 60,
        background: "hsl(var(--card))",
        borderColor: borderColor(data.state),
        color: "hsl(var(--foreground))",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        boxSizing: "border-box",
      }}
      title={data.description}
    >
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
      <Handle
        type="source"
        position={Position.Left}
        id="left-out"
        style={handleStyle}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right-out"
        style={handleStyle}
        isConnectable={false}
      />
      <div className="flex items-center gap-1.5 font-mono">
        {data.state === "completed" && <Check className="h-3 w-3 text-success" />}
        {data.state === "active" && <Circle className="h-3 w-3 fill-current text-ring" />}
        <span className="truncate">{data.label}</span>
      </div>
      {data.description !== "" && (
        <div
          className="text-[10px] truncate mt-0.5"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {data.description}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-out"
        style={handleStyle}
        isConnectable={false}
      />
    </div>
  );
}
