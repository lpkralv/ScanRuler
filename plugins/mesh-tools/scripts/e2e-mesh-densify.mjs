// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test for Densify: drives the real app in headless Chrome on a
// box as CAD exports one — two triangles a face, twelve in all — densifies it
// from the panel at the edge it starts with, reads the edit off the list and
// the triangles off the scan's slot, and steps it back with Ctrl+Z.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/mesh-tools/scripts/e2e-mesh-densify.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canvasRect, check, finish, launchApp, loadScan, OUT_DIR, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'

/** A box `size` across about the origin, two triangles a face, wound out, as
 *  a binary STL. */
function cadBox(size) {
  const h = size / 2
  const quads = [
    [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]],
    [[-h, -h, -h], [-h, h, -h], [h, h, -h], [h, -h, -h]],
    [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]],
    [[-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h]],
    [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]],
    [[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]],
  ]
  const tris = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]])
  const buf = Buffer.alloc(84 + 50 * tris.length)
  buf.write('ScanRuler e2e CAD box', 0, 'ascii')
  buf.writeUInt32LE(tris.length, 80)
  tris.forEach((t, i) => {
    const o = 84 + 50 * i + 12
    t.forEach((p, k) => p.forEach((x, j) => buf.writeFloatLE(x, o + 12 * k + 4 * j)))
  })
  return buf
}

mkdirSync(OUT_DIR, { recursive: true })
const SCAN = join(OUT_DIR, 'mesh-densify-box.stl')
writeFileSync(SCAN, cadBox(20))

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const text = (sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim())
const shot = async (name) => {
  const r = await canvasRect(page, '.viewslot canvas')
  await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h }, path: shotPath(`mesh-densify-${name}`) })
}

await loadScan(page, SCAN)
await page.click('[data-test=workspace-mesh]')
await page.waitForSelector('[data-test=mesh-tool-densify]')
await page.click('[data-test=mesh-tool-densify]')
await page.waitForSelector('[data-test=densify-tool]')
// A hundredth of the box's 34.6 mm diagonal, on the 1-2-5 steps.
const edge = await page.$eval('[data-test=densify-edge]', (el) => el.value)
check(Number(edge) === 0.5, `the edge starts at 0.5 mm: ${edge}`)
check(!(await page.$eval('[data-test=densify-scan]', (el) => el.disabled)), 'Densify is ready')
await shot('1-before.png')

await page.click('[data-test=densify-scan]')
await page.waitForFunction(() => document.querySelectorAll('[data-test=pending-edit]').length === 1, { timeout: 300_000 })
await page.waitForFunction(() => !document.querySelector('.busyoverlay'), { timeout: 300_000 })
await sleep(800)
await shot('2-densified.png')
const listed = await text('[data-test=pending-edit]')
check(listed.includes('Densified to edges of 0.5 mm at most'), `the list says so: ${listed}`)
const added = Number(listed.replace(/.*\+([\d,]+) △.*/, '$1').replace(/,/g, ''))
check(added > 10_000, `thousands of triangles added: ${added}`)

await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction(() => document.querySelectorAll('[data-test=pending-edit]').length === 0, { timeout: 60_000 })
check(true, 'Ctrl+Z puts it back')
await finish(browser, consoleErrors)
