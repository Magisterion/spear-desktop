/** Original straight-road collector simulation. Positions are independent of rendering. */
export function createDrive() {
  const run = {
    x: 0,
    target: 0,
    score: 0,
    combo: 0,
    shield: 100,
    distance: 0,
    speed: 0.3,
    sequence: 0,
    path: 0,
    invulnerable: 0,
    objects: [] as {
      x: number;
      z: number;
      hazard: boolean;
      color: number;
      kind?: 'barrier' | 'mine' | 'sweeper';
      radius?: number;
      origin?: number;
    }[],
    bursts: [] as { x: number; age: number; hazard: boolean }[],
  };
  return {
    run,
    reset() {
      Object.assign(run, {
        x: 0,
        target: 0,
        score: 0,
        combo: 0,
        shield: 100,
        distance: 0,
        speed: 0.3,
        sequence: 0,
        path: 0,
        invulnerable: 0,
      });
      run.objects = [];
      run.bursts = [];
    },
    beat(band: number, intensity = 0) {
      if (run.shield <= 0) return;
      // A continuous, reachable ribbon of pickups instead of discrete lanes.
      run.path = Math.sin(run.sequence * 0.25) * 0.68;
      const color = (Math.max(0, band) + Math.floor(run.sequence / 4)) % 4;
      run.objects.push({ x: run.path, z: 0, hazard: false, color });
      if (intensity > 0.65)
        run.objects.push({
          x: Math.sin((run.sequence + 0.3) * 0.25) * 0.68,
          z: -0.05,
          hazard: false,
          color,
        });
      if (run.sequence % 4 === 3) {
        const kind = (['barrier', 'mine', 'sweeper'] as const)[
          Math.floor(run.sequence / 4) % 3
        ];
        const x = run.path >= 0 ? -0.65 : 0.65;
        run.objects.push({
          x,
          origin: x,
          z: 0,
          hazard: true,
          color: 0,
          kind,
          radius: kind === 'barrier' ? 0.25 : 0.16,
        });
      }
      run.sequence++;
    },
    step(seconds: number, active: boolean, bpm: number) {
      const dt = Math.max(0, Math.min(0.05, seconds));
      run.x +=
        (Math.max(-0.9, Math.min(0.9, run.target)) - run.x) *
        Math.min(1, dt * 12);
      run.bursts.forEach((b) => (b.age += dt));
      run.bursts = run.bursts.filter((b) => b.age < 0.8);
      if (!active || run.shield <= 0) return;
      const level = Math.min(8, Math.floor(run.score / 1500));
      const wanted =
        0.24 + Math.max(0, Math.min(120, bpm - 60)) * 0.0007 + level * 0.008;
      run.speed += (wanted - run.speed) * dt;
      run.distance += dt * run.speed;
      run.invulnerable = Math.max(0, run.invulnerable - dt);
      for (const object of run.objects) {
        object.z += dt * run.speed;
        if (object.kind === 'sweeper')
          object.x =
            (object.origin ?? object.x) + Math.sin(object.z * 10) * 0.12;
        if (object.z < 0.88) continue;
        const collected = Math.abs(object.x - run.x) < (object.radius ?? 0.22);
        if (collected) {
          if (object.hazard && run.invulnerable === 0) {
            run.shield = Math.max(0, run.shield - 35);
            run.combo = 0;
            run.invulnerable = 0.65;
            run.bursts.push({ x: run.x, age: 0, hazard: true });
          } else if (!object.hazard) {
            run.combo++;
            run.score += 100 * Math.min(5, 1 + Math.floor(run.combo / 10));
            run.bursts.push({ x: object.x, age: 0, hazard: false });
          }
        } else if (!object.hazard) run.combo = 0;
      }
      run.objects = run.objects.filter((o) => o.z < 0.88);
    },
  };
}
