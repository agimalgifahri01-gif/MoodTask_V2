import { Sparkles } from 'lucide-react'
import CharacterPresence from '../features/character/CharacterPresence'
import { getCharacterMessage } from '../features/character/messages'
import PageIntro from '../components/PageIntro'
import { getTaskMood, taskMoodLabels } from '../features/tasks/domain'
import { getActiveTasksByUrgency } from '../features/tasks/presentation'
import { useTasks } from '../features/tasks/TaskContext'
import { useCurrentTime } from '../features/tasks/useCurrentTime'

export default function CharacterPage() {
  const { tasks } = useTasks()
  const now = useCurrentTime()
  const urgentTask = getActiveTasksByUrgency(tasks, now)[0]
  const lastCompleted = tasks
    .filter((task) => task.status === 'completed')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  const representedTask = urgentTask ?? lastCompleted
  const mood = representedTask ? getTaskMood(representedTask, now) : 'calm'

  return (
    <>
      <PageIntro
        eyebrow="TEMAN KECILMU"
        title="Kenalan dulu"
        description="Momo mengikuti perubahan mood pada tugas paling mendesakmu, tanpa memberi tekanan tambahan."
      />
      <section className={`character-preview mood-panel-${mood ?? 'calm'}`}>
        <div className="character-art">
          <div className="character-halo" />
          <CharacterPresence
            className="character-large"
            mood={mood ?? 'calm'}
            label={`Momo${mood ? ` sedang ${taskMoodLabels[mood].toLowerCase()}` : ' sedang santai'}`}
          />
        </div>
        <div className="character-copy">
          <span className="character-badge">
            <Sparkles size={14} /> KARAKTER DASAR
          </span>
          <h2>Ini Momo.</h2>
          <p>
            {urgentTask && mood
              ? `Sedang menemanimu pada tugas “${urgentTask.title}”. ${getCharacterMessage(mood, urgentTask.id)}`
              : lastCompleted && mood
                ? `Tugas terakhir selesai. ${getCharacterMessage(mood, lastCompleted.id)}`
                : 'Tambahkan tugas dan Momo akan menyesuaikan ekspresinya berdasarkan waktu yang tersisa.'}
          </p>
          <div className="expression-chips">
            <span className={`mood-chip mood-${mood ?? 'calm'}`}>
              ✳ {mood ? taskMoodLabels[mood] : 'Santai'}
            </span>
            <span>{urgentTask ? 'Menemani tugas aktif' : 'Siap menemani'}</span>
          </div>
        </div>
      </section>
    </>
  )
}
