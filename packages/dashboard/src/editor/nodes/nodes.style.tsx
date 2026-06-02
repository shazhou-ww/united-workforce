import type { ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

type Props = {
  className: string | null;
  children: ReactNode;
};

function BaseNode({ className, children }: Props): ReactNode {
  return (
    <div
      className={cn(
        "rounded-lg border-2 border-border bg-white px-4 py-3 text-center text-sm font-medium min-w-[120px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StartNode({ children }: { children: ReactNode }): ReactNode {
  return (
    <BaseNode className="bg-gradient-to-br from-green-50 to-green-200 border-green-500 text-green-500">
      {children}
    </BaseNode>
  );
}

export function EndNode({ children }: { children: ReactNode }): ReactNode {
  return (
    <BaseNode className="bg-gradient-to-br from-indigo-50 to-blue-100 border-blue-600 text-blue-600">
      {children}
    </BaseNode>
  );
}

export function NodeContent({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 min-w-[160px] max-w-[240px]">
      {children}
    </div>
  );
}

export function NodeIcon({ className, children }: Props): ReactNode {
  return (
    <div className={cn("flex items-center justify-center w-8 h-8 rounded-lg shrink-0", className)}>
      {children}
    </div>
  );
}

export function NodeBody({ children }: { children: ReactNode }): ReactNode {
  return <div className="flex-1 min-w-0">{children}</div>;
}

export function NodeKindLabel({ className, children }: Props): ReactNode {
  return (
    <div className={cn("text-[10px] font-semibold uppercase tracking-wide mb-1", className)}>
      {children}
    </div>
  );
}

export function NodeHint({ children }: { children: ReactNode }): ReactNode {
  return <div className="text-[13px] text-gray-800 leading-snug break-words">{children}</div>;
}

export function NodeSubHint({ children }: { children: ReactNode }): ReactNode {
  return <div className="text-[11px] text-gray-400 mt-0.5">{children}</div>;
}

export function RoleIcon({ children }: { children: ReactNode }): ReactNode {
  return (
    <NodeIcon className="bg-gradient-to-br from-teal-50 to-teal-200 text-teal-700">
      {children}
    </NodeIcon>
  );
}

export function RoleKindLabel({ children }: { children: ReactNode }): ReactNode {
  return <NodeKindLabel className="text-teal-700">{children}</NodeKindLabel>;
}
