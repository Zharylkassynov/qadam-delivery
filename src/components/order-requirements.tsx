import type { Order } from '../lib/types';
import { deliveryWindow,parcelLabels,windowExpired } from '../lib/order-details';
import { Feedback } from './delivery-ui';

export function OrderRequirements({order}:{order:Order}){
  const window=deliveryWindow(order),expired=windowExpired(order)&&order.status==='SEARCHING_FOR_COURIER';
  return <>
    {(order.businessName||order.pickupDetails)&&<section className="review-section"><h2>{order.businessName||'Как найти отправителя'}</h2>{order.pickupDetails&&<p className="pre-wrap">{order.pickupDetails}</p>}</section>}
    {(window||order.urgent)&&<section className="review-section"><h2>Когда доставить</h2>{window&&<><p className="delivery-window">{window}</p><p className="muted">Желаемый интервал · время Алматы</p></>}{order.urgent&&<p>Важно доставить без задержки. Автоматической доплаты нет.</p>}{expired&&<Feedback title="Интервал доставки истёк" tone="warning">Клиент может отменить этот заказ и повторить его с новым временем. Принимать доставку с истёкшим интервалом нельзя.</Feedback>}</section>}
    {(order.parcelType||order.fragile||order.surprise)&&<section className="review-section"><h2>{order.parcelType?parcelLabels[order.parcelType]:'О посылке'}</h2>{order.fragile&&<p>Хрупкое — перевозить бережно, не переворачивать.</p>}{order.surprise&&<p>Сюрприз — сначала свяжитесь с отправителем перед звонком получателю.</p>}{['FLOWERS','CAKE'].includes(order.parcelType??'')&&<p className="muted">Уточните подходящий транспорт и упаковку. Категория не означает наличие термобокса.</p>}</section>}
    {order.cardText&&<details className="price-breakdown"><summary>Текст открытки</summary><p className="pre-wrap">{order.cardText}</p><p className="muted">Готовую открытку передаёт отправитель вместе с посылкой.</p></details>}
  </>;
}
