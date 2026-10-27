import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import { rollup } from 'rollup'
import ts from 'typescript'

async function compile(entry) {
  const globals = {}
  const bundle = await rollup({
    input: path.resolve(entry),
    external(id, importer) {
      if (!importer || /widget-actions(?:\.ts)?$/.test(id)) return false
      globals[id] ??= `dependency${Object.keys(globals).length}`
      return true
    },
    plugins: [
      {
        name: 'typescript-test',
        resolveId(id) {
          if (id.endsWith('widget-actions')) return path.resolve('src/widget-actions.ts')
        },
        async load(id) {
          return ts.transpileModule(await readFile(id, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
          }).outputText
        },
      },
    ],
  })
  const { output } = await bundle.generate({
    format: 'iife',
    name: 'module',
    globals(id) {
      const key = path.isAbsolute(id) ? `./${path.relative(path.resolve('src'), id)}` : id
      return globals[key]
    },
  })
  await bundle.close()
  return (mocks, context) => {
    for (const [id, name] of Object.entries(globals)) context[name] = mocks[id] || {}
    vm.runInNewContext(output[0].code, context)
    return context.module
  }
}

const loadWidget = await compile('src/widget.ts')
const loadApp = await compile('src/app.ts')
const loadIndex = await compile('src/index.ts')
const loadActions = await compile('src/widget-actions.ts')
const logger = { log() {} }
const image = { size: { width: 800, height: 320 } }

class Stack {
  children = []
  axis = 'vertical'
  addStack() {
    const stack = new Stack()
    this.children.push(stack)
    return stack
  }
  addText(text) {
    const label = { text, rightAlignText() {}, leftAlignText() {} }
    this.children.push(label)
    return label
  }
  addImage(image) {
    const node = { image }
    this.children.push(node)
    return node
  }
  addSpacer(length = 0) {
    this.children.push({ length })
  }
  layoutHorizontally() {
    this.axis = 'horizontal'
  }
  layoutVertically() {
    this.axis = 'vertical'
  }
  centerAlignContent() {}
  setPadding(top, left, bottom, right) {
    this.padding = { top, left, bottom, right }
  }
}

function height(node) {
  if ('text' in node) return node.font * 1.2
  if ('image' in node) return node.imageSize.height
  if ('length' in node) return node.length
  const heights = node.children.map((child) => (node.axis === 'horizontal' && 'length' in child ? 0 : height(child)))
  const content = node.axis === 'horizontal' ? Math.max(0, ...heights) : heights.reduce((a, b) => a + b, 0)
  return Math.max(node.size?.height || 0, content)
}

function flatten(node) {
  return [node, ...(node.children || []).flatMap(flatten)]
}

function status() {
  return {
    car: { nickName: '2026 Tucson', odometer: 23700 },
    status: {
      fuelLevel: 41,
      soc: 80,
      range: 281,
      odometer: 23700,
      twelveSoc: 96,
      lastStatusCheck: Date.now(),
      lastRemoteStatusCheck: Date.now(),
      isCharging: false,
      isPluggedIn: false,
      chargingPower: 7,
      remainingChargeTimeMins: 30,
    },
  }
}

function config() {
  return {
    widgetAppearance: 'dark',
    widgetConfig: {
      standardPollPeriod: 1,
      remotePollPeriod: 1,
      chargingRemotePollPeriod: 1,
      nightStandardPollPeriod: 1,
      nightRemotePollPeriod: 1,
      nightChargingRemotePollPeriod: 1,
    },
    auth: { region: 'europe' },
  }
}

function context() {
  class Color {
    constructor(hex) {
      this.hex = hex
    }
    static white() {
      return 'white'
    }
    static black() {
      return 'black'
    }
    static green() {
      return 'green'
    }
    static red() {
      return 'red'
    }
    static orange() {
      return 'orange'
    }
  }
  return {
    Script: { name: () => 'bluelocke' },
    URLScheme: { forRunningScript: () => 'scriptable:///run?scriptName=bluelocke' },
    Color,
    Font: new Proxy({}, { get: () => (size) => size }),
    Size: class {
      constructor(width, height) {
        this.width = width
        this.height = height
      }
    },
    SFSymbol: { named: (symbol) => ({ image: { ...image, symbol } }) },
    ListWidget: Stack,
    Keychain: { contains: () => false, set() {} },
    Timer: { schedule: () => ({ invalidate() {} }) },
  }
}

