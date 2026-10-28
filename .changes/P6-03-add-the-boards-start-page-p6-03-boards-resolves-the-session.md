area: web
kind: minor

Add the boards start page (P6-03): /boards resolves the session, lists workspaces via the SDK and persists the selected workspace, lists boards with title/visibility/Intl-formatted updatedAt, creates/renames/deletes boards through the SDK with dialogs (trimmed 1..120 title validation, destructive confirmation, focus trap), first-run flow creating a workspace then its first board, skeleton/empty/error-with-retry/in-flight states, board navigation to /boards/:id with a missing/forbidden guard back to /boards, SDK-only data path, messages en/de parity and pure node --test helpers (title/workspace validation, updatedAt sort, Intl date formatting, workspace persistence).
