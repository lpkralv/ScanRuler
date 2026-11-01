// SPDX-License-Identifier: AGPL-3.0-only
// Densify: the triangles of an STL exported from CAD split until no edge is
// longer than a length, so its faces have points to read.

import { InfoDot } from '../../../../src/ui/InfoDot'
import { NumberField } from '../../../../src/ui/NumberField'
import { useMeshTools } from '../../state/meshStore'

export function DensifyTool({ ready, busy, onDensify }: { ready: boolean; busy: boolean; onDensify: () => void }) {
  const m = useMeshTools()

  return (
    <div className="group" data-test="densify-tool">
      <div className="sec-head">
        Densify
        <InfoDot title="Densifying a CAD export">
          <p>
            An STL exported from CAD has its points only on the edges and rims of the part: a flat
            face is a few long triangles from one rim to the next, with nothing inside. A scan is
            points all over. Whatever reads the surface off its points — finding regions, a fit
            started from a click, the noise a check reads — finds nothing inside a face of a CAD
            export, or reads across an edge.
          </p>
          <p>
            Densify splits every edge longer than <b>Longest edge</b> at its middle until none is
            left, so the faces fill with points. Each new point lies on the triangle it was made on:
            the part does not change shape or volume, and the points on a bore's rim stay exactly on
            its circle. It changes the edited copy; <b>Ctrl+Z</b> puts it back.
          </p>
        </InfoDot>
      </div>

      <NumberField
        label="Longest edge"
        testId="densify-edge"
        value={m.densifyEdge}
        step={0.1}
        min={0.001}
        kind="length"
        disabled={busy}
        onCommit={m.setDensifyEdge}
        hint="No edge is left longer than this. It starts at a hundredth of the part's size; a shorter edge makes many more points."
      />

      <button className="primary block" data-test="densify-scan" data-confirm={1} disabled={!ready || busy} onClick={onDensify}>
        {m.editing ? (
          <>
            <span className="spinner" />
            Densifying…
          </>
        ) : (
          'Densify'
        )}
      </button>
    </div>
  )
}
