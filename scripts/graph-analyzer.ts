import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";

export interface GraphNode {
	id: string;
	label: string;
	community?: number;
	file_type?: string;
	source_file?: string | null;
	source_location?: string | null;
	norm_label?: string;
	[key: string]: unknown;
}

export interface GraphLink {
	source: string;
	target: string;
	relation: string;
	confidence?: string;
	confidence_score?: number;
	source_file?: string | null;
	source_location?: string | null;
	[key: string]: unknown;
}

export interface GraphHyperedge {
	id?: string | null;
	label?: string;
	nodes: string[];
	relation?: string;
	source_file?: string | null;
	[key: string]: unknown;
}

export interface GraphData {
	nodes: GraphNode[];
	links: GraphLink[];
	hyperedges?: GraphHyperedge[];
	[key: string]: unknown;
}

export interface RemovedSuspiciousEdge {
	source: string;
	target: string;
	sourceFile: string;
	sourceLocation?: string;
	reason: string;
}

export interface InvalidHyperedge {
	id?: string | null;
	label?: string;
	reason: string;
}

export interface RepeatedStructure {
	category: "code" | "data" | "metadata" | "test";
	communityIds: number[];
	occurrences: number;
	labels: string[];
	sourceFiles: string[];
}

export interface SemanticPattern {
	id: string;
	label: string;
	relation?: string;
	members: string[];
}

export interface GraphAnalysis {
	cleanedGraph: GraphData;
	quality: {
		normalizedSourcePaths: number;
		removedSuspiciousEdges: RemovedSuspiciousEdge[];
		invalidHyperedges: InvalidHyperedge[];
		repairedHyperedgeIds: Array<{ id: string; label?: string }>;
		isolatedNodeIds: string[];
		connectedComponents: number;
	};
	patterns: {
		repeatedStructures: RepeatedStructure[];
		semanticPatterns: SemanticPattern[];
	};
}

export interface AnalyzeGraphOptions {
	repoRoot?: string;
	readSource?: (path: string) => string;
}

interface Binding {
	kind: "import" | "local" | "parameter";
	module?: string;
}

