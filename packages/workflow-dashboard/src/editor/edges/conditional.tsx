import {
  getSmoothStepPath,
  EdgeLabelRenderer,
  useReactFlow,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { ConditionalEdge as ConditionalEdgeType } from "../type.ts";
import { useModel } from "../context.tsx";
import { cn } from "../../lib/utils.ts";

const SOURCE_COLOR = "#10b981";
const TARGET_COLOR = "#3b82f6";
const LACK_COLOR = "#ff5252";
const RADIUS = 12;

function GradientPath({
  id,
  path,
  sourceX,
  sourceY,
  targetX,
  targetY,
  hasCondition,
  selected,
}: {
  id: string;
  path: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  hasCondition: boolean | null;
  selected: boolean;
}) {
  const gradientId = `gradient-${id}`;
  const showLack = hasCondition === false;
  const strokeStyle = selected
    ? { stroke: '#f59e0b', strokeWidth: 2 }
    : { stroke: `url(#${gradientId})`, strokeWidth: 1.5 };

  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={showLack ? LACK_COLOR : SOURCE_COLOR} />
          <stop offset="100%" stopColor={showLack ? LACK_COLOR : TARGET_COLOR} />
        </linearGradient>
      </defs>
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction"
      />
      <path
        id={id}
        d={path}
        fill="none"
        className="react-flow__edge-path"
        style={strokeStyle}
      />
    </>
  );
}

function ElseBadge({ labelX, labelY }: { labelX: number; labelY: number }): ReactNode {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
      }}
    >
      <span className="inline-block px-1 bg-white rounded text-[10px] border border-gray-300 text-gray-500">
        else
      </span>
    </div>
  );
}

type ConditionLabelProps = {
  condition: string | undefined;
  labelX: number;
  labelY: number;
  onSave: (value: string) => void;
};

function ConditionLabel({ condition, labelX, labelY, onSave }: ConditionLabelProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  function handleBadgeClick() {
    setInputValue(condition || "");
    setIsOpen(true);
  }

  function handleSave() {
    if (inputValue.trim()) {
      onSave(inputValue.trim());
    }
    setIsOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleSave();
    }
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("pointerdown", handleClickOutside, true);
    return () => document.removeEventListener("pointerdown", handleClickOutside, true);
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      className="absolute pointer-events-auto"
      style={{
        transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
        zIndex: isOpen ? 1000 : undefined,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div onClick={handleBadgeClick} onKeyDown={undefined} className="cursor-pointer">
        <span
          className={cn(
            "inline-block px-1 bg-white rounded text-[10px]",
            condition
              ? "border border-gray-300 text-black"
              : "border border-dashed text-red-500",
          )}
          style={condition ? undefined : { borderColor: LACK_COLOR }}
        >
          if
        </span>
      </div>
      {isOpen && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 bg-white rounded shadow-lg border border-gray-200 p-1">
          <div className="flex items-center gap-0.5">
            <input
              type="text"
              className="w-32 rounded border border-gray-300 px-1 py-0.5 text-[10px] focus:border-blue-500 focus:outline-none"
              placeholder="输入条件"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button
              type="button"
              onClick={handleSave}
              className="p-0.5 text-blue-600 hover:bg-blue-50 rounded"
            >
              <Check size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function isElseEdge(edgeId: string, source: string, allEdges: Edge[]): boolean {
  const siblings = allEdges.filter(e => e.source === source && e.type === 'conditional');
  return siblings.length >= 2 && siblings[0].id === edgeId;
}

export function ConditionalEdge({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps<ConditionalEdgeType>): ReactNode {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: RADIUS,
  });
  const flow = useReactFlow();
  const model = useModel();

  const allEdges = flow.getEdges();
  const isElse = useMemo(() => isElseEdge(id, source, allEdges), [id, source, allEdges]);

  const condition = data?.condition;
  function handleSave(value: string) {
    model.startTransaction();
    flow.updateEdgeData(id, { condition: value });
    requestAnimationFrame(model.endTransaction);
  }

  return (
    <>
      <GradientPath
        id={id}
        path={edgePath}
        sourceX={sourceX}
        sourceY={sourceY}
        targetX={targetX}
        targetY={targetY}
        hasCondition={isElse ? null : (condition ? true : false)}
        selected={!!selected}
      />
      <EdgeLabelRenderer>
        {isElse
          ? <ElseBadge labelX={labelX} labelY={labelY} />
          : <ConditionLabel condition={condition} labelX={labelX} labelY={labelY} onSave={handleSave} />
        }
      </EdgeLabelRenderer>
    </>
  );
}

export function GradientEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps<Edge>): ReactNode {
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: RADIUS,
  });

  return (
    <GradientPath
      id={id}
      path={edgePath}
      sourceX={sourceX}
      sourceY={sourceY}
      targetX={targetX}
      targetY={targetY}
      hasCondition={null}
      selected={!!selected}
    />
  );
}
