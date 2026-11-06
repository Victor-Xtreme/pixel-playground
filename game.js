// THEME: Replace these colors and nouns after the theme roulette.
const THEME = {
  background: "#0b1426", grid: "#1b2a43", player: "#70edcf",
  collectible: "#ffdc76", hazard: "#ff778e", collectiblePlural: "sparks"
};

// RULES: Speeds are in Canvas pixels per second.
const RULES = {
  playerSpeed: 270, playerAcceleration: 900, playerFriction: 720,
  hazardSpeed: 115, speedPerLevel: 22, maxHazardSpeed: 235,
  hazardAcceleration: 90, steeringHazardCount: 4,
  directionalPulseReach: 28, directionalPulseRearWidth: 6,
  directionalPulseFrontWidth: 28, directionalPulseLifetime: 0.2,
  slowFactor: 0.5, slowDuration: 5,
  radialPulseRadius: 360, radialPulseLifetime: 0.45,
  powerPerHit: 5, hungerDrainRate: 1, hungerPerSpark: 7,
  pointsPerLevel: 5, maxHazards: 8
};

const canvas = document.querySelector("#arena");
const ctx = canvas.getContext("2d");
const { width, height } = canvas;
const overlay = document.querySelector("#overlay");
const action = document.querySelector("#action");
const scoreLabel = document.querySelector("#score");
const levelLabel = document.querySelector("#level");
const bestLabel = document.querySelector("#best");
const powerBar = document.querySelector("#power-bar");
const powerValue = document.querySelector("#power-value");
const hungerBar = document.querySelector("#hunger-bar");
const hungerValue = document.querySelector("#hunger-value");
const panelDetail = document.querySelector("#panel-detail");
const panelTitle = document.querySelector("#panel-title");
const status = document.querySelector("#status");
const controls = ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"];
const keys = new Set();
const touches = new Map();
const storageKey = "pixel-playground-best";

let state = "ready";
let player, collectible, hazards, pulses, radialPulses, score, level, power, hunger;
let best = 0;
let lastTime;
let elapsedTime = 0;
let lastInputX = 0;
let lastInputY = 0;

try {
  best = Number(localStorage.getItem(storageKey)) || 0;
} catch {
  // The best score still works for this page if storage is disabled.
}

function resetRound() {
  player = { x: width / 2, y: height / 2, size: 26, vx: 0, vy: 0 };
  elapsedTime = 0;
  lastInputX = 0;
  lastInputY = 0;
  pulses = [];
  radialPulses = [];
  hazards = [];
  collectible = undefined;
  score = 0;
  level = 1;
  power = 0;
  hunger = 50;
  addHazard();
  addHazard();
  placeCollectible();
  updateHud();
}

function updateHud() {
  scoreLabel.textContent = score;
  levelLabel.textContent = level;
  bestLabel.textContent = best;
  powerBar.value = power;
  powerValue.textContent = `${Math.floor(power)}%`;
  hungerBar.value = hunger;
  hungerValue.textContent = `${Math.ceil(hunger)}%`;
}

function startRound() {
  clearInput();
  resetRound();
  state = "playing";
  lastTime = undefined;
  overlay.hidden = true;
  canvas.focus();
}

function endRound() {
  state = "over";
  clearInput();
  status.textContent = "RUN COMPLETE";
  panelTitle.textContent = "Drone collision!";
  panelDetail.textContent = `Score ${score} · Level ${level} · Best ${best}`;
  action.textContent = "Play again";
  overlay.hidden = false;
  action.focus();
}

// All positions describe the center of an object.
function overlaps(a, b, gap = 0) {
  const reach = (a.size + b.size) / 2 + gap;
  return Math.abs(a.x - b.x) < reach && Math.abs(a.y - b.y) < reach;
}

function playerHitboxes() {
  // Four overlapping half-depth strips expose cardinal contact sides.
  const half = player.size / 2;
  const sideDepth = half;
  return {
    up: { x: player.x, y: player.y - half / 2, width: player.size, height: sideDepth },
    right: { x: player.x + half / 2, y: player.y, width: sideDepth, height: player.size },
    down: { x: player.x, y: player.y + half / 2, width: player.size, height: sideDepth },
    left: { x: player.x - half / 2, y: player.y, width: sideDepth, height: player.size }
  };
}

