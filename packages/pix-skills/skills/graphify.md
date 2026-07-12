---
name: graphify
description: "Use for any question about a codebase, its architecture, file relationships, or project content — especially when graphify-out/ exists, where the question should be treated as a graphify query first. Turns any input (code, docs, papers, images, videos) into a persistent knowledge graph with god nodes, community detection, and query/path/explain tools."
disable-model-invocation: true
---

# /graphify

Turn any folder of files into a navigable knowledge graph with community detection, an honest audit trail, and three outputs: interactive HTML, GraphRAG-ready JSON, and a plain-language GRAPH_REPORT.md.

## Usage

```
/graphify                                             # full pipeline on current directory
/graphify <path>                                      # full pipeline on specific path
/graphify <path> --mode deep                          # thorough extraction, richer INFERRED edges
/graphify <path> --update                             # incremental - re-extract only new/changed files
/graphify <path> --cluster-only                       # rerun clustering on existing graph
/graphify <path> --no-viz                             # skip visualization, just report + JSON
/graphify query "<question>"                          # BFS traversal - broad context
/graphify query "<question>" --dfs                    # DFS - trace a specific path
/graphify path "AuthModule" "Database"                # shortest path between two concepts
/graphify explain "SwinTransformer"                   # plain-language explanation of a node
```

## What graphify is for

Drop any folder of code, docs, papers, images, or video into graphify and get a queryable knowledge graph. Persistent across sessions, honest audit trail (EXTRACTED/INFERRED/AMBIGUOUS), community detection surfaces cross-document connections you wouldn't think to ask about.

## What You Must Do When Invoked

If the user invoked `/graphify --help` or `/graphify -h` (with no other arguments), print the contents of the `## Usage` section above verbatim and stop. Do not run any commands, do not detect files, do not default the path to `.`. Just print the Usage block and return.

**Fast path — existing graph:** Before doing anything else, check whether `graphify-out/graph.json` exists. The expected location is `graphify-out/graph.json` relative to the **current working directory** (i.e. the project root where you are running commands). If it exists AND the user's request is a natural-language question about the codebase (e.g. "How does X work?", "What calls Y?", "Trace the data flow through Z") and NOT an explicit rebuild command (`--update`, `--cluster-only`, or a bare path/URL that implies fresh extraction): **skip Steps 1–5 entirely and jump straight to `## For /graphify query`.** Run `graphify query "<question>"` immediately. Do not run detect. Do not check corpus size. Do not ask the user to narrow. The graph is already built — use it.

If no path was given, use `.` (current directory). Do not ask the user for a path.

Follow these steps in order. Do not skip steps.

### Step 1 - Ensure graphify is installed

```bash
if ! python3 -c "import graphify" 2>/dev/null; then
    echo "graphify is not installed. See https://github.com/safishamsi/graphify for install instructions."
    echo "Quick install, then re-run this command:"
    echo "  uv tool install graphifyy      # recommended"
    echo "  # or: pip install graphifyy"
    exit 1
fi
mkdir -p graphify-out
python3 -c "import sys; open('graphify-out/.graphify_python', 'w', encoding='utf-8').write(sys.executable)"
echo "$(cd . && pwd)" > graphify-out/.graphify_root
```

