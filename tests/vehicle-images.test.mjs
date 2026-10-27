import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { rollup } from 'rollup'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import ts from 'typescript'

const directory = await mkdtemp(path.join(tmpdir(), 'bluelocke-images-'))
const bundle = await rollup({
  input: {
    images: 'src/resources/vehicle-images/index.ts',
    picker: 'src/vehicle-image-picker.ts',
    base: 'src/lib/bluelink-regions/base.ts',
  },
  plugins: [
    {
      name: 'typescript-test',
      transform(source, id) {
        if (!id.endsWith('.ts')) return null
        return ts.transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText
      },
    },
    nodeResolve({ extensions: ['.js', '.ts'] }),
  ],
})
await bundle.write({ dir: directory, format: 'es', entryFileNames: '[name].mjs' })
await bundle.close()
after(() => rm(directory, { recursive: true, force: true }))
globalThis.Script = { name: () => 'bluelocke' }
const load = (name) => import(pathToFileURL(path.join(directory, `${name}.mjs`)))
const { vehicleImages, resolveVehicleImage } = await load('images')
const { pickVehicleImage } = await load('picker')
const { Bluelink } = await load('base')
const lookup = { manufacturer: 'hyundai', modelName: 'Tucson', modelYear: '2026', modelTrim: 'Style' }
const green = '2026/tucson-preferred-green.png'

test('the picker catalogue covers the repository PNGs without duplicate choices', async () => {
  const files = (await readdir('assets/vehicle-images', { recursive: true })).filter((file) => file.endsWith('.png'))
  assert.deepEqual(vehicleImages.map((image) => image.id).sort(), files.sort())
  assert.equal(new Set(vehicleImages.map((image) => image.id)).size, vehicleImages.length)
  for (const image of vehicleImages) {
    assert.equal(new URL(image.url).pathname.split('/assets/vehicle-images/')[1], image.id)
    const png = await readFile(`assets/vehicle-images/${image.id}`)
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
  }
})

test('manual selection overrides vehicle matching and invalid or empty choices keep automatic matching', () => {
  const automatic = resolveVehicleImage(lookup)
  assert.match(automatic.imageUrl, /tucson-nline-black\.png$/)
  assert.match(resolveVehicleImage(lookup, green).imageUrl, /tucson-preferred-green\.png$/)
  assert.deepEqual(resolveVehicleImage(lookup, ''), automatic)
  assert.deepEqual(resolveVehicleImage(lookup, 'https://example.invalid/image.png'), automatic)
  assert.deepEqual(resolveVehicleImage(lookup, '../anything.png'), automatic)
})

test('a selected image replaces an automatic cached image and is cached independently', async () => {
  const automatic = resolveVehicleImage(lookup)
  const blackImage = { name: 'black' }
  const greenImage = { name: 'green' }
  const cache = new Map([[`/cache/${automatic.cacheKey}`, blackImage]])
  const requests = []
  globalThis.config = { runsInWidget: true }
  globalThis.FileManager = {
    local: () => ({
      libraryDirectory: () => '/cache',
      fileExists: (key) => cache.has(key),
      readImage: (key) => cache.get(key),
      writeImage: (key, image) => cache.set(key, image),
    }),
  }
  globalThis.Request = class {
    constructor(url) {
      requests.push(url)
    }
    async loadImage() {
      return greenImage
    }
  }
  const bl = Object.create(Bluelink.prototype)
  bl.config = { manufacturer: 'hyundai', vehicleImageId: green }
  bl.cache = { car: lookup }
  assert.equal(await bl.getCarImage(), greenImage)
  assert.equal(await bl.getCarImage(), greenImage)
  assert.equal(requests.length, 1)
  assert.equal(requests[0], vehicleImages.find((image) => image.id === green).url)
  bl.config.vehicleImageId = ''
  assert.equal(await bl.getCarImage(), blackImage)
  assert.equal(requests.length, 1)
})

test('the image picker distinguishes dismissal, automatic mode and an image selection', async () => {
  let choose
  globalThis.UITable = class {
    rows = []
    addRow(row) {
      this.rows.push(row)
    }
    async present() {
      choose(this.rows)
    }
  }
  globalThis.UITableRow = class {
    cells = []
    addCell(cell) {
      this.cells.push(cell)
    }
    addText(title, subtitle) {
      const cell = { title, subtitle }
      this.cells.push(cell)
      return cell
    }
  }
  globalThis.UITableCell = { imageAtURL: (url) => ({ url }) }
  choose = () => {}
  assert.equal(await pickVehicleImage(green), undefined)
  choose = (rows) => rows[0].onSelect()
  assert.equal(await pickVehicleImage(green), '')
  choose = (rows) => {
    const row = rows.find((row) => row.cells.some((cell) => cell.url?.endsWith(green)))
    assert.match(row.cells[1].title, /^✓ Tucson Preferred Green$/)
    row.onSelect()
  }
  assert.equal(await pickVehicleImage(green), green)
})
