import type { ReactNode } from "react";
import { Outlet } from "react-router";

export function Layout(): ReactNode {
  return (
    <div className="h-screen w-screen bg-background text-foreground">
      <Outlet />
    </div>
  );
}
