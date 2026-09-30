import React, { useMemo } from "react";
import { createPortal } from "react-dom";
import { trackKey } from "../api";
import "./LineageTree.css";

/**
 * The whole family, on demand — what a cover was made from, every voice tried
 * on it, what those covers were made from in turn. A row only ever shows one
 * hop of that (its own parent, one click away); this is for the times a person
 * genuinely wants the shape of the thing, the way a programmer opens a git log
 * graph instead of reading commits one `git show` at a time.
 *
 * Built from the same flat, already-merged row list the library renders — no
 * separate fetch. A "track" (a song or an import) can hold several rows, one
 * per voice it has been sung in; those collapse back into one family node here
 * with its voices as branches, since that grouping is what a row already is.
 */

function buildFamily(rows) {
  const byTrack = new Map();
  rows.forEach((row) => {
    const list = byTrack.get(row.id) || [];
    list.push(row);
    byTrack.set(row.id, list);
  });

  const nodes = new Map();
  byTrack.forEach((group) => {
    // A song or an import usually has an unvoiced home row to anchor on. A
    // plain song sung in two voices with no cover involved does not — neither
    // "anne" nor "dualipaimported" is more the home than the other — so any
    // row stands in for it. An orphaned conversion is the one true leaf: a
    // single row, no siblings, nothing to branch into. Treating that lone row
    // as its own child as well as its own home nested it one level inside
    // itself, which is what `group.length > 1` guards against below.
    const home = group.find((row) => !row.voice) || group[0];
    const homeKey = trackKey(home);
    nodes.set(homeKey, {
      key: homeKey,
      rowId: home.rowId ?? home.id,
      title: home.title,
      kind: home.kind === "upload" ? "upload" : home.kind === "conversion" ? "voice" : "song",
      derivation: home.derivation,
      parentKey: home.sourceSongId || home.sourceId || null,
      createdAt: home.createdAt,
    });
    if (group.length <= 1) return;

    group
      .filter((row) => row.voice)
      .forEach((row) => {
        const key = `${homeKey}::${row.voice}`;
        const versions = (row.takes || []).filter((item) => item.kind === "voice").length;
        nodes.set(key, {
          key,
          rowId: row.rowId,
          title: row.voice,
          kind: "voice",
          parentKey: homeKey,
          versions,
          createdAt: row.createdAt,
        });
      });
  });

  const childrenOf = new Map();
  nodes.forEach((node) => {
    if (!node.parentKey) return;
    const list = childrenOf.get(node.parentKey) || [];
    list.push(node.key);
    childrenOf.set(node.parentKey, list);
  });
  childrenOf.forEach((list) =>
    list.sort((a, b) => String(nodes.get(a)?.createdAt || "").localeCompare(nodes.get(b)?.createdAt || ""))
  );

  return { nodes, childrenOf };
}

/** The root of this family — walk parent links until one is missing or unknown. */
function findRoot(nodes, startKey) {
  let current = nodes.get(startKey);
  if (!current) return startKey;
  const seen = new Set();
  while (current.parentKey && nodes.has(current.parentKey) && !seen.has(current.key)) {
    seen.add(current.key);
    current = nodes.get(current.parentKey);
  }
  return current.key;
}

const KIND_LABEL = { song: "Created", upload: "Imported", voice: "Voice" };

function Branch({ node, nodes, childrenOf, activeKey, onJump, depth }) {
  if (!node || depth > 12) return null;
  const kids = (childrenOf.get(node.key) || []).map((key) => nodes.get(key)).filter(Boolean);
  return (
    <li className="rx-lineage-node">
      <button
        type="button"
        className="rx-lineage-btn"
        data-active={node.key === activeKey ? "" : undefined}
        onClick={() => onJump(node.rowId)}
      >
        <span className="rx-lineage-title">{node.title}</span>
        <span className="rx-lineage-kind">
          {KIND_LABEL[node.kind] || node.kind}
          {node.versions > 1 ? ` · ${node.versions} versions` : ""}
        </span>
      </button>
      {kids.length > 0 && (
        <ul className="rx-lineage-children">
          {kids.map((kid) => (
            <Branch
              key={kid.key}
              node={kid}
              nodes={nodes}
              childrenOf={childrenOf}
              activeKey={activeKey}
              onJump={onJump}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function LineageTree({ rows, rootKey, onJump, onClose }) {
  const { nodes, childrenOf } = useMemo(() => buildFamily(rows), [rows]);
  const root = useMemo(() => nodes.get(findRoot(nodes, rootKey)), [nodes, rootKey]);

  // Ported straight to <body>: the view it opens from is mid-mount-animation
  // often enough that a CSS `transform` is live on an ancestor, which turns
  // that ancestor into the containing block for anything `position: fixed`
  // beneath it — the overlay would then sit wherever that ancestor happens to
  // be in the page's normal flow instead of covering the viewport. Escaping
  // the tree entirely sidesteps depending on which ancestor that is today.
  //
  // Every colour and reset in this app hangs off `.rx` — a portal leaves that
  // ancestor behind too, so it is re-declared here. The theme attribute is
  // read off the live root rather than threaded down as a prop: this is the
  // one place outside the normal tree that needs to know it at all.
  const theme = document.querySelector(".rx")?.getAttribute("data-theme") || undefined;
  return createPortal(
    <div className="rx rx-lineage-portal" data-theme={theme}>
    <div className="rx-lineage-overlay" onClick={onClose}>
      <div
        className="rx-lineage-card"
        role="dialog"
        aria-label="Track history"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="rx-lineage-head">
          <b>History</b>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="rx-lineage-body">
          {root ? (
            <ul className="rx-lineage-children rx-lineage-root">
              <Branch
                node={root}
                nodes={nodes}
                childrenOf={childrenOf}
                activeKey={rootKey}
                onJump={(rowId) => {
                  onJump(rowId);
                  onClose();
                }}
                depth={0}
              />
            </ul>
          ) : (
            <span className="hint">This track has no history to show.</span>
          )}
        </div>
      </div>
    </div>
    </div>,
    document.body
  );
}
