import {
  BattleflowEngine,
  formatMinutes,
  getEchelonRank,
  localOrderParser
} from "./battleflow-engine.js";

const dom = {
  scenarioTitle: document.getElementById("scenarioTitle"),
  clock: document.getElementById("clock"),
  elapsed: document.getElementById("elapsed"),
  runState: document.getElementById("runState"),
  resetBtn: document.getElementById("resetBtn"),
  stepBtn: document.getElementById("stepBtn"),
  playBtn: document.getElementById("playBtn"),
  timeScrubber: document.getElementById("timeScrubber"),
  scrubLabel: document.getElementById("scrubLabel"),
  batchBtn: document.getElementById("batchBtn"),
  modeSelect: document.getElementById("modeSelect"),
  scenarioFile: document.getElementById("scenarioFile"),
  exportBtn: document.getElementById("exportBtn"),
  canvas: document.getElementById("mapCanvas"),
  mapHint: document.getElementById("mapHint"),
  mapSubtitle: document.getElementById("mapSubtitle"),
  legend: document.getElementById("legend"),
  metrics: document.getElementById("metrics"),
  validation: document.getElementById("validation"),
  selectedUnit: document.getElementById("selectedUnit"),
  forceTree: document.getElementById("forceTree"),
  unitCount: document.getElementById("unitCount"),
  orderForm: document.getElementById("orderForm"),
  orderUnit: document.getElementById("orderUnit"),
  orderTask: document.getElementById("orderTask"),
  orderX: document.getElementById("orderX"),
  orderY: document.getElementById("orderY"),
  orderStart: document.getElementById("orderStart"),
  orderArrive: document.getElementById("orderArrive"),
  orderSpeed: document.getElementById("orderSpeed"),
  orderDirection: document.getElementById("orderDirection"),
  orderFailure: document.getElementById("orderFailure"),
  orderSide: document.getElementById("orderSide"),
  queueCount: document.getElementById("queueCount"),
  orderQueue: document.getElementById("orderQueue"),
  coaScores: document.getElementById("coaScores"),
  coaBest: document.getElementById("coaBest"),
  coaMatrix: document.getElementById("coaMatrix"),
  ontologyView: document.getElementById("ontologyView"),
  copyOntologyBtn: document.getElementById("copyOntologyBtn"),
  applyOntologyBtn: document.getElementById("applyOntologyBtn"),
  naturalOrder: document.getElementById("naturalOrder"),
  apiEndpoint: document.getElementById("apiEndpoint"),
  apiModel: document.getElementById("apiModel"),
  apiKey: document.getElementById("apiKey"),
  localParseBtn: document.getElementById("localParseBtn"),
  openAiParseBtn: document.getElementById("openAiParseBtn"),
  applyParsedBtn: document.getElementById("applyParsedBtn"),
  parsedOrder: document.getElementById("parsedOrder"),
  aiStatus: document.getElementById("aiStatus"),
  eventCount: document.getElementById("eventCount"),
  eventLog: document.getElementById("eventLog")
};

const ctx = dom.canvas.getContext("2d");
let engine;
let selectedUnitId = null;
let selectedCell = null;
let playing = false;
let playTimer = null;
let parsedOrder = null;
let dragUnitId = null;
let transform = null;
let needsDraw = true;

const terrainColors = {
  "water-fringe": "#8ccbd0",
  "eastern-littoral": "#d8c57b",
  "airfield-corridor": "#bfc8c9",
  "sentinel-port": "#9baab0",
  "central-highlands": "#6e925d",
  "open-interior": "#9fb978",
  "baseline-land": "#b8c789"
};

