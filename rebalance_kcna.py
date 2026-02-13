#!/usr/bin/env python3
"""
rebalance_kcna.py

Creates 10 KCNA practice tests with 60 questions each, matching the target KCNA domain ratios:

- Kubernetes Fundamentals:            44%  -> 26 / 60
- Container Orchestration:            28%  -> 17 / 60
- Cloud Native Application Delivery:  16%  -> 10 / 60
- Cloud Native Architecture:          12%  ->  7 / 60

Inputs:
  data/kcna.test*.json

Outputs (overwrites):
  data/kcna.test1.json ... data/kcna.test10.json

How it works:
- Loads all KCNA questions from existing kcna.test*.json files
- Deduplicates by stable content hash
- Classifies each question into a topic bucket via keyword heuristics (or uses q.topic if present)
- Applies a "hardness bias" (+10–20%) when selecting questions:
    - if q.difficulty exists (easy/medium/hard/very-hard), uses it
    - else uses heuristic difficulty score (keyword density + text length)
- Builds 10 tests with target distribution (26/17/10/7), shuffled for realism
- Writes output and prints topic counts per test

Run from project root (s1.ie):
  python3 rebalance_kcna.py
"""

import json
import glob
import re
import random
import hashlib
from pathlib import Path
from collections import defaultdict, Counter
from typing import Dict, List, Any, Tuple

# ---- Settings
RANDOM_SEED = 42
random.seed(RANDOM_SEED)

DATA_DIR = Path("data")
KCNA_GLOB = str(DATA_DIR / "kcna.test*.json")

# Target split for 60 questions
TARGET_COUNTS: Dict[str, int] = {
    "Kubernetes Fundamentals": 26,
    "Container Orchestration": 17,
    "Cloud Native Application Delivery": 10,
    "Cloud Native Architecture": 7,
}

N_TESTS = 10
QUESTIONS_PER_TEST = 60

# "Harder than real" bias. 1.10 ~ 10% harder, 1.20 ~ 20% harder.
# Larger values shrink the candidate pool toward "harder" questions.
HARD_BIAS = 1.15

# ---- Topic classification keywords (tune if needed for your dataset)
TOPIC_KEYWORDS: Dict[str, List[str]] = {
    "Kubernetes Fundamentals": [
        r"\bpod\b", r"\bnode\b", r"\bkubelet\b", r"\bkubectl\b", r"\bnamespace\b",
        r"\bdeployment\b", r"\breplicaset\b", r"\bstatefulset\b", r"\bdaemonset\b",
        r"\bjob\b", r"\bcronjob\b", r"\bconfigmap\b", r"\bsecret\b",
        r"\bapi server\b", r"\betcd\b", r"\bcontrol plane\b", r"\bscheduler\b",
        r"\btaint\b", r"\btoleration\b", r"\baffinity\b",
        r"\bliveness\b", r"\breadiness\b", r"\bstartup\b",
        r"\bservice account\b", r"\brbac\b", r"\bclusterrole\b", r"\brolebinding\b",
        r"\blabel\b", r"\bselector\b", r"\bannotation\b",
    ],
    "Container Orchestration": [
        r"\bservice\b", r"\bingress\b", r"\bendpoint\b", r"\bclusterip\b", r"\bnodeport\b",
        r"\bloadbalancer\b", r"\bnetworkpolicy\b", r"\bcni\b", r"\bcoredns\b",
        r"\bhpa\b", r"\bvpa\b", r"\bautoscal", r"\bmetrics\b",
        r"\brolling update\b", r"\brollout\b",
        r"\bblue[- ]green\b", r"\bcanary\b", r"\bhelm\b", r"\bkustomize\b",
        r"\bvolume\b", r"\bpvc\b", r"\bpv\b", r"\bstorageclass\b", r"\bcsi\b",
    ],
    "Cloud Native Application Delivery": [
        r"\bci\/cd\b", r"\bci\b", r"\bcd\b", r"\bpipeline\b", r"\bgitops\b",
        r"\bargo\b", r"\bflux\b",
        r"\bobservability\b", r"\blogging\b", r"\bmetrics\b", r"\btracing\b",
        r"\bprometheus\b", r"\bgrafana\b", r"\bopentelemetry\b", r"\balert\b",
        r"\bcontainer image\b", r"\bimage\b", r"\bregistry\b", r"\bbuild\b", r"\bdeploy\b",
    ],
    "Cloud Native Architecture": [
        r"\bmicroservice\b", r"\bservice mesh\b", r"\bistio\b", r"\blinkerd\b",
        r"\bapi gateway\b", r"\bcncf\b", r"\b12[- ]factor\b",
        r"\bimmutable\b", r"\bstateless\b",
        r"\bscalability\b", r"\bresilien", r"\bfault\b", r"\bcircuit breaker\b",
        r"\bslo\b", r"\bsla\b", r"\bsli\b",
        r"\bzero trust\b", r"\bdistributed\b", r"\bevent[- ]driven\b",
    ],
}

