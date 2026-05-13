import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
} from "@xyflow/react";
import type { ConditionEdgeData } from "./types.ts";

export function ConditionEdge(props: EdgeProps) {
  const {
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    markerEnd,
  } = props;
  const edgeData = data as (ConditionEdgeData & { elkLabelX?: number | null; elkLabelY?: number | null }) | undefined;
  const isFallback = edgeData?.isFallback ?? false;
  const isSelfLoop = source === target;

  const [path, defaultLabelX, defaultLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: isSelfLoop ? 20 : 8,
    offset: isSelfLoop ? 50 : undefined,
  });

  const stroke = isFallback ? "var(--color-text-muted)" : "var(--color-accent)";
  const strokeDasharray = isFallback ? "5 4" : undefined;
  const label = edgeData?.condition ?? "";

  // Use ELK-computed label position if available, otherwise fall back to ReactFlow default
  const labelX = edgeData?.elkLabelX ?? defaultLabelX;
  const labelY = edgeData?.elkLabelY ?? defaultLabelY;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke, strokeWidth: 1.5, strokeDasharray }}
      />
      {label !== "" && (
        <EdgeLabelRenderer>
          <div
            className="absolute px-1.5 py-0.5 rounded text-[10px] font-mono pointer-events-auto"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              color: isFallback ? "var(--color-text-muted)" : "var(--color-text)",
              whiteSpace: "nowrap",
              zIndex: 10,
            }}
            title={edgeData?.conditionDescription ?? undefined}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