function overlapsHitbox(hitbox, object) {
  const half = object.size / 2;
  return Math.abs(hitbox.x - object.x) < (hitbox.width + object.size) / 2 &&
    Math.abs(hitbox.y - object.y) < (hitbox.height + object.size) / 2;
}

function overlappingSides(hitboxes, object) {
  return Object.keys(hitboxes).filter(side => overlapsHitbox(hitboxes[side], object));
}

function updateInputDirection(dx, dy) {
  if (!dx && !dy) return;
  const reversedX = dx && lastInputX && Math.sign(dx) !== lastInputX;
  const reversedY = dy && lastInputY && Math.sign(dy) !== lastInputY;
  if (reversedX || reversedY) fireDirectionalPulse(dx, dy);
  lastInputX = Math.sign(dx) || lastInputX;
  lastInputY = Math.sign(dy) || lastInputY;
}

function fireDirectionalPulse(dx, dy) {
  const magnitude = Math.hypot(dx, dy) || 1;
  const ux = dx / magnitude;
  const uy = dy / magnitude;
  pulses.push({
    x: player.x,
    y: player.y,
    ux,
    uy,
    age: 0,
    resolved: false
  });
}

function pulseVertices(pulse, scale = 1) {
  const px = -pulse.uy;
  const py = pulse.ux;
  const rear = player.size / 2;
  const front = rear + RULES.directionalPulseReach * scale;
  const rearHalfWidth = RULES.directionalPulseRearWidth / 2;
  const frontHalfWidth = RULES.directionalPulseFrontWidth / 2 * scale;
  return [
    [pulse.x + pulse.ux * rear + px * rearHalfWidth, pulse.y + pulse.uy * rear + py * rearHalfWidth],
    [pulse.x + pulse.ux * front + px * frontHalfWidth, pulse.y + pulse.uy * front + py * frontHalfWidth],
    [pulse.x + pulse.ux * front - px * frontHalfWidth, pulse.y + pulse.uy * front - py * frontHalfWidth],
    [pulse.x + pulse.ux * rear - px * rearHalfWidth, pulse.y + pulse.uy * rear - py * rearHalfWidth]
  ];
}

function polygonsOverlap(a, b) {
  const axes = [[1, 0], [0, 1]];
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i += 1) {
      const [x1, y1] = polygon[i];
      const [x2, y2] = polygon[(i + 1) % polygon.length];
      axes.push([-(y2 - y1), x2 - x1]);
    }
  }
  return axes.every(([axisX, axisY]) => {
    const project = polygon => polygon.map(([x, y]) => x * axisX + y * axisY);
    const aProjection = project(a);
    const bProjection = project(b);
    return Math.max(...aProjection) >= Math.min(...bProjection) &&
      Math.max(...bProjection) >= Math.min(...aProjection);
  });
}

function hazardTouchesPulse(pulse, hazard) {
  const half = hazard.size / 2;
  const hazardCorners = [
    [hazard.x - half, hazard.y - half], [hazard.x + half, hazard.y - half],
    [hazard.x - half, hazard.y + half], [hazard.x + half, hazard.y + half]
  ];
  return polygonsOverlap(pulseVertices(pulse), hazardCorners);
}

function resolveDirectionalPulses(dt) {
  for (const pulse of pulses) {
    if (!pulse.resolved) {
      const target = hazards
        .filter(hazard => hazardTouchesPulse(pulse, hazard))
        .sort((a, b) => Math.hypot(a.x - pulse.x, a.y - pulse.y) - Math.hypot(b.x - pulse.x, b.y - pulse.y))[0];
      if (target) {
        if (elapsedTime >= (target.slowUntil ?? -Infinity)) {
          target.vx *= RULES.slowFactor;
          target.vy *= RULES.slowFactor;
        }
        target.slowUntil = elapsedTime + RULES.slowDuration;
        if (overlappingSides(playerHitboxes(), target).length) target.pulseContact = true;
        power = Math.min(100, power + RULES.powerPerHit);
        updateHud();
      }
      pulse.resolved = true;
    }
    pulse.age += dt;
  }
  pulses = pulses.filter(pulse => pulse.age < RULES.directionalPulseLifetime);
}

function fireRadialPulse() {
  if (power < 100) return;
  power = 0;
  hazards = hazards.filter(hazard => Math.hypot(hazard.x - player.x, hazard.y - player.y) > RULES.radialPulseRadius);
  radialPulses.push({ x: player.x, y: player.y, age: 0 });
  updateHud();
}

