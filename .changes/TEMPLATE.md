# Change entry template

Copy this shape into `.changes/<task-id>-<short-name>.md`, or let `pnpm run change` write it:

```markdown
area: tooling
kind: patch

One English line describing the change.
```

Replace the area, the kind and the summary; keep the summary to one line. Areas, kinds and the
gate are documented in [README.md](README.md).
