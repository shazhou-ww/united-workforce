import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from "@xyflow/react";
import type { ConditionEdgeData } from "./types.ts";

// Must match the FEEDBACK_OFFSET_X in use-layout.ts
const FEEDBACK_OFFSET_X = 80;
// Radius for feedback edge corners
const FEEDBACK_RADIUS = 16;

/**
 * Build an SVG path for an edge routed to the side of the nodes.
 * Works for both feedback (bottom→up) and skip-forward (top→down) edges.
 * The path goes: source → horizontal to side → vertical → horizontal to target
 */
function sidePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  side: "right" | "left",
): string {
  const d = side === "right" ? 1 : -1;
  const offsetX =
    side === "right"
      ? Math.max(sourceX, targetX) + FEEDBACK_OFFSET_X
      : Math.min(sourceX, targetX) - FEEDBACK_OFFSET_X;
  const r = FEEDBACK_RADIUS;

  // Direction: going up (feedback) or down (skip-forward)
  const goingDown = targetY > sourceY;
  const vertSourceY = goingDown ? sourceY + r : sourceY - r;
  const vertTargetY = goingDown ? targetY - r : targetY + r;

  const segments = [
    `M ${sourceX} ${sourceY}`,
    `L ${offsetX - d * r} ${sourceY}`,
    `Q ${offsetX} ${sourceY} ${offsetX} ${vertSourceY}`,
    `L ${offsetX} ${vertTargetY}`,
    `Q ${offsetX} ${targetY} ${offsetX - d * r} ${targetY}`,
    `L ${targetX} ${targetY}`,
  ];

  return segments.join(" ");
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: edge routing logic is inherently branchy
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
  const isFeedback = edgeData?.isFeedback ?? false;

  let path: string;
  let defaultLabelX: number;
  let defaultLabelY: number;

  if (isFeedback) {
    const side = edgeData?.feedbackSide ?? "right";
    path = sidePath(sourceX, sourceY, targetX, targetY, side);
    const offsetX =
      side === "right"
        ? Math.max(sourceX, targetX) + FEEDBACK_OFFSET_X
        : Math.min(sourceX, targetX) - FEEDBACK_OFFSET_X;
    defaultLabelX = offsetX;
    defaultLabelY = (sourceY + targetY) / 2;
  } else {
    const result = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: isSelfLoop ? 20 : 8,
      offset: isSelfLoop ? 50 : undefined,
    });
    path = result[0];
    defaultLabelX = result[1];
    defaultLabelY = result[2];
  }

  const stroke = "hsl(var(--ring))";
  const label = isFallback ? "" : (edgeData?.condition ?? "");

  // Use pre-computed label position if available, otherwise fall back to default
  const labelX = edgeData?.labelX ?? defaultLabelX;
  const labelY = edgeData?.labelY ?? defaultLabelY;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke, strokeWidth: 1.5 }} />
      {label !== "" && (
        <EdgeLabelRenderer>
          <div
            className="absolute px-1.5 py-0.5 rounded text-[10px] font-mono pointer-events-auto"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              color: "hsl(var(--foreground))",
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