# Preference order for tie breaks
TOPIC_PREFERENCE = [
    "Kubernetes Fundamentals",
    "Container Orchestration",
    "Cloud Native Application Delivery",
    "Cloud Native Architecture",
]


def norm_text(q: Dict[str, Any]) -> str:
    prompt = str(q.get("prompt", "")).strip()
    choices = q.get("choices", [])
    if not isinstance(choices, list):
        choices = []
    joined = " ".join([prompt] + [str(c) for c in choices])
    return joined.lower()


def stable_content_hash(q: Dict[str, Any]) -> str:
    # Hash on prompt+choices, so duplicates across files collapse.
    txt = norm_text(q)
    return hashlib.sha1(txt.encode("utf-8")).hexdigest()[:12]


def ensure_id(q: Dict[str, Any], source_prefix: str) -> Dict[str, Any]:
    qq = dict(q)
    if not qq.get("id"):
        h = stable_content_hash(qq)
        qq["id"] = f"{source_prefix}-{h}"
    else:
        qq["id"] = str(qq["id"])
    return qq


def classify_topic(q: Dict[str, Any]) -> str:
    # Respect existing topic if already present and matches our set
    existing = str(q.get("topic", "")).strip()
    if existing in TARGET_COUNTS:
        return existing

    txt = norm_text(q)
    scores: Dict[str, int] = {}
    for topic, pats in TOPIC_KEYWORDS.items():
        scores[topic] = sum(1 for p in pats if re.search(p, txt, re.IGNORECASE))

    max_score = max(scores.values()) if scores else 0
    if max_score == 0:
        return "Kubernetes Fundamentals"

    tied = [t for t, s in scores.items() if s == max_score]
    for pref in TOPIC_PREFERENCE:
        if pref in tied:
            return pref
    return tied[0]


def difficulty_score(q: Dict[str, Any]) -> int:
    """
    Returns a numeric score; higher = harder.
    If q.difficulty exists, uses it. Else heuristics.
    """
    d = str(q.get("difficulty", "")).strip().lower()
    if d in {"very-hard", "veryhard", "vh"}:
        return 100
    if d in {"hard", "h"}:
        return 80
    if d in {"medium", "med", "m"}:
        return 55
    if d in {"easy", "e"}:
        return 30

    txt = norm_text(q)

    # heuristic: longer stems + more technical keywords => harder
    length_component = min(len(txt), 1200) // 40  # 0..30
    keyword_hits = 0
    for pats in TOPIC_KEYWORDS.values():
        for p in pats:
            if re.search(p, txt, re.IGNORECASE):
                keyword_hits += 1
    keyword_component = min(keyword_hits * 3, 60)

    return 20 + length_component + keyword_component


def load_all_questions() -> List[Dict[str, Any]]:
    files = sorted(glob.glob(KCNA_GLOB))
    if not files:
        raise SystemExit("No kcna.test*.json found under ./data")

    all_questions: List[Dict[str, Any]] = []
    for fp in files:
        p = Path(fp)
        with open(p, "r", encoding="utf-8") as f:
            doc = json.load(f)

        qs = doc.get("questions", [])
        if not isinstance(qs, list):
            continue

        for q in qs:
            if not isinstance(q, dict):
                continue
            qq = ensure_id(q, p.stem)
            qq["_source"] = p.name
            qq["_hash"] = stable_content_hash(qq)
            qq["_topic"] = classify_topic(qq)
            all_questions.append(qq)

    return all_questions


