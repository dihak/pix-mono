/** Format elapsed milliseconds as a compact human duration (e.g. "5s", "1m 03s"). */
export function formatElapsed(ms: number): string {
	const s = Math.floor(Math.max(0, ms) / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rem = s % 60;
	if (m < 60) return `${m}m ${String(rem).padStart(2, "0")}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${String(m % 60).padStart(2, "0")}m ${String(rem).padStart(2, "0")}s`;
}
