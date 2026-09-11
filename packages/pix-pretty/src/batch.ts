/** Shared batching for read/grep/find/ls — N known targets, one tool result. */

export const BATCH_MAX_TARGETS = 20;
export const BATCH_MAX_BYTES = 50 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function resolveBatchStrings(single: string | undefined, many: unknown): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const add = (value: unknown) => {
		if (typeof value !== "string") return;
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) return;
		seen.add(trimmed);
		out.push(trimmed);
	};
	add(single);
	if (Array.isArray(many)) {
		for (const value of many) add(value);
	}
	return out;
}

export function sliceBatchTargets(targets: string[]): { targets: string[]; omitted: number } {
	if (targets.length <= BATCH_MAX_TARGETS) return { targets, omitted: 0 };
	return {
		targets: targets.slice(0, BATCH_MAX_TARGETS),
		omitted: targets.length - BATCH_MAX_TARGETS,
	};
}

/** Add an optional string[] field and drop listed keys from `required`. Does not mutate `schema`. */
export function withOptionalStringArray(
	schema: unknown,
	field: string,
	description: string,
	unrequire: string[] = [],
): unknown {
	const src = schema && typeof schema === "object" ? (schema as Record<string, unknown>) : {};
	const properties = {
		...((src.properties as Record<string, unknown> | undefined) ?? {}),
		[field]: {
			type: "array",
			items: { type: "string" },
			description,
		},
	};
	const required = Array.isArray(src.required)
		? (src.required as string[]).filter((key) => !unrequire.includes(key))
		: [];
	const next: Record<string, unknown> = { ...src, properties };
	if (required.length > 0) next.required = required;
	else delete next.required;
	return next;
}

export type BatchSection = {
	id: string;
	body: string;
	units: number;
	nouns: readonly [string, string];
	error?: string;
	truncated?: boolean;
	hint?: string;
};

function unitLabel(units: number, nouns: readonly [string, string]): string {
	return `${units} ${units === 1 ? nouns[0] : nouns[1]}`;
}

export function formatBatchIndex(sections: BatchSection[], omitted = 0): string {
	const parts = sections.map((section) => {
		if (section.error) return `${section.id} error`;
		if (section.truncated) {
			return section.hint ? `${section.id} truncated, ${section.hint}` : `${section.id} truncated`;
		}
		return `${section.id} ${unitLabel(section.units, section.nouns)}`;
	});
	if (omitted > 0) parts.push(`+${omitted} omitted`);
	return parts.join(" · ");
}

function byteLength(text: string): number {
	return encoder.encode(text).length;
}

function cutToBytes(text: string, maxBytes: number): string {
	const bytes = encoder.encode(text);
	if (bytes.length <= maxBytes) return text;
	let cut = decoder.decode(bytes.slice(0, maxBytes));
	if (cut.endsWith("\uFFFD")) cut = cut.slice(0, -1);
	const lastNl = cut.lastIndexOf("\n");
	return lastNl > 0 ? cut.slice(0, lastNl) : cut;
}

/** Cap section bodies across the whole batch. Index always covers every section. */
export function capSections(
	sections: BatchSection[],
	maxBytes: number,
	maxUnits?: number,
	omitted = 0,
): { index: string; text: string; sections: BatchSection[] } {
	let remainingUnits = maxUnits;
	let remainingBytes = maxBytes;
	const capped: BatchSection[] = [];

	for (const section of sections) {
		if (section.error) {
			capped.push(section);
			continue;
		}
		if ((remainingUnits != null && remainingUnits <= 0) || remainingBytes <= 0) {
			capped.push({ ...section, body: "", units: 0, truncated: true });
			continue;
		}

		const lines = section.body.length > 0 ? section.body.split("\n") : [];
		let keep = lines;
		let truncated = Boolean(section.truncated);
		if (remainingUnits != null && keep.length > remainingUnits) {
			keep = keep.slice(0, remainingUnits);
			truncated = true;
		}
		let body = keep.join("\n");
		if (byteLength(body) > remainingBytes) {
			body = cutToBytes(body, remainingBytes);
			keep = body.length > 0 ? body.split("\n") : [];
			truncated = true;
		}
		const units = body ? keep.length : 0;
		if (remainingUnits != null) remainingUnits -= units;
		remainingBytes -= byteLength(body);
		capped.push({ ...section, body, units, truncated });
	}

	const index = formatBatchIndex(capped, omitted);
	const blocks = capped
		.filter((section) => section.error || section.body)
		.map((section) => `===== ${section.id} =====\n${section.error ?? section.body}`);
	const text = [index, ...blocks].filter(Boolean).join("\n\n");
	return { index, text, sections: capped };
}

export function joinSectionBodies(sections: BatchSection[]): string {
	return sections
		.map((section) => `===== ${section.id} =====\n${section.error ?? section.body}`)
		.join("\n\n");
}

export function formatCallTargets(ids: string[], max = 3, noun = "files"): string {
	if (ids.length === 0) return "";
	if (ids.length <= max) return ids.join(", ");
	return `${ids.length} ${noun}`;
}