const legendItems = [
  ["Water", "#8ccbd0"],
  ["Beach", "#d8c57b"],
  ["Open", "#9fb978"],
  ["Highland", "#6e925d"],
  ["Port", "#9baab0"],
  ["Airfield", "#bfc8c9"],
  ["Blue", "#1d6fd6"],
  ["Red", "#c73a3a"]
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function number(value, digits = 0) {
  return Number(value || 0).toFixed(digits);
}

function metric(label, value, description, tone = "") {
  return `
    <div class="metric ${escapeHtml(tone)}">
      <div class="metric-head">
        <span>${escapeHtml(label)}</span>
        <button type="button" class="metric-help" title="${escapeHtml(description)}" aria-label="${escapeHtml(label)} explanation">i</button>
      </div>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(description)}</p>
    </div>
  `;
}

function statusText(unit) {
  if (!unit) return "";
  const strength = unit.state.strength / Math.max(1, unit.state.initialStrength) * 100;
  return `${number(strength)}% str / ${number(unit.state.readiness)}% ready`;
}

async function init() {
  const response = await fetch("./scenario-iron-tide.json");
  const scenario = await response.json();
  engine = new BattleflowEngine(scenario);
  selectedUnitId = engine.getCommandableUnits()[0]?.id || engine.scenario.units[0]?.id;
  dom.scenarioTitle.textContent = "Decision Making Support with Course Of Action Evaluation";
  dom.mapSubtitle.textContent = `${engine.scenario.terrain.map.widthKm} km x ${engine.scenario.terrain.map.heightKm} km local grid`;
  dom.legend.innerHTML = legendItems
    .map(([label, color]) => `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${label}</span>`)
    .join("");
  wireEvents();
  resizeCanvas();
  engine.addEventListener("change", () => {
    renderAll();
    needsDraw = true;
  });
  renderAll();
  requestAnimationFrame(drawLoop);
}

function wireEvents() {
  dom.resetBtn.addEventListener("click", () => {
    stopPlaying();
    engine.reset();
    selectedUnitId = engine.getCommandableUnits()[0]?.id || engine.scenario.units[0]?.id;
  });
  dom.stepBtn.addEventListener("click", () => engine.step(engine.scenario.simulation.timeStepMinutes));
  dom.playBtn.addEventListener("click", () => (playing ? stopPlaying() : startPlaying()));
  dom.timeScrubber.addEventListener("input", () => {
    dom.scrubLabel.textContent = `T+${formatMinutes(Number(dom.timeScrubber.value || 0))}`;
  });
  dom.timeScrubber.addEventListener("change", () => seekToMinute(Number(dom.timeScrubber.value || 0)));
  dom.batchBtn.addEventListener("click", () => {
    stopPlaying();
    engine.runBatch();
  });
  dom.scenarioFile.addEventListener("change", loadScenarioFile);
  dom.exportBtn.addEventListener("click", exportState);
  dom.orderForm.addEventListener("submit", submitOrder);
  dom.orderUnit.addEventListener("change", () => selectUnit(dom.orderUnit.value));
  for (const input of [dom.orderX, dom.orderY]) {
    input.addEventListener("input", updateDirectionPreview);
  }
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });
  dom.copyOntologyBtn.addEventListener("click", copyOntology);
  dom.applyOntologyBtn.addEventListener("click", applyOntology);
  dom.localParseBtn.addEventListener("click", parseLocal);
  dom.openAiParseBtn.addEventListener("click", parseOpenAi);
  dom.applyParsedBtn.addEventListener("click", applyParsedOrder);

  dom.canvas.addEventListener("pointerdown", onPointerDown);
  dom.canvas.addEventListener("pointermove", onPointerMove);
  dom.canvas.addEventListener("pointerup", onPointerUp);
  dom.canvas.addEventListener("pointerleave", onPointerUp);
  window.addEventListener("resize", resizeCanvas);
}

function startPlaying() {
  stopPlaying();
  playing = true;
  dom.playBtn.textContent = "Pause";
  dom.runState.textContent = "Running";
  const mode = dom.modeSelect.value;
  const tick = mode === "realTime" ? 1000 : mode === "accelerated" ? 700 : 260;
  const minutes = mode === "realTime" ? 1 : mode === "accelerated" ? engine.scenario.simulation.timeStepMinutes : 60;
  playTimer = window.setInterval(() => {
    if (engine.elapsedMinutes >= engine.scenario.simulation.horizonHours * 60) {
      stopPlaying();
      return;
    }
    engine.step(minutes);
  }, tick);
}

function stopPlaying() {
  playing = false;
  if (playTimer) window.clearInterval(playTimer);
  playTimer = null;
  dom.playBtn.textContent = "Play";
  dom.runState.textContent = "Paused";
}

function seekToMinute(targetMinute) {
  const step = Number(engine.scenario.simulation.timeStepMinutes || 10);
  const horizon = Number(engine.scenario.simulation.horizonHours || 0) * 60;
  const target = clamp(Math.round(targetMinute / step) * step, 0, horizon);
  stopPlaying();
  if (target < engine.elapsedMinutes) {
    engine.reset();
    selectedUnitId = engine.getCommandableUnits()[0]?.id || engine.scenario.units[0]?.id;
  }
  let guard = 0;
  while (engine.elapsedMinutes < target && guard < 1000) {
    engine.step(Math.min(step, target - engine.elapsedMinutes));
    guard += 1;
  }
  renderAll();
  needsDraw = true;
}

function renderAll() {
  if (!engine) return;
  renderHeader();
  renderMetrics();
  renderValidation();
  renderSelectedUnit();
  renderForceTree();
  renderOrderForm();
  renderOrderQueue();
  renderCoa();
  renderOntology();
  renderEvents();
}

function renderHeader() {
  dom.clock.textContent = engine.clock;
  dom.elapsed.textContent = `T+${formatMinutes(engine.elapsedMinutes)}`;
  dom.unitCount.textContent = `${engine.scenario.units.length} units`;
  const horizon = Number(engine.scenario.simulation.horizonHours || 0) * 60;
  dom.timeScrubber.max = String(horizon);
  dom.timeScrubber.step = String(engine.scenario.simulation.timeStepMinutes || 10);
  if (document.activeElement !== dom.timeScrubber) {
    dom.timeScrubber.value = String(engine.elapsedMinutes);
  }
  dom.scrubLabel.textContent = `T+${formatMinutes(engine.elapsedMinutes)} / ${formatMinutes(horizon)}`;
}

