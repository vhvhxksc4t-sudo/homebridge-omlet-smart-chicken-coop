# homebridge-omlet-smart-chicken-coop

A [Homebridge](https://homebridge.io) plugin for the [Omlet Smart Automatic Chicken Coop Door](https://www.omlet.co.uk/smart-automatic-chicken-coop-door-opener/). Exposes each door on your Omlet account as a **Lock** in Apple HomeKit — so you can see when your flock is secured for the night, open or close the door from the Home app, and receive a notification the moment the state changes.

Supports **multiple doors** on a single account (one HomeKit accessory per coop).

---

## Features

- **Lock/Unlock in HomeKit** — closed door = Locked (Secured), open door = Unlocked (Unsecured)
- **Notifications** — HomeKit notifies you when the door opens or closes (enable in the Home app)
- **Manual control** — open or close from the Home app, Siri, or any HomeKit automation
- **Multiple coops** — all Autodoor devices on your account are discovered automatically
- **Responsive polling** — checks every 60 seconds normally; drops to every 10 seconds while the door is in motion

---

## Requirements

- [Homebridge](https://homebridge.io) v1.8.0 or later (v2.x supported)
- Node.js 18 or later
- An Omlet account with at least one Smart Automatic Chicken Coop Door
- A free Omlet API key (see below)

---

## Installation

### Via Homebridge UI (recommended)

1. Open the Homebridge UI
2. Go to **Plugins** and search for `homebridge-omlet-smart-chicken-coop`
3. Click **Install**
4. Configure the plugin (see [Configuration](#configuration))

### Via npm

```bash
npm install -g homebridge-omlet-smart-chicken-coop
```

---

## Getting an API Key

API keys are free and issued instantly from the Omlet developer portal.

1. Visit [smart.omlet.com/developers/login](https://smart.omlet.com/developers/login) and sign in with your Omlet account
2. Go to **API Keys** → **Generate New Key**
3. Copy the token — you'll need it during plugin setup

---

## Configuration

### Via Homebridge UI

After installing, click **Settings** on the plugin card and fill in your API key. Everything else has sensible defaults.

### Manually (config.json)

Add the following to the `platforms` array in your Homebridge `config.json`:

```json
{
  "platform": "OmletSmartChickenCoop",
  "name": "Omlet Smart Chicken Coop",
  "apiKey": "your-api-key-here"
}
```

### All options

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | string | *required* | Your Omlet API key |
| `name` | string | `"Omlet Smart Chicken Coop"` | Display name for the platform |
| `pollInterval` | integer (seconds) | `60` | How often to check door state. Minimum 10. Automatically drops to 10s during open/close transitions. |

---

## HomeKit State Mapping

The door is exposed as a **Lock Mechanism** accessory.

| Omlet door state | HomeKit state |
|---|---|
| `open` | Unlocked (Unsecured) |
| `closed` | Locked (Secured) |
| `opening` / `openpending` | Unknown (transitioning) |
| `closing` / `closepending` | Unknown (transitioning) |
| `stopping` | Unknown |
| `fault` | Jammed |

---

## Enabling Notifications

HomeKit handles notifications natively — no extra configuration needed in the plugin.

1. Open the **Home** app
2. Tap and hold the door accessory → **Accessory Settings** (gear icon)
3. Enable **Status Change Notifications**

You'll receive an alert on your iPhone/iPad whenever the door locks (closes for the night) or unlocks (opens in the morning).

You can also trigger automations — for example, send a notification if the door is still unlocked after sunset.

---

## Multiple Doors

No extra configuration required. The plugin discovers all Autodoor devices on your Omlet account automatically and creates one HomeKit accessory per door. Each accessory polls independently.

---

## Development

```bash
git clone https://github.com/vhvhxksc4t/homebridge-omlet-smart-chicken-coop.git
cd homebridge-omlet-smart-chicken-coop
npm install
npm run build        # compile TypeScript once
npm run watch        # recompile on save
```

To test against a live Homebridge instance, install the local folder as a global package:

```bash
npm install -g /path/to/homebridge-omlet-smart-chicken-coop
```

Then add the platform to your Homebridge config and restart.

---

## Troubleshooting

**Door not appearing in HomeKit**
Verify your API key is correct by testing it in the [Omlet developer console](https://smart.omlet.com/developers/login). Check the Homebridge log for errors on startup.

**State is stale / not updating**
The plugin polls on an interval rather than receiving push events. The default is 60 seconds. You can lower `pollInterval` in the config (minimum 10). During door movement the plugin automatically polls every 10 seconds.

**"No Autodoor devices found" warning**
This means your API key is valid but the account has no Autodoor devices registered. Check that your door is set up in the Omlet app under the same account.

---

## Contributing

Pull requests are welcome. Please open an issue first for anything beyond a small bug fix.

---

## License

MIT
