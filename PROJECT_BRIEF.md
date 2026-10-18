# Qadam Delivery — Project Brief

## 1. Project Overview

Qadam Delivery is an academic MVP of a local delivery platform for Kazakhstan, primarily delivered through a Telegram Mini App.

The platform connects:
- Small businesses that need to deliver goods.
- Customers who request a courier.
- Couriers who accept and complete deliveries.
- Administrators who manage orders and users.

**Deadline:** October 21, 2026.

**Goal:** Demonstrate a working end-to-end delivery flow. This is an academic MVP, not a production-ready replacement for Yandex Delivery.

## 2. MVP Success Criteria

For the October 21 demonstration, the system should support:
1. At least 2–3 courier test accounts.
2. Several customer test accounts.
3. Creating a delivery order.
4. A courier viewing and accepting an available order.
5. Updating order statuses.
6. Showing pickup and destination on a map.
7. Showing the courier's last reported coordinates when available.
8. Restoring the order and its status after closing and reopening the Mini App.
9. An admin view for monitoring orders and assigning couriers.

Prefer real volunteers for the demonstration. Clearly label any seeded or simulated data. Do not represent simulated location as real live tracking.

## 3. Product Strategy

Long-term vision: a universal local delivery platform for both business (B2B) and individual (B2C) customers.

Initial focus: B2B delivery for small businesses, while allowing a simple customer-created delivery request if it can be implemented without putting the core workflow at risk.

Do not build taxi or passenger transportation in this MVP.

## 4. User Roles and Features

### Customer
- Create a delivery request.
- Enter pickup and destination addresses.
- View order status and order history.
- View the courier's last reported location on a map.
- See when the courier's location was last updated.

### Business
- Create delivery orders for its customers.
- View active and completed orders.
- Track order status.

### Courier
- View available orders.
- Accept an order.
- Update delivery status.
- Share location while the Mini App is active and permission is granted.
- Mark an order as delivered.

### Administrator
- View all orders.
- View users and couriers.
- Assign or reassign couriers.
- Monitor order status and handle basic operational issues.

For the deadline, role-based sections in one Mini App are acceptable. Separate Mini Apps are not required.

## 5. Order Lifecycle

Use the following order states:

CREATED → SEARCHING_FOR_COURIER → ACCEPTED → PICKED_UP → IN_TRANSIT → DELIVERED

Also support CANCELLED where appropriate.

Validate state transitions on the server. A courier must not be able to update an order assigned to another courier.

## 6. Technical Preferences

Inspect the existing repository before choosing or changing the stack. Preferred stack if the repository is empty or compatible:

- Frontend: Next.js, React, TypeScript.
- Backend: Node.js / server-side API.
- Database: PostgreSQL.
- Telegram integration: Telegram Mini Apps SDK and Telegram Bot API.
- Map: a suitable provider with map display, geocoding, and route support.
- Real-time updates: WebSockets or polling, choosing the simplest reliable option for the deadline.

Do not add technologies without a clear MVP need.

## 7. Telegram and Location Limitations

- The Mini App must not be assumed to continue executing when closed or backgrounded.
- Location updates can be sent while the Mini App is active and the user has granted permission, subject to browser, operating-system, and Telegram restrictions.
- Store the last reported coordinates and timestamp on the server.
- Clearly show stale location data; never present an old location as live.
- Continuous background location may require a native courier app later.
- Orders and statuses must be stored in the database, not only in local/browser memory.
- Reopening the Mini App must reload the order and current status from the server.
- Telegram bot notifications can be used for order events, subject to user permissions and Telegram availability.

## 8. Security and Reliability

- Validate Telegram `initData` on the server when using Telegram authentication.
- Enforce role-based access control in server-side handlers.
- Never trust a client-provided role or courier ID without server-side authorization.
- A courier can only update orders assigned to them.
- Do not expose API keys, bot tokens, or database credentials in client code.
- Use environment variables for secrets.
- Handle duplicate requests safely where practical.
- Show clear loading, error, and empty states.

## 9. Out of Scope for This MVP

Do not implement unless the core workflow is already stable:
- Separate native iOS and Android apps.
- Continuous background tracking after the Mini App is closed.
- Complex route optimization.
- Full payment processing.
- Advanced pricing and promotions.
- Microservices.
- Large-scale dispatch algorithms.
- Production-scale analytics.

Manual courier assignment is acceptable. A basic map and honest last-known-location display are sufficient for the academic demo.

## 10. Required Codex Workflow

Before writing code:
1. Inspect the repository and identify the existing stack.
2. Explain what already works and what is missing.
3. Identify build, database, authentication, and deployment blockers.
4. Propose a realistic implementation plan for the October 21 deadline.
5. Separate tasks into:
   - P0: essential for the demo.
   - P1: useful if time permits.
   - P2: future production features.

Do not rewrite the project before inspecting it.

Then implement one vertical slice at a time. Run available tests and build checks after each significant change. Do not claim a feature works unless it has been implemented and verified. Keep the README and setup instructions current.

## 11. Definition of Done

The demo is ready when the team can reproduce this flow:

1. Open the Telegram Mini App.
2. Sign in or enter using the configured demo authentication flow.
3. Create a delivery order as a customer or business.
4. See the order in the admin/courier view.
5. Accept the order as a courier.
6. Update the order through pickup and transit to delivered.
7. See status updates from another account.
8. View pickup and destination on a map.
9. View the courier's last reported location and update timestamp, when available.
10. Close and reopen the Mini App without losing the order.
11. See the completed order in history.

## 12. First Task for Codex

Read this document and inspect the repository. Do not immediately build everything.

Return:
- A concise repository assessment.
- A realistic P0 plan for the October 21, 2026 demo.
- The biggest risks and blockers.
- The first small implementation task.

Prioritize a reliable, demonstrable delivery workflow over feature count.
