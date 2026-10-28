// P6-01: route table and pure helpers (titles/empty-state message keys), testable
// without a DOM. Later tasks replace the empty states; the routes stay.
export interface RouteDefinition {
  readonly path: string;
  readonly titleKey: string;
  readonly bodyKey: string;
}

export const ROUTES: readonly RouteDefinition[] = [
  { path: "/", titleKey: "routes.start.title", bodyKey: "routes.start.body" },
  { path: "/login", titleKey: "routes.login.title", bodyKey: "routes.login.body" },
  { path: "/boards", titleKey: "routes.boards.title", bodyKey: "routes.boards.body" },
  { path: "/boards/:id", titleKey: "routes.board.title", bodyKey: "routes.board.body" },
  { path: "/settings", titleKey: "routes.settings.title", bodyKey: "routes.settings.body" },
];

export function routeByPath(path: string): RouteDefinition | undefined {
  return ROUTES.find((route) => route.path === path);
}

export function isShellRoute(path: string): boolean {
  return path === "/" || path === "/settings";
}

export function boardPath(id: string): string {
  return `/boards/${encodeURIComponent(id)}`;
}
