export const districts = ['ALATAU', 'ALMALY', 'AUEZOV', 'BOSTANDYK', 'ZHETYSU', 'MEDEU', 'NAURYZBAY', 'TURKSIB'] as const;
export const districtLabels = { ALATAU: 'Алатауский', ALMALY: 'Алмалинский', AUEZOV: 'Ауэзовский', BOSTANDYK: 'Бостандыкский', ZHETYSU: 'Жетысуский', MEDEU: 'Медеуский', NAURYZBAY: 'Наурызбайский', TURKSIB: 'Турксибский' } as const;
export const availabilityOptions = ['MORNING', 'DAY', 'EVENING', 'WEEKEND'] as const;
export const availabilityLabels = { MORNING: 'Утром', DAY: 'Днём', EVENING: 'Вечером', WEEKEND: 'В выходные' } as const;
export type District = typeof districts[number];
export type Availability = typeof availabilityOptions[number];
export function validSource(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value) ? value : undefined;
}
