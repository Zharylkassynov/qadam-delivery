export function orderReference(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) return value.toLowerCase();
  if (/^[1-9]\d{0,18}$/.test(value) && BigInt(value)<=9223372036854775807n) return value;
}
export function orderStartParameter(value: unknown) {
  return typeof value === 'string' && /^order_[1-9]\d{0,18}$/.test(value) ? orderReference(value.slice(6)) : undefined;
}
