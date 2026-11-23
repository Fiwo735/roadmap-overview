import { openTripFileFromDisk } from './importTrip'

let input: HTMLInputElement | null = null

/** Show the browser's file chooser and open the picked trip file. */
export function pickTripFile(): void {
  if (!input) {
    input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.hidden = true
    input.dataset.testid = 'open-trip-input'
    input.addEventListener('change', () => {
      const file = input?.files?.[0]
      if (file) void openTripFileFromDisk(file)
    })
    document.body.append(input)
  }
  // Picking the same file twice in a row must still fire `change`.
  input.value = ''
  input.click()
}
