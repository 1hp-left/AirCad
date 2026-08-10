# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

AirCad is primarily for people who want to create simple 3D-printable models through intuitive webcam hand gestures instead of traditional CAD menus, sliders, and keyboard-heavy controls.

## Product Purpose

AirCad is a browser-based 3D modeling workspace where a person's hands are the main modeling controls. Success means a user can select, create, position, rotate, resize, shape, combine, and delete objects while receiving enough visual feedback to understand what the system recognized and how their movement affects the model.

## Positioning

AirCad uses direct landmark-driven pinches for object manipulation and discrete hand poses for occasional commands such as create and shape. The interface is a live spatial workspace rather than a conventional modeling form full of numeric controls.

## Operating Context

The product runs in a desktop browser with a webcam and camera permission. Users work in front of the camera while watching a Three.js scene, a mirrored hand-skeleton preview, gesture status, action guidance, and the selected object. Mouse controls remain available for selection and transforms when gesture input is inconvenient.

## Capabilities and Constraints

- The current app supports gesture and mouse selection, movement, rotation, uniform resizing, stretch/squash shaping, primitive creation, deletion, two-hand CSG union, and file export.
- Pinching directly on an object selects and moves it. Pinching the same object with both hands moves it from the midpoint, resizes it from hand separation, and rotates it from the hand-to-hand angle.
- The primitive picker supports box, sphere, cylinder, and torus objects.
- MediaPipe supplies up to two tracked hands and discrete pose categories. Pinch state is calculated from thumb/index distance relative to palm width, with separate close and release thresholds so brief classifier changes do not drop a grab.
- React owns the editor HUD while a plain Three.js render loop owns scene updates and rendering.
- One-shot additive gestures must be held briefly and released before they can fire again.
- A selected object is deleted from the Selection panel or with the Delete/Backspace key, so deletion never depends on gesture recognition.
- Combining starts when each hand pinches a different overlapping object. Misses stay neutral; valid targets use matching blue and green cursor/outline pairs before the union runs.
- Export downloads every modeling object as binary STL, OBJ, or binary glTF (`.glb`) without including editor helpers.
- Before creating an STL, AirCad converts each object to a closed manifold solid and Boolean-unions overlapping geometry in a temporary export model. It rejects invalid source meshes rather than presenting them as print-ready; this check does not certify every possible slicing issue.
- The custom-gesture training pipeline remains planned work rather than a current product claim.

## Brand Commitments

The product name is AirCad. Product language should be direct, spatial, and instructional: identify the recognized action, describe a physical movement, and make release or recovery behavior explicit.

## Evidence on Hand

- The runnable implementation and current interaction behavior live in this repository.
- The original architecture and milestone brief was supplied in the originating Codex task and is not tracked in this repository.
- There are no customer testimonials, usage benchmarks, certification claims, or production-readiness claims on hand; future work must not fabricate them.

## Product Principles

- Make every gesture's direction and release behavior understandable without prior CAD knowledge.
- Keep continuous manipulation stable through landmark jitter, brief tracking loss, and changes in detector hand order.
- Give immediate, spatially relevant feedback for selection and modeling actions.
- Prevent ambiguous gestures from causing repeated creation, deletion, or unintended action switching.
- Keep the high-frequency scene loop independent from React reconciliation.

## Accessibility & Inclusion

The current interface provides mouse fallbacks, visible focus treatment, text guidance alongside gesture labels, and status announcements for create/delete and export results. No specific conformance standard has been established.
