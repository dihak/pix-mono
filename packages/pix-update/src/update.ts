import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
// ─── Pure logic (exported for tests) ─────────────────────────────────────────

export const PACKAGE_NAME = "@earendil-works/pi-coding-agent";

// Canonical pix-mono installer. Re-running it is idempotent (Pi install + opt-in
// prompts), so it doubles as the extension updater: it refreshes every
// @xynogen/pix-* package from npm.
export const PIX_INSTALL_URL =
	"https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh";
export const PIX_INSTALL_COMMAND = `curl -fsSL ${PIX_INSTALL_URL} | sh`;

const TRANSIENT_PATTERNS = [
	/eai_again/i,
	/etimedout/i,
	/econnreset/i,
	/econnrefused/i,
	/socket hang up/i,
	/network/i,
	/timeout/i,
	/temporar/i,
	/too many requests/i,
	/\b429\b/,
	/\b502\b/,
	/\b503\b/,
	/\b504\b/,
];

export type InstallMethod = "vp" | "bun" | "npm" | "brew" | "native";

export type CommandSpec = {
	command: string;
	args: string[];
	label: string;
};

export function isTransient(output: string): boolean {
	return TRANSIENT_PATTERNS.some((pattern) => pattern.test(output));
}

export function commandFor(method: InstallMethod): CommandSpec | undefined {
	switch (method) {
		case "vp":
			return {
				command: "vp",
				args: ["add", "-g", `${PACKAGE_NAME}@latest`],
				label: `vp add -g ${PACKAGE_NAME}@latest`,
			};
		case "bun":
			return {
				command: "bun",
				args: ["add", "-g", `${PACKAGE_NAME}@latest`],
				label: `bun add -g ${PACKAGE_NAME}@latest`,
			};
		case "npm":
			return {
				command: "npm",
				args: ["install", "-g", `${PACKAGE_NAME}@latest`],
				label: `npm install -g ${PACKAGE_NAME}@latest`,
			};
		case "brew":
			return {
				command: "/bin/sh",
				args: ["-lc", "brew upgrade pi-coding-agent || brew upgrade pi"],
				label: "brew upgrade pi-coding-agent || brew upgrade pi",
			};
		case "native":
			return undefined;
	}
}

export function formatUpdateSummary(
	before: string,
	after: string,
	attempts: number,
): string {
	const changed =
		before !== after && before !== "unknown" && after !== "unknown";
	const summary = changed
		? `Pi updated: ${before} → ${after}`
		: `Pi is up to date (${after}).`;
	return attempts > 1
		? `${summary} Retried ${attempts - 1} transient failure(s).`
		: summary;
}

async function resolveCommand(command: string, pi: ExtensionAPI) {
	const result = await pi.exec(
		"/bin/sh",
		["-lc", `command -v ${command} || true`],
		{ timeout: 10_000 },
	);
	return result.stdout.trim().split("\n")[0] || undefined;
}

async function currentVersion(pi: ExtensionAPI) {
	const result = await pi.exec("pi", ["--version"], { timeout: 10_000 });
	return result.stdout.trim() || result.stderr.trim() || "unknown";
}

async function detectInstallMethod(pi: ExtensionAPI): Promise<InstallMethod> {
	const piPath = await resolveCommand("pi", pi);
	const realPiPath = piPath
		? (
				await pi.exec(
					"/bin/sh",
					["-lc", `realpath ${piPath} 2>/dev/null || printf %s ${piPath}`],
					{ timeout: 10_000 },
				)
			).stdout.trim()
		: undefined;

	if (piPath?.includes("/.vite-plus/") || realPiPath?.includes("/.vite-plus/"))
		return "vp";
	if (piPath?.includes("/.bun/") || realPiPath?.includes("/.bun/"))
		return "bun";
	if (
		piPath?.includes("/Homebrew/") ||
		piPath?.includes("/homebrew/") ||
		realPiPath?.includes("/Homebrew/") ||
		realPiPath?.includes("/homebrew/")
	)
		return "brew";

	if (piPath) {
		const hasGlobalNpm = await pi.exec(
			"/bin/sh",
			[
				"-lc",
				`p=${piPath}; i=0; while [ $i -lt 5 ]; do d=$(dirname "$p"); [ -d "$d/node_modules/${PACKAGE_NAME}" ] && exit 0; p=$d; i=$((i+1)); done; exit 1`,
			],
			{ timeout: 10_000 },
		);
		if ((hasGlobalNpm.code ?? 1) === 0) return "npm";
	}

	if (await resolveCommand("vp", pi)) return "vp";
	if (await resolveCommand("bun", pi)) return "bun";
	if (await resolveCommand("npm", pi)) return "npm";
	if (await resolveCommand("brew", pi)) return "brew";
	return "native";
}

