export type CompanionExpression =
  'calm' | 'alert' | 'anxious' | 'panic' | 'late' | 'happy'

export type CompanionPalette = {
  body: string
  bodyShade: string
  face: string
  clothes: string
  clothesShade: string
  feature: string
  cheek: string
  ear: string
}

const defaultPalette: CompanionPalette = {
  body: '#f3b36f',
  bodyShade: '#e99b52',
  face: '#ffd29c',
  clothes: '#aac8bc',
  clothesShade: '#92b5a6',
  feature: '#503a31',
  cheek: '#ef9b85',
  ear: '#f4bd7e',
}

type CompanionProps = {
  expression?: CompanionExpression
  className?: string
  label?: string
  palette?: CompanionPalette
}

export default function Companion({
  expression = 'calm',
  className = '',
  label = 'Ilustrasi karakter MoodTask',
  palette = defaultPalette,
}: CompanionProps) {
  const eyes = {
    calm: 'M76 91q4 5 8 0M116 91q4 5 8 0',
    alert: 'M79 90a4.5 5 0 1 0 0-.1M119 90a4.5 5 0 1 0 0-.1',
    anxious: 'M78 91a4 4.5 0 1 0 0-.1M118 91a4 4.5 0 1 0 0-.1',
    panic: 'M79 90a5.5 6 0 1 0 0-.1M119 90a5.5 6 0 1 0 0-.1',
    late: 'M76 91q4-3 8 0M116 91q4-3 8 0',
    happy: 'M76 91q5 7 10 0M116 91q5 7 10 0',
  }[expression]
  const eyebrows = {
    calm: '',
    alert: 'M73 82q7-5 15 0M113 82q7-5 15 0',
    anxious: 'M73 84q7 2 15-2M113 82q7 4 15 2',
    panic: 'M72 80q8-7 16-1M112 79q8-6 16 0',
    late: 'M74 85q7 4 14 1M114 86q7-3 14-5',
    happy: '',
  }[expression]
  const mouth = {
    calm: 'M91 102q9 10 18 0',
    alert: 'M93 106q7 2 14 0',
    anxious: 'M92 108q8-6 16 0',
    panic: 'M95 103a5 6 0 1 0 10 0a5 6 0 1 0-10 0',
    late: 'M91 109q9-8 18 0',
    happy: 'M91 105q7 7 14 0',
  }[expression]

  return (
    <svg
      className={`companion ${className}`}
      viewBox="0 0 200 220"
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-expression={expression}
    >
      <ellipse cx="100" cy="204" rx="58" ry="8" fill="#d8d4c9" opacity=".45" />
      <path
        d="M47 137c0-34 23-59 53-59s53 25 53 59v35c0 16-12 27-28 27H75c-16 0-28-11-28-27z"
        fill={palette.body}
      />
      <path
        d="M54 128c5-31 24-51 46-51s41 20 46 51c-14-11-29-15-46-15s-32 4-46 15"
        fill={palette.bodyShade}
      />
      <ellipse cx="100" cy="108" rx="52" ry="44" fill={palette.face} />
      {eyebrows && (
        <path
          d={eyebrows}
          fill="none"
          stroke={palette.feature}
          strokeWidth="3"
          strokeLinecap="round"
        />
      )}
      <path
        d={eyes}
        fill="none"
        stroke={palette.feature}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d={mouth}
        fill="none"
        stroke={palette.feature}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <ellipse
        cx="67"
        cy="111"
        rx="7"
        ry="4"
        fill={palette.cheek}
        opacity=".55"
      />
      <ellipse
        cx="133"
        cy="111"
        rx="7"
        ry="4"
        fill={palette.cheek}
        opacity=".55"
      />
      <path
        d="M58 159c10-10 21-15 34-15h16c13 0 24 5 34 15v31c0 5-4 9-9 9H67c-5 0-9-4-9-9z"
        fill={palette.clothes}
      />
      <path
        d="M58 159q42 18 84 0"
        fill="none"
        stroke={palette.clothesShade}
        strokeWidth="3"
      />
      <circle cx="52" cy="77" r="8" fill={palette.ear} />
      <circle cx="148" cy="77" r="8" fill={palette.ear} />
    </svg>
  )
}
