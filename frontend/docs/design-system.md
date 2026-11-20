# ClinicOS design system

CL-D01-FE — Modern Medical Dashboard, blue/white, Light/Dark/System.

## Foundation

- React + TypeScript (strict), Vite, Tailwind CSS v4 via `@tailwindcss/vite`.
- shadcn/ui initialized with the current CLI, Radix base, Nova preset. `components.json` uses CSS variables and an empty Tailwind config path for v4.
- Components are owned source files under `src/components/ui/`. Use `cn` from `@/lib/utils` (`clsx` + `tailwind-merge`).
- Geist Variable is self-hosted through Fontsource, including Vietnamese. Lucide is the only icon family; default stroke width is 1.75.
- Spacing follows Tailwind's 4px scale. Body text 14–16px, supporting text 12px, page titles 24–30px. Radius: 6/8/10/14/18px.

## Semantic color tokens

Defined in `src/index.css`; components should use semantic classes instead of repeating hex values.

| Token                | Light     | Dark      | Purpose                             |
| -------------------- | --------- | --------- | ----------------------------------- |
| `background`         | `#f5f7fb` | `#0d1524` | Application canvas                  |
| `foreground`         | `#172b49` | `#e7edf8` | Primary text                        |
| `card`               | `#ffffff` | `#141f32` | Raised surfaces                     |
| `primary`            | `#1e5ed2` | `#93bbff` | Actions, active navigation          |
| `primary-foreground` | `#ffffff` | `#0e2246` | Text on primary actions             |
| `muted`              | `#eef2f8` | `#1d2b42` | Secondary surfaces                  |
| `muted-foreground`   | `#596b83` | `#a4b4cc` | Supporting text                     |
| `border`             | `#dce4ef` | `#2a3c55` | Separators and surface outlines     |
| `input`              | `#aebed2` | `#536987` | Form borders                        |
| `ring`               | `#1e5ed2` | `#93bbff` | Keyboard focus                      |
| `destructive`        | `#b42338` | `#ffa0ae` | Errors                              |
| `brand-surface`      | `#1e5ed2` | `#1e5ed2` | Blue banner, always with white text |

## Layout and accessibility

- Desktop navigation starts at 1024px; sidebar is 256px with independent overflow. Content is capped at 1600px.
- Mobile/tablet use a Radix modal Sheet: focus trap, Escape, return focus on dismissal, focus main content after navigation. The menu supports safe-area padding.
- Native links and buttons, visible focus, skip link, `aria-current` on active routes, labels on fields and icon buttons.
- Login fields use native required/email/minimum-length validation. Submission only displays an explanatory local message; it does not authenticate.
- `LoadingState`, `EmptyState`, `ErrorState` are reusable. Preview them in Settings with explicit DEMO labeling.
- No metric values, patient records or fabricated activity appear in the scaffold. Dashes mean data is unavailable, not zero.

## Theme and motion

- `ThemeProvider` follows system preference by default. Only an explicit Light/Dark choice is stored under `clinic-theme`; System removes that key.
- The pre-paint script in `index.html` applies the preference before React loads. Storage failures are handled gracefully.
- Magic UI `BlurFade` is installed from the official registry and adapted: blur is disabled by default, entrance uses only opacity and a 4px translation for 300ms, on one dashboard banner.
- `useReducedMotion`, `MotionConfig reducedMotion="user"` and a global media query disable motion and skeleton pulses when requested.
- No looping decorative animations or external image/font requests.

## Official references

- [shadcn/ui Vite setup](https://ui.shadcn.com/docs/installation/vite)
- [Tailwind CSS Vite setup](https://tailwindcss.com/docs/installation/using-vite)
- [React Router declarative setup](https://reactrouter.com/start/declarative/installation)
- [Magic UI Blur Fade](https://magicui.design/docs/components/blur-fade)

Context7 MCP was connected and used for shadcn/ui, Tailwind v4 and Magic UI documentation. Playwright MCP was connected for browser QA. Component source provenance is recorded in [third-party notices](third-party-notices.md).
