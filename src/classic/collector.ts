/** Original vertical collector. Music analysis drives spawning; no recorded audio or assets. */
type Point = { x: number; y: number };
type Shape = Point & {
  radius: number;
  hue: number;
  sides: number;
  hazard: boolean;
  angle: number;
  done?: boolean;
};
type Tail = Point & { age: number };
type Particle = Point & { vx: number; vy: number; age: number; red: boolean };
export function createCollector(onPulse: () => void = () => {}) {
  const run = {
    x: 0.5,
    y: 0.7,
    targetX: 0.5,
    targetY: 0.7,
    score: 0,
    best: 0,
    mass: 3,
    combo: 0,
    invulnerable: 0,
    respawn: 0,
    slow: 0,
    charge: 0,
    cooldown: 0,
    speed: 0.3,
    energy: 0,
    time: 0,
    distance: 0,
    sequence: 0,
    held: false,
    objects: [] as Shape[],
    tail: [] as Tail[],
    particles: [] as Particle[],
    waves: [] as (Point & { age: number; radius: number })[],
  };
  let width = 960,
    height = 600;
  const clamp = (v: number, a: number, b: number) =>
    Math.max(a, Math.min(b, v));
  const radius = () => 6 + Math.sqrt(run.mass) * 3;
  function burst(x: number, y: number, red = false, count = 12) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2,
        v = 0.04 + Math.random() * 0.17;
      run.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        age: 0,
        red,
      });
    }
  }
  function die() {
    burst(run.x, run.y, true, 55);
    run.respawn = 2;
    run.mass = 0;
    run.charge = 0;
    run.held = false;
    run.tail = [];
  }
  function collect(o: Shape) {
    if (o.done) return;
    o.done = true;
    run.combo++;
    run.score +=
      (o.radius < 48 ? 30 : 10) * Math.min(5, 1 + Math.floor(run.combo / 15));
    run.best = Math.max(run.best, run.score);
    run.mass = Math.min(16, run.mass + 0.21);
    burst(o.x, o.y);
  }
  function hit(o: Shape) {
    o.done = true;
    burst(o.x, o.y, true, 35);
    if (run.invulnerable > 0 || run.respawn > 0) return;
    run.mass = Math.max(0, run.mass - 2.5);
    run.score = Math.max(0, run.score - 40);
    run.combo = 0;
    run.slow = 2.4;
    run.invulnerable = 2;
    if (!run.mass) die();
  }
  function release() {
    if (run.respawn || run.cooldown || run.charge < 0.12) {
      run.charge = 0;
      return;
    }
    run.waves.push({
      x: run.x,
      y: run.y,
      age: 0,
      radius: (0.1 + 0.23 * run.charge) * Math.min(width, height),
    });
    run.cooldown = 1.2 + run.charge * 1.5;
    run.charge = 0;
    onPulse();
  }
  function tailDistance(o: Point, a: Point, b: Point) {
    const dx = (b.x - a.x) * width,
      dy = (b.y - a.y) * height;
    const u = clamp(
      ((o.x - a.x) * width * dx + (o.y - a.y) * height * dy) /
        (dx * dx + dy * dy || 1),
      0,
      1,
    );
    return Math.hypot(
      (o.x - a.x) * width - u * dx,
      (o.y - a.y) * height - u * dy,
    );
  }
  function beat(band: number, energy: number) {
    const i = run.sequence++,
      complex = energy > 0.22,
      x = clamp(
        0.5 + 0.3 * Math.sin(i * 0.27) + 0.08 * Math.sin(i * 0.61),
        0.08,
        0.92,
      );
    run.objects.push({
      x,
      y: -0.06,
      radius: complex ? 36 + (i % 3) * 6 : 60 + (i % 3) * 8,
      hue: 160 + band * 45,
      sides: complex ? 5 : 3 + (i % 4),
      hazard: false,
      angle: i * 0.6,
    });
    // Red mines are separate, clearly marked, and never occupy a collectible's path.
    if (i > 5 && i % (complex ? 5 : 9) === 0)
      run.objects.push({
        x: clamp(x + (x > 0.5 ? -0.32 : 0.32), 0.08, 0.92),
        y: -0.12,
        radius: 54,
        hue: 0,
        sides: 8,
        hazard: true,
        angle: 0,
      });
    if (complex && i % 4 === 0)
      run.objects.push({
        x: clamp(x + 0.12, 0.08, 0.92),
        y: -0.1,
        radius: 34,
        hue: 280,
        sides: 3,
        hazard: false,
        angle: 0,
      });
    run.objects = run.objects.slice(-100);
  }
  function reset() {
    Object.assign(run, {
      x: 0.5,
      y: 0.7,
      targetX: 0.5,
      targetY: 0.7,
      score: 0,
      mass: 3,
      combo: 0,
      invulnerable: 1.5,
      respawn: 0,
      slow: 0,
      charge: 0,
      cooldown: 0,
      speed: 0.3,
      energy: 0,
      time: 0,
      distance: 0,
      sequence: 0,
      held: false,
      objects: [],
      tail: [],
      particles: [],
      waves: [],
    });
  }
  function step(
    dt: number,
    active: boolean,
    bpm: number,
    energy: number,
    held: boolean,
  ) {
    if (!active) {
      run.held = false;
      run.charge = 0;
      return;
    }
    run.time += dt;
    run.invulnerable = Math.max(0, run.invulnerable - dt);
    run.cooldown = Math.max(0, run.cooldown - dt);
    run.slow = Math.max(0, run.slow - dt);
    run.energy +=
      (clamp(energy * 2, 0, 1) - run.energy) * (1 - Math.exp(-dt * 1.4));
    const speed =
      ((0.33 * clamp(bpm, 70, 170)) / 108) *
      (1 + run.energy * 0.42) *
      (run.slow > 0 ? 0.45 + 0.55 * (1 - run.slow / 2.4) : 1);
    run.speed += (speed - run.speed) * (1 - Math.exp(-dt * 2));
    run.distance += run.speed * dt;
    run.x += (run.targetX - run.x) * (1 - Math.exp(-dt * 15));
    run.y += (run.targetY - run.y) * (1 - Math.exp(-dt * 15));
    if (run.respawn > 0) {
      run.respawn -= dt;
      if (run.respawn <= 0) {
        run.respawn = 0;
        run.mass = 3;
        run.score = 0;
        run.combo = 0;
        run.invulnerable = 2;
        run.tail = [];
      }
    }
    if (!run.respawn) {
      if (held && !run.cooldown)
        run.charge = Math.min(1, run.charge + dt / 1.35);
      if (run.held && !held) release();
    } else run.charge = 0;
    run.held = held;
    for (const w of run.waves) w.age += dt;
    for (const o of run.objects) {
      o.y += run.speed * dt;
      o.angle += dt * 0.45;
      if (!run.respawn) {
        for (const w of run.waves)
          if (
            Math.hypot((o.x - w.x) * width, (o.y - w.y) * height) <
            w.radius * Math.min(1, w.age / 0.5) + o.radius
          ) {
            if (o.hazard) {
              o.done = true;
              burst(o.x, o.y, true, 18);
            } else collect(o);
            break;
          }
        if (
          !o.done &&
          Math.hypot((o.x - run.x) * width, (o.y - run.y) * height) <
            o.radius * 0.75 + radius()
        ) {
          if (o.hazard) hit(o);
          else collect(o);
        }
        // The trail collects shapes, but does not make the player vulnerable to mines.
        if (!o.done && !o.hazard)
          for (let i = 1; i < run.tail.length; i++) {
            const a = run.tail[i - 1],
              b = run.tail[i];
            if (tailDistance(o, a, b) < o.radius * 0.7 + 3 + run.mass * 0.3) {
              collect(o);
              break;
            }
          }
      }
      if (!o.done && o.y - o.radius / height > 1) {
        o.done = true;
        if (!o.hazard && !run.respawn) {
          run.score -= 15;
          run.combo = 0;
          // A missed collectible costs score only. Only red mines damage the core.
        }
      }
    }
    run.objects = run.objects.filter((o) => !o.done);
    run.waves = run.waves.filter((w) => w.age < 0.75);
    for (const k of run.tail) {
      k.age += dt;
      k.y += run.speed * dt * 0.85;
    }
    if (!run.respawn) run.tail.push({ x: run.x, y: run.y, age: 0 });
    run.tail = run.tail
      .filter((k) => k.age < 1.1 + run.mass * 0.07 + run.energy * 0.8)
      .slice(-180);
    for (const k of run.particles) {
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.age += dt;
    }
    run.particles = run.particles.filter((k) => k.age < 0.9).slice(-400);
  }
  function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    width = w;
    height = h;
    const dot = (x: number, y: number, r: number, color: string) => {
      ctx.beginPath();
      ctx.arc(x * w, y * h, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    // Three downward-moving layers establish upward flight without moving the camera.
    for (let i = 0; i < 90; i++) {
      const layer = i % 3;
      const x = (i * 0.618033) % 1;
      const y = (i * 0.3819 + run.distance * (0.65 + layer * 0.8)) % 1;
      const size = 0.9 + layer * 0.65;
      const opacity = 0.18 + layer * 0.11;
      const length = (3 + layer * 5) * (0.7 + run.speed * 2);
      ctx.beginPath();
      ctx.moveTo(x * w, y * h - length);
      ctx.lineTo(x * w, y * h);
      ctx.lineWidth = size;
      ctx.strokeStyle = `rgba(176,223,255,${opacity})`;
      ctx.stroke();
      dot(x, y, size, `rgba(210,242,255,${opacity + 0.12})`);
    }
    for (const o of run.objects) {
      ctx.save();
      ctx.translate(o.x * w, o.y * h);
      ctx.rotate(o.angle);
      ctx.beginPath();
      for (let i = 0; i < o.sides; i++) {
        const a = (i / o.sides) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * o.radius,
          y = Math.sin(a) * o.radius;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = o.hazard ? '#551426aa' : `hsla(${o.hue},55%,40%,.3)`;
      ctx.fill();
      ctx.strokeStyle = o.hazard ? '#ff627f' : `hsl(${o.hue},80%,72%)`;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (o.hazard) {
        ctx.beginPath();
        ctx.moveTo(-5, -5);
        ctx.lineTo(5, 5);
        ctx.moveTo(5, -5);
        ctx.lineTo(-5, 5);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.lineCap = 'round';
    for (let i = 1; i < run.tail.length; i++) {
      const a = run.tail[i - 1],
        b = run.tail[i],
        alpha = clamp(
          1 - b.age / (1.1 + run.mass * 0.07 + run.energy * 0.8),
          0,
          1,
        );
      for (const glow of [true, false]) {
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.lineWidth = (2 + run.mass * 0.35 + run.energy * 3) * (glow ? 4 : 1);
        ctx.strokeStyle = `hsla(${170 + run.energy * 65},85%,75%,${alpha * (glow ? 0.1 : 0.8)})`;
        ctx.stroke();
      }
    }
    for (const wave of run.waves) {
      ctx.globalAlpha = 1 - wave.age / 0.75;
      ctx.beginPath();
      ctx.arc(
        wave.x * w,
        wave.y * h,
        wave.radius * Math.min(1, wave.age / 0.5),
        0,
        Math.PI * 2,
      );
      ctx.strokeStyle = '#d5fff2';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (run.charge > 0) {
      ctx.setLineDash([3, 8]);
      ctx.beginPath();
      ctx.arc(
        run.x * w,
        run.y * h,
        (0.1 + 0.23 * run.charge) * Math.min(w, h),
        0,
        Math.PI * 2,
      );
      ctx.strokeStyle = '#d5fff266';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const k of run.particles) {
      ctx.globalAlpha = 1 - k.age / 0.9;
      dot(k.x, k.y, k.red ? 3 : 2, k.red ? '#ff7488' : '#baffec');
    }
    ctx.globalAlpha = 1;
    if (!run.respawn) {
      ctx.globalAlpha =
        run.invulnerable > 0
          ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(run.time * 24))
          : 1;
      ctx.shadowColor = '#a6fff0';
      ctx.shadowBlur = 18 + run.mass;
      dot(run.x, run.y, radius(), '#a4f0e4');
      dot(run.x, run.y, radius() * 0.45, '#f0fffc');
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }
  reset();
  return { run, reset, beat, step, draw };
}
