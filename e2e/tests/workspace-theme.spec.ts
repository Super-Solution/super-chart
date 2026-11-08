import { test, expect, openHarness, pageErrors } from './fixtures'

// The chrome reads --super-chart-* custom properties with the original dark values as fallbacks, so a host can
// restyle it without a theme, and `theme` / `setTheme` give ready-made light and dark sets.
test('workspace chrome follows theme presets and host custom properties', async ({ page }) => {
  await openHarness(page)
  const colors = await page.evaluate(async () => {
    const { H } = window as any
    const read = (container: HTMLElement): Record<string, string> => {
      const root = container.querySelector('[aria-label="Chart workspace"]')!
      const style = (element: Element): CSSStyleDeclaration => getComputedStyle(element)
      return { background: style(root).backgroundColor, text: style(root).color, button: style(root.querySelector('button')!).backgroundColor, divider: style(root.querySelector('[role=toolbar]')!).borderBottomColor, notice: style(root.querySelector('[role=alert]')!).color }
    }
    const make = async (id: string, options: Record<string, unknown>, hostStyle = ''): Promise<{ pro: any, container: HTMLElement }> => {
      const container = document.createElement('div')
      container.id = id; container.style.cssText = `height:320px;${hostStyle}`
      document.getElementById('charts')!.appendChild(container)
      const { pro } = H.mount({ chart: { container, ...options } })
      await H.ready(pro)
      return { pro, container }
    }
    const plain = await make('theme-plain', {})
    const light = await make('theme-light', { theme: 'light' })
    const custom = await make('theme-custom', {}, '--super-chart-background:rgb(34,0,51);--super-chart-surface:rgb(68,0,102)')
    const switched = await make('theme-switch', { theme: 'light' })
    switched.pro.setTheme('dark')
    return { plain: read(plain.container), light: read(light.container), custom: read(custom.container), switched: read(switched.container), lightRender: light.pro.chart.getRenderOptions().background, plainRender: plain.pro.chart.getRenderOptions().background }
  })
  // No theme: exactly the previous dark look.
  expect(colors.plain).toEqual({ background: 'rgb(16, 21, 29)', text: 'rgb(214, 222, 234)', button: 'rgb(23, 32, 44)', divider: 'rgb(40, 52, 68)', notice: 'rgb(244, 184, 174)' })
  expect(colors.light).toEqual({ background: 'rgb(255, 255, 255)', text: 'rgb(31, 41, 55)', button: 'rgb(243, 245, 248)', divider: 'rgb(227, 232, 239)', notice: 'rgb(180, 35, 24)' })
  expect(colors.lightRender).toBe('#ffffff')
  expect(colors.custom.background).toBe('rgb(34, 0, 51)')
  expect(colors.custom.button).toBe('rgb(68, 0, 102)')
  expect(colors.custom.text).toBe(colors.plain.text)
  expect(colors.switched).toEqual(colors.plain)
  const rejected = await page.evaluate(() => {
    const { H } = window as any
    try { new H.SC.ChartWorkspace(document.createElement('div'), { theme: 'neon', datafeed: {}, symbol: { ticker: 'x' }, period: { multiplier: 1, timespan: 'day', text: 'D' } }) } catch (error) { return (error as Error).message }
    return null
  })
  expect(rejected).toMatch(/theme must be/)
  expect(await pageErrors(page)).toEqual([])
})
