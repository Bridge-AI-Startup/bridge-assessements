/**
 * Variant: wont-boot.
 *
 * Requires a config module that was never committed, so the process exits
 * immediately on start and the app never becomes reachable. Every check that
 * needs a running app is unverifiable through no fault of the grader.
 */
const http = require("http");

// ./lib/config.js is missing from the submission — this throws at load time.
const config = require("./lib/config");

const PORT = Number(process.env.PORT || config.port);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ notes: [] }));
});

server.listen(PORT, () => {
  console.log(`Notes API listening on http://localhost:${PORT}`);
});
