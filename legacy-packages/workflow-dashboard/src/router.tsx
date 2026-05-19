import { createHashRouter, redirect } from "react-router";
import { Layout } from "./app.tsx";
import { ClientRedirect } from "./components/client-redirect.tsx";
import { LoginPage } from "./components/login.tsx";
import { ThreadDetail } from "./components/thread-detail.tsx";
import { ThreadList } from "./components/thread-list.tsx";
import { WorkflowDetail } from "./components/workflow-detail.tsx";
import { WorkflowList } from "./components/workflow-list.tsx";

export const router = createHashRouter([
  {
    path: "/login",
    Component: LoginPage,
  },
  {
    path: "/",
    Component: Layout,
    children: [
      {
        index: true,
        Component: ClientRedirect,
      },
      {
        path: ":client/threads",
        Component: ThreadList,
      },
      {
        path: ":client/threads/:threadId",
        Component: ThreadDetail,
      },
      {
        path: ":client/workflows",
        Component: WorkflowList,
      },
      {
        path: ":client/workflows/:workflowName",
        Component: WorkflowDetail,
      },
      {
        path: ":client",
        loader: ({ params }) => redirect(`/${params.client}/threads`),
      },
    ],
  },
]);
