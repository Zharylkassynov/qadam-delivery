export type Role = 'CUSTOMER' | 'COURIER';
export type User = { id: string; name: string; email: string; role: Role; telegramId?: string; isAdmin?: true };
export type CourierApplication = {
  id: string; userId: string; name: string; telegramId: string; phone: string;
  transport: 'FOOT' | 'BICYCLE' | 'CAR'; notes: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED'; submittedAt: string;
  reviewedAt: string | null; reviewer: string | null; decisionReason: string; applicantActive: boolean;
};
export const transportLabels = { FOOT: 'Пешком', BICYCLE: 'Велосипед', CAR: 'Автомобиль' } as const;
export const statuses = ['CREATED', 'SEARCHING_FOR_COURIER', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'] as const;
export type Status = typeof statuses[number];
export const statusLabels: Record<Status, string> = {
  CREATED: 'Создан', SEARCHING_FOR_COURIER: 'Ищем курьера', ACCEPTED: 'Курьер назначен',
  PICKED_UP: 'Посылка у курьера', IN_TRANSIT: 'В пути', DELIVERED: 'Доставлен', CANCELLED: 'Отменён',
};
export const nextStatus: Partial<Record<Status, Status>> = {
  ACCEPTED: 'PICKED_UP', PICKED_UP: 'IN_TRANSIT', IN_TRANSIT: 'DELIVERED',
};
export const actionLabels: Partial<Record<Status, string>> = {
  ACCEPTED: 'Посылка у меня', PICKED_UP: 'Начать доставку', IN_TRANSIT: 'Завершить доставку',
};
export type OrderEvent = { id: number; status: Status; at: string; actor: string };
export type Order = {
  id: string; number: string; customerId: string; customerName: string;
  courierId: string | null; courierName: string | null;
  pickupAddress: string; destinationAddress: string; recipientName: string; recipientPhone: string;
  notes: string; status: Status; createdAt: string; updatedAt: string; events: OrderEvent[];
};
