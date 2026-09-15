# Shared Geist foundation

Use [Vercel's Geist design system](https://vercel.com/geist/introduction), including its [color roles](https://vercel.com/geist/colors) and [typography](https://vercel.com/geist/typography). These are design references, not a requirement to install an unofficial component package. The bundled CSS is a small Open Artifacts adaptation, not the official full component implementation.

## Shared rules

- Dark first: near-black page, a subtly raised surface, neutral borders, clear primary and secondary text. Use one restrained blue accent for focus, links, or selected state. Use red, amber, and green only for meaningful states, with text labels.
- Geist Sans for headings, prose and controls. Geist Mono with tabular numbers for measurements, code and compact metadata. The packer embeds both supplied WOFF2 fonts as data URLs. Their SIL Open Font License is included in the plugin and as an HTML comment in packaged output.
- Use 14px controls, 16px body copy, 20–24px section headings, and a 32px page title. A large visualization can justify more, but do not default to giant hero type. Headings use medium/semibold weight and tight tracking.
- Use a 4px spacing rhythm: 8/12px within controls and small groups, 16/24px within sections, 32/48px between major regions. Radius 6px for controls and 10px for substantial panels. Keep shadows light and local to floating surfaces.
- One primary action at a time. Native buttons, labels, checkboxes, selects and tables are the starting point. Use whitespace and typography for hierarchy, and a bordered panel only when it groups something meaningful.
- A desktop content width around 1040px and responsive stacks are defaults. Keep the top-right 190×64px clear for the shared Library, Comments, and comment-list controls; the foundation provides a 76px top inset. Do not put crucial controls underneath them or duplicate them in artifact HTML.
- Paint `html` and `body` with the page's solid `--bg` color. This gives the viewer a consistent background to extend into browser safe areas. The host owns browser theme metadata and safe-area layout; artifact authors only supply the content theme.
- Use legible contrast, visible focus, 44px touch targets, and reduced-motion support. Do not communicate a result through color alone.
- Avoid novelty fonts, unrelated palettes, ornamental gradients, decorative grids, generic KPI card walls, fake navigation, and branding unrelated to the task. A diagram, calculator, table and small document should feel related while keeping their own useful structure.

## CSS building blocks

The foundation styles semantic HTML and provides a few optional utilities:

- `.artifact`: constrained page container; `.stack`, `.row`, `.grid`: spacing/layout helpers.
- `.panel`: restrained bordered surface; `.muted`, `.mono`: secondary text and data type.
- `.primary`: high-contrast primary button; `.badge`: compact status label.
- `.table-scroll`: contained horizontal scroll for genuinely wide tables.
- `.sr-only`: visually hidden accessible label.

Reuse its custom properties (`--bg`, `--surface`, `--border`, `--text`, `--muted`, `--accent`, `--space-*`, `--radius`) for artifact-specific CSS. Avoid overriding every default. Explicit page templates will come later.
