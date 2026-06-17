const ECHELON_RANK = {
  fireteam: 1,
  team: 1,
  squad: 2,
  section: 2,
  platoon: 3,
  company: 4,
  battery: 4,
  flight: 4,
  battalion: 5,
  squadron: 5,
  regiment: 6,
  brigade: 6,
  force: 7
};

const RESPONSE_KEYS = ["likely", "dangerous", "deceptive", "adaptive"];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.xKm - b.xKm, a.yKm - b.yKm);
}

function bearingDegrees(from, to) {
  const radians = Math.atan2(to.xKm - from.xKm, to.yKm - from.yKm);
  return (radians * 180 / Math.PI + 360) % 360;
}

function isInside(point, bounds) {
  return (
    point.xKm >= bounds.xMin &&
    point.xKm <= bounds.xMax &&
    point.yKm >= bounds.yMin &&
    point.yKm <= bounds.yMax
  );
}

function boundsOverlap(a, b) {
  return a.xMin < b.xMax && a.xMax > b.xMin && a.yMin < b.yMax && a.yMax > b.yMin;
}

function moraleFactor(value) {
  return clamp(value / 100, 0.35, 1.08);
}

function readinessFactor(value) {
  return clamp(value / 100, 0.25, 1.05);
}

function formatClock(startIso, elapsedMinutes) {
  const date = new Date(new Date(startIso).getTime() + elapsedMinutes * 60_000);
  return date.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

function sideOf(otherSide) {
  return otherSide === "Blue" ? "Red" : "Blue";
}

function objectiveWeightSum(objectives) {
  return objectives.reduce((sum, objective) => sum + Number(objective.strategicValue || 0), 0) || 1;
}

export class BattleflowEngine extends EventTarget {
  constructor(scenario) {
    super();
    this.loadScenario(scenario);
  }

  loadScenario(scenario) {
    this.sourceScenario = clone(scenario);
    this.scenario = clone(scenario);
    this.elapsedMinutes = 0;
    this.terrainGrid = this.buildTerrainGrid();
    this.initialByUnit = new Map();
    this.eventLog = [];
    this.turn = 0;
    this.scenario.units = this.scenario.units.map((unit) => this.hydrateUnit(unit));
    this.scenario.terrain.objectives = this.scenario.terrain.objectives.map((objective) => ({
      ...objective,
      initialControl: objective.control
    }));
    this.recordEvent("System", "Battleflow scenario loaded", "Blue and Red orders of battle are ready.");
    this.emitChange();
  }

  reset() {
    this.loadScenario(this.sourceScenario);
  }

  hydrateUnit(unit) {
    const hydrated = clone(unit);
    const capabilities = hydrated.capabilities || {};
    const supplies = capabilities.supplies || {};
    const personnel = Number(capabilities.personnel || 0);
    hydrated.state = {
      strength: personnel,
      initialStrength: personnel,
      readiness: Number(capabilities.readiness ?? 100),
      morale: Number(capabilities.morale ?? 85),
      supplies: {
        ammo: Number(supplies.ammo ?? 100),
        fuel: Number(supplies.fuel ?? 100),
        sustainment: Number(supplies.sustainment ?? 100)
      },
      initialLocation: {
        xKm: Number(hydrated.location.xKm || 0),
        yKm: Number(hydrated.location.yKm || 0)
      },
      currentTask: hydrated.orders?.[0]?.task || "Hold",
      posture: "active",
      selected: false,
      lastEngagementMinute: -9999,
      lastStatus: "Ready"
    };
    hydrated.location.time = this.scenario.simulation.startTime;
    hydrated.orders = (hydrated.orders || []).map((order, index) => ({
      ...order,
      id: order.id || `${hydrated.id}-ORD-${index + 1}`,
      completed: false,
      arrivedLogged: false,
      failureLogged: false
    }));
    this.initialByUnit.set(hydrated.id, {
      strength: hydrated.state.strength,
      readiness: hydrated.state.readiness,
      morale: hydrated.state.morale
    });
    return hydrated;
  }

  buildTerrainGrid() {
    const terrain = this.scenario.terrain;
    const { widthKm, heightKm, cellKm } = terrain.map;
    const width = Math.ceil(widthKm / cellKm);
    const height = Math.ceil(heightKm / cellKm);
    const origin = this.scenario.metadata.coordinateSystem.origin;
    const latKm = 1 / 110.574;
    const lonKm = 1 / (111.320 * Math.cos(origin.latitude * Math.PI / 180));
    const grid = [];

    for (let y = 0; y < height; y += 1) {
      const row = [];
      for (let x = 0; x < width; x += 1) {
        const center = { xKm: x + cellKm / 2, yKm: y + cellKm / 2 };
        let cell = {
          x,
          y,
          center,
          domain: "land",
          zoneId: "baseline-land",
          name: "Island Interior",
          latitude: origin.latitude + center.yKm * latKm,
          longitude: origin.longitude + center.xKm * lonKm,
          altitudeM: 35,
          soil: "mixed loam",
          accessibility: 0.74,
          use: "mixed rural terrain",
          cover: 0.18,
          movement: 0.74,
          attackModifier: 0,
          water: null,
          air: terrain.globalAir
        };

        for (const zone of terrain.terrainZones) {
          if (isInside(center, zone.bounds)) {
            const land = zone.land || {};
            const water = zone.water || null;
            cell = {
              ...cell,
              domain: zone.domain,
              zoneId: zone.id,
              name: zone.name,
              altitudeM: land.altitudeM ?? cell.altitudeM,
              soil: land.soil ?? cell.soil,
              accessibility: land.accessibility ?? cell.accessibility,
              use: land.use ?? cell.use,
              cover: land.cover ?? cell.cover,
              movement: zone.movement ?? cell.movement,
              attackModifier: zone.attackModifier ?? cell.attackModifier,
              water: water ? { ...terrain.globalWater, ...water } : null
            };
          }
        }
        row.push(cell);
      }
      grid.push(row);
    }
    return grid;
  }

  get clock() {
    return formatClock(this.scenario.simulation.startTime, this.elapsedMinutes);
  }

  getUnit(id) {
    return this.scenario.units.find((unit) => unit.id === id);
  }

  getObjective(id) {
    return this.scenario.terrain.objectives.find((objective) => objective.id === id);
  }

  getCellAt(xKm, yKm) {
    const { cellKm } = this.scenario.terrain.map;
    const x = clamp(Math.floor(xKm / cellKm), 0, this.terrainGrid[0].length - 1);
    const y = clamp(Math.floor(yKm / cellKm), 0, this.terrainGrid.length - 1);
    return this.terrainGrid[y][x];
  }

  getUnitCell(unit) {
    return this.getCellAt(unit.location.xKm, unit.location.yKm);
  }

  getHierarchy() {
    const byParent = new Map();
    for (const unit of this.scenario.units) {
      const key = unit.parent || "__root__";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(unit);
    }
    for (const units of byParent.values()) {
      units.sort((a, b) => (ECHELON_RANK[b.echelon] || 0) - (ECHELON_RANK[a.echelon] || 0) || a.name.localeCompare(b.name));
    }
    return byParent;
  }

  getCommandableUnits() {
    const minRank = ECHELON_RANK[this.scenario.simulation.commandLevelMinimum] || ECHELON_RANK.company;
    return this.scenario.units.filter((unit) => (ECHELON_RANK[unit.echelon] || 0) >= minRank);
  }

  validateStartingAreas() {
    const areas = this.scenario.terrain.feasibleStartingAreas;
    const messages = [];
    if (boundsOverlap(areas.Blue.bounds, areas.Red.bounds)) {
      messages.push({ severity: "error", message: "Blue and Red feasible starting areas overlap." });
    }
    for (const unit of this.scenario.units) {
      if (unit.domain === "air") continue;
      const area = areas[unit.side];
      const initialLocation = unit.state?.initialLocation || unit.location;
      if (area && !isInside(initialLocation, area.bounds)) {
        messages.push({
          severity: "warning",
          message: `${unit.name} starts outside ${unit.side} feasible area.`
        });
      }
    }
    if (!messages.length) {
      messages.push({ severity: "ok", message: "Feasible starting areas are separated and occupied legally." });
    }
    return messages;
  }

  updateUnitLocation(unitId, xKm, yKm, options = {}) {
    const unit = this.getUnit(unitId);
    if (!unit) return false;
    const map = this.scenario.terrain.map;
    const next = {
      xKm: clamp(xKm, 0, map.widthKm),
      yKm: clamp(yKm, 0, map.heightKm)
    };
    if (options.enforceStartingArea) {
      const area = this.scenario.terrain.feasibleStartingAreas[unit.side];
      if (unit.domain !== "air" && area && !isInside(next, area.bounds)) {
        this.recordEvent("Order", `${unit.name} not moved`, "Target location is outside the feasible starting area.");
        this.emitChange();
        return false;
      }
    }
    unit.location.xKm = next.xKm;
    unit.location.yKm = next.yKm;
    unit.location.time = this.clock;
    if (this.elapsedMinutes === 0 && unit.state?.initialLocation) {
      unit.state.initialLocation.xKm = next.xKm;
      unit.state.initialLocation.yKm = next.yKm;
    }
    this.emitChange();
    return true;
  }

  issueOrder(unitId, order) {
    const unit = this.getUnit(unitId);
    if (!unit) throw new Error(`Unknown unit: ${unitId}`);
    const minRank = ECHELON_RANK[this.scenario.simulation.commandLevelMinimum] || ECHELON_RANK.company;
    if ((ECHELON_RANK[unit.echelon] || 0) < minRank) {
      throw new Error(`${unit.name} is below the command level minimum.`);
    }
    const normalized = {
      id: `ORD-${unit.id}-${Date.now().toString(36)}`,
      startMinute: Number(order.startMinute ?? this.elapsedMinutes),
      arriveByMinute: Number(order.arriveByMinute ?? this.elapsedMinutes + 240),
      task: String(order.task || "Move"),
      destination: {
        xKm: Number(order.destination?.xKm ?? unit.location.xKm),
        yKm: Number(order.destination?.yKm ?? unit.location.yKm)
      },
      speedKph: Number(order.speedKph ?? 8),
      directionDeg: Number(order.directionDeg ?? bearingDegrees(unit.location, order.destination || unit.location)),
      onFailure: String(order.onFailure || "Hold current position"),
      completed: false,
      arrivedLogged: false,
      failureLogged: false
    };
    unit.orders.push(normalized);
    unit.state.currentTask = normalized.task;
    this.recordEvent("Order", `${unit.name}: ${normalized.task}`, `Destination ${normalized.destination.xKm.toFixed(1)}, ${normalized.destination.yKm.toFixed(1)} by T+${normalized.arriveByMinute}m.`);
    this.emitChange();
    return normalized;
  }

  getActiveOrder(unit) {
    const active = unit.orders.find((order) => !order.completed && this.elapsedMinutes >= Number(order.startMinute || 0));
    return active || null;
  }

  step(minutes = this.scenario.simulation.timeStepMinutes) {
    this.turn += 1;
    this.elapsedMinutes += minutes;
    for (const unit of this.scenario.units) {
      if (unit.state.strength <= 0 || unit.state.readiness <= 0) continue;
      this.moveUnit(unit, minutes);
      this.degradeSupplies(unit, minutes);
    }
    this.resolveEngagements(minutes);
    this.updateObjectiveControl();
    this.updatePostures();
    this.emitChange();
  }

  runBatch(hours = this.scenario.simulation.horizonHours) {
    const end = Math.min(hours * 60, this.scenario.simulation.horizonHours * 60);
    let guard = 0;
    while (this.elapsedMinutes < end && guard < 20_000) {
      this.step(this.scenario.simulation.timeStepMinutes);
      guard += 1;
    }
    this.recordEvent("System", "Batch run complete", `Simulation advanced to ${this.clock}.`);
    this.emitChange();
  }

  moveUnit(unit, minutes) {
    const order = this.getActiveOrder(unit);
    if (!order) return;
    unit.state.currentTask = order.task;
    const destination = order.destination || unit.location;
    const remaining = distance(unit.location, destination);
    if (remaining <= 0.12) {
      order.completed = true;
      if (!order.arrivedLogged) {
        order.arrivedLogged = true;
        this.recordEvent("Movement", `${unit.name} arrived`, `${order.task} at ${destination.xKm.toFixed(1)}, ${destination.yKm.toFixed(1)}.`);
      }
      return;
    }
    if (this.elapsedMinutes > Number(order.arriveByMinute) && !order.failureLogged) {
      order.failureLogged = true;
      unit.state.currentTask = order.onFailure;
      this.recordEvent("Branch", `${unit.name} missed timing`, order.onFailure);
    }
    const cell = this.getUnitCell(unit);
    const speed = Number(order.speedKph || 0);
    if (speed <= 0) return;
    const moveFactor = this.movementFactor(unit, cell);
    const travelKm = speed * (minutes / 60) * moveFactor;
    const fraction = clamp(travelKm / remaining, 0, 1);
    unit.location.xKm += (destination.xKm - unit.location.xKm) * fraction;
    unit.location.yKm += (destination.yKm - unit.location.yKm) * fraction;
    unit.location.time = this.clock;
    if (fraction >= 0.999) {
      order.completed = true;
      order.arrivedLogged = true;
      this.recordEvent("Movement", `${unit.name} arrived`, `${order.task} at ${destination.xKm.toFixed(1)}, ${destination.yKm.toFixed(1)}.`);
    }
  }

  movementFactor(unit, cell) {
    const base = cell.movement ?? 0.7;
    const mobility = clamp((unit.capabilities.mobility || 6) / 8, 0.35, 1.25);
    const readiness = readinessFactor(unit.state.readiness);
    const morale = moraleFactor(unit.state.morale);
    const fuel = clamp(unit.state.supplies.fuel / 100, 0.25, 1);
    if (unit.domain === "air") {
      const windPenalty = clamp((this.scenario.terrain.globalAir.windKph || 0) / 120, 0, 0.25);
      return clamp(0.92 - windPenalty, 0.65, 1.05) * readiness;
    }
    if (unit.domain === "sea" || unit.domain === "water") {
      const water = cell.water || this.scenario.terrain.globalWater;
      const seaPenalty = clamp((water.waveHeightM || 0) / 5, 0, 0.35);
      return clamp((water.buoyancy || 0.9) - seaPenalty, 0.35, 1) * readiness * fuel;
    }
    return clamp(base * mobility * readiness * morale * fuel, 0.08, 1.15);
  }

  degradeSupplies(unit, minutes) {
    const order = this.getActiveOrder(unit);
    const moving = order && distance(unit.location, order.destination || unit.location) > 0.15;
    const fuelUse = moving ? 0.035 * minutes * clamp((unit.capabilities.mobility || 6) / 8, 0.6, 1.4) : 0.006 * minutes;
    const sustainmentUse = 0.0035 * minutes;
    unit.state.supplies.fuel = clamp(unit.state.supplies.fuel - fuelUse, 0, 100);
    unit.state.supplies.sustainment = clamp(unit.state.supplies.sustainment - sustainmentUse, 0, 100);
    if (unit.state.supplies.sustainment < 35 && unit.state.lastStatus !== "Low sustainment") {
      unit.state.lastStatus = "Low sustainment";
      this.recordEvent("Logistics", `${unit.name} sustainment low`, "Readiness will begin to degrade if not relieved.");
    }
    if (unit.state.supplies.sustainment < 20) {
      unit.state.readiness = clamp(unit.state.readiness - 0.02 * minutes, 0, 100);
    }
  }

  resolveEngagements(minutes) {
    const attacks = [];
    for (const attacker of this.scenario.units) {
      if (attacker.state.strength <= 0 || attacker.state.readiness < 20) continue;
      const weapons = attacker.capabilities.weapons || [];
      if (!weapons.length) continue;
      const enemy = this.findBestTarget(attacker);
      if (!enemy) continue;
      const attack = this.calculateAttack(attacker, enemy, minutes);
      if (attack.casualties > 0.04 || attack.readinessLoss > 0.03) {
        attacks.push({ attacker, target: enemy, attack });
      }
    }

    for (const item of attacks) {
      const target = item.target;
      const before = target.state.strength;
      target.state.strength = clamp(target.state.strength - item.attack.casualties, 0, target.state.initialStrength);
      target.state.readiness = clamp(target.state.readiness - item.attack.readinessLoss, 0, 100);
      target.state.morale = clamp(target.state.morale - item.attack.moraleLoss, 0, 100);
      item.attacker.state.supplies.ammo = clamp(item.attacker.state.supplies.ammo - item.attack.ammoSpent, 0, 100);
      for (const weapon of item.attacker.capabilities.weapons || []) {
        weapon.ammo = clamp((weapon.ammo ?? item.attacker.state.supplies.ammo) - item.attack.ammoSpent * 0.35, 0, 100);
      }
      if (before > 0 && target.state.strength <= 0.5) {
        target.state.posture = "combat ineffective";
        this.recordEvent("Engagement", `${target.name} combat ineffective`, `${item.attacker.name} delivered decisive effects.`);
      } else if (item.attack.casualties >= 1.2 && this.elapsedMinutes - item.attacker.state.lastEngagementMinute >= 30) {
        item.attacker.state.lastEngagementMinute = this.elapsedMinutes;
        this.recordEvent(
          "Engagement",
          `${item.attacker.name} engaged ${target.name}`,
          `${item.attack.casualties.toFixed(1)} losses, ${item.attack.readinessLoss.toFixed(1)} readiness loss.`
        );
      }
    }
  }

  findBestTarget(attacker) {
    let best = null;
    let bestScore = -Infinity;
    for (const target of this.scenario.units) {
      if (target.side === attacker.side || target.state.strength <= 0) continue;
      const range = this.maxWeaponRange(attacker);
      const d = distance(attacker.location, target.location);
      if (d > range) continue;
      const objectiveProximity = this.scenario.terrain.objectives.some((objective) => distance(target.location, objective) < 1.4) ? 8 : 0;
      const score =
        (target.capabilities.firepower || 0) * 0.7 +
        (target.capabilities.combatPower || 0) * 0.5 +
        objectiveProximity -
        d * 0.8;
      if (score > bestScore) {
        best = target;
        bestScore = score;
      }
    }
    return best;
  }

  maxWeaponRange(unit) {
    return Math.max(0, ...(unit.capabilities.weapons || []).map((weapon) => Number(weapon.rangeKm || 0)));
  }

  calculateAttack(attacker, target, minutes) {
    const d = Math.max(0.1, distance(attacker.location, target.location));
    const attackerCell = this.getUnitCell(attacker);
    const targetCell = this.getUnitCell(target);
    let weaponEffect = 0;
    let ammoDemand = 0;
    for (const weapon of attacker.capabilities.weapons || []) {
      const range = Number(weapon.rangeKm || 0);
      if (d > range) continue;
      const rangeFactor = clamp(1 - (d / range) * 0.72, 0.10, 1);
      const ammoFactor = clamp((weapon.ammo ?? attacker.state.supplies.ammo) / 100, 0.10, 1);
      weaponEffect += Number(weapon.destructivePower || 0) * Number(weapon.rateOfFire || 1) * rangeFactor * ammoFactor;
      ammoDemand += Number(weapon.rateOfFire || 1) * (minutes / 60);
    }
    if (weaponEffect <= 0) {
      return { casualties: 0, readinessLoss: 0, moraleLoss: 0, ammoSpent: 0 };
    }
    const attackTerrain = 1 + (attackerCell.attackModifier || 0);
    const targetCover = clamp(targetCell.cover || 0, 0, 0.65);
    const targetExposedOnBeach = targetCell.zoneId === "eastern-littoral" ? 1.15 : 1;
    const airDefensePenalty = attacker.domain === "air" && target.capabilities.role === "Air defense" ? 0.55 : 1;
    const readiness = readinessFactor(attacker.state.readiness);
    const morale = moraleFactor(attacker.state.morale);
    const supply = clamp(attacker.state.supplies.ammo / 100, 0.12, 1);
    const scale = attacker.domain === "air" ? 0.26 : this.maxWeaponRange(attacker) > 12 ? 0.18 : 0.30;
    const raw =
      (attacker.capabilities.firepower || 1) *
      (weaponEffect / 100) *
      readiness *
      morale *
      supply *
      attackTerrain *
      (1 - targetCover * 0.55) *
      targetExposedOnBeach *
      airDefensePenalty *
      scale *
      (minutes / 10);
    const targetMass = clamp(Math.sqrt(target.state.initialStrength || 1) / 13, 0.4, 1.8);
    const casualties = clamp(raw / targetMass, 0, target.state.strength * 0.18);
    const casualtyRatio = casualties / Math.max(1, target.state.initialStrength);
    return {
      casualties,
      readinessLoss: clamp(casualtyRatio * 115 + raw * 0.035, 0, 16),
      moraleLoss: clamp(casualtyRatio * 150 + raw * 0.025, 0, 12),
      ammoSpent: clamp(ammoDemand * 0.7, 0.05, 4.5)
    };
  }

  updateObjectiveControl() {
    for (const objective of this.scenario.terrain.objectives) {
      const power = { Blue: 0, Red: 0 };
      for (const unit of this.scenario.units) {
        if (unit.state.strength <= 0 || unit.domain === "air") continue;
        const d = distance(unit.location, objective);
        if (d <= 1.45) {
          const strengthFactor = unit.state.strength / Math.max(1, unit.state.initialStrength);
          power[unit.side] += (unit.capabilities.combatPower || 0) * readinessFactor(unit.state.readiness) * strengthFactor * (1.5 - d / 1.45);
        }
      }
      const previous = objective.control;
      if (power.Blue > 0.8 && power.Red > 0.8 && Math.abs(power.Blue - power.Red) / Math.max(power.Blue, power.Red) < 0.22) {
        objective.control = "Contested";
      } else if (power.Blue > power.Red * 1.22 && power.Blue > 1) {
        objective.control = "Blue";
      } else if (power.Red > power.Blue * 1.22 && power.Red > 1) {
        objective.control = "Red";
      }
      if (objective.control !== previous) {
        this.recordEvent("Objective", `${objective.name} ${objective.control}`, `Blue ${power.Blue.toFixed(1)} / Red ${power.Red.toFixed(1)} local power.`);
      }
    }
  }

  updatePostures() {
    for (const unit of this.scenario.units) {
      const ratio = unit.state.strength / Math.max(1, unit.state.initialStrength);
      if (ratio < 0.25 || unit.state.readiness < 35 || unit.state.morale < 25) {
        unit.state.posture = "combat ineffective";
      } else if (ratio < 0.55 || unit.state.readiness < 55 || unit.state.morale < 45) {
        unit.state.posture = "degraded";
      } else {
        unit.state.posture = "active";
      }
    }
  }

  getMetrics() {
    const totals = {
      Blue: { initial: 0, strength: 0, readiness: 0, morale: 0, count: 0, logistics: 0, c2: 0, c2Count: 0 },
      Red: { initial: 0, strength: 0, readiness: 0, morale: 0, count: 0, logistics: 0, c2: 0, c2Count: 0 }
    };
    for (const unit of this.scenario.units) {
      const bucket = totals[unit.side];
      bucket.initial += unit.state.initialStrength;
      bucket.strength += unit.state.strength;
      bucket.readiness += unit.state.readiness;
      bucket.morale += unit.state.morale;
      bucket.logistics += (unit.state.supplies.ammo + unit.state.supplies.fuel + unit.state.supplies.sustainment) / 3;
      bucket.count += 1;
      if ((unit.capabilities.role || "").toLowerCase().includes("c2") || unit.name.toLowerCase().includes("hq")) {
        bucket.c2 += unit.state.readiness;
        bucket.c2Count += 1;
      }
    }
    const objectiveTotal = objectiveWeightSum(this.scenario.terrain.objectives);
    const blueObjective = this.scenario.terrain.objectives.reduce(
      (sum, objective) => sum + (objective.control === "Blue" ? objective.strategicValue : objective.control === "Contested" ? objective.strategicValue * 0.35 : 0),
      0
    );
    const redObjective = this.scenario.terrain.objectives.reduce(
      (sum, objective) => sum + (objective.control === "Red" ? objective.strategicValue : objective.control === "Contested" ? objective.strategicValue * 0.35 : 0),
      0
    );
    const blue = this.sideMetric(totals.Blue);
    const red = this.sideMetric(totals.Red);
    const blueUtility =
      (blueObjective / objectiveTotal) * 38 +
      blue.preservation * 0.24 +
      blue.avgReadiness * 0.14 +
      blue.avgLogistics * 0.12 +
      blue.avgC2 * 0.12 -
      Math.max(0, 100 - blue.avgMorale) * 0.04;
    const redFires = ["RED-PCL181", "RED-PHL191", "RED-HQ9", "RED-DF17"]
      .map((id) => this.getUnit(id))
      .filter(Boolean)
      .reduce((sum, unit) => sum + unit.state.readiness * (unit.state.strength / Math.max(1, unit.state.initialStrength)), 0) / 4;
    return {
      clock: this.clock,
      elapsedMinutes: this.elapsedMinutes,
      Blue: blue,
      Red: red,
      objectives: {
        blueScore: (blueObjective / objectiveTotal) * 100,
        redScore: (redObjective / objectiveTotal) * 100,
        objectiveTotal
      },
      blueUtility: clamp(blueUtility, 0, 100),
      redFiresSurvival: clamp(redFires, 0, 100),
      beachheadSecure: this.getObjective("OBJ001")?.control === "Blue",
      c2Degraded: blue.avgC2 < 70
    };
  }

  sideMetric(bucket) {
    const count = Math.max(1, bucket.count);
    return {
      strength: bucket.strength,
      initial: bucket.initial,
      losses: Math.max(0, bucket.initial - bucket.strength),
      preservation: bucket.initial ? (bucket.strength / bucket.initial) * 100 : 0,
      avgReadiness: bucket.readiness / count,
      avgMorale: bucket.morale / count,
      avgLogistics: bucket.logistics / count,
      avgC2: bucket.c2Count ? bucket.c2 / bucket.c2Count : bucket.readiness / count
    };
  }

  calculateCoaScores(weights = { expected: 0.45, floor: 0.25, regret: 0.20, risk: 0.10 }) {
    const metrics = this.getMetrics();
    const rows = this.scenario.coaLibrary.map((coa) => {
      const utilities = {};
      for (const response of RESPONSE_KEYS) {
        utilities[response] = this.adjustUtility(coa, response, metrics);
      }
      return { coa, utilities };
    });

    const bestByResponse = {};
    for (const response of RESPONSE_KEYS) {
      bestByResponse[response] = Math.max(...rows.map((row) => row.utilities[response]));
    }

    const responseWeights = Object.fromEntries(
      (this.scenario.redResponses || []).map((response) => [response.id, Number(response.probability || 0)])
    );
    return rows
      .map((row) => {
        const values = RESPONSE_KEYS.map((key) => row.utilities[key]);
        const expected = RESPONSE_KEYS.reduce((sum, key) => sum + row.utilities[key] * (responseWeights[key] || 0.25), 0);
        const floor = Math.min(...values);
        const worstRegret = Math.max(...RESPONSE_KEYS.map((key) => bestByResponse[key] - row.utilities[key]));
        const score =
          weights.expected * expected +
          weights.floor * floor -
          weights.regret * worstRegret -
          weights.risk * row.coa.risk * 100;
        return {
          id: row.coa.id,
          name: row.coa.name,
          posture: row.coa.posture,
          concept: row.coa.concept,
          fragility: row.coa.fragility,
          utilities: row.utilities,
          expected,
          floor,
          worstRegret,
          risk: row.coa.risk,
          score
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  adjustUtility(coa, response, metrics) {
    let utility = Number(coa.baseUtility[response] || 50);
    const bluePres = metrics.Blue.preservation;
    const blueC2 = metrics.Blue.avgC2;
    const blueLogistics = metrics.Blue.avgLogistics;
    const objectiveScore = metrics.objectives.blueScore;
    const redFires = metrics.redFiresSurvival;
    const hours = metrics.elapsedMinutes / 60;

    if (coa.posture === "opportunity-seeking") {
      utility += objectiveScore * 0.16;
      utility += Math.max(0, 18 - hours) * 0.22;
      utility -= Math.max(0, redFires - 45) * 0.18;
      utility -= Math.max(0, 72 - blueC2) * 0.20;
      utility -= Math.max(0, 68 - blueLogistics) * 0.16;
    } else if (coa.posture === "maximin") {
      utility += bluePres * 0.12;
      utility += blueC2 * 0.10;
      utility += blueLogistics * 0.10;
      utility -= Math.max(0, 45 - objectiveScore) * 0.10;
      utility -= Math.max(0, hours - 24) * 0.08;
    } else {
      utility += objectiveScore * 0.12;
      utility += bluePres * 0.08;
      utility += blueC2 * 0.10;
      utility += metrics.beachheadSecure ? 6 : -5;
      utility -= Math.max(0, redFires - 60) * 0.08;
      utility -= Math.max(0, 65 - blueLogistics) * 0.12;
    }

    if (response === "dangerous") {
      utility -= Math.max(0, redFires - 55) * 0.10;
      utility -= metrics.c2Degraded ? 8 : 0;
    }
    if (response === "deceptive") {
      const recon = this.getUnit("BLUE-RECON");
      const isr = this.getUnit("BLUE-F35");
      const isrReadiness = ((recon?.state.readiness || 60) + (isr?.state.readiness || 60)) / 2;
      utility += (isrReadiness - 70) * 0.12;
    }
    if (response === "adaptive") {
      utility -= Math.max(0, 70 - blueLogistics) * 0.08;
      utility += metrics.beachheadSecure ? 3 : -4;
    }
    return clamp(utility, 0, 100);
  }

  exportState() {
    return {
      ontology: this.scenario.ontology,
      metadata: this.scenario.metadata,
      simulationState: {
        clock: this.clock,
        elapsedMinutes: this.elapsedMinutes,
        metrics: this.getMetrics()
      },
      terrainGrid: this.terrainGrid,
      objectives: this.scenario.terrain.objectives,
      units: this.scenario.units,
      events: this.eventLog
    };
  }

  recordEvent(type, title, detail) {
    this.eventLog.unshift({
      id: `EVT-${this.turn}-${this.eventLog.length}`,
      minute: this.elapsedMinutes,
      clock: this.clock,
      type,
      title,
      detail
    });
    this.eventLog = this.eventLog.slice(0, 160);
  }

  emitChange() {
    this.dispatchEvent(new CustomEvent("change", { detail: this }));
  }
}

export function getEchelonRank(echelon) {
  return ECHELON_RANK[echelon] || 0;
}

export function pointDistance(a, b) {
  return distance(a, b);
}

export function formatMinutes(minutes) {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `${sign}${hours}h ${mins.toString().padStart(2, "0")}m`;
}

export function localOrderParser(text, units, objectives) {
  const lower = text.toLowerCase();
  const unit =
    units.find((candidate) => lower.includes(candidate.name.toLowerCase())) ||
    units.find((candidate) => lower.includes(candidate.id.toLowerCase())) ||
    units[0];
  const objective = objectives.find((candidate) => lower.includes(candidate.name.toLowerCase()));
  const coordMatch = text.match(/(?:x|lon|longitude)\s*[:=]?\s*(-?\d+(?:\.\d+)?).{0,24}(?:y|lat|latitude)\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i);
  const timeMatch = text.match(/(?:arrive|arrival|by)\D{0,10}(\d+(?:\.\d+)?)\s*(h|hr|hour|m|min|minute)?/i);
  const startMatch = text.match(/(?:start|begin)\D{0,10}(\d+(?:\.\d+)?)\s*(h|hr|hour|m|min|minute)?/i);
  const speedMatch = text.match(/(\d+(?:\.\d+)?)\s*(kph|km\/h|kmh)/i);
  const task =
    ["assault", "defend", "secure", "recon", "screen", "support", "withdraw", "strike", "probe", "hold"].find((word) => lower.includes(word)) ||
    "Move";
  const destination = objective
    ? { xKm: objective.xKm, yKm: objective.yKm }
    : coordMatch
      ? { xKm: Number(coordMatch[1]), yKm: Number(coordMatch[2]) }
      : { xKm: unit?.location.xKm ?? 0, yKm: unit?.location.yKm ?? 0 };
  const toMinutes = (match, fallback) => {
    if (!match) return fallback;
    const amount = Number(match[1]);
    const unitText = (match[2] || "m").toLowerCase();
    return unitText.startsWith("h") ? amount * 60 : amount;
  };
  return {
    unitId: unit?.id,
    task: task[0].toUpperCase() + task.slice(1),
    destination,
    startMinute: toMinutes(startMatch, 0),
    arriveByMinute: toMinutes(timeMatch, 240),
    speedKph: speedMatch ? Number(speedMatch[1]) : 8,
    directionDeg: unit ? bearingDegrees(unit.location, destination) : 0,
    onFailure: lower.includes("if fail") ? text.split(/if fail/i).at(-1).trim() : "Hold current position and report"
  };
}
