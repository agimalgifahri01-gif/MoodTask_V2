import type { ReminderDurationInput } from './model'

const fields = [
  { unit: 'days', label: 'Hari', max: 365 },
  { unit: 'hours', label: 'Jam', max: 8_760 },
  { unit: 'minutes', label: 'Menit', max: 525_600 },
] as const

export default function ReminderDurationFields({
  value,
  onChange,
}: {
  value: ReminderDurationInput
  onChange: (unit: keyof ReminderDurationInput, value: string) => void
}) {
  return (
    <div className="task-reminder-duration">
      {fields.map(({ unit, label, max }) => (
        <label className="form-field" key={unit}>
          <span>{label}</span>
          <input
            type="number"
            min={0}
            max={max}
            step={1}
            inputMode="numeric"
            value={value[unit]}
            onChange={(event) => onChange(unit, event.target.value)}
            aria-label={`Durasi pengingat dalam ${label.toLowerCase()}`}
          />
        </label>
      ))}
    </div>
  )
}
