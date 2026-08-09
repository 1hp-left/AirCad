# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

AirCad is primarily for people who want to create simple 3D-printable models through intuitive webcam hand gestures instead of traditional CAD menus, sliders, and keyboard-heavy controls.

## Product Purpose

AirCad is a browser-based 3D modeling workspace where a person's hands are the main modeling controls. Success means a user can select, create, position, rotate, resize, shape, and delete objects while receiving enough visual feedback to understand what the system recognized and how their movement affects the model.

## Positioning

AirCad combines discrete hand-gesture recognition for choosing an action with continuous hand-landmark motion for controlling that action. The interface is a live spatial workspace rather than a conventional modeling form full of numeric controls.

## Operating Context

The product runs in a desktop browser with a webcam and camera permission. Users work in front of the camera while watching a Three.js scene, a mirrored hand-skeleton preview, gesture status, action guidance, and the selected object. Mouse controls remain available for selection and transforms when gesture input is inconvenient.

## Capabilities and Constraints

- The current app supports gesture and mouse selection, movement, rotation, uniform resizing, stretch/squash shaping, primitive creation, and deletion.
- The primitive picker supports box, sphere, cylinder, and torus objects.
- MediaPipe Gesture Recognizer supplies discrete gesture categories and up to two hands of landmark data; continuous modeling values come from the landmarks.
- React owns the editor HUD while a plain Three.js render loop owns scene updates and rendering.
- One-shot destructive or additive gestures must be held briefly and released before they can fire again.
- Combining objects, exporting files, and the custom-gesture training pipeline remain planned work rather than current product claims.

## Brand Commitments

The product name is AirCad. Product language should be direct, spatial, and instructional: identify the recognized action, describe a physical movement, and make release or recovery behavior explicit.

## Evidence on Hand

- The runnable implementation and current interaction behavior live in this repository.
- The original architecture and milestone brief was supplied in the originating Codex task and is not tracked in this repository.
- There are no customer testimonials, usage benchmarks, certification claims, or production-readiness claims on hand; future work must not fabricate them.

## Product Principles

- Make every gesture's direction and release behavior understandable without prior CAD knowledge.
- Keep continuous manipulation stable even when a gesture classifier briefly loses confidence.
- Give immediate, spatially relevant feedback for selection and modeling actions.
- Prevent ambiguous gestures from causing repeated creation, deletion, or unintended action switching.
- Keep the high-frequency scene loop independent from React reconciliation.

## Accessibility & Inclusion

The current interface provides mouse fallbacks, visible focus treatment, text guidance alongside gesture labels, and status announcements for create/delete results. No specific conformance standard has been established.