function openSpot(size, blockers, gap) {
  // Scan a grid so placement always finishes, even when the arena gets busy.
  const spots = [];
  for (let y = 24; y <= height - 24; y += 28) {
    for (let x = 24; x <= width - 24; x += 28) {
      const spot = { x, y, size };
      if (blockers.every(blocker => !overlaps(spot, blocker, gap))) spots.push(spot);
    }
  }
  return spots[Math.floor(Math.random() * spots.length)];
}

function addHazard() {
  const blockers = collectible ? [player, collectible, ...hazards] : [player, ...hazards];
  const spot = openSpot(28, blockers, 50) ?? openSpot(28, blockers, 0);
  if (!spot) return;
  const angle = Math.random() * Math.PI * 2;
  const speed = Math.min(RULES.maxHazardSpeed, RULES.hazardSpeed + (level - 1) * RULES.speedPerLevel);
  hazards.push({
    ...spot,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed
  });
}

function placeCollectible() {
  const blockers = [player, ...hazards];
  collectible = openSpot(22, blockers, 20) ?? openSpot(22, blockers);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function movePlayer(dt) {
  const held = key => keys.has(key) || [...touches.values()].includes(key);
  let dx = Number(held("arrowright") || held("d")) - Number(held("arrowleft") || held("a"));
  let dy = Number(held("arrowdown") || held("s")) - Number(held("arrowup") || held("w"));
  updateInputDirection(dx, dy);
  // Normalize input so diagonal acceleration matches movement on one axis.
  const inputLength = Math.hypot(dx, dy) || 1;
  dx /= inputLength;
  dy /= inputLength;
  if (dx || dy) {
    player.vx += dx * RULES.playerAcceleration * dt;
    player.vy += dy * RULES.playerAcceleration * dt;
  } else {
    const speed = Math.hypot(player.vx, player.vy);
    const reducedSpeed = Math.max(0, speed - RULES.playerFriction * dt);
    if (speed > 0) {
      player.vx *= reducedSpeed / speed;
      player.vy *= reducedSpeed / speed;
    }
  }
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > RULES.playerSpeed) {
    player.vx *= RULES.playerSpeed / speed;
    player.vy *= RULES.playerSpeed / speed;
  }
  const edge = player.size / 2;
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  if (player.x < edge || player.x > width - edge) player.vx = 0;
  if (player.y < edge || player.y > height - edge) player.vy = 0;
  player.x = clamp(player.x, edge, width - edge);
  player.y = clamp(player.y, edge, height - edge);
}

function moveHazards(dt) {
  const baseSpeed = Math.min(RULES.maxHazardSpeed, RULES.hazardSpeed + (level - 1) * RULES.speedPerLevel);
  for (const hazard of hazards) {
    const slowed = elapsedTime < (hazard.slowUntil ?? -Infinity);
    const speed = baseSpeed * (slowed ? RULES.slowFactor : 1);
    const edge = hazard.size / 2;
    const currentSpeed = Math.hypot(hazard.vx, hazard.vy) || speed;
    const speedGain = Math.min(speed - currentSpeed, RULES.hazardAcceleration * dt);
    if (speedGain > 0) {
      hazard.vx += hazard.vx / currentSpeed * speedGain;
      hazard.vy += hazard.vy / currentSpeed * speedGain;
    }
    // Once four hazards are active, each drone gradually steers toward the player.
    if (hazards.length >= RULES.steeringHazardCount) {
      const dx = player.x - hazard.x;
      const dy = player.y - hazard.y;
      const distance = Math.hypot(dx, dy) || 1;
      hazard.vx += dx / distance * RULES.hazardAcceleration * dt;
      hazard.vy += dy / distance * RULES.hazardAcceleration * dt;
    }
    const hazardSpeed = Math.hypot(hazard.vx, hazard.vy);
    if (hazardSpeed > speed) {
      hazard.vx *= speed / hazardSpeed;
      hazard.vy *= speed / hazardSpeed;
    }
    hazard.x += hazard.vx * dt;
    hazard.y += hazard.vy * dt;
    if (hazard.x < edge || hazard.x > width - edge) hazard.vx *= -1;
    if (hazard.y < edge || hazard.y > height - edge) hazard.vy *= -1;
    hazard.x = clamp(hazard.x, edge, width - edge);
    hazard.y = clamp(hazard.y, edge, height - edge);
  }
}

