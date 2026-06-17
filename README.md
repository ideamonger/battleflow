# Battleflow MVP

Battleflow is a static browser wargame simulation engine seeded with Operation IRON TIDE.
It runs without a database or backend storage.

## Run

```bash
python3 -m http.server 8792 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8792/
```

## Files

- `index.html` - app shell.
- `styles.css` - interface styling.
- `app.js` - UI controller, map rendering, file import/export, order parser controls.
- `battleflow-engine.js` - deterministic simulation engine.
- `scenario-iron-tide.json` - human-readable Battleflow ontology and seeded scenario.

## Ontology Shape

The MVP uses `battleflow.v0.1` JSON:

```json
{
  "ontology": "battleflow.v0.1",
  "metadata": {},
  "simulation": {
    "startTime": "2026-06-17T06:00:00Z",
    "horizonHours": 72,
    "timeStepMinutes": 10,
    "commandLevelMinimum": "company"
  },
  "terrain": {
    "map": { "widthKm": 32, "heightKm": 18, "cellKm": 1 },
    "terrainZones": [],
    "feasibleStartingAreas": {},
    "objectives": []
  },
  "forces": [],
  "units": [],
  "coaLibrary": [],
  "redResponses": []
}
```

Units are hierarchical by `parent`, support land/water/air domains, and include location,
frontage/depth, subunit count, weapons, supplies, morale, readiness, and orders.

## Implemented Mechanics

- Terrain grid synthesized from human-readable terrain zones.
- Land, water, and air environmental factors.
- Feasible Blue/Red starting areas with non-overlap validation.
- Unit movement by order timing, destination, speed, direction, and fallback.
- Terrain-modified movement and combat effects.
- Ranged/close engagement adjudication using transparent relative scores.
- Attrition, readiness, morale, ammo, fuel, and sustainment changes.
- Objective control and event logging.
- Real-time, accelerated, fast, and batch execution modes.
- COA utility matrix with expected value, floor, minimax regret, and risk adjustment.
- Local natural-language order parser and optional OpenAI Responses API parser.
