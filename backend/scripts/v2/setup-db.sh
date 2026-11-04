#!/bin/sh
# Fresh, migrated, seeded database for one v2 test area.
#   sh scripts/v2/setup-db.sh truehr_auth
# Needs a Postgres on PGPORT (default 55432) reachable as user postgres.
set -e
DB=${1:?database name}
PORT=${PGPORT:-55432}
psql -h localhost -p "$PORT" -U postgres -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
psql -h localhost -p "$PORT" -U postgres -qc "CREATE DATABASE $DB" >/dev/null
export DATABASE_URL=postgres://postgres@localhost:$PORT/$DB
export JWT_SECRET=${JWT_SECRET:-testsecret}
export PII_ENCRYPTION_KEY=${PII_ENCRYPTION_KEY:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}
cd "$(dirname "$0")/../.."
node src/db/migrate.js >/dev/null
node src/db/seed.js >/dev/null
echo "ready: $DATABASE_URL"