def dedupe_questions(all_q: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Deduplicate by stable content hash.
    If duplicates exist, keep the one with higher difficulty_score (harder version).
    """
    best_by_hash: Dict[str, Dict[str, Any]] = {}
    for q in all_q:
        h = q.get("_hash")
        if not h:
            continue
        cur = best_by_hash.get(h)
        if cur is None or difficulty_score(q) > difficulty_score(cur):
            best_by_hash[h] = q

    return list(best_by_hash.values())


def pick_hard_biased(bucket: List[Dict[str, Any]], k: int, hard_bias: float) -> List[Dict[str, Any]]:
    """
    Picks k questions from bucket with bias toward harder ones by shrinking
    the eligible pool toward the top difficulty segment.
    """
    if k <= 0:
        return []
    if not bucket:
        return []

    # bucket assumed sorted by difficulty desc
    # hard_bias > 1 shrinks the pool towards the top
    top_n = max(k, int(len(bucket) / hard_bias))
    pool = bucket[:top_n].copy()
    random.shuffle(pool)
    return pool[:k]


def build_tests(pool: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    by_topic: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for q in pool:
        by_topic[q["_topic"]].append(q)

    # sort each bucket by difficulty desc (harder first)
    for t in by_topic:
        by_topic[t].sort(key=difficulty_score, reverse=True)

    all_sorted = sorted(pool, key=difficulty_score, reverse=True)

    tests: List[List[Dict[str, Any]]] = []

    for test_i in range(1, N_TESTS + 1):
        chosen: List[Dict[str, Any]] = []
        chosen_ids = set()

        # pick per topic
        for topic, count in TARGET_COUNTS.items():
            bucket = by_topic.get(topic, [])

            picks = pick_hard_biased(bucket, count, HARD_BIAS)

            # ensure unique within the test
            filtered = []
            for q in picks:
                if q["id"] in chosen_ids:
                    continue
                filtered.append(q)
                chosen_ids.add(q["id"])
                if len(filtered) == count:
                    break

            # if short, fill from the full bucket (still prefer hard, bucket is sorted)
            if len(filtered) < count:
                for q in bucket:
                    if q["id"] in chosen_ids:
                        continue
                    filtered.append(q)
                    chosen_ids.add(q["id"])
                    if len(filtered) == count:
                        break

            chosen.extend(filtered)

        # fill any remaining slots from global hard list
        if len(chosen) < QUESTIONS_PER_TEST:
            need = QUESTIONS_PER_TEST - len(chosen)
            for q in all_sorted:
                if q["id"] in chosen_ids:
                    continue
                chosen.append(q)
                chosen_ids.add(q["id"])
                need -= 1
                if need == 0:
                    break

        # final shuffle for realism
        random.shuffle(chosen)

        # export: remove internal keys but keep topic for future balancing/filters
        exported = []
        for q in chosen[:QUESTIONS_PER_TEST]:
            out = {k: v for k, v in q.items() if not k.startswith("_")}
            out["topic"] = q["_topic"]
            exported.append(out)

        tests.append(exported)

    return tests


def write_tests(tests: List[List[Dict[str, Any]]]) -> None:
    for i, questions in enumerate(tests, start=1):
        out_path = DATA_DIR / f"kcna.test{i}.json"
        payload = {
            "title": f"KCNA Test {i}",
            "version": "1.0",
            "questions": questions
        }
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Wrote {out_path} ({len(questions)} questions)")


def report_distribution(tests: List[List[Dict[str, Any]]]) -> None:
    print("\n=== Distribution Report ===")
    print("Target:", TARGET_COUNTS)
    for i, qs in enumerate(tests, start=1):
        c = Counter(q.get("topic", "") for q in qs)
        print(f"\nTest {i}:")
        for t in TOPIC_PREFERENCE:
            print(f"  {t}: {c.get(t, 0)}")
        total = sum(c.values())
        print(f"  Total: {total}")


def main() -> None:
    if not DATA_DIR.exists():
        raise SystemExit("No ./data folder found. Run this from project root (s1.ie).")

    all_q = load_all_questions()
    print(f"Loaded {len(all_q)} questions from existing KCNA files.")

    pool = dedupe_questions(all_q)
    print(f"Deduped pool size: {len(pool)} unique questions.")

    # sanity: ensure enough questions per topic
    by_topic = Counter(q["_topic"] for q in pool)
    print("\nPool by topic:")
    for t in TOPIC_PREFERENCE:
        print(f"  {t}: {by_topic.get(t, 0)}")

    min_needed = {t: TARGET_COUNTS[t] for t in TARGET_COUNTS}
    missing = [t for t in TARGET_COUNTS if by_topic.get(t, 0) < min_needed[t]]
    if missing:
        print("\nWARNING: Pool may not have enough questions in these topics to perfectly hit targets:")
        for t in missing:
            print(f"  {t}: have {by_topic.get(t, 0)} need at least {min_needed[t]}")
        print("The script will still build tests, but may fill shortages from other topics.")

    tests = build_tests(pool)
    write_tests(tests)
    report_distribution(tests)
    print("\nDone.")


if __name__ == "__main__":
    main()
    tests = build_tests(pool)

    # Backup existing outputs before overwriting
    backup_dir = DATA_DIR / "_backup_before_rebalance"
    backup_dir.mkdir(exist_ok=True)
    for i in range(1, N_TESTS + 1):
        p = DATA_DIR / f"kcna.test{i}.json"
        if p.exists():
            p.replace(backup_dir / p.name)

    write_tests(tests)
    report_distribution(tests)
    print("\nDone. Previous kcna.test*.json backed up to data/_backup_before_rebalance/")
