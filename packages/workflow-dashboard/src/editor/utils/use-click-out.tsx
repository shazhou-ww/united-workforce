import { useEffect, useRef } from "react";

function judge(container: HTMLElement, target: HTMLElement): boolean {
  if (container === target) {
    return true;
  }
  if (target === document.body) {
    return false;
  }
  const parent = target.parentElement;
  return parent ? judge(container, parent) : false;
}

export function useClickOutRef<T extends HTMLElement>(callback: () => void, delay = 0) {
  const ref = useRef<T>(null);
  const flag = useRef<boolean>(delay === 0);

  useEffect(() => {
    if (!delay) return;
    const timer = setTimeout(() => {
      flag.current = true;
    }, delay);
    return () => clearTimeout(timer);
  }, [delay]);

  useEffect(() => {
    function handle(ev: MouseEvent) {
      if (!flag.current) return;
      const container = ref.current;
      const target = ev.target as HTMLElement;
      if (container && target) {
        if (judge(container, target)) return;
        callback();
      }
    }
    document.addEventListener("click", handle);
    return () => document.removeEventListener("click", handle);
  }, [callback]);

  return ref;
}
