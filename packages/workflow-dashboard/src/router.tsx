import { createBrowserRouter } from "react-router";
import { Layout } from "./app.tsx";
import { HomePage } from "./pages/home.tsx";
import { DetailPage } from "./pages/detail.tsx";

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
