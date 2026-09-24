# Native Playback Migration

The app keeps the Vue + Capacitor UI and existing backend contracts. Android now
contains an optional `NativePlayback` Capacitor plugin backed by AndroidX
Media3:

- Plans with a usable `directURL`, or a backend `delivery: "redirect"` plan,
  are played on the device with Media3. The latter follows the backend's
  redirect and avoids streaming media bytes through the backend.
- MP4 and HLS are selected from the URL or MIME type.
- Viewer request headers are passed to the native data source.
- Position, duration, play state, video dimensions, errors, and end-of-item
  events are sent back to the Vue player.
- Backend proxy/HLS plans continue to use the existing WebView/HLS.js path.

This is intentionally a hybrid migration. It does not change the backend and
does not attempt to parse provider pages in Java yet. Provider-specific parsing
from the reference app should be migrated only after each source exposes a
stable `directURL`, headers, MIME type, and quality metadata through the app
playback plan.

## Build prerequisites

The Android build requires JDK 21, the Android SDK, and network access for
Gradle/Media3 dependencies. The repository does not store SDK paths, accounts,
cookies, passwords, or signing keys.