If the import succeeds, print nothing and move straight to Step 2. If it prints the install message, stop and tell the user to install graphify (see <https://github.com/safishamsi/graphify>) before retrying — do not attempt to install it yourself.

**In every subsequent bash block, replace `python3` with `$(cat graphify-out/.graphify_python)` to use the correct interpreter.**

### Step 2 - Detect files

```bash
$(cat graphify-out/.graphify_python) -c "
import json
from graphify.detect import detect
from pathlib import Path
result = detect(Path('INPUT_PATH'))
print(json.dumps(result, ensure_ascii=False))
" > graphify-out/.graphify_detect.json
```

Replace INPUT_PATH with the actual path. Do NOT cat or print the JSON — read it silently and present a clean summary:

```
Corpus: X files · ~Y words
  code:     N files (.py .ts .go ...)
  docs:     N files (.md .txt ...)
  papers:   N files (.pdf ...)
  images:   N files
```

Omit any category with 0 files.

Then act on it:

- If `total_files` is 0: stop with "No supported files found in [path]."
- If `skipped_sensitive` is non-empty: mention file count skipped, not file names.
- If `total_words` > 2,000,000 OR `total_files` > 500: show the warning, compute top 5 subdirectories by file count, ask which to run on.
- Otherwise: proceed to Step 3.

### Step 3 - Extract entities and relationships

This step has two parts: **structural extraction** (deterministic, free) and **semantic extraction** (LLM).

#### Part A - Structural extraction for code files

```bash
$(cat graphify-out/.graphify_python) -c "
import sys, json
from graphify.extract import collect_files, extract
from pathlib import Path

code_files = []
detect = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding='utf-8'))
for f in detect.get('files', {}).get('code', []):
    code_files.extend(collect_files(Path(f)) if Path(f).is_dir() else [Path(f)])

if code_files:
    result = extract(code_files, cache_root=Path('.'))
    Path('graphify-out/.graphify_ast.json').write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'AST: {len(result[\"nodes\"])} nodes, {len(result[\"edges\"])} edges')
else:
    Path('graphify-out/.graphify_ast.json').write_text(json.dumps({'nodes':[],'edges':[],'input_tokens':0,'output_tokens':0}, ensure_ascii=False), encoding='utf-8')
    print('No code files - skipping AST extraction')
"
```

#### Part B - Semantic extraction (pi-native)

**Fast path:** If detection found zero docs, papers, and images (code-only corpus), skip Part B entirely. AST handles code.

**Pi-native mode:** Pi reads files directly and extracts entities. No API key needed. Sequential processing, zero cost.

**Step B0 - Check extraction cache**

```bash
$(cat graphify-out/.graphify_python) -c "
import json
from graphify.cache import check_semantic_cache
from pathlib import Path

detect = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding='utf-8'))
all_files = [f for files in detect['files'].values() for f in files]

cached_nodes, cached_edges, cached_hyperedges, uncached = check_semantic_cache(all_files)

if cached_nodes or cached_edges or cached_hyperedges:
    Path('graphify-out/.graphify_cached.json').write_text(json.dumps({'nodes': cached_nodes, 'edges': cached_edges, 'hyperedges': cached_hyperedges}, ensure_ascii=False), encoding='utf-8')
Path('graphify-out/.graphify_uncached.txt').write_text('\n'.join(uncached), encoding='utf-8')
print(f'Cache: {len(all_files)-len(uncached)} files hit, {len(uncached)} files need extraction')
"
```

Only extract from files in `graphify-out/.graphify_uncached.txt`. If all cached, skip to Part C.

**Step B1 - Split into batches**

```bash
$(cat graphify-out/.graphify_python) -c "
from pathlib import Path
import json

uncached = Path('graphify-out/.graphify_uncached.txt').read_text(encoding='utf-8').strip().split('\n')
detect = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding='utf-8'))

images = [f for f in uncached if any(f.lower().endswith(e) for e in ('.png','.jpg','.jpeg','.gif','.webp','.svg'))]
text_files = [f for f in uncached if f not in images]

BATCH_SIZE = 10
batches = []
for i in range(0, len(text_files), BATCH_SIZE):
    batches.append({'type': 'text', 'files': text_files[i:i+BATCH_SIZE]})
for img in images:
    batches.append({'type': 'image', 'files': [img]})

Path('graphify-out/.graphify_batches.json').write_text(json.dumps(batches, indent=2), encoding='utf-8')
print(f'Batches: {len(batches)} ({len(text_files)} text in {(len(text_files)+BATCH_SIZE-1)//BATCH_SIZE} batches, {len(images)} images)')
"
```

**Step B2 - Process each batch sequentially**

For each batch, you (the pi agent) must:

1. **Read all files** in the batch using the `read` tool
2. **Extract entities** from the file content — you ARE the LLM
3. **Write chunk JSON** to disk using the `write` tool

**Extraction rules** (follow these when extracting):

```
Extract a knowledge graph fragment from the files.
Output ONLY valid JSON matching the schema — no explanation, no markdown fences.

Rules:
- EXTRACTED: relationship explicit in source (import, call, citation)
- INFERRED: reasonable inference (shared structure, implied dependency)
- AMBIGUOUS: uncertain — flag it, do not omit
- Doc/paper files: named concepts, entities, citations.
  Store rationale as a `rationale` attribute on the relevant node.
  file_type must be one of: code, document, paper, image, rationale, concept
- DEEP_MODE: aggressive INFERRED edges — indirect deps, shared assumptions
- Semantic similarity: if two concepts solve the same problem without a
  structural link, add semantically_similar_to edge (INFERRED, 0.6-0.95)
- Hyperedges: if 3+ nodes share a concept not captured by pairwise edges,
  add hyperedge. Max 3 per batch. Use sparingly.
- confidence_score REQUIRED on every edge:
  EXTRACTED = 1.0 always
  INFERRED: pick ONE of 0.95/0.85/0.75/0.65/0.55
  AMBIGUOUS: 0.1-0.3

Node ID format: {parent_dir}_{filename_stem}_{entity}
  All lowercase, only [a-z0-9_], no dots/slashes
  src/auth/session.py + ValidateToken → auth_session_validatetoken
  Top-level files: just filename stem

Output JSON:
{
  "nodes": [{"id":"...", "label":"...", "file_type":"document|paper|image|rationale|concept", "source_file":"relative/path", "source_location":null, "source_url":null, "captured_at":null, "author":null, "contributor":null}],
  "edges": [{"source":"...", "target":"...", "relation":"references|cites|conceptually_related_to|shares_data_with|semantically_similar_to|rationale_for", "confidence":"EXTRACTED|INFERRED|AMBIGUOUS", "confidence_score":1.0, "source_file":"relative/path", "source_location":null, "weight":1.0}],
  "hyperedges": [{"id":"...", "label":"...", "nodes":["..."], "relation":"participate_in|implement|form", "confidence":"EXTRACTED|INFERRED", "confidence_score":0.75, "source_file":"relative/path"}],
  "input_tokens": 0,
  "output_tokens": 0
}
```

**For each batch:**

1. Read the files:

   ```
   read file1.md
   read file2.md
   ...
   ```

2. Extract entities from the content you just read. Follow the rules above.

3. Write the chunk JSON to `graphify-out/.graphify_chunk_NN.json` (zero-padded, 2 digits).

4. Print progress:

   ```
   Batch 1/N: extracted X nodes, Y edges from [file names]
   ```

**Image batches:** For images, use the `read` tool which supports vision. Understand what the image IS, not just OCR. Extract image-specific nodes with `file_type: "image"`.

**Step B3 - Collect and merge**

```bash
$(cat graphify-out/.graphify_python) -c "
import json, glob
from pathlib import Path

chunks = sorted(glob.glob('graphify-out/.graphify_chunk_*.json'))
if not chunks:
    print('No chunk files found — extraction may have failed')
else:
    all_nodes, all_edges, all_hyperedges = [], [], []
    total_in, total_out = 0, 0
    for c in chunks:
        d = json.loads(Path(c).read_text(encoding='utf-8'))
        all_nodes += d.get('nodes', [])
        all_edges += d.get('edges', [])
        all_hyperedges += d.get('hyperedges', [])
        total_in += d.get('input_tokens', 0)
        total_out += d.get('output_tokens', 0)
    Path('graphify-out/.graphify_semantic_new.json').write_text(json.dumps({
        'nodes': all_nodes, 'edges': all_edges, 'hyperedges': all_hyperedges,
        'input_tokens': total_in, 'output_tokens': total_out,
    }, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'Merged {len(chunks)} chunks: {len(all_nodes)} nodes, {len(all_edges)} edges')
"
```

Save to cache and merge with cached results:

```bash
$(cat graphify-out/.graphify_python) -c "
import json
from graphify.cache import save_semantic_cache
from pathlib import Path

new = json.loads(Path('graphify-out/.graphify_semantic_new.json').read_text(encoding='utf-8')) if Path('graphify-out/.graphify_semantic_new.json').exists() else {'nodes':[],'edges':[],'hyperedges':[]}
saved = save_semantic_cache(new.get('nodes', []), new.get('edges', []), new.get('hyperedges', []))
print(f'Cached {saved} files')
"
```

Merge cached + new:

```bash
$(cat graphify-out/.graphify_python) -c "
import json
from pathlib import Path

cached = json.loads(Path('graphify-out/.graphify_cached.json').read_text(encoding='utf-8')) if Path('graphify-out/.graphify_cached.json').exists() else {'nodes':[],'edges':[],'hyperedges':[]}
new = json.loads(Path('graphify-out/.graphify_semantic_new.json').read_text(encoding='utf-8')) if Path('graphify-out/.graphify_semantic_new.json').exists() else {'nodes':[],'edges':[],'hyperedges':[]}

all_nodes = cached['nodes'] + new.get('nodes', [])
all_edges = cached['edges'] + new.get('edges', [])
all_hyperedges = cached.get('hyperedges', []) + new.get('hyperedges', [])
seen = set()
deduped = []
for n in all_nodes:
    if n['id'] not in seen:
        seen.add(n['id'])
        deduped.append(n)

Path('graphify-out/.graphify_semantic.json').write_text(json.dumps({
    'nodes': deduped, 'edges': all_edges, 'hyperedges': all_hyperedges,
    'input_tokens': new.get('input_tokens', 0), 'output_tokens': new.get('output_tokens', 0),
}, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'Extraction complete - {len(deduped)} nodes, {len(all_edges)} edges')
"
```

Clean up: `rm -f graphify-out/.graphify_cached.json graphify-out/.graphify_uncached.txt graphify-out/.graphify_semantic_new.json graphify-out/.graphify_chunk_*.json graphify-out/.graphify_batches.json`

#### Part C - Merge AST + semantic into final extraction

```bash
$(cat graphify-out/.graphify_python) -c "
import sys, json
from pathlib import Path

ast = json.loads(Path('graphify-out/.graphify_ast.json').read_text(encoding='utf-8'))
sem = json.loads(Path('graphify-out/.graphify_semantic.json').read_text(encoding='utf-8'))

seen = {n['id'] for n in ast['nodes']}
merged_nodes = list(ast['nodes'])
for n in sem['nodes']:
    if n['id'] not in seen:
        merged_nodes.append(n)
        seen.add(n['id'])

merged_edges = ast['edges'] + sem['edges']
merged = {
    'nodes': merged_nodes,
    'edges': merged_edges,
    'hyperedges': sem.get('hyperedges', []),
    'input_tokens': sem.get('input_tokens', 0),
    'output_tokens': sem.get('output_tokens', 0),
}
Path('graphify-out/.graphify_extract.json').write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'Merged: {len(merged_nodes)} nodes, {len(merged_edges)} edges ({len(ast[\"nodes\"])} AST + {len(sem[\"nodes\"])} semantic)')
"
```

### Step 4 - Build graph, cluster, analyze, generate outputs

```bash
mkdir -p graphify-out
$(cat graphify-out/.graphify_python) -c "
import sys, json
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json
from pathlib import Path

extraction = json.loads(Path('graphify-out/.graphify_extract.json').read_text(encoding='utf-8'))
detection  = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding='utf-8'))

G = build_from_json(extraction)
communities = cluster(G)
cohesion = score_all(G, communities)
tokens = {'input': extraction.get('input_tokens', 0), 'output': extraction.get('output_tokens', 0)}
gods = god_nodes(G)
surprises = surprising_connections(G, communities)
labels = {cid: 'Community ' + str(cid) for cid in communities}
questions = suggest_questions(G, communities, labels)

report = generate(G, communities, cohesion, labels, gods, surprises, detection, tokens, '.', suggested_questions=questions)
Path('graphify-out/GRAPH_REPORT.md').write_text(report, encoding='utf-8')
to_json(G, communities, 'graphify-out/graph.json')

analysis = {
    'communities': {str(k): v for k, v in communities.items()},
    'cohesion': {str(k): v for k, v in cohesion.items()},
    'gods': gods, 'surprises': surprises, 'questions': questions,
}
Path('graphify-out/.graphify_analysis.json').write_text(json.dumps(analysis, indent=2, ensure_ascii=False), encoding='utf-8')
if G.number_of_nodes() == 0:
    print('ERROR: Graph is empty - extraction produced no nodes.')
    raise SystemExit(1)
print(f'Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities')
"
```

If this step prints `ERROR: Graph is empty`, stop and tell the user.

### Step 5 - Label communities

Read `graphify-out/.graphify_analysis.json`. For each community key, look at its node labels and write a 2-5 word plain-language name.

Then regenerate the report:

```bash
$(cat graphify-out/.graphify_python) -c "
import sys, json
from graphify.build import build_from_json
from graphify.cluster import score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from pathlib import Path

extraction = json.loads(Path('graphify-out/.graphify_extract.json').read_text(encoding='utf-8'))
detection  = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding='utf-8'))
analysis   = json.loads(Path('graphify-out/.graphify_analysis.json').read_text(encoding='utf-8'))

G = build_from_json(extraction)
communities = {int(k): v for k, v in analysis['communities'].items()}
cohesion = {int(k): v for k, v in analysis['cohesion'].items()}
tokens = {'input': extraction.get('input_tokens', 0), 'output': extraction.get('output_tokens', 0)}

# LABELS - replace with actual dict
labels = LABELS_DICT

questions = suggest_questions(G, communities, labels)
report = generate(G, communities, cohesion, labels, analysis['gods'], analysis['surprises'], detection, tokens, '.', suggested_questions=questions)
Path('graphify-out/GRAPH_REPORT.md').write_text(report, encoding='utf-8')
Path('graphify-out/.graphify_labels.json').write_text(json.dumps({str(k): v for k, v in labels.items()}, ensure_ascii=False), encoding='utf-8')
print('Report updated with community labels')
"
```

Replace `LABELS_DICT` with the actual dict (e.g. `{0: "Attention Mechanism", 1: "Training Pipeline"}`).

### Step 6 - Generate HTML

```bash
graphify export html
```

### Step 7 - Patch HTML: add hyperedge hull toggle

The generated HTML renders hyperedge hulls as filled convex polygons. When nodes are spread far apart by the force-directed layout, these become large blade-shaped artifacts. Patch the file to add a checkbox that toggles hull visibility (off by default).

**Find this block** in `graphify-out/graph.html`:

```html
    <div id="legend-controls">
      <label><input type="checkbox" id="select-all-cb" checked onchange="toggleAllCommunities(!this.checked)">Select All</label>
    </div>
```

**Replace with:**

```html
    <div id="legend-controls">
      <label><input type="checkbox" id="select-all-cb" checked onchange="toggleAllCommunities(!this.checked)">Select All</label>
      <label><input type="checkbox" id="hulls-cb" onchange="setHullsVisible(this.checked)">Hyperedge hulls</label>
    </div>
```

**Then find** the `afterDrawing` handler (near bottom of `<script>`):

```js
network.on('afterDrawing', function(ctx) {
    hyperedges.forEach(h => {
```

**Replace with:**

```js
let _hullsVisible = false;
function setHullsVisible(v) { _hullsVisible = v; network.redraw(); }
network.on('afterDrawing', function(ctx) {
    if (!_hullsVisible) return;
    hyperedges.forEach(h => {
```

Do this with two `edit` calls (exact string replacement). The checkbox appears in the legend controls bar; hulls are hidden by default and render on demand.

### Step 9 - Save manifest, update cost tracker, clean up

```bash
$(cat graphify-out/.graphify_python) -c "
import json
from pathlib import Path
from datetime import datetime, timezone
from graphify.detect import save_manifest

detect = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding='utf-8'))
save_manifest(detect.get('all_files') or detect['files'])

extract = json.loads(Path('graphify-out/.graphify_extract.json').read_text(encoding='utf-8'))
input_tok = extract.get('input_tokens', 0)
output_tok = extract.get('output_tokens', 0)

cost_path = Path('graphify-out/cost.json')
if cost_path.exists():
    cost = json.loads(cost_path.read_text(encoding='utf-8'))
else:
    cost = {'runs': [], 'total_input_tokens': 0, 'total_output_tokens': 0}

cost['runs'].append({
    'date': datetime.now(timezone.utc).isoformat(),
    'input_tokens': input_tok, 'output_tokens': output_tok,
    'files': detect.get('total_files', 0),
})
cost['total_input_tokens'] += input_tok
cost['total_output_tokens'] += output_tok
cost_path.write_text(json.dumps(cost, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'This run: {input_tok:,} input tokens, {output_tok:,} output tokens')
"
rm -f graphify-out/.graphify_detect.json graphify-out/.graphify_extract.json graphify-out/.graphify_ast.json graphify-out/.graphify_semantic.json graphify-out/.graphify_analysis.json
find graphify-out -maxdepth 1 -name '.graphify_chunk_*.json' -delete 2>/dev/null
rm -f graphify-out/.needs_update graphify-out/.graphify_batches.json 2>/dev/null || true
```

Tell the user:

```
Graph complete. Outputs in graphify-out/

  graph.html            - interactive graph, open in browser
  GRAPH_REPORT.md       - audit report
  graph.json            - raw graph data
```

Then paste these sections from GRAPH_REPORT.md:

- God Nodes
- Surprising Connections
- Suggested Questions

## For /graphify query

When `graphify-out/graph.json` already exists and the user asks a question about the corpus, answer from the graph:

```bash
graphify query "<question>"
```

## Honesty Rules

- Never invent an edge. If unsure, use AMBIGUOUS.
- Never skip the corpus check warning.
- Always show token cost in the report.
- Never hide cohesion scores behind symbols - show the raw number.
