import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
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
  const edgeData = data as ConditionEdgeData | undefined;
  const isFallback = edgeData?.isFallback ?? false;
  const isSelfLoop = source === target;

  const [path, labelX, labelY] = isSelfLoop
    ? getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: 20,
      })
    : getBezierPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
      });

  const stroke = isFallback ? "var(--color-text-muted)" : "var(--color-text)";
  const strokeDasharray = isFallback ? "5 4" : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke, strokeWidth: 1.5, strokeDasharray }}
      />
      {edgeData && !isFallback && edgeData.condition !== "" && (
        <EdgeLabelRenderer>
          <div
            className="absolute px-1.5 py-0.5 rounded text-[10px] font-mono pointer-events-auto"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
            }}
            title={edgeData.conditionDescription ?? undefined}
          >
            {edgeData.condition}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
