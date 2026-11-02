import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
  configurable: true,
  value(this: HTMLDialogElement) {
    this.open = true
  },
})

Object.defineProperty(HTMLDialogElement.prototype, 'close', {
  configurable: true,
  value(this: HTMLDialogElement) {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new Event('close'))
  },
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})
