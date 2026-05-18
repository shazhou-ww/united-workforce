import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/utils.ts";

type Props = {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  className: string | null;
  style: CSSProperties | null;
  children: React.ReactNode;
};

export function ResizablePanel({
  defaultWidth,
  minWidth,
  maxWidth,
  className,
  style,
  children,
}: Props) {
  const [width, setWidth] = useState(defaultWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = width;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const next = Math.min(maxWidth, Math.max(minWidth, startW.current + delta));
      setWidth(next);
    },
    [minWidth, maxWidth],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ ...style, width }}
    >
      {children}
      <div
        className="absolute top-0 -right-1 w-2 h-full cursor-col-resize z-10 group"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="absolute inset-y-0 left-1/2 w-px bg-border opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
      </div>
    </div>
  );
}
