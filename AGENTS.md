# Qadam Delivery — Design and Frontend Rules

## Current plan (read first)

The current roadmap, stage status and working rules are in `docs/ROADMAP.md`.
It takes priority over the "Deadline priority" section below and over `PROJECT_BRIEF.md`:
the October 21 academic deadline has passed and the goal now is real use.
Work stage by stage and wait for the repository owner's approval before starting each stage.

## Product

Qadam Delivery is a Kazakhstan-focused delivery platform built primarily as a Telegram Mini App.

Primary users:
- Customers ordering deliveries.
- Couriers accepting and completing orders.
- Small businesses creating delivery orders.
- Administrators managing the service.

## Design workflow

1. Before coding a new screen, establish the user flow and visual direction.
2. Use the `frontend-design` skill for substantial UI work.
3. Use the Figma MCP and relevant Figma skills to create editable Figma designs.
4. Review the screens and obtain approval before implementing the full interface.
5. Implement the approved design in the existing codebase.
6. Compare the running application against the Figma reference and correct visual differences.
7. Verify responsive layouts, loading states, empty states, errors, and accessibility.

## Visual quality

- Create a distinctive, professional logistics product rather than a generic dashboard template.
- Prioritize clear hierarchy, readable typography, consistent spacing, and restrained color usage.
- Use reusable components and design tokens.
- Keep the customer experience simple and mobile-first.
- Ensure the interface works inside Telegram Mini Apps on mobile screens.
- Use realistic Russian-language interface copy for the initial Kazakhstan demo; keep the structure ready for Kazakh localization.
- Avoid unnecessary gradients, excessive rounded cards, decorative animations, and placeholder content.

## Engineering rules

- Inspect the repository before changing its architecture.
- Reuse the existing framework and installed components where possible.
- Preserve working functionality.
- Keep API keys and secrets out of frontend code.
- Persist orders and statuses on the server.
- Clearly indicate stale courier coordinates.
- Do not claim background location tracking works when the Mini App is closed.
- Test the actual running UI rather than relying only on generated code.

## Deadline priority

The academic MVP deadline is October 21, 2026.

Prioritize:
1. Creating an order.
2. Courier acceptance.
3. Order status updates.
4. Map and last-known courier location.
5. Persistence after reopening the Mini App.
6. A clean, coherent visual design.

Do not sacrifice the complete delivery flow to add secondary visual effects or unnecessary features.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