function update(dt) {
  elapsedTime += dt;
  hunger = Math.max(0, hunger - RULES.hungerDrainRate * dt);
  updateHud();
  movePlayer(dt);
  moveHazards(dt);
  resolveDirectionalPulses(dt);
  radialPulses = radialPulses.filter(pulse => {
    pulse.age += dt;
    return pulse.age < RULES.radialPulseLifetime;
  });
  const sides = playerHitboxes();
  const fatalCollision = hazards.some(hazard => {
    const touchedSides = overlappingSides(sides, hazard);
    if (!touchedSides.length) {
      hazard.pulseContact = false;
      return false;
    }
    return !hazard.pulseContact;
  });
  if (fatalCollision) {
    endRound();
    return;
  }
  if (collectible && overlaps(player, collectible)) {
    score += 1;
    hunger = Math.min(100, hunger + RULES.hungerPerSpark);
    if (score > best) {
      best = score;
      try {
        localStorage.setItem(storageKey, best);
      } catch {
        // Keep the in-memory score.
      }
    }
    if (score % RULES.pointsPerLevel === 0) {
      level += 1;
      if (hazards.length < RULES.maxHazards) addHazard();
    }
    placeCollectible();
    updateHud();
  }
}

function drawSquare(object, color) {
  ctx.fillStyle = color;
  const half = object.size / 2;
  ctx.fillRect(object.x - half, object.y - half, object.size, object.size);
}

function draw() {
  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = THEME.grid;
  for (let x = 0; x < width; x += 24) ctx.fillRect(x, 0, 1, height);
  for (let y = 0; y < height; y += 24) ctx.fillRect(0, y, width, 1);

  if (collectible) {
    ctx.save();
    ctx.translate(collectible.x, collectible.y);
    ctx.rotate(Math.PI / 4);
    drawSquare({ x: 0, y: 0, size: collectible.size / Math.SQRT2 }, THEME.collectible);
    ctx.restore();
  }
  for (const hazard of hazards) {
    drawSquare(hazard, THEME.hazard);
    ctx.fillStyle = THEME.background;
    ctx.font = "bold 22px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("×", hazard.x, hazard.y + 1);
  }
  for (const pulse of pulses) {
    const progress = pulse.age / RULES.directionalPulseLifetime;
    const vertices = pulseVertices(pulse, 0.75 + progress * 0.25);
    ctx.beginPath();
    ctx.moveTo(...vertices[0]);
    for (const [x, y] of vertices.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.globalAlpha = 0.3 + (1 - progress) * 0.45;
    ctx.fillStyle = THEME.collectible;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = THEME.collectible;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  for (const pulse of radialPulses) {
    const progress = pulse.age / RULES.radialPulseLifetime;
    ctx.beginPath();
    ctx.arc(pulse.x, pulse.y, RULES.radialPulseRadius * progress, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 220, 118, ${1 - progress})`;
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  drawSquare(player, THEME.player);
  ctx.fillStyle = THEME.background;
  ctx.fillRect(player.x - 7, player.y - 4, 4, 5);
  ctx.fillRect(player.x + 3, player.y - 4, 4, 5);
}

function frame(time) {
  // Cap the step after interruptions to avoid jumping across the arena.
  const dt = lastTime === undefined ? 0 : Math.min((time - lastTime) / 1000, 0.033);
  lastTime = time;
  if (state === "playing" && !document.hidden) update(dt);
  draw();
  requestAnimationFrame(frame);
}

function clearInput() {
  keys.clear();
  touches.clear();
}

action.addEventListener("click", startRound);
window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  if (state !== "playing" || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (!event.repeat) fireRadialPulse();
    return;
  }
  if (!controls.includes(key)) return;
  event.preventDefault();
  keys.add(key);
});
window.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", clearInput);
document.addEventListener("visibilitychange", clearInput);
for (const button of document.querySelectorAll("[data-key]")) {
  button.addEventListener("pointerdown", event => {
    if (state !== "playing") return;
    button.setPointerCapture(event.pointerId);
    touches.set(event.pointerId, button.dataset.key);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(name, event => touches.delete(event.pointerId));
  }
}

panelDetail.textContent = `Grab ${RULES.pointsPerLevel} ${THEME.collectiblePlural} to reach the next level.`;
resetRound();
requestAnimationFrame(frame);
