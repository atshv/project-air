# infra/kratos

Ory Kratos configuration for Project air (ADR-0007): the identity service owns
accounts, credentials, sessions, magic links and verification e-mails; the
platform and PostgreSQL row-level security own workspace permissions.

- **Kind:** `infra`
- **Configuration:** [kratos.yml](kratos.yml) — flows, courier, session cookie
  and the identity schema reference. Secrets, the DSN and the URLs come from the
  environment, never from this file.
- **Identity schema:** [identity.schema.json](identity.schema.json) — e-mail
  (unique credential identifier, verified through the code flow), display name
  (1–80 characters) and an optional `de`/`en` locale.
- **Compose:** the `identity` profile in
  [../compose/compose.yaml](../compose/compose.yaml) starts `kratos-migrate` (one
  shot) and then `kratos`. See [../compose/README.md](../compose/README.md).

```bash
bash tools/dev/setup                       # writes the local secrets to infra/compose/.env
docker compose -f infra/compose/compose.yaml --profile identity up -d --wait
curl --fail http://127.0.0.1:8433/health/ready
```

The public API is bound to `127.0.0.1:8433` and the admin API to
`127.0.0.1:8434` on the host (container ports 4433/4434); both stay local. The
service keeps no password or credential data outside Kratos.
