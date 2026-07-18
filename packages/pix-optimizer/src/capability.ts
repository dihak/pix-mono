import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Test whether a command can perform a harmless operation through Pi's executor. */
export async function canExecute(
	pi: Pick<ExtensionAPI, "exec">,
	command: string,
	args: string[],
	timeout = 3000,
): Promise<boolean> {
	try {
		const result = await pi.exec(command, args, { timeout });
		return result.code === 0;
	} catch {
		return false;
	}
}
