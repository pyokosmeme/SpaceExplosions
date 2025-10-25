const assert = require('assert');
const { clampTimeScale, computeSimulationDelta, resolveTimeStep } = require('../simulation-utils.js');

// clampTimeScale should clamp to non-negative numbers and coerce NaN to 0
(() => {
  assert.strictEqual(clampTimeScale(1.5), 1.5);
  assert.strictEqual(clampTimeScale(-2), 0);
  assert.strictEqual(clampTimeScale(Number.NaN), 0);
})();

// Helper to compare floating point values with tolerance
function approxEqual(actual, expected, tolerance = 1e-9) {
  assert(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

// Test computeSimulationDelta when playing and positive scale
(() => {
  const rawDelta = 0.016;
  const scale = 0.5;
  const result = computeSimulationDelta(rawDelta, scale, true);
  approxEqual(result, rawDelta * scale);
})();

// Test computeSimulationDelta clamps negative scale and pause behaviour
(() => {
  const rawDelta = 0.02;
  const negativeScale = -1;
  const pausedResult = computeSimulationDelta(rawDelta, negativeScale, false);
  approxEqual(pausedResult, 0);

  const playingResult = computeSimulationDelta(rawDelta, negativeScale, true);
  approxEqual(playingResult, 0);
})();

// resolveTimeStep should fall back to raw delta when paused
(() => {
  const rawDelta = 0.01;
  const simDelta = 0.005;
  approxEqual(resolveTimeStep(false, simDelta, rawDelta), rawDelta);
})();

// resolveTimeStep should return simulation delta when playing
(() => {
  const rawDelta = 0.01;
  const simDelta = 0.008;
  approxEqual(resolveTimeStep(true, simDelta, rawDelta), simDelta);
})();

console.log('All simulation util tests passed.');