function renderMetrics() {
  const metrics = engine.getMetrics();
  dom.metrics.innerHTML = [
    metric(
      "Blue Utility",
      `${number(metrics.blueUtility)}%`,
      "Composite planning utility combining objective control, force preservation, readiness, logistics, and command-and-control.",
      "metric-blue"
    ),
    metric(
      "Objective Score",
      `${number(metrics.objectives.blueScore)}%`,
      "Weighted share of scenario objectives controlled or effectively contested by Blue at the current time.",
      "metric-gold"
    ),
    metric(
      "Blue Preservation",
      `${number(metrics.Blue.preservation)}%`,
      "Remaining Blue combat strength compared with the starting order of battle.",
      "metric-green"
    ),
    metric(
      "Red Fires",
      `${number(metrics.redFiresSurvival)}%`,
      "Surviving Red long-range fires, strike, and air-defense threat that can still influence Blue movement.",
      "metric-red"
    ),
    metric(
      "Blue C2",
      `${number(metrics.Blue.avgC2)}%`,
      "Average readiness of Blue command-and-control and support elements used to coordinate the force.",
      "metric-teal"
    )
  ].join("");
}

function renderValidation() {
  dom.validation.innerHTML = engine
    .validateStartingAreas()
    .map((notice) => `<div class="notice ${escapeHtml(notice.severity)}">${escapeHtml(notice.message)}</div>`)
    .join("");
}

function renderSelectedUnit() {
  const unit = engine.getUnit(selectedUnitId);
  if (!unit) {
    dom.selectedUnit.innerHTML = `<div class="notice warning">No unit selected.</div>`;
    return;
  }
  const cell = engine.getUnitCell(unit);
  dom.selectedUnit.innerHTML = `
    <div class="unit-head">
      <h3>${escapeHtml(unit.name)}</h3>
      <span class="pill ${unit.side}">${escapeHtml(unit.side)}</span>
    </div>
    <div class="kv-grid">
      <div class="kv"><span>Echelon</span><strong>${escapeHtml(unit.echelon)}</strong></div>
      <div class="kv"><span>Role</span><strong>${escapeHtml(unit.capabilities.role)}</strong></div>
      <div class="kv"><span>Location</span><strong>${number(unit.location.xKm, 1)}, ${number(unit.location.yKm, 1)}</strong></div>
      <div class="kv"><span>Terrain</span><strong>${escapeHtml(cell.name)}</strong></div>
      <div class="kv"><span>Strength</span><strong>${number(unit.state.strength)} / ${number(unit.state.initialStrength)}</strong></div>
      <div class="kv"><span>Readiness</span><strong>${number(unit.state.readiness)}%</strong></div>
      <div class="kv"><span>Morale</span><strong>${number(unit.state.morale)}%</strong></div>
      <div class="kv"><span>Supplies</span><strong>${number((unit.state.supplies.ammo + unit.state.supplies.fuel + unit.state.supplies.sustainment) / 3)}%</strong></div>
    </div>
  `;
}

function renderForceTree() {
  const byParent = engine.getHierarchy();
  const renderNode = (unit) => {
    const children = byParent.get(unit.id) || [];
    const selected = unit.id === selectedUnitId ? "selected" : "";
    return `
      <div class="tree-node ${selected}" data-unit="${escapeHtml(unit.id)}" style="margin-left:${Math.max(0, 6 - getEchelonRank(unit.echelon)) * 4}px">
        <div class="node-title">
          <span>${escapeHtml(unit.name)}</span>
          <span class="pill ${unit.side}">${escapeHtml(unit.echelon)}</span>
        </div>
        <div class="node-meta">${escapeHtml(unit.capabilities.role)} | ${statusText(unit)} | ${number(unit.location.xKm, 1)}, ${number(unit.location.yKm, 1)}</div>
        ${children.length ? `<div class="children">${children.map(renderNode).join("")}</div>` : ""}
      </div>
    `;
  };
  dom.forceTree.innerHTML = (byParent.get("__root__") || []).map(renderNode).join("");
  dom.forceTree.querySelectorAll("[data-unit]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      selectUnit(node.dataset.unit);
    });
  });
}

function renderOrderForm() {
  const commandable = engine.getCommandableUnits();
  const selected = engine.getUnit(selectedUnitId);
  const unit = commandable.find((item) => item.id === selectedUnitId) || commandable[0];
  dom.orderUnit.innerHTML = commandable
    .map((item) => `<option value="${escapeHtml(item.id)}"${item.id === unit?.id ? " selected" : ""}>${escapeHtml(item.side)} | ${escapeHtml(item.name)}</option>`)
    .join("");
  if (!unit) return;
  dom.orderSide.textContent = `${unit.side} command`;
  if (!selected || selected.id !== unit.id) selectedUnitId = unit.id;
  const currentOrder = unit.orders.find((order) => !order.completed) || unit.orders.at(-1);
  dom.orderTask.value = taskOption(currentOrder?.task || "Move");
  dom.orderX.value = number(currentOrder?.destination?.xKm ?? unit.location.xKm, 1);
  dom.orderY.value = number(currentOrder?.destination?.yKm ?? unit.location.yKm, 1);
  dom.orderStart.value = number(engine.elapsedMinutes);
  dom.orderArrive.value = number(engine.elapsedMinutes + 240);
  dom.orderSpeed.value = number(currentOrder?.speedKph ?? 8);
  dom.orderDirection.value = number(currentOrder?.directionDeg ?? 0);
  dom.orderFailure.value = currentOrder?.onFailure || "Hold current position and report";
}

function taskOption(task) {
  const lower = String(task).toLowerCase();
  const option = ["Move", "Assault", "Defend", "Secure", "Recon", "Support", "Strike", "Withdraw"].find((item) =>
    lower.includes(item.toLowerCase())
  );
  return option || "Move";
}

