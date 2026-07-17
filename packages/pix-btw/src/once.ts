/** Per-Pi-instance activation guard shared through globalThis. */
export function once(pi: object, key: string, fn: () => void): void {
	const g = globalThis as { __pixOnce?: WeakMap<object, Set<string>> };
	if (!g.__pixOnce) g.__pixOnce = new WeakMap<object, Set<string>>();
	const registry = g.__pixOnce;
	let loaded = registry.get(pi);
	if (!loaded) {
		loaded = new Set<string>();
		registry.set(pi, loaded);
	}
	if (loaded.has(key)) return;
	loaded.add(key);
	fn();
}
