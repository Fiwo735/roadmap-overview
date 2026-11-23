import { SIZE_PRESETS, type PresetId } from './options'

interface PresetPickerProps {
  value: PresetId
  onChange: (id: PresetId) => void
}

/** The size presets as a radio group of small cards: a sketch of the shape, the name and the pixel size. */
export function PresetPicker({ value, onChange }: PresetPickerProps) {
  return (
    <div className="presets" role="radiogroup" aria-label="Image size">
      {SIZE_PRESETS.map((preset) => {
        const ratio = preset.width / preset.height
        // A sketch of the shape in a 26 px box.
        const shape = ratio >= 1 ? { width: 26, height: Math.round(26 / ratio) } : { width: Math.round(26 * ratio), height: 26 }
        return (
        <label key={preset.id} className="preset" data-testid={`export-preset-${preset.id}`}>
          <input
            className="preset__input"
            type="radio"
            name="export-preset"
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
