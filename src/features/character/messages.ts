import type { TaskMood } from '../tasks/domain'

const messages: Record<TaskMood, readonly string[]> = {
  calm: [
    'Masih ada ruang untuk melangkah dengan tenang.',
    'Pelan-pelan juga tetap bergerak.',
  ],
  alert: [
    'Sedikit fokus sekarang bisa membuat nanti lebih ringan.',
    'Pilih satu langkah kecil untuk dimulai.',
  ],
  anxious: [
    'Tarik napas. Pecah tugas ini menjadi bagian yang lebih kecil.',
    'Kamu tidak harus menyelesaikan semuanya sekaligus.',
  ],
  panic: [
    'Mari fokus pada satu hal yang paling penting dulu.',
    'Mulai dari langkah paling kecil yang bisa dilakukan sekarang.',
  ],
  late: [
    'Waktunya sudah lewat. Kamu masih bisa meninjau dan menentukan langkah berikutnya.',
    'Tidak apa-apa mengevaluasi ulang rencana dan memulai lagi.',
  ],
  happy: [
    'Satu tugas selesai. Beri dirimu waktu menikmati progres ini.',
    'Kamu berhasil menuntaskan satu langkah penting.',
  ],
}

/** Stable selection prevents the companion message from changing on every render. */
export function getCharacterMessage(mood: TaskMood, seed = ''): string {
  const options = messages[mood]
  let hash = 0
  for (const character of seed)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return options[hash % options.length]
}
