# Task ID: fix-crisis — Agent: crisis-fixer

**Scope:** `src/components/msaada/CrisisPanel.tsx` ONLY.
**Inputs reviewed before editing:** `worklog.md`, `reviews/judge-3-ux.md`, `reviews/audit-6-a11y.md` (issues #1 + #2), `reviews/audit-7-pii-fu.md` (findings F-6 / F-13).

## Bugs fixed (one per audit finding)

1. **No focus trap (audit-6 #1)** → Added `containerRef` on the outer `motion.div` + `confirmButtonRef` on the confirm `<Button>`. New `useEffect` captures `document.activeElement` on mount into `previousFocusRef`, schedules a `requestAnimationFrame` that focuses the confirm button (or container as fallback), and on unmount restores focus to the captured trigger element. Added a `handleTrapKeyDown` on the outer container that intercepts `Tab` / `Shift+Tab`, queries focusable descendants via `getFocusableDescendants()`, and wraps focus from last → first (Tab) / first → last (Shift+Tab). The container also has `tabIndex={-1}` so it can receive focus as a last-resort stop.
2. **Plain-text phone numbers (judge-3, audit-6)** → Wrapped `1199` in `<a href="tel:1199">` and `+254 722 178 177` in `<a href="tel:+254722178177">` in BOTH the main crisis-line paragraph (the fallback JSX rendered when `record.crisisLine` is not provided — preserves the verbatim "Kenya Red Cross 1199 · Befrienders Kenya +254 722 178 177" text) AND the two `<li>` items. Anchors share a `TEL_LINK_CLASS` (underline + bold + visible focus ring offset against the red background) for high-contrast tappable affordance.
3. **Bypassable via refresh / F5 / back button (audit-7 F-6)** → New `useEffect` registers a `beforeunload` listener that calls `e.preventDefault()` and sets `e.returnValue = ""` while the panel is mounted; cleanup removes it on unmount. Modern browsers show the generic "Leave site?" prompt.
4. **Native `disabled` traps keyboard users during the 5 s countdown (audit-6 #2)** → Removed `disabled={!canConfirm}` from the confirm `<Button>`. Replaced with `aria-disabled={canConfirm ? undefined : true}` + `tabIndex={0}` (explicit, although `<button>` defaults to 0) so the button stays in the tab order. The existing `handleConfirm` already early-returns when `!canConfirm` — kept as the click/Enter/Space guard. Swapped the Tailwind `disabled:` variants in the button className → `aria-disabled:` variants (`aria-disabled:opacity-70 aria-disabled:cursor-not-allowed`) so the visual "waiting" state still renders.

## Behaviour preserved verbatim (per task constraint)

- 5-second countdown (`useState(5)` → `Math.max(0, c - 1)` every 1000 ms; `canConfirm = countdown === 0`).
- Escape-block in capture phase (`window.addEventListener("keydown", block, true)`).
- `role="alertdialog"` + `aria-modal="true"` + `aria-labelledby="crisis-title"` + `aria-describedby="crisis-desc"` + `aria-live="assertive"`.
- Red high-contrast palette (`bg-red-600` overlay, `bg-red-700` card, `text-white`, `border-white/70`).
- Verbatim crisis-line text rendered: `"Kenya Red Cross 1199 · Befrienders Kenya +254 722 178 177"` (only the digits are now inside anchors — visible text unchanged).
- Verbatim list items: `"Kenya Red Cross toll-free: 1199"` and `"Befrienders Kenya: +254 722 178 177"` (digits wrapped in `<span className="font-bold">` inside anchors — preserves the existing bold styling).
- Explicit confirm button + "This panel cannot be closed without confirmation." caption + record-ID footer.
- Renders first as the first child of the root div in `src/app/page.tsx` (unchanged).
- `onMouseDown` stopPropagation on the outer overlay (unchanged).
- `record.chpInstruction ??` and `record.crisisLine ??` fallbacks unchanged — only the rendered fallback for `crisisLine` was switched from a single plain-text string to the equivalent JSX with anchors inside.

## Verification

- `bun run lint` → `EXIT=0` (no errors, no warnings).
- Dev server (`bun run dev`) → `/` recompiles successfully: `GET / 200 in 33ms`.
- No other file modified.
EOF
