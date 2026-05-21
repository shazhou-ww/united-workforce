import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router.tsx";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<RouterProvider router={router} />);
}
