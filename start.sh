# start.sh — worker in background, web in foreground; container dies if web dies
npx tsx src/worker/index.ts &
node server.js
