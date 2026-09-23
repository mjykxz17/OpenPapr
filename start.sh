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

start_worker() {
  $TSX src/worker/index.ts &
  worker_pid=$!
}

shutdown() {
  stopping=1
  kill -TERM "$web_pid" $worker_pid 2>/dev/null
  wait "$web_pid" 2>/dev/null
  [ -n "$worker_pid" ] && wait "$worker_pid" 2>/dev/null
  exit 0
}
trap shutdown TERM INT

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
done
