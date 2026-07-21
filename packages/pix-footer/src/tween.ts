/**
 * Time-based ease-out tween for footer counters. Deterministic given a clock,
 * so it's pure enough to unit-test by passing `now` explicitly.
 *
 * Duration scales with the jump distance (5ms/unit) and is clamped, so a
 * 0→1000 change lands in ~5s while tiny bumps stay snappy and huge token
 * jumps never crawl. Re-targeting mid-flight re-anchors from the current
 * displayed value, giving smooth follow while a stream keeps raising the total.
 */

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

const MIN_MS = 400;
const MAX_MS = 5_000;
const MS_PER_UNIT = 5; // 1000 units → 5000ms → ~5s

export function animDuration(distance: number): number {
	return Math.min(MAX_MS, Math.max(MIN_MS, Math.abs(distance) * MS_PER_UNIT));
}

export class Tween {
	private from = 0;
	private start = 0;
	private duration = 0;
	value = 0;
	to = 0;

	/** Point at a new target; re-anchors from the current value if it changed. */
	retarget(target: number, now: number): void {
		if (target === this.to) return;
		this.from = this.value;
		this.to = target;
		this.start = now;
		this.duration = animDuration(target - this.from);
	}

	/** Sample the eased value at `now`. Returns true once settled on target. */
	sample(now: number): boolean {
		if (this.duration <= 0 || now >= this.start + this.duration) {
			this.value = this.to;
			return true;
		}
		const t = (now - this.start) / this.duration;
		this.value = this.from + (this.to - this.from) * easeOutCubic(t);
		return false;
	}
}
