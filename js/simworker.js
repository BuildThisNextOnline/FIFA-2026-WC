/**
 * simworker.js — Web Worker entry point for Monte Carlo simulation.
 *
 * Message protocol:
 *
 *   Main → Worker:
 *     { type: "run", allMatches, eloSeedData, params, N, seed }
 *
 *   Worker → Main:
 *     { type: "result", data: SimResult }   on success
 *     { type: "error",  message: string }   on failure
 *
 * Usage:
 *   const worker = new Worker("./js/simworker.js", { type: "module" });
 *   worker.postMessage({ type: "run", allMatches, eloSeedData, params, N: 20000, seed: 42 });
 *   worker.onmessage = ({ data }) => { ... };
 */

import { runSimulation } from "./sim.js";

self.onmessage = function ({ data }) {
  if (data.type !== "run") return;
  const { allMatches, eloSeedData, params, N, seed } = data;
  try {
    const result = runSimulation(allMatches, eloSeedData, params, N, seed);
    self.postMessage({ type: "result", data: result });
  } catch (err) {
    self.postMessage({ type: "error", message: err.message });
  }
};
