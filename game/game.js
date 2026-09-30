/* Hill Rider — original 2D side-view hill climbing game.
   Plain JS + Canvas. Physics: two wheel contact points, spring suspension,
   air rotation, hard clamp so the car can never fall through terrain.
*/
(function () {
'use strict';

/* ---------------- setup ---------------- */
var canvas = document.getElementById('game');
var ctx = canvas.getContext('2d');
var W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize); resize();

var el = {
  dist: document.getElementById('dist'),
  best: document.getElementById('best'),
  coins: document.getElementById('coins'),
  fuelbar: document.getElementById('fuelbar'),
  fueltext: document.getElementById('fueltext'),
  statename: document.getElementById('statename'),
  debug: document.getElementById('debug'),
  overlay: document.getElementById('overlay'),
  title: document.getElementById('title'),
  msg: document.getElementById('msg'),
  mainbtn: document.getElementById('mainbtn'),
  garage: document.getElementById('garage'),
  upgrades: document.getElementById('upgrades'),
  garageclose: document.getElementById('garageclose'),
  gmsg: document.getElementById('gmsg'),
  soundbtn: document.getElementById('soundbtn'),
  garagebtn: document.getElementById('garagebtn'),
  gasPedal: document.getElementById('gasPedal'),
  brakePedal: document.getElementById('brakePedal'),
  hint: document.getElementById('hint')
};

function clamp(v, a, b) {
  if (!isFinite(v)) return 0;
  return v < a ? a : (v > b ? b : v);
}

/* ---------------- storage ---------------- */
var KEY = 'hillrider.save.v1';
var save = { best: 0, coins: 0, sound: true, upgrades: { engine: 0, suspension: 0, tank: 0 } };
function loadSave() {
  try {
    var raw = window.localStorage ? window.localStorage.getItem(KEY) : null;
    if (raw) {
      var s = JSON.parse(raw);
      if (s && typeof s === 'object') {
        save.best = +s.best || 0;
        save.coins = +s.coins || 0;
        save.sound = s.sound !== false;
        if (s.upgrades) {
          save.upgrades.engine = clamp(+s.upgrades.engine || 0, 0, 5);
          save.upgrades.suspension = clamp(+s.upgrades.suspension || 0, 0, 5);
          save.upgrades.tank = clamp(+s.upgrades.tank || 0, 0, 5);
        }
      }
    }
  } catch (e) { /* ignore */ }
}
function persist() {
  try { if (window.localStorage) window.localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}
loadSave();

/* ---------------- terrain ---------------- */
function hash(n) {
  var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function vnoise(x) {
  var i = Math.floor(x), f = x - i;
  var t = f * f * (3 - 2 * f);
  return hash(i) * (1 - t) + hash(i + 1) * t;
}
function difficulty(x) { return clamp(x / 1400, 0, 1); }

function groundY(x) {
  var d = difficulty(x);
  var base = 320;
  var y = base;
  y += 90 * vnoise(x / 140);            // long rolling hills
  y += 40 * vnoise(x / 47 + 13.5);      // medium bumps
  y += 14 * vnoise(x / 17 + 71.2) * (0.4 + d);
  if (x > 260) {
    var period = 320 - 120 * d;
    var seg = (x % period) / period;
    if (seg < 0.35) {
      var s = seg / 0.35;
      y -= 70 * d * s * s;              // ramp up
    } else if (seg > 0.62) {
      var s2 = (seg - 0.62) / 0.38;
      y += 40 * d * Math.sin(s2 * Math.PI);
    }
  }
  if (x < 60) y = base;                 // flat safe start
  return y;
}
function groundSlope(x) {
  var e = 0.75;
  return (groundY(x + e) - groundY(x - e)) / (2 * e);
}
function groundNormal(x) {
  var s = groundSlope(x);
  var len = Math.sqrt(1 + s * s);
  return { x: -s / len, y: -1 / len };   // unit normal, pointing up (negative y)
}

var WORLD_BOTTOM = 1400;

/* ---------------- car ---------------- */
var car = {};
function carStats() {
  var u = save.upgrades;
  return {
    torque: 900 + 160 * u.engine,
    maxSpeed: 26 + 3 * u.engine,
    springK: 1600 + 260 * u.suspension,
    damping: 190 + 30 * u.suspension,
    tank: 100 + 25 * u.tank,
    restLen: 26 - 2 * u.suspension
  };
}
function resetCar() {
  var st = carStats();
  var a0 = Math.atan(groundSlope(120));   // start already aligned with the terrain
  car = {
    x: 120, y: groundY(120) - st.restLen - 14,
    vx: 0, vy: 0, angle: a0, omega: 0,
    mass: 120, inertia: 1600,
    wheelBase: 62, wheelR: 16,
    contact: 0, fuel: st.tank, overturned: 0,
    wheelSpin: 0, airTime: 0, prevContact: 0
  };
}

/* ---------------- state ---------------- */
var state = 'drive';   // ready | drive | paused | over | garage
var runCoins = 0;
var camX = 0, camY = 0;
var input = { gas: false, brake: false };
var coins = [];
var fuels = [];
var particles = [];
var lastDebug = '';

function spawnCoins() {
  coins = [];
  for (var x = 180; x < 4200; x += 90) {
    if (hash(x / 90 + 3.3) > 0.55) {
      var lift = 26 + 34 * hash(x / 90 + 9.1);
      coins.push({ x: x, y: groundY(x) - lift, taken: false, spin: hash(x) * 6.28 });
    }
  }
  fuels = [];
  for (var x2 = 260; x2 < 4200; x2 += 210) {
    if (hash(x2 / 210 + 4.6) > 0.42) {
      fuels.push({ x: x2, y: groundY(x2) - 30, taken: false });
    }
  }
}

function restart() {
  resetCar(); spawnCoins(); runCoins = 0; particles = [];
  camX = car.x + 140; camY = car.y - 40;
  state = 'drive'; hideOverlay();
}
/* ---------------- sound ---------------- */
var actx = null, engineOsc = null, engineGain = null, masterGain = null;
function initAudio() {
  if (actx) return;
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    masterGain = actx.createGain(); masterGain.gain.value = save.sound ? 0.35 : 0.0;
    masterGain.connect(actx.destination);
    engineOsc = actx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineGain = actx.createGain(); engineGain.gain.value = 0.05;
    var lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    engineOsc.connect(engineGain); engineGain.connect(lp); lp.connect(masterGain);
    engineOsc.frequency.value = 60;
    engineOsc.start();
  } catch (e) { actx = null; }
}
function blip(freq, dur, vol, type) {
  if (!actx || !save.sound) return;
  try {
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'triangle'; o.frequency.value = freq;
    g.gain.value = vol;
    g.connect(masterGain); o.connect(g);
    var t = actx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* ignore */ }
}
function thud(v) {
  if (!actx || !save.sound) return;
  blip(90 + 60 * clamp(v, 0, 1), 0.18, clamp(0.12 + v * 0.2, 0.05, 0.35), 'square');
}

/* ---------------- physics ---------------- */
var G = 900;

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function physics(dt) {
  var st = carStats();
  var k = st.springK, damp = st.damping, restLen = st.restLen;
  var sa = Math.sin(car.angle), ca = Math.cos(car.angle);
  var upx = -sa, upy = -ca;   // body-up direction in screen coords (up = -y)

  /* suspension / ground contact: vertical spring force + real moment arm,
     so the chassis is rotated by the terrain it rides on */
  var totalUp = 0, totalTorque = 0, contactSum = 0;
  var arms = [-car.wheelBase / 2, car.wheelBase / 2];
  for (var i = 0; i < 2; i++) {
    var off = arms[i];
    var wx = car.x + off * ca;
    var wy = car.y + off * sa;
    var gy = groundY(wx);
    var travel = clamp(gy - (wy + car.wheelR), 0, restLen + 8);
    var f = 0;
    if (travel > 0) {
      var px = wx - car.x, py = wy - car.y;
      var arm = px * upy - py * upx;           // cross(up, wheelOffset)
      var wheelVelUp = (car.vy * upy + car.vx * upx) * 0.35 + car.omega * arm;
      wheelVelUp = clamp(wheelVelUp, -120, 120);
      f = k * travel - damp * wheelVelUp;
      if (f < 0) f = 0;
      if (f > 2600) f = 2600;                  // solver guard
      contactSum += 1;
    }
    totalUp += f;
    totalTorque += f * arm;
  }
  car.contact = contactSum;

  // gravity + spring response (linear + angular velocity integration)
  car.vy += G * dt;
  car.vy -= (totalUp / car.mass) * dt;
  if (contactSum > 0) {
    // torque that makes the chassis follow the terrain slope
    var target = wrapAngle(Math.atan(groundSlope(car.x)));
    var err = wrapAngle(target - car.angle);
    car.omega += (totalTorque / car.inertia) * dt + err * 1.2 * dt;
    car.omega -= car.omega * 4.2 * dt;
    car.omega = clamp(car.omega, -3, 3);
  } else {
    car.omega += (totalTorque / car.inertia) * dt;
    car.omega = clamp(car.omega, -4, 4);
  }

  // throttle / brake along slope tangent
  var driveForce = 0, brakeForce = 0;
  if (input.gas && contactSum > 0 && car.fuel > 0) driveForce = st.torque;
  if (input.brake && contactSum > 0) {
    brakeForce = -Math.sign(car.vx) * 700;
    if (Math.abs(car.vx) < 6) brakeForce = 0;
  }

  // fuel
  if (input.gas && contactSum > 0 && car.fuel > 0) {
    car.fuel -= dt * (0.9 + 0.25 * Math.abs(car.vx) / st.maxSpeed) * 1.4;
  } else {
    car.fuel -= dt * 0.18;
  }
  if (car.fuel <= 0) { car.fuel = 0; endRun('Out of fuel'); }

  if (contactSum > 0) {
    var n = groundNormal(car.x);
    var tx = -n.y, ty = n.x;
    var ff = driveForce + brakeForce;
    car.vx += (ff * tx / car.mass) * dt;
    car.vy += (ff * ty / car.mass) * dt;
    // keep wheels hugging the slope on steep hills
    var normalVel = car.vx * n.x + car.vy * n.y;
    if (normalVel > 0) {
      var corr = Math.min(normalVel, 220) * 3.5 * dt;
      car.vx -= n.x * corr; car.vy -= n.y * corr;
    }
    car.vx -= car.vx * 0.25 * dt;
    car.airTime = 0;
  } else {
    car.omega -= car.omega * 0.15 * dt;
    car.airTime += dt;
    if (input.gas) car.omega += 1.6 * dt;
    if (input.brake) car.omega -= 1.6 * dt;
  }

  // integrate translation AND rotation
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.angle = wrapAngle(car.angle + car.omega * dt);

  // hard clamp: wheels can never sink below terrain
  for (var j = 0; j < 2; j++) {
    var off2 = arms[j];
    var wx2 = car.x + off2 * ca;
    var wy2 = car.y + off2 * sa;
    var gy2 = groundY(wx2);
    if (wy2 + car.wheelR > gy2) {
      var push = (wy2 + car.wheelR) - gy2;
      car.y -= push;
      if (car.vy > 0) {
        if (car.vy > 220) thud(clamp(car.vy / 700, 0, 1));
        car.vy = -car.vy * 0.15;
      }
    }
  }
  if (car.y > groundY(car.x) - 8) { car.y = groundY(car.x) - 8; if (car.vy > 0) car.vy = 0; }

  // every state stays finite — NaN can never propagate into the debug readout
  car.x = clamp(car.x, -200, 1000000);
  car.y = clamp(car.y, -5000, WORLD_BOTTOM + 200);
  car.angle = wrapAngle(car.angle);

  // landing thud
  if (contactSum > 0 && car.prevContact === 0 && car.airTime > 0.3) {
    thud(clamp(Math.abs(car.vy) / 600, 0.15, 1));
  }
  car.prevContact = contactSum;

  // caps
  car.vx = clamp(car.vx, -12, st.maxSpeed);
  car.vy = clamp(car.vy, -800, 800);
  car.omega = clamp(car.omega, -4, 4);
  car.wheelSpin += (car.vx / car.wheelR) * dt;

  // overturned
  var cosA = Math.cos(car.angle);
  if (car.contact > 0 && cosA < -0.2) car.overturned += dt;
  else car.overturned = Math.max(0, car.overturned - dt * 0.5);
  if (car.overturned > 2.2) endRun('Car is upside down');
  if (car.y > WORLD_BOTTOM) endRun('Fell off the world');

  // coins
  for (var c = 0; c < coins.length; c++) {
    var co = coins[c];
    if (co.taken) continue;
    var dx = co.x - car.x, dy = co.y - car.y;
    if (dx * dx + dy * dy < 46 * 46) {
      co.taken = true; runCoins++;
      blip(880, 0.12, 0.16); blip(1320, 0.16, 0.12);
      for (var p = 0; p < 8; p++) {
        particles.push({ x: co.x, y: co.y, vx: (hash(p + co.spin) - 0.5) * 160, vy: -hash(p * 3 + co.spin) * 180, life: 0.6, c: '#ffd27a' });
      }
    }
  }

  // fuel canisters
  for (var fc = 0; fc < fuels.length; fc++) {
    var fu = fuels[fc];
    if (fu.taken) continue;
    var ddx = fu.x - car.x, ddy = fu.y - car.y;
    if (ddx * ddx + ddy * ddy < 52 * 52) {
      fu.taken = true;
      car.fuel = Math.min(carStats().tank, car.fuel + carStats().tank * 0.22);
      blip(520, 0.16, 0.16); blip(760, 0.2, 0.12);
      for (var fp = 0; fp < 8; fp++) {
        particles.push({ x: fu.x, y: fu.y, vx: (hash(fp + 2.2) - 0.5) * 150, vy: -hash(fp * 5 + 1.1) * 170, life: 0.6, c: '#8fd6a0' });
      }
    }
  }

  // particles
  for (var q = particles.length - 1; q >= 0; q--) {
    var pa = particles[q];
    pa.life -= dt; if (pa.life <= 0) { particles.splice(q, 1); continue; }
    pa.x += pa.vx * dt; pa.y += pa.vy * dt; pa.vy += 300 * dt;
  }
  if (car.contact > 0 && input.gas && car.fuel > 0 && hash(Math.floor(car.x)) > 0.6) {
    particles.push({ x: car.x - 34 * Math.cos(car.angle), y: car.y - 10, vx: -60, vy: -40, life: 0.5, c: '#c8d2dd' });
  }

  // distance / best
  var dist = Math.max(0, Math.floor(car.x - 120));
  if (dist > save.best) { save.best = dist; persist(); }

  // camera
  camX += (car.x + 140 - camX) * Math.min(1, dt * 3.5);
  camY += (car.y - 40 - camY) * Math.min(1, dt * 3.5);
  camY = Math.min(camY, 220);
}

function endRun(reason) {
  if (state === 'over') return;
  state = 'over';
  save.coins += runCoins; runCoins = 0;
  persist();
  showOverlay('Game over', reason + ' — run: ' + Math.max(0, Math.floor(car.x - 120)) + ' m, coins: ' + runCoins, 'Restart (R)');
  blip(220, 0.4, 0.2, 'sawtooth');
}

/* ---------------- UI ---------------- */
function showOverlay(t, m, btn) {
  el.title.textContent = t; el.msg.textContent = m; el.mainbtn.textContent = btn;
  el.overlay.classList.remove('hidden');
}
function hideOverlay() { el.overlay.classList.add('hidden'); }

el.mainbtn.addEventListener('click', function () {
  initAudio();
  if (state === 'over') { save.coins += runCoins; persist(); restart(); }
  else if (state === 'ready' || state === 'paused') { state = 'drive'; hideOverlay(); }
});
el.garageclose.addEventListener('click', function () {
  el.garage.classList.add('hidden');
  if (state === 'garage') state = 'drive';
});
function updateSoundBtn() { el.soundbtn.textContent = 'SOUND: ' + (save.sound ? 'ON' : 'OFF'); }
el.soundbtn.addEventListener('click', function () {
  save.sound = !save.sound; persist(); updateSoundBtn();
  if (save.sound) { initAudio(); if (masterGain) masterGain.gain.value = 0.35; blip(660, 0.1, 0.15); }
  else if (masterGain) masterGain.gain.value = 0;
});
updateSoundBtn();

var UPG = [
  { key: 'engine', name: 'Engine', cost: function (lv) { return 15 + lv * 12; } },
  { key: 'suspension', name: 'Suspension', cost: function (lv) { return 12 + lv * 10; } },
  { key: 'tank', name: 'Fuel tank', cost: function (lv) { return 10 + lv * 9; } }
];
function renderGarage() {
  el.upgrades.innerHTML = '';
  el.gmsg.textContent = 'Coins banked: ' + save.coins + '. Upgrades saved locally. Best: ' + save.best + ' m.';
  UPG.forEach(function (u) {
    var lv = save.upgrades[u.key];
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'upg';
    b.innerHTML = u.name + ' lv ' + lv + (lv >= 5 ? ' (max)' : '<span>' + u.cost(lv) + ' coins</span>');
    b.setAttribute('data-upgrade', u.key);
    b.disabled = lv >= 5 || save.coins < u.cost(lv);
    b.addEventListener('click', function () {
      if (lv >= 5 || save.coins < u.cost(lv)) return;
      save.coins -= u.cost(lv); save.upgrades[u.key]++; persist();
      blip(700, 0.15, 0.18); renderGarage();
    });
    el.upgrades.appendChild(b);
  });
}
el.garagebtn.addEventListener('click', function () {
  state = 'garage';
  el.garage.classList.remove('hidden');
  renderGarage();
});

window.addEventListener('keydown', function (e) {
  var k = (e.key || '').toLowerCase();
  if (k === 'arrowright' || k === 'd') { input.gas = true; el.gasPedal.classList.add('active'); e.preventDefault(); }
  if (k === 'arrowleft' || k === 'a') { input.brake = true; el.brakePedal.classList.add('active'); e.preventDefault(); }
  if (k === 'p') togglePause();
  if (k === 'r') { initAudio(); restart(); }
  if (k === 'm') el.soundbtn.click();
  if (k === 'g') el.garagebtn.click();
});
window.addEventListener('keyup', function (e) {
  var k = (e.key || '').toLowerCase();
  if (k === 'arrowright' || k === 'd') { input.gas = false; el.gasPedal.classList.remove('active'); }
  if (k === 'arrowleft' || k === 'a') { input.brake = false; el.brakePedal.classList.remove('active'); }
});
function bindPedal(btn, flag) {
  function on(e) { e.preventDefault(); input[flag] = true; btn.classList.add('active'); initAudio(); }
  function off() { input[flag] = false; btn.classList.remove('active'); }
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('pointercancel', off);
}
bindPedal(el.gasPedal, 'gas');
bindPedal(el.brakePedal, 'brake');
window.addEventListener('pointerdown', function () { initAudio(); }, { once: true });

function togglePause() {
  if (state === 'drive') {
    state = 'paused';
    save.coins += runCoins; runCoins = 0; persist();
    showOverlay('Paused', 'press P to continue, R to restart', 'Continue');
  } else if (state === 'paused') { state = 'drive'; hideOverlay(); }
}

/* ---------------- drawing ---------------- */
function worldToScreen(wx, wy) { return { x: wx - camX + W / 2, y: wy - camY + H / 2 }; }

function drawSky() {
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#24344f');
  g.addColorStop(0.55, '#3b5876');
  g.addColorStop(1, '#6f8b9a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  var sx = W * 0.8, sy = H * 0.18;
  ctx.fillStyle = 'rgba(255,225,160,.75)';
  ctx.beginPath(); ctx.arc(sx, sy, 34, 0, 6.283); ctx.fill();
  ctx.fillStyle = 'rgba(255,225,160,.14)';
  ctx.beginPath(); ctx.arc(sx, sy, 70, 0, 6.283); ctx.fill();

  drawParallax(0.25, '#2f4660', 0.55, 120);
  drawParallax(0.5, '#35516a', 0.75, 90);

  for (var i = 0; i < 5; i++) {
    var cx = ((i * 371 - camX * 0.18) % (W + 260) + W + 260) % (W + 260) - 130;
    var cy = 60 + i * 34 + 40 * hash(i * 7.7);
    ctx.fillStyle = 'rgba(240,246,252,.13)';
    puff(cx, cy, 46 + 18 * hash(i + 2.1));
  }
}
function puff(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 6.283);
  ctx.arc(x + r * 0.8, y + 6, r * 0.7, 0, 6.283);
  ctx.arc(x - r * 0.8, y + 8, r * 0.6, 0, 6.283);
  ctx.fill();
}
function drawParallax(par, color, yBase, amp) {
  ctx.fillStyle = color;
  ctx.beginPath();
  var ox = -camX * par;
  ctx.moveTo(0, H);
  for (var px = 0; px <= W; px += 16) {
    var wx = px - W * 0.5;
    var t = (wx + ox) / 300;
    var y = H * yBase - amp * (0.5 + 0.5 * Math.sin(t * 1.7) + 0.35 * vnoise((wx + ox) / 220 + 5.5));
    ctx.lineTo(px, y);
  }
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
}

function drawTerrain() {
  var start = camX - W / 2 - 40, end = camX + W / 2 + 40;
  var first = worldToScreen(start, groundY(start));
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (var x = start; x <= end; x += 8) {
    var p = worldToScreen(x, groundY(x));
    ctx.lineTo(p.x, p.y);
  }
  var lastP = worldToScreen(end, groundY(end));
  ctx.lineTo(lastP.x, H + 200); ctx.lineTo(first.x, H + 200); ctx.closePath();
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#4a7c46');
  g.addColorStop(1, '#2c4a32');
  ctx.fillStyle = g; ctx.fill();

  ctx.strokeStyle = '#69b05f'; ctx.lineWidth = 4;
  ctx.beginPath();
  for (var x2 = start; x2 <= end; x2 += 8) {
    var p2 = worldToScreen(x2, groundY(x2));
    if (x2 === start) ctx.moveTo(p2.x, p2.y); else ctx.lineTo(p2.x, p2.y);
  }
  ctx.stroke();

  for (var tx = Math.floor(start / 120) * 120; tx < end; tx += 120) {
    if (tx < 200) continue;
    var h = hash(tx / 120 + 1.7);
    if (h < 0.5) continue;
    var sp = worldToScreen(tx, groundY(tx));
    drawTree(sp.x, sp.y, 26 + 26 * h, h);
  }

  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.font = '11px monospace';
  for (var m = Math.ceil(start / 100) * 100; m < end; m += 100) {
    if (m < 100) continue;
    var mp = worldToScreen(m, groundY(m));
    if (mp.y > H + 20) continue;
    ctx.fillRect(mp.x - 1, mp.y - 34, 2, 30);
    ctx.fillText((m - 120) + 'm', mp.x + 4, mp.y - 24);
  }
}
function drawTree(x, y, size, h) {
  ctx.strokeStyle = '#6b5335'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - size); ctx.stroke();
  ctx.fillStyle = h > 0.75 ? '#3d7a44' : '#458751';
  ctx.beginPath(); ctx.arc(x, y - size - size * 0.45, size * 0.55, 0, 6.283); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.beginPath(); ctx.arc(x - size * 0.18, y - size - size * 0.55, size * 0.28, 0, 6.283); ctx.fill();
}

function drawCoins() {
  for (var i = 0; i < coins.length; i++) {
    var c = coins[i];
    if (c.taken) continue;
    var p = worldToScreen(c.x, c.y);
    if (p.x < -40 || p.x > W + 40) continue;
    var wob = Math.sin(c.spin + performance.now() / 300) * 3;
    ctx.save();
    ctx.translate(p.x, p.y + wob);
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath(); ctx.ellipse(0, 0, 10, 12, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#e8a93f';
    ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 8, 0, 0, 6.283); ctx.fill();
    ctx.restore();
  }
}

function drawFuel() {
  for (var i = 0; i < fuels.length; i++) {
    var f = fuels[i];
    if (f.taken) continue;
    var p = worldToScreen(f.x, f.y);
    if (p.x < -40 || p.x > W + 40) continue;
    ctx.fillStyle = '#2f3a45';
    ctx.fillRect(p.x - 9, p.y - 12, 18, 24);
    ctx.fillStyle = '#e0553f';
    ctx.fillRect(p.x - 9, p.y - 4, 18, 16);
    ctx.fillStyle = '#8fd6a0';
    ctx.fillRect(p.x - 3, p.y - 16, 6, 4);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.fillRect(p.x - 6, p.y - 2, 3, 10);
  }
}

function drawParticles() {
  for (var i = 0; i < particles.length; i++) {
    var p = particles[i];
    var s = worldToScreen(p.x, p.y);
    ctx.globalAlpha = clamp(p.life / 0.6, 0, 1);
    ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCar() {
  var s = worldToScreen(car.x, car.y);
  var sa = Math.sin(car.angle), ca = Math.cos(car.angle);
  var st = carStats();

  ctx.save();
  ctx.translate(s.x, s.y);

  // ground shadow (world aligned)
  var gy = groundY(car.x);
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath(); ctx.ellipse(0, gy - car.y, 46, 8, 0, 0, 6.283); ctx.fill();

  ctx.rotate(car.angle);

  // suspension struts + springs, drawn per wheel using real travel
  for (var i = 0; i < 2; i++) {
    var off = (i === 0 ? -car.wheelBase / 2 : car.wheelBase / 2);
    var travel = clamp(groundY(car.x + off * ca) - (car.y + off * sa + car.wheelR), 0, st.restLen + 8);
    var len = st.restLen + 8 - travel;          // current strut length
    ctx.strokeStyle = '#8d99a8'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(off, -2); ctx.lineTo(off, len - 2); ctx.stroke();
    ctx.strokeStyle = '#a9b6c4'; ctx.lineWidth = 2;
    for (var w = 0; w < 4; w++) {
      var yy = 1 + w * (len - 4) / 4;
      ctx.beginPath(); ctx.moveTo(off - 4, yy); ctx.lineTo(off + 4, yy + 2); ctx.stroke();
    }
  }

  // body
  ctx.fillStyle = '#e0553f';
  ctx.strokeStyle = '#8f3225'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-34, -4); ctx.lineTo(-30, -18); ctx.lineTo(-10, -20);
  ctx.lineTo(6, -26); ctx.lineTo(22, -26); ctx.lineTo(30, -12);
  ctx.lineTo(34, -4); ctx.lineTo(26, 2); ctx.lineTo(-26, 2);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  ctx.fillStyle = 'rgba(180,220,240,.85)';
  ctx.beginPath();
  ctx.moveTo(-8, -19); ctx.lineTo(4, -24); ctx.lineTo(18, -24); ctx.lineTo(18, -12); ctx.lineTo(-8, -12);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = '#f2c9a0';
  ctx.beginPath(); ctx.arc(6, -17, 5.5, 0, 6.283); ctx.fill();
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath(); ctx.arc(6, -19, 5.5, Math.PI, 2 * Math.PI); ctx.fill();

  ctx.fillStyle = '#7c8894';
  ctx.fillRect(-40, -10, 8, 4);

  // wheels
  for (var j = 0; j < 2; j++) {
    var off2 = (j === 0 ? -car.wheelBase / 2 : car.wheelBase / 2);
    var travel2 = clamp(groundY(car.x + off2 * ca) - (car.y + off2 * sa + car.wheelR), 0, st.restLen + 8);
    var wy = (st.restLen + 8 - travel2) + car.wheelR - 4;
    ctx.save();
    ctx.translate(off2, wy);
    ctx.rotate(car.wheelSpin);
    ctx.fillStyle = '#23282e';
    ctx.beginPath(); ctx.arc(0, 0, car.wheelR, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#5d6a76';
    ctx.beginPath(); ctx.arc(0, 0, car.wheelR * 0.55, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#39424c'; ctx.lineWidth = 2;
    for (var sp = 0; sp < 5; sp++) {
      var a = sp * 6.283 / 5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * car.wheelR * 0.5, Math.sin(a) * car.wheelR * 0.5); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawDebug() {
  var speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);
  var d = 'dist ' + Math.max(0, Math.floor(car.x - 120)) + 'm | speed ' + speed.toFixed(1) +
          ' | fuel ' + Math.round(car.fuel) + '% | coins ' + runCoins + ' | state ' + state +
          ' | angle ' + (car.angle * 57.295).toFixed(1) + 'deg | omega ' + car.omega.toFixed(2) +
          ' | contact ' + car.contact;
  if (d !== lastDebug) { el.debug.textContent = d; lastDebug = d; }
}

function drawHUDValues() {
  el.dist.textContent = Math.max(0, Math.floor(car.x - 120)) + ' m';
  el.best.textContent = save.best + ' m';
  el.coins.textContent = runCoins + ' (bank ' + save.coins + ')';
  var pct = clamp(car.fuel / carStats().tank, 0, 1);
  el.fuelbar.style.width = (pct * 100).toFixed(1) + '%';
  el.fueltext.textContent = 'fuel ' + Math.round(car.fuel) + '%';
  el.statename.textContent = state;
}

/* ---------------- loop ---------------- */
var last = performance.now();
var acc = 0;
var FIXED = 1 / 120;

function frame(now) {
  var dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'drive') {
    acc += dt;
    var guard = 0;
    while (acc >= FIXED && guard < 12) { physics(FIXED); acc -= FIXED; guard++; }
    if (actx && save.sound && engineGain) {
      engineOsc.frequency.value = 60 + Math.abs(car.vx) * 9 + (input.gas ? 40 : 0);
      engineGain.gain.value = input.gas && car.contact > 0 ? 0.09 : 0.035;
    }
  }
  drawSky();
  drawTerrain();
  drawCoins();
  drawFuel();
  drawParticles();
  drawCar();
  drawHUDValues();
  drawDebug();
  requestAnimationFrame(frame);
}

resetCar(); spawnCoins();
camX = car.x + 140; camY = car.y - 40;
showOverlay('Ready to drive', 'Gas: Right / D — or press pedals on touch screens. P pause, R restart, M sound, G garage.', 'Start driving');
state = 'ready';
requestAnimationFrame(frame);

window.hillrider = { car: car, state: function () { return state; }, debug: function () { return el.debug.textContent; } };
})();
