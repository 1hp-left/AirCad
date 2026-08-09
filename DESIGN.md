---
name: AirCad
description: A compact graphite modeling workspace with direct, legible spatial feedback.
colors:
  workbench: "#181818"
  canvas: "#252525"
  panel: "#242424"
  raised: "#2d2d2d"
  divider: "#3b3b3b"
  text-primary: "#e2e2e2"
  text-secondary: "#b0b0b0"
  text-muted: "#949494"
  camera-well: "#0b0b0b"
  panel-shadow: "rgba(0, 0, 0, 0.28)"
  active: "#7c9fe8"
  tracking: "#a8bd68"
  danger: "#cf6a61"
  model-neutral: "#9aa6b5"
typography:
  headline:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
  title:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  supporting:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  control:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "normal"
  label:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "normal"
  directional:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "normal"
  message:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  sharp: "0px"
  control: "2px"
  marker: "3px"
  round: "50%"
spacing:
  micro: "3px"
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  xxl: "22px"
components:
  shelf-tool:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "5px 2px"
    height: "43px"
    width: "100%"
  shelf-tool-active:
    backgroundColor: "rgba(124, 159, 232, 0.16)"
    textColor: "{colors.active}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "5px 2px"
    height: "43px"
    width: "100%"
  camera-toggle:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 9px"
    height: "28px"
  property-field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sharp}"
    padding: "9px 10px"
  control-coach:
    backgroundColor: "rgba(24, 24, 24, 0.94)"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.marker}"
    padding: "10px 12px 9px"
  selected-label:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-primary}"
    typography: "{typography.mono}"
    rounded: "{rounded.sharp}"
    padding: "7px 8px"
---

# Design System: AirCad

## Overview

**Creative North Star: "The Clear Modeling Workshop"**

AirCad should feel like a modern, simplified 3D modeling application: professional enough to trust, compact enough to keep the scene dominant, and clearer than a traditional expert-first CAD interface. The graphite workspace provides continuity around the canvas while concise labels and visible state changes make gesture control easier to learn.

The interface is technical and restrained rather than playful, glossy, or decorative. Color is functional: it distinguishes an active tool, live hand tracking, and a destructive result. Dense desktop chrome is acceptable because the controls are grouped by task and leave most of the screen to the model.

**Key Characteristics:**

- Graphite surfaces frame a full-window 3D canvas.
- Compact, fixed editor regions create a stable spatial map.
- Muted color communicates state rather than personality for its own sake.
- Compact type, thin borders, and nearly square controls reinforce desktop-tool precision.
- Gesture instructions use direct physical language and remain close to live state.

## Colors

The palette is a neutral graphite system with three narrowly assigned signals: blue for active tools and selection, yellow-green for live tracking, and red for destructive outcomes.

### Primary

- **Active blue** (`active`): marks the current primitive, focused controls, and selected-object outlines in the scene.

### Secondary

- **Live tracking green** (`tracking`): appears only on gesture names, the hand cursor, and skeleton feedback while the system is reading or applying hand input.

### Tertiary

- **Destructive red** (`danger`): reserved for delete feedback and errors that need recovery.
- **Model neutral** (`model-neutral`): gives primitives a cool, material-like gray that does not compete with action colors.

### Neutral

- **Graphite Workbench** (`workbench`): anchors fixed editor chrome.
- **Canvas graphite** (`canvas`): fills the viewport and keeps the 3D scene visually continuous.
- **Panel graphite** (`panel`): separates fields and selected-object readouts through tonal layering.
- **Raised graphite** (`raised`): identifies the webcam header and conventional raised controls.
- **Soft divider** (`divider`): defines panel and control boundaries without bright outlines.
- **Primary text** (`text-primary`): carries object names and active instructional copy.
- **Secondary text** (`text-secondary`): carries quiet labels, metadata, and inactive controls.
- **Muted text** (`text-muted`): preserves hierarchy for tertiary guidance while remaining readable on raised graphite surfaces.
- **Camera well** (`camera-well`): provides a near-black fallback behind live video.

### Named Rules

**The Functional Color Rule.** Blue means active or selected, yellow-green means live tracking, and red means destructive; none of these colors is general decoration.

**The One Signal Rule.** A compact control should normally show one signal color at a time so status remains unambiguous.

## Typography

**Display Font:** Segoe UI (with system sans-serif fallbacks)  
**Body Font:** Segoe UI (with system sans-serif fallbacks)  
**Label/Mono Font:** SFMono-Regular or Consolas for object identifiers only

**Character:** The typography behaves like desktop application chrome: compact, neutral, and information-first. Monospace is limited to object identifiers where stable character widths help scanning.

### Hierarchy

