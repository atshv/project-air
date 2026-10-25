area: platform
kind: minor

Kratos identity ids (UUIDv4) map to contract-valid UUIDv7 account ids through a unique `app.profiles.kratos_identity_id` key and a SECURITY DEFINER resolver; session resolution creates the profile and mapping once, `GET /v1/session` exposes the resolved account id and every API response stays UUIDv7-only.
