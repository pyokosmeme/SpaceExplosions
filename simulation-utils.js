function clampTimeScale(timeScale) {
  if (Number.isNaN(timeScale)) {
    return 0;
  }
  return Math.max(0, timeScale);
}

function computeSimulationDelta(rawDelta, timeScale, isPlaying) {
  if (!isPlaying) {
    return 0;
  }

  const safeDelta = Math.max(0, rawDelta);
  const safeScale = clampTimeScale(timeScale);
  return safeDelta * safeScale;
}

function resolveTimeStep(isPlaying, simulationDelta, rawDelta) {
  if (isPlaying) {
    return simulationDelta;
  }

  return Math.max(0, rawDelta);
}

module.exports = {
  computeSimulationDelta,
  resolveTimeStep,
};
