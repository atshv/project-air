/**
 * Registers the contract API routes (P3-04).
 */

import type { Router } from "../http/router.ts";
import { registerBoardRoutes } from "./boards.ts";
import { registerCardRoutes } from "./cards.ts";
import type { ApiDependencies } from "./context.ts";
import { registerNoteRoutes } from "./notes.ts";
import { registerWorkspaceRoutes } from "./workspaces.ts";

export function registerApiRoutes(router: Router, dependencies: ApiDependencies): void {
  registerWorkspaceRoutes(router, dependencies);
  registerBoardRoutes(router, dependencies);
  registerNoteRoutes(router, dependencies);
  registerCardRoutes(router, dependencies);
}
