#!/bin/sh
# start.sh — the web server and the background worker in one machine.
#
# The web server is the container: if it exits, the script exits and Fly
# restarts the machine. The worker is looked after here: if it dies (a crash,
# an out-of-memory kill, the watchdog giving up on a stuck tick) it is
# started again after a short pause, so syncing never silently stops.
# SIGTERM from a deploy is passed to both, so they can finish writes and the
# volume unmounts cleanly.

TSX=./node_modules/.bin/tsx
[ -x "$TSX" ] || TSX="npx tsx"

stopping=0
worker_pid=""
litestream_pid=""

# Backups (see litestream.yml). `fly storage create` sets BUCKET_NAME and the
# AWS_* keys; the replica URL is built from them unless one is given.
if [ -z "$LITESTREAM_REPLICA_URL" ] && [ -n "$BUCKET_NAME" ]; then
  export LITESTREAM_REPLICA_URL="s3://$BUCKET_NAME/openpapr.db?endpoint=fly.storage.tigris.dev&region=auto"
fi
# Litestream sets Tigris up itself from the endpoint in the URL; the generic
# AWS endpoint variable would override that.
unset AWS_ENDPOINT_URL_S3
backups=0
if [ -n "$LITESTREAM_REPLICA_URL" ] && command -v litestream >/dev/null 2>&1; then
  backups=1
  # A new or wiped volume: bring the database back from the backup first.
  if [ ! -f "$DATABASE_PATH" ]; then
    echo "no database at $DATABASE_PATH — restoring from backup if there is one"
    mkdir -p "$(dirname "$DATABASE_PATH")"
    litestream restore -config ./litestream.yml -if-db-not-exists -if-replica-exists "$DATABASE_PATH" || {
      echo "restore failed — refusing to start with an empty database"
      exit 1
    }
  fi
else
  echo "backups are off (no LITESTREAM_REPLICA_URL or BUCKET_NAME)"
fi

start_litestream() {
  litestream replicate -config ./litestream.yml &
  litestream_pid=$!
}

start_worker() {
  $TSX src/worker/index.ts &
  worker_pid=$!
}

shutdown() {
  stopping=1
  kill -TERM "$web_pid" $worker_pid 2>/dev/null
  wait "$web_pid" 2>/dev/null
  [ -n "$worker_pid" ] && wait "$worker_pid" 2>/dev/null
  # Litestream stops last, so it uploads the final writes before the volume goes.
  if [ -n "$litestream_pid" ]; then
    kill -TERM "$litestream_pid" 2>/dev/null
    wait "$litestream_pid" 2>/dev/null
  fi
  exit 0
}
trap shutdown TERM INT

[ "$backups" -eq 1 ] && start_litestream
node server.js &
web_pid=$!
start_worker

while [ "$stopping" -eq 0 ]; do
  sleep 5 &
  wait $!
  if ! kill -0 "$web_pid" 2>/dev/null; then
    echo "web server exited — stopping"
    kill -TERM $worker_pid 2>/dev/null
    exit 1
  fi
  if ! kill -0 "$worker_pid" 2>/dev/null; then
    echo "worker exited — restarting it"
    start_worker
  fi
  if [ "$backups" -eq 1 ] && ! kill -0 "$litestream_pid" 2>/dev/null; then
    echo "litestream exited — restarting it"
    start_litestream
  fi
done
