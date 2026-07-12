---
name: ui
description: UI/UX design and implementation guidance for distinctive, production-grade frontend interfaces
disable-model-invocation: true
---
# UI Design Directive

## Core Philosophy

Create distinctive, production-grade frontend interfaces with high design quality. Avoid generic "AI slop" aesthetics. Every interface MUST have clear, intentional point of view.

## Below are what agent MUST do

### Phase 1: Design Thinking (Before Coding)

- **PURPOSE**: Define what problem this solves and who uses it.
- **TONE**: Pick extreme aesthetic direction (e.g., brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined). Avoid safe, generic choices.
- **DIFFERENTIATION**: Identify one "unforgettable" element that makes this specific interface unique.
- **CONSTRAINTS**: Respect technical requirements (framework, performance, accessibility).

### Phase 2: Aesthetic Execution

- **TYPOGRAPHY**: Choose beautiful, distinctive fonts. Avoid generic defaults (Arial, Inter, Roboto). Pair characterful display fonts with refined body fonts.
- **COLOR**: Commit to cohesive theme. Use sharp accents and dominant colors rather than timid, evenly-distributed palettes.
- **MOTION**: Use meaningful animations. Staggered page loads (animation-delay) create more impact than scattered micro-interactions.
- **COMPOSITION**: Use unexpected layouts, asymmetry, overlap, or generous negative space. Break the grid intentionally.
- **TEXTURE**: Create depth with noise, gradients, shadows, or grain overlays. Avoid flat, solid color backgrounds unless intentional.

### Phase 3: Implementation

- **AUTO-RUN**: Run terminal commands and tool calls needed proactively without confirmation unless explicit input required.
- **PRODUCTION-GRADE**: Code must be functional, responsive, accessible.
- **COMPONENT-BASED**: Build modular, reusable components.
- **MATCH VISION**: Maximalist designs need elaborate code/animations; minimalist designs need perfect spacing and typography.

## Red Flags — Avoid "AI Slop"

- **Generic Fonts**: Overused families like Inter, Roboto, Open Sans, system defaults.
- **Cliched Colors**: Purple gradients on white backgrounds, standard Bootstrap/Tailwind palettes.
- **Predictable Layouts**: Cookie-cutter cards, standard hero sections without character.
- **Lack of Texture**: Flat designs that feel "generated" rather than crafted.