test('medium widget keeps energy and summary data, links actions and fits all supported sizes', async () => {
  for (const [width, maxHeight] of [
    [375, 155],
    [390, 158],
    [440, 170],
  ]) {
    for (const [charging, appearance, systemDark = false] of [
      [false, 'dark'],
      [true, 'dark'],
      [false, 'white'],
      [true, 'white'],
      [false, 'system', false],
      [true, 'system', false],
      [false, 'system', true],
      [true, 'system', true],
    ]) {
      const data = status()
      data.status.isCharging = charging
      data.status.isPluggedIn = charging
      const env = context()
      env.Device = { screenSize: () => ({ width, height: 900 }), isUsingDarkAppearance: () => systemDark }
      const { createMediumWidget } = loadWidget(
        {
          './lib/util': {
            getIconName: (key) => key,
            tintSFSymbol: () => {
              throw new Error('Widget icons must not use WebView tinting')
            },
            getTintedIconAsync: () => {
              throw new Error('Widget icons must not use WebView tinting')
            },
            getChargingIcon: () => (charging ? 'charging' : undefined),
            getBatteryPercentColor: () => 'green',
            getChargeCompletionString: () => '21:30',
            getChargingPowerString: () => '7 kW',
          },
          './lib/logger': {
            Logger: class {
              log() {}
            },
          },
        },
        env,
      )
      const widgetConfig = { ...config(), widgetAppearance: appearance }
      const widget = await createMediumWidget(widgetConfig, {
        getCachedStatus: () => data,
        getCarImage: async () => image,
        supportsChargingFeatures: () => charging,
        getDistanceUnit: () => 'km',
      })
      const nodes = flatten(widget)
      const texts = nodes.filter((node) => 'text' in node).map((node) => node.text)
      assert.ok(texts.includes(charging ? '80%' : '41%'))
      assert.ok(texts.includes('281 km'))
      assert.ok(texts.includes('23700 km'))
      assert.ok(texts.includes('12V 96%'))
      assert.ok(!texts.some((text) => /Tucson|Fuel|~/.test(text)))
      const textColor = appearance === 'dark' || (appearance === 'system' && systemDark) ? 'white' : 'black'
      assert.equal(nodes.find((node) => node.text === '281 km').textColor, textColor)
      assert.equal(
        nodes.find((node) => node.text === (charging ? '80%' : '41%')).textColor,
        charging ? 'green' : textColor,
      )
      const buttons = nodes.filter((node) => node.url)
      for (const button of buttons) {
        const icons = button.children.filter((node) => node.image)
        assert.equal(icons.length, 1)
        assert.equal(icons[0].tintColor.hex, '0A84FF')
        assert.ok(icons[0].image.symbol)
      }
      const symbols = nodes.filter((node) => node.image?.symbol)
      for (const symbol of symbols) {
        assert.notEqual(symbol.tintColor, 'white')
        assert.notEqual(symbol.tintColor, 'black')
      }
      if (!charging) assert.equal(nodes.find((node) => node.image?.symbol === 'fuel').tintColor.hex, '0A84FF')
      assert.equal(nodes.find((node) => node.image?.symbol === 'last-update').tintColor.hex, '0A84FF')
      const urls = buttons.map((node) => new URL(node.url))
      assert.deepEqual(
        urls.map((url) => url.searchParams.get('action')),
        ['lock', 'refresh', 'unlock'],
      )
      assert.ok(urls.every((url) => url.searchParams.get('scriptName') === 'bluelocke'))
      const actualHeight = height(widget) + widget.padding.top + widget.padding.bottom
      assert.ok(actualHeight <= maxHeight, `${width}, charging=${charging}: ${actualHeight} > ${maxHeight}`)
    }
  }
})

