export function lastReleaseTagCommand(revision: string): string[] {
	return ["describe", "--tags", "--abbrev=0", "--match=release-*", revision];
}
