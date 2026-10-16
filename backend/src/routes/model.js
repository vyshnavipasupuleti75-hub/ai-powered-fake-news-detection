const router = require('express').Router();
const asyncHandler = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { health, modelMetrics } = require('../services/aiClient');

// Public: lets the UI show whether the AI/media service is running and which capabilities exist.
router.get('/health', asyncHandler(async (_req, res) => {
  const state = await health();
  res.status(state.reachable ? 200 : 503).json(state);
}));

// Saved evaluation from the last real training run (never synthetic).
router.get('/metrics', requireAuth, asyncHandler(async (_req, res) => {
  const data = await modelMetrics();
  if (!data) return res.status(404).json({ message: 'No evaluation report exists yet. Run ai-engine/scripts/evaluate_model.py.' });
  res.json(data);
}));

module.exports = router;
