import Companion from '../../components/Companion'
import { getCharacter } from './catalog'
import { getCompanionExpression } from './moodAdapter'
import { taskMoodLabels, type TaskMood } from '../tasks/domain'

type Props = {
  mood: TaskMood
  characterId?: string
  className?: string
  label?: string
}

/** Mood remains a domain input; the catalog and SVG renderer only present it. */
export default function CharacterPresence({
  mood,
  characterId = 'momo',
  className,
  label,
}: Props) {
  const character = getCharacter(characterId)
  return (
    <Companion
      className={className}
      expression={getCompanionExpression(mood)}
      label={
        label ?? `${character.name}, ${taskMoodLabels[mood].toLowerCase()}`
      }
      palette={character.palette}
    />
  )
}
