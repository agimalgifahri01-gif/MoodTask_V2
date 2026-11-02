type Props = { eyebrow: string; title: string; description: string }

export default function PageIntro({ eyebrow, title, description }: Props) {
  return (
    <div className="page-intro">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  )
}