function renderOrderQueue() {
  const unit = engine.getUnit(selectedUnitId);
  if (!unit) {
    dom.orderQueue.innerHTML = "";
    return;
  }
  dom.queueCount.textContent = `${unit.orders.length} orders`;
  dom.orderQueue.innerHTML = unit.orders
    .slice()
    .reverse()
    .map((order) => `
      <div class="order-item">
        <h3>${escapeHtml(order.task)} ${order.completed ? "(complete)" : ""}</h3>
        <p>T+${number(order.startMinute)}m to T+${number(order.arriveByMinute)}m | ${number(order.destination.xKm, 1)}, ${number(order.destination.yKm, 1)} | ${number(order.speedKph)} kph</p>
        <p>${escapeHtml(order.onFailure)}</p>
      </div>
    `)
    .join("");
}

function renderCoa() {
  const scores = engine.calculateCoaScores();
  const best = scores[0];
  dom.coaBest.textContent = best ? `${best.id} leads` : "";
  dom.coaScores.innerHTML = scores
    .map((score) => `
      <div class="coa-item">
        <h3>${escapeHtml(score.id)} | ${escapeHtml(score.name)}</h3>
        <p>${escapeHtml(score.concept)}</p>
        <div class="score-line">
          <span>Score</span>
          <div class="bar"><span style="width:${clamp(score.score, 0, 100)}%"></span></div>
          <strong>${number(score.score)}</strong>
        </div>
        <p>Floor ${number(score.floor)} | Expected ${number(score.expected)} | Regret ${number(score.worstRegret)} | Risk ${number(score.risk * 100)}</p>
      </div>
    `)
    .join("");
  const responses = engine.scenario.redResponses || [];
  dom.coaMatrix.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>COA</th>
          ${responses.map((response) => `<th>${escapeHtml(response.name)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${scores
          .map((score) => `
            <tr>
              <td>${escapeHtml(score.id)}</td>
              ${responses.map((response) => `<td>${number(score.utilities[response.id])}</td>`).join("")}
            </tr>
          `)
          .join("")}
      </tbody>
    </table>
  `;
}

function renderOntology() {
  if (document.activeElement === dom.ontologyView) return;
  const readable = {
    ontology: engine.scenario.ontology,
    metadata: engine.scenario.metadata,
    simulation: engine.scenario.simulation,
    terrain: engine.scenario.terrain,
    forces: engine.scenario.forces,
    units: engine.scenario.units.map(({ state, ...unit }) => unit),
    coaLibrary: engine.scenario.coaLibrary,
    redResponses: engine.scenario.redResponses
  };
  dom.ontologyView.value = JSON.stringify(readable, null, 2);
}

function renderEvents() {
  dom.eventCount.textContent = `${engine.eventLog.length} visible`;
  dom.eventLog.innerHTML = engine.eventLog
    .map((event) => `
      <div class="event-item">
        <div class="event-type">${escapeHtml(event.type)} | T+${formatMinutes(event.minute)}</div>
        <h3>${escapeHtml(event.title)}</h3>
        <p>${escapeHtml(event.detail)}</p>
      </div>
    `)
    .join("");
}

function selectUnit(unitId) {
  selectedUnitId = unitId;
  selectedCell = null;
  renderAll();
  needsDraw = true;
}

function setTab(name) {
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
}

function submitOrder(event) {
  event.preventDefault();
  const unit = engine.getUnit(dom.orderUnit.value);
  const destination = { xKm: Number(dom.orderX.value), yKm: Number(dom.orderY.value) };
  const order = {
    task: dom.orderTask.value,
    destination,
    startMinute: Number(dom.orderStart.value),
    arriveByMinute: Number(dom.orderArrive.value),
    speedKph: Number(dom.orderSpeed.value),
    directionDeg: Number(dom.orderDirection.value),
    onFailure: dom.orderFailure.value
  };
  try {
    engine.issueOrder(unit.id, order);
    selectedUnitId = unit.id;
  } catch (error) {
    engine.recordEvent("Order", "Order rejected", error.message);
    engine.emitChange();
  }
}

function updateDirectionPreview() {
  const unit = engine.getUnit(dom.orderUnit.value);
  if (!unit) return;
  const dx = Number(dom.orderX.value) - unit.location.xKm;
  const dy = Number(dom.orderY.value) - unit.location.yKm;
  dom.orderDirection.value = number((Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360);
}

async function loadScenarioFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const scenario = JSON.parse(text);
    stopPlaying();
    engine.loadScenario(scenario);
    selectedUnitId = engine.getCommandableUnits()[0]?.id || engine.scenario.units[0]?.id;
    dom.scenarioTitle.textContent = "Decision Making Support with Course Of Action Evaluation";
    dom.mapSubtitle.textContent = `${engine.scenario.terrain.map.widthKm} km x ${engine.scenario.terrain.map.heightKm} km local grid`;
  } catch (error) {
    engine.recordEvent("System", "Scenario load failed", error.message);
    engine.emitChange();
  } finally {
    event.target.value = "";
  }
}

function exportState() {
  const blob = new Blob([JSON.stringify(engine.exportState(), null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `battleflow-state-T${engine.elapsedMinutes}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function copyOntology() {
  await navigator.clipboard.writeText(dom.ontologyView.value);
  engine.recordEvent("System", "Ontology copied", "Scenario JSON copied to clipboard.");
  engine.emitChange();
}

function applyOntology() {
  try {
    const scenario = JSON.parse(dom.ontologyView.value);
    stopPlaying();
    engine.loadScenario(scenario);
    selectedUnitId = engine.getCommandableUnits()[0]?.id || engine.scenario.units[0]?.id;
    dom.mapSubtitle.textContent = `${engine.scenario.terrain.map.widthKm} km x ${engine.scenario.terrain.map.heightKm} km local grid`;
  } catch (error) {
    engine.recordEvent("System", "Ontology rejected", error.message);
    engine.emitChange();
  }
}

function parseLocal() {
  const commandable = engine.getCommandableUnits();
  parsedOrder = localOrderParser(dom.naturalOrder.value, commandable, engine.scenario.terrain.objectives);
  dom.aiStatus.textContent = "Local parsed";
  dom.parsedOrder.textContent = JSON.stringify(parsedOrder, null, 2);
}

async function parseOpenAi() {
  const key = dom.apiKey.value.trim();
  if (!key) {
    dom.aiStatus.textContent = "API key required";
    return;
  }
  dom.aiStatus.textContent = "Parsing";
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      unitId: { type: "string" },
      task: { type: "string" },
      destination: {
        type: "object",
        additionalProperties: false,
        properties: {
          xKm: { type: "number" },
          yKm: { type: "number" }
        },
        required: ["xKm", "yKm"]
      },
      startMinute: { type: "number" },
      arriveByMinute: { type: "number" },
      speedKph: { type: "number" },
      directionDeg: { type: "number" },
      onFailure: { type: "string" }
    },
    required: ["unitId", "task", "destination", "startMinute", "arriveByMinute", "speedKph", "directionDeg", "onFailure"]
  };
  const context = {
    commandableUnits: engine.getCommandableUnits().map((unit) => ({ id: unit.id, name: unit.name, side: unit.side })),
    objectives: engine.scenario.terrain.objectives.map((objective) => ({
      id: objective.id,
      name: objective.name,
      xKm: objective.xKm,
      yKm: objective.yKm
    }))
  };
  try {
    const response = await fetch(dom.apiEndpoint.value.trim(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: dom.apiModel.value.trim() || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: "Parse the order into Battleflow JSON. Use only supplied unit ids and objective coordinates."
          },
          {
            role: "user",
            content: JSON.stringify({ context, order: dom.naturalOrder.value })
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "battleflow_order",
            strict: true,
            schema
          }
        }
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || response.statusText);
    const text = extractOutputText(data);
    parsedOrder = JSON.parse(text);
    dom.aiStatus.textContent = "API parsed";
    dom.parsedOrder.textContent = JSON.stringify(parsedOrder, null, 2);
  } catch (error) {
    dom.aiStatus.textContent = "API failed";
    dom.parsedOrder.textContent = error.message;
  }
}

function extractOutputText(data) {
  if (data.output_text) return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function applyParsedOrder() {
  if (!parsedOrder) parseLocal();
  if (!parsedOrder) return;
  try {
    fillOrderFormFromParsed(parsedOrder);
    dom.aiStatus.textContent = "Fields ready";
    setTab("orders");
  } catch (error) {
    dom.parsedOrder.textContent = error.message;
  }
}

function fillOrderFormFromParsed(order) {
  const unit = engine.getUnit(order.unitId);
  if (!unit) throw new Error(`Unknown unit id: ${order.unitId || "none"}`);
  const destination = order.destination || {};
  selectedUnitId = unit.id;
  renderOrderForm();
  dom.orderUnit.value = unit.id;
  dom.orderTask.value = taskOption(order.task || "Move");
  dom.orderX.value = number(destination.xKm ?? unit.location.xKm, 1);
  dom.orderY.value = number(destination.yKm ?? unit.location.yKm, 1);
  dom.orderStart.value = number(order.startMinute ?? engine.elapsedMinutes);
  dom.orderArrive.value = number(order.arriveByMinute ?? engine.elapsedMinutes + 240);
  dom.orderSpeed.value = number(order.speedKph ?? 8);
  dom.orderDirection.value = number(order.directionDeg ?? 0);
  dom.orderFailure.value = order.onFailure || "Hold current position and report";
  renderSelectedUnit();
  renderForceTree();
  renderOrderQueue();
  needsDraw = true;
}

function resizeCanvas() {
  const parent = dom.canvas.parentElement;
  const parentRect = parent.getBoundingClientRect();
  const desiredHeight = clamp(parentRect.width * 9 / 16, 340, 620);
  parent.style.height = `${desiredHeight}px`;
  const rect = parent.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  dom.canvas.width = Math.max(640, Math.floor(rect.width * dpr));
  dom.canvas.height = Math.max(360, Math.floor(rect.height * dpr));
  dom.canvas.style.width = `${rect.width}px`;
  dom.canvas.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  transform = null;
  needsDraw = true;
}

function drawLoop() {
  if (needsDraw) {
    drawMap();
    needsDraw = false;
  }
  requestAnimationFrame(drawLoop);
}

function fitTransform() {
  const rect = dom.canvas.getBoundingClientRect();
  const map = engine.scenario.terrain.map;
  const padding = 24;
  const scale = Math.min((rect.width - padding * 2) / map.widthKm, (rect.height - padding * 2) / map.heightKm);
  const width = map.widthKm * scale;
  const height = map.heightKm * scale;
  transform = {
    scale,
    left: (rect.width - width) / 2,
    top: (rect.height - height) / 2,
    width,
    height,
    map
  };
  return transform;
}

function mapToCanvas(point) {
  const t = transform || fitTransform();
  return {
    x: t.left + point.xKm * t.scale,
    y: t.top + (t.map.heightKm - point.yKm) * t.scale
  };
}

function canvasToMap(point) {
  const t = transform || fitTransform();
  return {
    xKm: clamp((point.x - t.left) / t.scale, 0, t.map.widthKm),
    yKm: clamp(t.map.heightKm - (point.y - t.top) / t.scale, 0, t.map.heightKm)
  };
}

function drawMap() {
  if (!engine) return;
  const rect = dom.canvas.getBoundingClientRect();
  const t = fitTransform();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#9bd2dc";
  ctx.fillRect(0, 0, rect.width, rect.height);
  drawTerrain(t);
  drawGrid(t);
  drawMapFeatures();
  drawShoreline();
  drawClippedToIsland(drawStartingAreas);
  drawObjectives();
  drawOrders();
  drawUnits();
  drawCellSelection();
}

function drawTerrain(t) {
  const cellScale = t.scale * engine.scenario.terrain.map.cellKm;
  ctx.save();
  ctx.fillStyle = "#8fcbd6";
  ctx.fillRect(t.left, t.top, t.width, t.height);
  drawOceanTexture(t);
  drawIslandPath();
  ctx.clip();
  for (const row of engine.terrainGrid) {
    for (const cell of row) {
      const point = mapToCanvas({ xKm: cell.x, yKm: cell.y + 1 });
      ctx.fillStyle = terrainColors[cell.zoneId] || "#b8c789";
      ctx.fillRect(point.x, point.y, Math.ceil(cellScale), Math.ceil(cellScale));
      if (cell.domain === "water") {
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.beginPath();
        ctx.moveTo(point.x, point.y + cellScale * 0.65);
        ctx.lineTo(point.x + cellScale, point.y + cellScale * 0.35);
        ctx.stroke();
      }
    }
  }
  drawHarborWater();
  ctx.restore();
}

function drawGrid(t) {
  ctx.save();
  drawIslandPath();
  ctx.clip();
  ctx.strokeStyle = "rgba(38, 58, 52, 0.13)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= t.map.widthKm; x += 1) {
    const a = mapToCanvas({ xKm: x, yKm: 0 });
    const b = mapToCanvas({ xKm: x, yKm: t.map.heightKm });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let y = 0; y <= t.map.heightKm; y += 1) {
    const a = mapToCanvas({ xKm: 0, yKm: y });
    const b = mapToCanvas({ xKm: t.map.widthKm, yKm: y });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOceanTexture(t) {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
  ctx.lineWidth = 1;
  for (let y = t.top + 14; y < t.top + t.height; y += 28) {
    ctx.beginPath();
    for (let x = t.left; x <= t.left + t.width; x += 26) {
      const wave = Math.sin((x + y) * 0.035) * 4;
      if (x === t.left) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function islandBoundaryPoints(steps = 180) {
  const map = engine.scenario.terrain.map;
  const cx = map.widthKm * 0.5;
  const cy = map.heightKm * 0.49;
  const rx = map.widthKm * 0.485;
  const ry = map.heightKm * 0.445;
  const points = [];
  for (let i = 0; i < steps; i += 1) {
    const theta = i / steps * Math.PI * 2;
    const harbor = Math.exp(-Math.pow(angleDelta(theta, -Math.PI / 2) / 0.34, 2)) * 0.25;
    const westBite = Math.exp(-Math.pow(angleDelta(theta, Math.PI) / 0.42, 2)) * 0.08;
    const northHeadland = Math.exp(-Math.pow(angleDelta(theta, Math.PI / 2) / 0.36, 2)) * 0.08;
    const wobble =
      Math.sin(theta * 3.2 + 0.45) * 0.045 +
      Math.cos(theta * 5.4 - 0.2) * 0.035 +
      Math.sin(theta * 8.1 + 1.3) * 0.018;
    const radius = 1 + wobble + northHeadland - harbor - westBite;
    points.push({
      xKm: cx + Math.cos(theta) * rx * radius,
      yKm: cy + Math.sin(theta) * ry * radius
    });
  }
  return points;
}

function angleDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function drawIslandPath() {
  const points = islandBoundaryPoints();
  ctx.beginPath();
  points.forEach((point, index) => {
    const p = mapToCanvas(point);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

function drawClippedToIsland(drawer) {
  ctx.save();
  drawIslandPath();
  ctx.clip();
  drawer();
  ctx.restore();
}

function drawShoreline() {
  ctx.save();
  drawIslandPath();
  ctx.shadowColor = "rgba(18, 31, 26, 0.28)";
  ctx.shadowBlur = 8;
  ctx.strokeStyle = "rgba(36, 74, 61, 0.82)";
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawHarborWater() {
  const harbor = mapToCanvas({ xKm: 16.1, yKm: 3.9 });
  const scale = (transform || fitTransform()).scale;
  ctx.save();
  ctx.fillStyle = "rgba(91, 174, 196, 0.82)";
  ctx.beginPath();
  ctx.ellipse(harbor.x, harbor.y, scale * 2.7, scale * 1.45, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function drawMapFeatures() {
  ctx.save();
  drawIslandPath();
  ctx.clip();
  drawRiver([
    { xKm: 12.5, yKm: 16.3 },
    { xKm: 11.7, yKm: 14.2 },
    { xKm: 10.2, yKm: 11.9 },
    { xKm: 8.0, yKm: 9.0 },
    { xKm: 5.5, yKm: 6.8 },
    { xKm: 3.1, yKm: 5.2 }
  ]);
  drawRiver([
    { xKm: 21.4, yKm: 15.0 },
    { xKm: 19.6, yKm: 12.3 },
    { xKm: 18.0, yKm: 9.2 },
    { xKm: 16.8, yKm: 6.2 },
    { xKm: 16.0, yKm: 4.1 }
  ]);
  drawRoad([
    { xKm: 2.9, yKm: 5.0 },
    { xKm: 6.0, yKm: 7.4 },
    { xKm: 9.0, yKm: 11.0 },
    { xKm: 12.4, yKm: 12.1 },
    { xKm: 18.0, yKm: 13.0 },
    { xKm: 20.0, yKm: 12.0 }
  ]);
  drawRoad([
    { xKm: 9.0, yKm: 11.0 },
    { xKm: 11.5, yKm: 8.5 },
    { xKm: 14.2, yKm: 6.1 },
    { xKm: 16.0, yKm: 4.0 },
    { xKm: 18.6, yKm: 4.7 }
  ]);
  drawRoad([
    { xKm: 6.0, yKm: 7.4 },
    { xKm: 9.2, yKm: 7.2 },
    { xKm: 12.5, yKm: 6.7 },
    { xKm: 16.0, yKm: 4.0 }
  ]);
  drawMountainRange([
    { xKm: 11.5, yKm: 14.4 },
    { xKm: 14.0, yKm: 15.2 },
    { xKm: 16.8, yKm: 14.4 },
    { xKm: 19.2, yKm: 13.3 },
    { xKm: 21.4, yKm: 12.4 }
  ]);
  ctx.restore();
}

function drawRiver(points) {
  drawPolyline(points, "rgba(255, 255, 255, 0.68)", 5.5);
  drawPolyline(points, "#238bb5", 2.4);
}

function drawRoad(points) {
  drawPolyline(points, "rgba(255, 255, 255, 0.9)", 4.8);
  drawPolyline(points, "#b97725", 1.9);
}

function drawPolyline(points, stroke, width) {
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((point, index) => {
    const p = mapToCanvas(point);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawMountainRange(points) {
  ctx.save();
  ctx.strokeStyle = "rgba(66, 84, 74, 0.78)";
  ctx.fillStyle = "rgba(238, 243, 240, 0.74)";
  ctx.lineWidth = 1.5;
  for (const point of points) {
    const p = mapToCanvas(point);
    const s = (transform || fitTransform()).scale * 0.45;
    ctx.beginPath();
    ctx.moveTo(p.x - s, p.y + s * 0.72);
    ctx.lineTo(p.x, p.y - s);
    ctx.lineTo(p.x + s, p.y + s * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(23, 32, 29, 0.72)";
  ctx.font = "750 10px Inter, system-ui, sans-serif";
  const label = mapToCanvas({ xKm: 14.1, yKm: 13.4 });
  ctx.fillText("Central Highlands", label.x, label.y);
  ctx.restore();
}

function drawStartingAreas() {
  const areas = engine.scenario.terrain.feasibleStartingAreas;
  drawArea(areas.Blue.bounds, "rgba(29, 111, 214, 0.12)", "rgba(29, 111, 214, 0.8)");
  drawArea(areas.Red.bounds, "rgba(199, 58, 58, 0.12)", "rgba(199, 58, 58, 0.8)");
}

function drawArea(bounds, fill, stroke) {
  const nw = mapToCanvas({ xKm: bounds.xMin, yKm: bounds.yMax });
  const se = mapToCanvas({ xKm: bounds.xMax, yKm: bounds.yMin });
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.fillRect(nw.x, nw.y, se.x - nw.x, se.y - nw.y);
  ctx.strokeRect(nw.x, nw.y, se.x - nw.x, se.y - nw.y);
  ctx.restore();
}

function drawObjectives() {
  for (const objective of engine.scenario.terrain.objectives) {
    const p = mapToCanvas(objective);
    const color = objective.control === "Blue" ? "#1d6fd6" : objective.control === "Red" ? "#c73a3a" : "#a46a19";
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#17201d";
    ctx.font = "700 11px Inter, system-ui, sans-serif";
    ctx.fillText(objective.name, p.x + 10, p.y - 8);
    ctx.restore();
  }
}

function drawOrders() {
  for (const unit of engine.scenario.units) {
    const order = unit.orders.find((item) => !item.completed && engine.elapsedMinutes >= Number(item.startMinute || 0));
    if (!order) continue;
    const start = mapToCanvas(unit.location);
    const end = mapToCanvas(order.destination);
    ctx.save();
    ctx.strokeStyle = unit.side === "Blue" ? "rgba(29, 111, 214, 0.42)" : "rgba(199, 58, 58, 0.42)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = unit.id === selectedUnitId ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
  }
}

function drawUnits() {
  const sorted = engine.scenario.units.slice().sort((a, b) => (a.side === "Red" ? 1 : -1) - (b.side === "Red" ? 1 : -1));
  for (const unit of sorted) {
    if (unit.state.strength <= 0) continue;
    const p = mapToCanvas(unit.location);
    const color = unit.side === "Blue" ? "#1d6fd6" : "#c73a3a";
    const radius = unit.domain === "air" ? 8 : getEchelonRank(unit.echelon) >= 5 ? 8 : 6;
    ctx.save();
    if (unit.id === selectedUnitId) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(22, 137, 135, 0.22)";
      ctx.fill();
      ctx.strokeStyle = "#168987";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    if (unit.domain === "air") {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - radius - 2);
      ctx.lineTo(p.x + radius + 2, p.y + radius);
      ctx.lineTo(p.x - radius - 2, p.y + radius);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const readiness = unit.state.readiness / 100;
    ctx.fillStyle = readiness > 0.7 ? "#ffffff" : readiness > 0.45 ? "#ffe9a8" : "#ffd0d0";
    ctx.fillRect(p.x - radius, p.y + radius + 4, radius * 2 * readiness, 3);
    if (unit.id === selectedUnitId || getEchelonRank(unit.echelon) >= 5) {
      ctx.fillStyle = "#17201d";
      ctx.font = "750 11px Inter, system-ui, sans-serif";
      ctx.fillText(unit.name.length > 18 ? `${unit.name.slice(0, 17)}.` : unit.name, p.x + 10, p.y + 4);
    }
    ctx.restore();
  }
}

function drawCellSelection() {
  if (!selectedCell) return;
  const p = mapToCanvas({ xKm: selectedCell.x, yKm: selectedCell.y + 1 });
  const size = (transform || fitTransform()).scale;
  ctx.save();
  ctx.strokeStyle = "#17201d";
  ctx.lineWidth = 2;
  ctx.strokeRect(p.x, p.y, size, size);
  ctx.restore();
}

function onPointerDown(event) {
  const point = pointerToCanvas(event);
  const unit = pickUnit(point);
  if (unit) {
    selectUnit(unit.id);
    if (engine.elapsedMinutes === 0) {
      dragUnitId = unit.id;
      dom.canvas.setPointerCapture(event.pointerId);
    }
  } else {
    const mapPoint = canvasToMap(point);
    selectedCell = cellFromMap(mapPoint);
    updateMapHint(selectedCell);
    needsDraw = true;
  }
}

function onPointerMove(event) {
  const point = pointerToCanvas(event);
  const mapPoint = canvasToMap(point);
  if (dragUnitId) {
    const unit = engine.getUnit(dragUnitId);
    if (unit && canPlaceUnit(unit, mapPoint)) {
      unit.location.xKm = mapPoint.xKm;
      unit.location.yKm = mapPoint.yKm;
      unit.location.time = engine.clock;
      if (engine.elapsedMinutes === 0 && unit.state?.initialLocation) {
        unit.state.initialLocation.xKm = mapPoint.xKm;
        unit.state.initialLocation.yKm = mapPoint.yKm;
      }
      engine.emitChange();
    }
    return;
  }
  const unit = pickUnit(point);
  if (unit) {
    dom.mapHint.textContent = `${unit.side} | ${unit.name} | ${statusText(unit)}`;
  } else {
    updateMapHint(cellFromMap(mapPoint));
  }
}

function onPointerUp(event) {
  if (dragUnitId && dom.canvas.hasPointerCapture?.(event.pointerId)) {
    dom.canvas.releasePointerCapture(event.pointerId);
  }
  dragUnitId = null;
}

function pointerToCanvas(event) {
  const rect = dom.canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function pickUnit(point) {
  let best = null;
  let bestDistance = Infinity;
  for (const unit of engine.scenario.units) {
    if (unit.state.strength <= 0) continue;
    const p = mapToCanvas(unit.location);
    const d = Math.hypot(point.x - p.x, point.y - p.y);
    if (d < 13 && d < bestDistance) {
      best = unit;
      bestDistance = d;
    }
  }
  return best;
}

function cellFromMap(point) {
  const cell = engine.getCellAt(point.xKm, point.yKm);
  return cell;
}

function updateMapHint(cell) {
  if (!cell) return;
  selectedCell = cell;
  const position = `${cell.center.xKm.toFixed(1)}, ${cell.center.yKm.toFixed(1)}`;
  const domain =
    cell.domain === "water"
      ? `wave ${number(cell.water?.waveHeightM, 1)}m / current ${number(cell.water?.currentKph, 1)} kph`
      : `alt ${number(cell.altitudeM)}m / access ${number(cell.accessibility * 100)}%`;
  dom.mapHint.textContent = `${cell.name} | ${position} | ${domain}`;
}

function canPlaceUnit(unit, point) {
  if (unit.domain === "air") return true;
  const area = engine.scenario.terrain.feasibleStartingAreas[unit.side];
  if (!area) return true;
  return (
    point.xKm >= area.bounds.xMin &&
    point.xKm <= area.bounds.xMax &&
    point.yKm >= area.bounds.yMin &&
    point.yKm <= area.bounds.yMax
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

init();
