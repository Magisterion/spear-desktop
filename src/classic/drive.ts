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
    objects: [] as { x: number; z: number; hazard: boolean; color: number }[],
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
    beat(band: number) {
      if (run.shield <= 0) return;
      // Adjacent moves only, with a clear collectible path through every row.
      if (run.sequence % 3 === 2)
        run.path = Math.max(-1, Math.min(1, run.path + (band % 2 ? 1 : -1)));
      run.objects.push({
        x: run.path * 0.66,
        z: 0,
        hazard: false,
        color: band % 4,
      });
      if (run.sequence++ % 4 === 3) {
        const obstacleLane = run.path === 0 ? (band % 2 ? -1 : 1) : -run.path;
        run.objects.push({
          x: obstacleLane * 0.66,
          z: 0,
          hazard: true,
          color: 0,
        });
      }
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
        if (object.z < 0.88) continue;
        const collected = Math.abs(object.x - run.x) < 0.27;
        if (collected) {
          if (object.hazard && run.invulnerable === 0) {
            run.shield = Math.max(0, run.shield - 35);
            run.combo = 0;
            run.invulnerable = 0.65;
            run.bursts.push({ x: run.x, age: 0, hazard: true });
          } else if (!object.hazard) {
            run.combo++;
            run.score += 100 * Math.min(4, 1 + Math.floor(run.combo / 10));
            run.shield = Math.min(100, run.shield + 1);
            run.bursts.push({ x: object.x, age: 0, hazard: false });
          }
        } else if (!object.hazard) run.combo = 0;
      }
      run.objects = run.objects.filter((o) => o.z < 0.88);
    },
  };
}
