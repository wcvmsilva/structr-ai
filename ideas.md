# GCHI Bundle Builder - Design Brainstorm

This is a direct port of an approved Streamlit prototype. The design direction is already established by Wellington: **Dark Mode Premium with Gold Accents**. The brainstorm focuses on how to elevate this within React/Tailwind.

<response>
<text>
## Idea A: "Command Center" — Military-Grade Dashboard

**Design Movement:** Tactical Operations UI (inspired by Bloomberg Terminal, military HUDs)

**Core Principles:**
1. Information density without clutter — every pixel serves a purpose
2. Monospace typography for data, sans-serif for labels
3. Amber/gold as the sole accent on near-black backgrounds
4. Hard geometric edges with subtle glow effects

**Color Philosophy:** Pure dark (#0A0D14) with gold (#D4A843) as the only warm accent. No blues, no purples. The gold represents authority and premium positioning. Danger states use pure red (#EF4444), success uses emerald (#22C55E).

**Layout Paradigm:** Fixed two-panel layout — left panel is a scrollable library/selector, right panel is the live "command dashboard" with metric cards stacked vertically. No horizontal scrolling.

**Signature Elements:**
1. Gold top-border accent on metric cards (3px gradient stripe)
2. Subtle gold glow on hover (box-shadow with gold rgba)
3. JetBrains Mono for all numeric/financial data

**Interaction Philosophy:** Immediate feedback — selecting an assembly instantly updates all metrics with smooth number transitions. The discount slider triggers real-time GP recalculation with color-coded alerts.

**Animation:** Smooth counter animations on metric values (count-up effect). Cards fade-in with slight upward motion. Alert banners slide in from right. Hover states with subtle scale(1.01) and gold border reveal.

**Typography System:** JetBrains Mono 700 for financial figures. Inter 800 for headers. Inter 400-600 for body text. All-caps with letter-spacing for section labels.
</text>
<probability>0.06</probability>
</response>

<response>
<text>
## Idea B: "Luxury Catalog" — High-End Product Configurator

**Design Movement:** Luxury E-commerce (inspired by Porsche configurator, Apple product pages)

**Core Principles:**
1. Generous whitespace on dark canvas
2. Large typography with dramatic size contrasts
3. Card-based layout with glass-morphism effects
4. Smooth page-like scrolling sections

**Color Philosophy:** Deep charcoal (#111318) with warm gold (#C9A84C) and cream (#F5E6C8) accents. The palette evokes a luxury showroom — understated but unmistakably premium.

**Layout Paradigm:** Full-width sections that scroll vertically. The library is a grid of large cards. The cart is a sticky sidebar that collapses on mobile into a bottom sheet.

**Signature Elements:**
1. Glass-morphism cards with backdrop-blur and subtle borders
2. Large hero numbers with thin weight for labels
3. Animated progress ring for GP percentage

**Interaction Philosophy:** Deliberate, weighted interactions. Cards have a satisfying "click" feel with scale animations. Selections trigger a subtle ripple effect.

**Animation:** Spring-based animations for card selections. Number morphing for price changes. Smooth accordion transitions for category expansion.

**Typography System:** Playfair Display for the main title. Inter for everything else. Extreme size contrast (4rem hero numbers vs 0.7rem labels).
</text>
<probability>0.03</probability>
</response>

<response>
<text>
## Idea C: "Precision Instrument" — Engineering Tool Aesthetic

**Design Movement:** Industrial Design UI (inspired by Figma, Linear, professional CAD tools)

**Core Principles:**
1. Clean, functional design where form follows function
2. Subtle depth through layered surfaces (not flat, not skeuomorphic)
3. Consistent 4px/8px spacing grid
4. Color used sparingly and only for meaning

**Color Philosophy:** Dark slate (#0E1117) base with gold (#D4A843) reserved exclusively for interactive elements and key metrics. Neutral grays for structure. The restraint makes gold elements pop with authority.

**Layout Paradigm:** Persistent two-column layout with clear visual hierarchy. Left column has a search-first approach with collapsible categories. Right column is a structured dashboard with clear data sections.

**Signature Elements:**
1. Thin gold divider lines with gradient fade-to-transparent
2. Monospace data tables with alternating row opacity
3. Shield/badge components for status indicators

**Interaction Philosophy:** Responsive and predictable. Checkboxes in the category browser sync with the multiselect. Discount input has immediate visual feedback with color-coded status.

**Animation:** Minimal but purposeful — 200ms transitions on hover, smooth height animations on accordions, subtle fade-in for new cart items. No gratuitous motion.

**Typography System:** Inter 800 for title with gold gradient. JetBrains Mono for all data. Inter 600 for section labels (uppercase, tracked). Inter 400 for body text.
</text>
<probability>0.08</probability>
</response>

---

## Selected Approach: Idea A — "Command Center"

This approach best matches the approved Streamlit prototype and Wellington's directive for a professional, dark-mode tool with gold accents that conveys authority and precision. The military-grade dashboard aesthetic aligns with the GCHI brand positioning as a premium contractor.
