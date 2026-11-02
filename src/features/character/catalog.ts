import type { CompanionPalette } from '../../components/Companion'

export type CharacterDefinition = {
  id: string
  name: string
  description: string
  palette: CompanionPalette
}

export const characterCatalog: Record<string, CharacterDefinition> = {
  momo: {
    id: 'momo',
    name: 'Momo',
    description: 'Teman kecil yang menemanimu menjaga ritme.',
    palette: {
      body: '#f3b36f',
      bodyShade: '#e99b52',
      face: '#ffd29c',
      clothes: '#aac8bc',
      clothesShade: '#92b5a6',
      feature: '#503a31',
      cheek: '#ef9b85',
      ear: '#f4bd7e',
    },
  },
}

export function getCharacter(characterId = 'momo'): CharacterDefinition {
  return characterCatalog[characterId] ?? characterCatalog.momo
}