async function runWithRetry(pi: ExtensionAPI, spec: CommandSpec) {
	let lastOutput = "";
	for (let attempt = 1; attempt <= 3; attempt++) {
		const result = await pi.exec(spec.command, spec.args, { timeout: 180_000 });
		lastOutput = [result.stdout, result.stderr]
			.filter(Boolean)
			.join("\n")
			.trim();
		if ((result.code ?? 0) === 0)
			return { ok: true, output: lastOutput, attempts: attempt };
		if (attempt === 3 || !isTransient(lastOutput))
			return { ok: false, output: lastOutput, attempts: attempt };
		await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
	}
	return { ok: false, output: lastOutput, attempts: 3 };
}

async function updatePi(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	await (
		ctx as ExtensionCommandContext & { waitForIdle?: () => Promise<void> }
	).waitForIdle?.();

	const before = await currentVersion(pi).catch(() => "unknown");
	const method = await detectInstallMethod(pi);
	const spec = commandFor(method);

	if (!spec) {
		ctx.ui.notify(
			`Pi ${before}; install method appears native. Please update the native binary manually.`,
			"warning",
		);
		return;
	}

	ctx.ui.notify(`Updating Pi via ${method}: ${spec.label}`, "info");
	const result = await runWithRetry(pi, spec);
	const after = await currentVersion(pi).catch(() => "unknown");

	if (!result.ok) {
		ctx.ui.notify(
			`Pi update failed after ${result.attempts} attempt(s). ${result.output || "No output."}`,
			"error",
		);
		return;
	}

	ctx.ui.notify(formatUpdateSummary(before, after, result.attempts), "info");
}

async function updateExtensions(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
) {
	ctx.ui.notify("Updating pix extensions via install.sh", "info");
	const result = await pi.exec("/bin/sh", ["-lc", PIX_INSTALL_COMMAND], {
		timeout: 240_000,
	});
	const output = [result.stdout, result.stderr]
		.filter(Boolean)
		.join("\n")
		.trim();
	if ((result.code ?? 0) !== 0) {
		ctx.ui.notify(
			`Pi extensions update failed. ${output || "No output."}`,
			"error",
		);
		return;
	}
	ctx.ui.notify(
		"Pi extensions updated. Please run /reload to apply changes.",
		"warning",
	);
}

async function updatePackages(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	ctx.ui.notify("Updating pi packages (pi update --extensions)", "info");
	const result = await pi.exec("pi", ["update", "--extensions"], {
		timeout: 240_000,
	});
	const output = [result.stdout, result.stderr]
		.filter(Boolean)
		.join("\n")
		.trim();
	if ((result.code ?? 0) !== 0) {
		ctx.ui.notify(
			`Pi package update failed. ${output || "No output."}`,
			"error",
		);
		return;
	}
	ctx.ui.notify(
		"Pi packages updated. Please run /reload to apply changes.",
		"warning",
	);
}

async function updateAll(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	await updatePi(pi, ctx);
	await updateExtensions(pi, ctx);
	await updatePackages(pi, ctx);
}

export default function (pi: ExtensionAPI) {
	(
		pi as ExtensionAPI & {
			registerFlag: (name: string, opts: unknown) => void;
		}
	).registerFlag("update", {
		description: "Update Pi, pix extensions, and pi packages",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("update", {
		description: "Update Pi, pix extensions, and pi packages",
		handler: async (_args, ctx) => {
			await updateAll(pi, ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const flags = pi as ExtensionAPI & {
			getFlag?: (name: string) => boolean;
			sendUserMessage?: (message: string, opts?: unknown) => void;
		};
		if (!flags.getFlag?.("update")) return;
		flags.sendUserMessage?.("/update", { deliverAs: "followUp" });
		ctx.ui.notify("Queued /update from --update", "info");
	});
}
