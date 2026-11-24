"""Trigger test for the real plan-brief project skill.

Based on skill-creator's run_eval.py, but it detects the real skill instead of a
temporary renamed copy, so CLAUDE.md and the skill listing are exactly what a user
gets. Each query runs `claude -p` in the repo. The run is stopped at the first tool
call: a Skill call naming plan-brief, or a Read of its SKILL.md, counts as triggered;
any other first tool, or an answer with no tool, counts as not triggered. The tool
never runs, because the process is killed before the model's message ends.

Usage: python3 run-trigger-tests.py <queries.json> <repo> <model> <runs> <workers> <timeout>
Set CLAUDE_BIN to use a claude binary other than the one on PATH. See README.md here.
"""
import json
import os
import select
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed


def run_one(query, repo, model, timeout):
    cmd = [os.environ.get("CLAUDE_BIN", "claude"), "-p", query, "--output-format", "stream-json", "--verbose",
           "--include-partial-messages", "--model", model]
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=repo, env=env)
    start = time.time()
    buf = ""
    tool = None
    acc = ""
    try:
        while time.time() - start < timeout:
            if proc.poll() is not None:
                rest = proc.stdout.read()
                if rest:
                    buf += rest.decode("utf-8", errors="replace")
            else:
                ready, _, _ = select.select([proc.stdout], [], [], 1.0)
                if not ready:
                    continue
                chunk = os.read(proc.stdout.fileno(), 8192)
                if not chunk:
                    break
                buf += chunk.decode("utf-8", errors="replace")
            while "\n" in buf:
                line, buf = buf.split("\n", 1)
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if ev.get("type") != "stream_event":
                    if ev.get("type") == "result":
                        return False, "no tool (answered)"
                    continue
                se = ev.get("event", {})
                t = se.get("type", "")
                if t == "content_block_start":
                    cb = se.get("content_block", {})
                    if cb.get("type") == "tool_use":
                        tool = cb.get("name", "")
                        acc = ""
                        if tool not in ("Skill", "Read"):
                            return False, f"first tool: {tool}"
                elif t == "content_block_delta" and tool:
                    d = se.get("delta", {})
                    if d.get("type") == "input_json_delta":
                        acc += d.get("partial_json", "")
                elif t == "content_block_stop" and tool:
                    hit = ("plan-brief" in acc) if tool == "Skill" else ("skills/plan-brief" in acc)
                    return hit, f"first tool: {tool} {acc[:80]}"
                elif t == "message_stop":
                    return False, "no tool (answered)"
            if proc.poll() is not None and "\n" not in buf:
                break
        return False, "timeout"
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def main():
    queries_path, repo, model, runs, workers, timeout = sys.argv[1:7]
    runs, workers, timeout = int(runs), int(workers), int(timeout)
    items = json.load(open(queries_path))
    results = {i: [] for i in range(len(items))}
    with ProcessPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(run_one, it["query"], repo, model, timeout): i
                for i, it in enumerate(items) for _ in range(runs)}
        for f in as_completed(futs):
            i = futs[f]
            try:
                results[i].append(f.result())
            except Exception as e:  # noqa: BLE001
                results[i].append((False, f"error: {e}"))
            print(f"done {sum(len(v) for v in results.values())}/{len(items) * runs}", file=sys.stderr, flush=True)
    out = []
    for i, it in enumerate(items):
        hits = sum(1 for h, _ in results[i] if h)
        rate = hits / len(results[i])
        passed = rate >= 0.5 if it["should_trigger"] else rate < 0.5
        out.append({"query": it["query"], "should_trigger": it["should_trigger"], "triggers": hits,
                    "runs": len(results[i]), "pass": passed, "notes": [n for _, n in results[i]]})
    summary = {"total": len(out), "passed": sum(r["pass"] for r in out)}
    json.dump({"model": model, "summary": summary, "results": out}, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
