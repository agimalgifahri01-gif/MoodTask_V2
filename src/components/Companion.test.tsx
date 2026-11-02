import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Companion from './Companion'

describe('Companion', () => {
  it('renders a calm expression by default', () => {
    const markup = renderToStaticMarkup(<Companion />)
    expect(markup).toContain('data-expression="calm"')
  })

  it('accepts an expression from its caller without owning mood logic', () => {
    const markup = renderToStaticMarkup(<Companion expression="happy" />)
    expect(markup).toContain('data-expression="happy"')
    expect(markup).toContain('aria-label="Ilustrasi karakter MoodTask"')
  })

  it('uses a caller-provided palette for replaceable character artwork', () => {
    const markup = renderToStaticMarkup(
      <Companion
        palette={{
          body: '#010203',
          bodyShade: '#111213',
          face: '#212223',
          clothes: '#313233',
          clothesShade: '#414243',
          feature: '#515253',
          cheek: '#616263',
          ear: '#717273',
        }}
      />,
    )
    expect(markup).toContain('fill="#010203"')
    expect(markup).toContain('fill="#313233"')
  })

  it.each(['calm', 'alert', 'anxious', 'panic', 'late', 'happy'] as const)(
    'exposes the %s expression for the visual layer',
    (expression) => {
      const markup = renderToStaticMarkup(<Companion expression={expression} />)
      expect(markup).toContain(`data-expression="${expression}"`)
    },
  )
})
