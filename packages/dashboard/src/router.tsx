import { createBrowserRouter } from "react-router";
import { Layout } from "./app.tsx";
import { DetailPage } from "./pages/detail.tsx";
import { HomePage } from "./pages/home.tsx";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      {
        index: true,
        Component: HomePage,
      },
      {
        path: "workflow/:name",
        Component: DetailPage,
      },
      {
        path: "workflow/:name/edit",
        Component: DetailPage,
      },
    ],
  },
]);
