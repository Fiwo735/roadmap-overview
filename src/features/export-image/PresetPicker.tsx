interface PresetOption<T extends string> {
  id: T
  label: string
  width: number
  height: number
}

interface PresetPickerProps<T extends string> {
  presets: readonly PresetOption<T>[]
  value: T
  onChange: (id: T) => void
  /** Accessible name of the group. */
  label: string
  /** Prefix of the test ids and of the radio group's name: `<prefix>-<preset id>`. */
  testIdPrefix: string
}

/** The size presets as a radio group of small cards: a sketch of the shape, the name and the pixel size. Serves the image and the video export. */
export function PresetPicker<T extends string>({ presets, value, onChange, label, testIdPrefix }: PresetPickerProps<T>) {
  return (
    <div className="presets" role="radiogroup" aria-label={label}>
      {presets.map((preset) => {
        const ratio = preset.width / preset.height
        // A sketch of the shape in a 26 px box.
        const shape = ratio >= 1 ? { width: 26, height: Math.round(26 / ratio) } : { width: Math.round(26 * ratio), height: 26 }
        return (
          <label key={preset.id} className="preset" data-testid={`${testIdPrefix}-${preset.id}`}>
            <input
              className="preset__input"
              type="radio"
              name={testIdPrefix}
              value={preset.id}
              checked={preset.id === value}
              onChange={() => onChange(preset.id)}
            />
            <span className="preset__body">
              <span className="preset__sketch" aria-hidden="true">
                <span className="preset__shape" style={shape} />
              </span>
              <span className="preset__text">
                <span className="preset__name">{preset.label}</span>
                <span className="preset__size">
                  {preset.width} × {preset.height}
                </span>
              </span>
            </span>
          </label>
        )
      })}
    </div>
  )
}
