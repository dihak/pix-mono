/**
 * Idempotency guard for extension activation.
 *
 * pix-core (the meta-package) invokes this package's factory in addition to a
 * possible direct install. Pi's loader uses jiti with `moduleCache: false`, so
 * each load pass re-evaluates modules — a plain module-level flag would not be
 * shared. The dedupe key therefore lives on `globalThis`, which persists for
 * the lifetime of the process across all load passes.
 */
export function once(key: string, fn: () => void): void {
	const g = globalThis as { __pixLoaded?: Set<string> };
	const loaded = (g.__pixLoaded ??= new Set<string>());
	if (loaded.has(key)) return;
	loaded.add(key);
	fn();
}