- **Headline** (500, 16px, 1.2): live gesture names and the most important transient state.
- **Message** (500, 17px, 1.2): blocking camera-state headings.
- **Directional** (600, 15px, 1): arrow glyphs inside the transient control coach.
- **Title** (600, 15px, 1.2): the AirCad wordmark and compact panel titles.
- **Supporting** (400, 13px, 1.35): concise secondary copy in blocking states.
- **Control** (400, 12px, 1.2): conventional buttons and inputs.
- **Body** (400, 11px, 1.45): actionable instructions, status, and property content.
- **Label** (600, 10px, 1.2): sentence-case section headings and short metadata.
- **Mono** (400, 10px, 1.2): selected object names and future measurement-like identifiers.

### Named Rules

**The Application Chrome Rule.** Type stays compact because the canvas is primary. Use sentence case, plain wording, and hierarchy from size or weight instead of miniature uppercase labels.

## Layout

The 3D canvas fills the viewport. Fixed chrome forms a stable frame: a 42px top bar with the AirCad wordmark and camera toggle, a 68px left tool shelf, a 258px right properties panel, and a 31px bottom gesture reference. The webcam preview floats inside the scene near the properties panel, while transient control coaching sits near the lower center of the usable canvas.

Spacing is dense and regular, with 6–14px internal gaps and 22px reserved for separation between major top-bar groups. Property sections use repeated padding and boundaries so the eye can scan vertically without card containers.

Below 900px, the properties panel narrows. Below 640px, the right panel collapses to a status strip, the left shelf narrows, and coaching plus camera preview shift inward. The canvas remains the dominant surface at every size.

## Elevation & Depth

The interface is flat by default and uses tonal layering plus borders for structure. A single low panel shadow (`0 2px 6px rgba(0, 0, 0, 0.28)`) separates fixed chrome and floating feedback from the scene without making each region look like a card.

### Shadow Vocabulary

- **Panel separation** (`0 2px 6px rgba(0, 0, 0, 0.28)`): fixed chrome, webcam preview, and other scene-adjacent panels only.

### Named Rules

**The Structural Depth Rule.** Use tone and a one-pixel boundary first; add the panel shadow only when a region floats above the 3D scene.

## Shapes

Controls and feedback panels are nearly square, using 2–3px corner radii. Major panels keep square outer edges so the application reads as one continuous workspace. Circles are reserved for reticles and shapes whose geometry is meaningful; generic status dots are not part of the system.

Thin one-pixel borders establish most boundaries. Primitive glyphs use simple geometric outlines rather than illustrative icons.

## Components

### Buttons

- **Shape:** compact and nearly square (2px radius), with dimensions determined by the surrounding editor region.
- **Primary:** active tools use a low-opacity blue field, blue text, and a darker blue boundary.
- **Hover / Focus:** hover changes the graphite tone; keyboard focus uses a visible 2px blue inset outline.
- **Neutral actions:** camera visibility and similar utility actions stay text-only until hovered or focused.

### Cards / Containers

- **Corner Style:** square for structural panels and 3px for floating coaching.
- **Background:** adjacent graphite tones distinguish canvas, chrome, panel content, and raised regions.
- **Shadow Strategy:** only scene-adjacent floating regions use the shared panel shadow.
- **Border:** one-pixel dark or soft-gray structural lines.
- **Internal Padding:** usually 9–14px depending on content density.

### Top Bar

The top bar contains only the product wordmark and the camera visibility action. It should read as ordinary application chrome, without a logo tile, product subtitle, decorative status, or placeholder menus.

### Primitive Picker

Each primitive is a 43px shelf tool with a geometric 17px glyph and a short label. Exactly one choice is visibly active, and its `aria-pressed` state matches the blue selection treatment.

### Gesture Status and Coach

Hand-control status uses one plain-language headline and one useful next step. The gesture coach appears only during continuous manipulation and states the locked action, movement direction, and release behavior without a decorative live marker.

### Selected Object Label

The selected name uses 10px monospace text inside a neutral one-pixel graphite border. Monospace belongs here because the label is an identifier, not because the product is technical.

## Do's and Don'ts

### Do:

- **Do** keep the 3D canvas visually dominant and place help near the action it explains.
- **Do** use active blue, tracking green, and destructive red only for their assigned states.
- **Do** preserve dense, stable editor regions so controls do not move between modeling actions.
- **Do** pair color with labels, outlines, position, or icons.
- **Do** use sentence case for labels and state copy.
- **Do** use direct instructions such as “move sideways to spin” and “relax your hand before creating another.”

### Don't:

- **Don't** return to a saturated orange-and-teal pairing or use gradients, neon glow, and glass effects that make the workspace resemble a generic AI dashboard.
- **Don't** place every property inside a rounded card; section boundaries already provide the structure.
- **Don't** use monospace for ordinary instructions or navigation.
- **Don't** add decorative color to inactive controls or neutral scene geometry.
- **Don't** let tool chrome occupy more space than the scene needs for manipulation.
- **Don't** add generic live dots, miniature all-caps subtitles, fake menu entries, or disabled future-feature placeholders.