function compareText(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

function normalizePath(path: string, repoRoot: string): string {
	if (!isAbsolute(path)) return path.split(sep).join("/");
	const normalized = relative(repoRoot, path);
	if (normalized === ".." || normalized.startsWith(`..${sep}`)) return path;
	return normalized.split(sep).join("/");
}

function packageFromPath(path: string | null | undefined): string | undefined {
	const match = path?.match(/^packages\/([^/]+)\//);
	return match?.[1];
}

function packageFromModule(moduleName: string, sourceFile: string, repoRoot: string): string | undefined {
	const pixPackage = moduleName.match(/^@dihak\/([^/]+)/)?.[1];
	if (pixPackage) return pixPackage;
	if (!moduleName.startsWith(".")) return undefined;
	return packageFromPath(normalizePath(resolve(repoRoot, sourceFile, "..", moduleName), repoRoot));
}

function locationLine(location: string | null | undefined): number | undefined {
	const line = location?.match(/L(\d+)/)?.[1];
	return line ? Number(line) : undefined;
}

function calledName(expression: ts.LeftHandSideExpression): string | undefined {
	if (ts.isIdentifier(expression)) return expression.text;
	if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
	return undefined;
}

function bindingName(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) return [name.text];
	const names: string[] = [];
	for (const element of name.elements) {
		if (ts.isOmittedExpression(element)) continue;
		names.push(...bindingName(element.name));
	}
	return names;
}

function findCall(sourceFile: ts.SourceFile, name: string, line: number): ts.CallExpression | undefined {
	let match: ts.CallExpression | undefined;
	function visit(node: ts.Node): void {
		if (match) return;
		if (ts.isCallExpression(node) && calledName(node.expression) === name) {
			const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
			const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
			if (line >= start && line <= end) {
				match = node;
				return;
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return match;
}

function findBinding(sourceFile: ts.SourceFile, call: ts.CallExpression, name: string): Binding | undefined {
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
		const clause = statement.importClause;
		if (!clause) continue;
		if (clause.name?.text === name) return { kind: "import", module: statement.moduleSpecifier.text };
		const bindings = clause.namedBindings;
		if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name) {
			return { kind: "import", module: statement.moduleSpecifier.text };
		}
		if (bindings && ts.isNamedImports(bindings)) {
			for (const element of bindings.elements) {
				if (element.name.text === name) {
					return { kind: "import", module: statement.moduleSpecifier.text };
				}
			}
		}
	}

	let ancestor: ts.Node | undefined = call;
	while (ancestor) {
		if (ts.isFunctionLike(ancestor)) {
			for (const parameter of ancestor.parameters) {
				if (bindingName(parameter.name).includes(name)) return { kind: "parameter" };
			}
		}
		ancestor = ancestor.parent;
	}

	let local = false;
	function visit(node: ts.Node): void {
		if (local) return;
		if (
			(ts.isVariableDeclaration(node) && bindingName(node.name).includes(name)) ||
			(ts.isFunctionDeclaration(node) && node.name?.text === name) ||
			(ts.isClassDeclaration(node) && node.name?.text === name)
		) {
			local = true;
			return;
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return local ? { kind: "local" } : undefined;
}

function callEdgeProblem(
	edge: GraphLink,
	nodesById: Map<string, GraphNode>,
	repoRoot: string,
	readSource: (path: string) => string,
): string | undefined {
	if (edge.relation !== "calls" || edge.confidence !== "INFERRED") return undefined;
	const sourceNode = nodesById.get(edge.source);
	const targetNode = nodesById.get(edge.target);
	const sourceFile = edge.source_file ?? sourceNode?.source_file;
	const targetFile = targetNode?.source_file;
	if (!sourceFile || !targetFile || sourceFile === targetFile) return undefined;

	const targetPackage = packageFromPath(targetFile);
	if (!targetPackage) return undefined;
	const line = locationLine(edge.source_location);
	const name = targetNode?.label.replace(/^\./, "").replace(/\(\)$/, "");
	if (!line || !name) return undefined;

	let text: string;
	try {
		text = readSource(resolve(repoRoot, sourceFile));
	} catch {
		return undefined;
	}
	const source = ts.createSourceFile(sourceFile, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const call = findCall(source, name, line);
	if (!call) return undefined;
	const binding = findBinding(source, call, name);
	if (!binding) return undefined;
	if (binding.kind === "parameter") return `callee ${name} is a function parameter, not a cross-file symbol`;
	if (binding.kind === "local") return `callee ${name} is declared locally, not in ${targetPackage}`;

	const expectedPackage = binding.module
		? packageFromModule(binding.module, sourceFile, repoRoot)
		: undefined;
	if (expectedPackage === targetPackage) return undefined;
	if (expectedPackage) {
		return `callee ${name} is imported from ${expectedPackage}, not ${targetPackage}`;
	}
	return `callee ${name} is imported from external module ${binding.module}, not ${targetPackage}`;
}

function structureCategory(nodes: GraphNode[]): RepeatedStructure["category"] {
	const files = nodes.map((node) => node.source_file ?? "");
	if (files.every((file) => file.endsWith("package.json"))) return "metadata";
	if (files.every((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file))) return "test";
	if (files.every((file) => /\.json$/.test(file))) return "data";
	return "code";
}

function repeatedStructures(nodes: GraphNode[]): RepeatedStructure[] {
	const communities = new Map<number, GraphNode[]>();
	for (const node of nodes) {
		if (node.community === undefined) continue;
		const members = communities.get(node.community) ?? [];
		members.push(node);
		communities.set(node.community, members);
	}

	const signatures = new Map<string, Array<{ id: number; nodes: GraphNode[] }>>();
	for (const [id, members] of communities) {
		if (members.length < 2) continue;
		const labels = members.map((node) => node.norm_label ?? node.label).sort(compareText);
		const signature = JSON.stringify(labels);
		const group = signatures.get(signature) ?? [];
		group.push({ id, nodes: members });
		signatures.set(signature, group);
	}

	const patterns: RepeatedStructure[] = [];
	for (const group of signatures.values()) {
		if (group.length < 2) continue;
		const members = group.flatMap((item) => item.nodes);
		const sourceFiles = new Set<string>();
		for (const member of members) {
			if (member.source_file) sourceFiles.add(member.source_file);
		}
		patterns.push({
			category: structureCategory(members),
			communityIds: group.map((item) => item.id).sort((a, b) => a - b),
			occurrences: group.length,
			labels: group[0]?.nodes.map((node) => node.label).sort(compareText) ?? [],
			sourceFiles: [...sourceFiles].sort(compareText),
		});
	}
	return patterns.sort(
		(a, b) => b.occurrences - a.occurrences || b.labels.length - a.labels.length,
	);
}

function uniqueHyperedgeId(label: string | undefined, existingIds: Set<string>): string {
	const slug = (label ?? "semantic_pattern")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	const base = `pattern_${slug || "semantic_pattern"}`;
	let candidate = base;
	let suffix = 2;
	while (existingIds.has(candidate)) {
		candidate = `${base}_${suffix}`;
		suffix += 1;
	}
	existingIds.add(candidate);
	return candidate;
}

function graphShape(graph: GraphData): { isolatedNodeIds: string[]; connectedComponents: number } {
	const adjacency = new Map(graph.nodes.map((node) => [node.id, new Set<string>()]));
	for (const edge of graph.links) {
		adjacency.get(edge.source)?.add(edge.target);
		adjacency.get(edge.target)?.add(edge.source);
	}
	const isolatedNodeIds = [...adjacency]
		.flatMap(([id, neighbors]) => (neighbors.size === 0 ? [id] : []))
		.sort(compareText);
	const visited = new Set<string>();
	let connectedComponents = 0;
	for (const id of adjacency.keys()) {
		if (visited.has(id)) continue;
		connectedComponents += 1;
		const pending = [id];
		visited.add(id);
		while (pending.length > 0) {
			const current = pending.pop();
			if (!current) continue;
			for (const neighbor of adjacency.get(current) ?? []) {
				if (visited.has(neighbor)) continue;
				visited.add(neighbor);
				pending.push(neighbor);
			}
		}
	}
	return { isolatedNodeIds, connectedComponents };
}

export function analyzeGraph(graph: GraphData, options: AnalyzeGraphOptions = {}): GraphAnalysis {
	const repoRoot = resolve(options.repoRoot ?? process.cwd());
	const readSource = options.readSource ?? ((path: string) => readFileSync(path, "utf8"));
	const cleanedGraph = structuredClone(graph);
	let normalizedSourcePaths = 0;
	for (const item of [
		...cleanedGraph.nodes,
		...cleanedGraph.links,
		...(cleanedGraph.hyperedges ?? []),
	]) {
		if (typeof item.source_file !== "string") continue;
		const normalized = normalizePath(item.source_file, repoRoot);
		if (normalized !== item.source_file) normalizedSourcePaths += 1;
		item.source_file = normalized;
	}

	const nodesById = new Map(cleanedGraph.nodes.map((node) => [node.id, node]));
	const removedSuspiciousEdges: RemovedSuspiciousEdge[] = [];
	cleanedGraph.links = cleanedGraph.links.filter((edge) => {
		const reason = callEdgeProblem(edge, nodesById, repoRoot, readSource);
		if (!reason) return true;
		removedSuspiciousEdges.push({
			source: edge.source,
			target: edge.target,
			sourceFile: edge.source_file ?? nodesById.get(edge.source)?.source_file ?? "unknown",
			...(edge.source_location ? { sourceLocation: edge.source_location } : {}),
			reason,
		});
		return false;
	});

	const nodeIds = new Set(cleanedGraph.nodes.map((node) => node.id));
	const hyperedgeIds = new Set(
		(cleanedGraph.hyperedges ?? []).flatMap((hyperedge) =>
			hyperedge.id ? [hyperedge.id] : [],
		),
	);
	const invalidHyperedges: InvalidHyperedge[] = [];
	const repairedHyperedgeIds: Array<{ id: string; label?: string }> = [];
	cleanedGraph.hyperedges = (cleanedGraph.hyperedges ?? []).filter((hyperedge) => {
		let reason: string | undefined;
		if (new Set(hyperedge.nodes).size < 3) reason = "fewer than three distinct members";
		else {
			const missing = hyperedge.nodes.filter((id) => !nodeIds.has(id));
			if (missing.length > 0) reason = `missing member ids: ${missing.join(", ")}`;
		}
		if (reason) {
			invalidHyperedges.push({ id: hyperedge.id, label: hyperedge.label, reason });
			return false;
		}
		if (!hyperedge.id) {
			hyperedge.id = uniqueHyperedgeId(hyperedge.label, hyperedgeIds);
			repairedHyperedgeIds.push({ id: hyperedge.id, label: hyperedge.label });
		}
		return true;
	});

	const shape = graphShape(cleanedGraph);
	return {
		cleanedGraph,
		quality: {
			normalizedSourcePaths,
			removedSuspiciousEdges,
			invalidHyperedges,
			repairedHyperedgeIds,
			...shape,
		},
		patterns: {
			repeatedStructures: repeatedStructures(cleanedGraph.nodes),
			semanticPatterns: (cleanedGraph.hyperedges ?? []).map((hyperedge) => ({
				id: hyperedge.id ?? "unknown",
				label: hyperedge.label ?? hyperedge.id ?? "Unnamed pattern",
				relation: hyperedge.relation,
				members: hyperedge.nodes,
			})),
		},
	};
}

function codeSpan(labels: string[]): string {
	return labels.map((label) => `\`${label.split("`").join("\\`")}\``).join(" + ");
}

function repeatedSection(
	title: string,
	patterns: RepeatedStructure[],
	categories: RepeatedStructure["category"][],
): string[] {
	const selected = patterns.filter((pattern) => categories.includes(pattern.category));
	const lines = [`## ${title}`, ""];
	if (selected.length === 0) return [...lines, "None.", ""];
	for (const pattern of selected) {
		lines.push(
			`- ${pattern.occurrences} occurrences: ${codeSpan(pattern.labels)} (${pattern.sourceFiles.join(", ")})`,
		);
	}
	return [...lines, ""];
}

export function renderPatternReport(result: GraphAnalysis): string {
	const { quality, patterns, cleanedGraph } = result;
	const lines = [
		"# Graph Pattern Report",
		"",
		"## Quality summary",
		"",
		`- Clean graph: ${cleanedGraph.nodes.length} nodes, ${cleanedGraph.links.length} links, ${cleanedGraph.hyperedges?.length ?? 0} hyperedges`,
		`- Removed suspicious inferred calls: ${quality.removedSuspiciousEdges.length}`,
		`- Removed invalid hyperedges: ${quality.invalidHyperedges.length}`,
		`- Repaired missing hyperedge IDs: ${quality.repairedHyperedgeIds.length}`,
		`- Normalized source paths: ${quality.normalizedSourcePaths}`,
		`- Connected components: ${quality.connectedComponents}`,
		`- Isolated nodes: ${quality.isolatedNodeIds.length}`,
		"",
		...repeatedSection("Repeated code structures", patterns.repeatedStructures, ["code"]),
		...repeatedSection("Repeated data and schema structures", patterns.repeatedStructures, ["data"]),
		...repeatedSection("Repeated test structures", patterns.repeatedStructures, ["test"]),
		"## Metadata repetition",
		"",
	];
	const metadata = patterns.repeatedStructures.filter((pattern) => pattern.category === "metadata");
	if (metadata.length === 0) lines.push("None.");
	else {
		lines.push(
			`${metadata.length} repeated metadata signatures are retained in the clean graph but excluded from code-pattern conclusions.`,
		);
	}
	lines.push("", "## Semantic patterns", "");
	if (patterns.semanticPatterns.length === 0) lines.push("None.");
	else {
		for (const pattern of patterns.semanticPatterns) {
			lines.push(`- **${pattern.label}**: ${pattern.members.length} validated members`);
		}
	}
	lines.push("", "## Removed unreliable relations", "");
	if (quality.removedSuspiciousEdges.length === 0) lines.push("None.");
	else {
		for (const edge of quality.removedSuspiciousEdges) {
			const location = edge.sourceLocation ? `:${edge.sourceLocation}` : "";
			lines.push(`- \`${edge.sourceFile}${location}\`: ${edge.reason}`);
		}
	}
	return `${lines.join("\n")}\n`;
}