test('action URLs preserve the current script name and reject unrecognized actions', () => {
  for (const url of ['scriptable:///run/My%20Car', 'scriptable:///run?scriptName=My%20Car']) {
    const { getWidgetAction, getWidgetActionUrl } = loadActions(
      {},
      {
        URLScheme: { forRunningScript: () => url },
      },
    )
    const action = getWidgetAction('unlock')
    assert.equal(new URL(getWidgetActionUrl(action)).searchParams.get('action'), 'unlock')
    assert.equal(getWidgetAction('unlock everything'), undefined)
    assert.equal(getWidgetAction('climate'), undefined)
    assert.equal(getWidgetAction(undefined), undefined)
    assert.equal(getWidgetAction({ key: 'unlock' }), undefined)
  }
})

test('widget buttons run through the app command handler and show the real result', async () => {
  for (const [key, command] of [
    ['lock', 'lock'],
    ['refresh', 'status'],
    ['unlock', 'unlock'],
  ]) {
    for (const success of [false, true]) {
      const data = status()
      const calls = []
      const states = []
      let screen, callback
      const table = {
        present: (options) => {
          screen = options
          return Promise.resolve()
        },
        setState: (state) => states.push(state),
        connect: () => () => {},
      }
      const env = context()
      const { getWidgetAction } = loadActions({}, env)
      const action = getWidgetAction(key)
      const util = {
        getAppLogger: () => logger,
        loadTintedIcons: async () => {},
        getAngledTintedIconAsync: async () => image,
        sleep: () => new Promise(() => {}),
      }
      const { createApp } = loadApp(
        {
          './lib/util': util,
          'lib/util': util,
          './lib/bluelink-regions/base': { formatVehicleDisplayName: () => 'Tucson' },
          config: { getConfig: config },
          'lib/scriptable-utils': { getTable: () => table },
        },
        env,
      )
      await createApp(
        config(),
        {
          getCachedStatus: () => data,
          getCarImage: async () => image,
          processRequest: async (type, payload, cb) => {
            calls.push([type, payload])
            callback = cb
          },
        },
        action,
      )
      assert.equal(calls.length, 0)
      await screen.afterFirstRender()
      assert.deepEqual(calls, [[command, undefined]])
      await callback(false, false)
      assert.equal(states.at(-1).updatingActions[action.actionKey].text, action.updatingText)
      await callback(true, success, command === 'status' ? data : data.status)
      const results = states.filter((state) => state.updatingActions)
      assert.equal(
        results.at(-1).updatingActions[action.actionKey].text,
        success ? action.successText : action.failureText,
      )
      assert.equal(
        states.some((state) => state.range === 281),
        success,
      )
    }
  }
})

test('only foreground action URLs are dispatched, with authentication refreshed first', async () => {
  for (const mode of ['app', 'siri', 'widget']) {
    for (const key of ['lock', 'refresh', 'unlock', 'unlock everything']) {
      const calls = []
      const env = context()
      env.config = { runsWithSiri: mode === 'siri', runsInWidget: mode === 'widget' }
      env.args = { queryParameters: { action: key }, shortcutParameter: 'status' }
      env.Script.complete = () => {}
      env.Script.setWidget = () => {}
      env.Script.setShortcutOutput = () => {}
      env.App = { close() {} }
      loadIndex(
        {
          'lib/bluelink': {
            initRegionalBluelink: async (_config, refresh) => {
              calls.push(['init', refresh])
              return { loginFailed: () => false, needRestart: () => false }
            },
          },
          './lib/util': { getAppLogger: () => logger },
          config: { configExists: () => true, getConfig: config },
          app: { createApp: async (_config, _bl, action) => calls.push(['app', action?.key]) },
          siri: { processSiriRequest: async (_config, _bl, parameter) => calls.push(['siri', parameter]) },
          widget: { createMediumWidget: async () => calls.push(['widget']) },
        },
        env,
      )
      await new Promise(setImmediate)
      const recognized = key !== 'unlock everything'
      assert.equal(calls[0][1], mode !== 'app' || recognized)
      assert.deepEqual(
        calls[1],
        mode === 'app' ? ['app', recognized ? key : undefined] : mode === 'siri' ? ['siri', 'status'] : ['widget'],
      )
    }
  }
})
