# Changelog

All notable changes to this project will be documented here.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.4.0] - 2026-05-22

### Changed
- **Breaking:** Replaced `LockMechanism` with `GarageDoorOpener` service — the Home app now shows open/closed/opening/closing/stopped states with the correct door icon and animation. Any automations targeting the old Lock accessory will need to be recreated.
- Light detection is now automatic — the plugin reads the Omlet API's action list and device state to determine whether a light is fitted, rather than relying on manual config. `hideLight: true` remains available as a force-suppress override.

### Added
- `ObstructionDetected` characteristic — fault state is surfaced in HomeKit as an obstruction alert.
- `setPrimaryService()` and `addLinkedService()` on the door service per HomeKit best practices.

### Fixed
- Stale `LockMechanism` service from earlier versions is automatically removed from the accessory cache on first restart after upgrade.

---

## [0.3.3] - 2026-05-22

### Fixed
- Corrected repository URL in `package.json` (`vhvhxksc4t-sudo` not `vhvhxksc4t`) so Homebridge UI can fetch release notes.

---

## [0.3.2] - 2026-05-21

### Changed
- Minimum Node.js version raised to 22 (Node 20 reaches EOL June 2026).

### Fixed
- GitHub Actions runner now forced to Node 24 for action scripts (`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`), eliminating the Node 20 deprecation warning in CI output.

---

## [0.3.1] - 2026-05-21

### Fixed
- `hideLight: true` now correctly persists across restarts. `updatePlatformAccessories()` was previously called before the accessory handler was constructed, so service removals weren't reflected in the Homebridge cache. Ordering corrected.

---

## [0.3.0] - 2026-05-21

### Added
- Per-device configuration via the `devices` array — override name and hide the light on a per-door basis.
- `hideLight` option to suppress the Lightbulb service for doors without a light fitted.

---

## [0.2.0] - 2026-05-21

### Added
- `Lightbulb` service — turn the coop light on/off from the Home app or Siri.
- `Battery` service — battery level percentage and low battery alert (threshold: 20%).

---

## [0.1.2] - 2026-05-21

### Fixed
- Removed `smartcoop-sdk` dependency — the official SDK crashes on devices that have missing optional state sub-objects (`Cannot read properties of undefined (reading 'state')`). Replaced with a hand-rolled HTTPS client using Node built-ins. Zero runtime dependencies.

---

## [0.1.1] - 2026-05-21

### Fixed
- Plugin failed to load (`No plugin found for platform OmletSmartChickenCoop`) due to TypeScript `export default` producing the wrong CommonJS export shape. Changed to `export =` so Homebridge receives `module.exports` correctly.

---

## [0.1.0] - 2026-05-21

### Added
- Initial release.
- Discovers all Autodoor devices on the Omlet account automatically at startup.
- `LockMechanism` service per door (open = Unsecured, closed = Secured, fault = Jammed).
- Polls device state every 60 seconds (configurable); drops to 10 seconds during door transitions.
- GitHub Actions CI/CD — stable releases publish to `@latest`, pre-releases to `@beta`.
