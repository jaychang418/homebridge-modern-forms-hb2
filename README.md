# Modern Forms Homebridge Plugin (HB2)

Add support for [Modern Forms](https://modernforms.com) fans to HomeKit using Homebridge.

> **Note:** This is a community fork of [homebridge-modern-forms](https://github.com/nickbreaton/homebridge-modern-forms) by Nick Breaton, updated for Homebridge 2.0 compatibility. All credit for the original implementation goes to the original author. This fork exists solely to keep the plugin working on current Homebridge versions.  This was coded using Claude Code.

## Requirements

- Homebridge 1.6.0 or later (including Homebridge 2.0)
- Node.js 20.15.1, 22, or 24

## Installation

Install through the Homebridge UI by searching for **Modern Forms HB2**, or run:

```bash
npm install -g homebridge-modern-forms-hb2
```

## Setup

1. Add any fans to your home network using the Modern Forms app:
    1. Download the Modern Forms [iOS](https://apps.apple.com/us/app/modern-forms/id1425046298) or [Android](https://play.google.com/store/apps/details?id=com.WAC.PlayStore.ModernForms&hl=en_US) app.
    1. Follow the instructions to pair your fan.
    1. Verify your fans show up in the app and can be controlled.

1. Add the following to your Homebridge `config.json` under platforms:

    ```json
    {
        "platform": "ModernForms"
    }
    ```

1. Restart Homebridge. Any fans visible in the Modern Forms app should appear in the Home app automatically.

## Configuration

### Specifying Fan IP Addresses

If any fans are not automatically discovered, specify their IP addresses manually:

```json
{
    "platform": "ModernForms",
    "fans": [
        { "ip": "192.168.0.10" },
        { "ip": "192.168.0.11" }
    ]
}
```

### Disabling Auto Discovery

To disable automatic network scanning and rely solely on manually specified IPs:

```json
{
    "platform": "ModernForms",
    "autoDiscover": false
}
```

### Live Status Updates

The plugin checks each fan's state every 10 seconds, so changes made with the remote or the Modern Forms app show up in the Home app. Change the interval (in seconds), or set it to `0` to turn it off:

```json
{
    "platform": "ModernForms",
    "pollingInterval": 30
}
```

### Fans Without a Light

Fans that report no light kit have their light tile removed automatically. To hide the light tile yourself, set `light` to `false` for that fan:

```json
{
    "platform": "ModernForms",
    "fans": [
        { "ip": "192.168.0.10", "light": false }
    ]
}
```

### How Auto Discovery Works

At startup the plugin asks every address on the Homebridge host's local network(s) whether it is a Modern Forms fan. It does not need `ping` or root permissions, and it recognises fans by their answer rather than by hardware ID, so newer fans are found too. Networks with more than 1,024 addresses (such as Docker bridge networks) are skipped. On a typical home network the scan takes 5–30 seconds and runs in the background; fans already known to Homebridge work immediately.

## Troubleshooting

### Fan shows normally in the Home app but ignores every tap

**Symptom:** The fan appears fine in the Home app (no "No Response"), but turning it on or off does nothing, and Homebridge logs no errors. The Modern Forms app still controls the fan.

**Cause:** On v2.0.2 and earlier, if the fan was unreachable at the moment Homebridge started (for example, a brief Wi-Fi drop), the plugin never connected the Home app controls to the cached fan and never retried.

**Fix:** Update to **v2.0.3** or later. The controls are now connected at startup using the fan's last known IP; if the fan is offline, the Home app shows "No Response" and recovers on its own once the fan is reachable. On older versions, restart the plugin's child bridge while the fan is online.

### Fan stops responding after its IP address changes

**Symptom:** Homebridge logs show repeated errors like `connect EHOSTUNREACH <old-ip>` and the fan stops responding in the Home app, even though the fan is online and reachable from your network.

**Cause:** This plugin caches each fan's IP address against its unique device ID. If the fan's IP changes — for example, you update its DHCP reservation, the router hands it a new lease, or you move it to a different subnet — Homebridge keeps trying to reach the old address. As of **v2.0.2**, the plugin automatically detects this on rediscovery and overwrites the cached IP. On earlier versions, the cached entry has to be cleared manually.

**Fix on v2.0.2 or later:** Make sure the fan's new IP is reachable from Homebridge. Then either:
- Enable `autoDiscover` and restart Homebridge (the network scan will find the fan at its new IP), or
- Add the new IP under the plugin's `fans` config and restart.

On restart you'll see a log line like `IP for <clientId> changed from <old> to <new>; updating cached accessory`. From that point on, the cached IP is corrected and the fan resumes working.

**Fix on v2.0.1 or earlier:** In the Homebridge UI, go to **Settings → Remove Single Cached Accessory**, delete the stale Modern Forms fan, ensure the new IP is in your config (or auto-discover is on and works for your network), then restart. The fan will be re-cached at the correct IP and re-pair with HomeKit automatically.

**Prevention:** Set a permanent DHCP reservation for each fan in your router so its IP never changes.

> Note on auto-discovery: the network scan only covers networks the Homebridge host is directly connected to. If Homebridge runs in Docker (bridge mode) or the fans are on a different subnet or VLAN, list the fan IPs explicitly under `fans` in the plugin config.

## Changes from Original

- Updated to Homebridge 2.0 Promise-based characteristic API (`onGet`/`onSet`)
- Node.js minimum raised to 18.20.4 (matches Homebridge 2.0 requirement)
- Removed unused dependency (`@network-utils/arp-lookup`)
- Updated `axios` to v1.x
- **v2.1.0:**
    - Auto discovery rewritten: finds fans by asking each address directly, so it works with newer fans (whose hardware IDs no longer start with `C8:93:46`) and on systems where `ping` isn't permitted, such as Synology. Removes six old dependencies.
    - Live status updates: the Home app now reflects changes made with the remote or the Modern Forms app (`pollingInterval`, default 10 seconds).
    - Fans without a light kit no longer show a light tile; `light: false` hides it manually.
    - New fans are named after the name set in the Modern Forms app (e.g. "Porch Fan") instead of their IP address, and report their model and firmware.
    - An offline fan now shows a clean "No Response" with one log line when it drops and one when it returns, instead of an error for every request.
    - Node.js 24 supported; Node.js 18 dropped.
- **v2.0.3:** Fans that were offline when Homebridge started now work as soon as they come back, instead of silently ignoring commands until the next restart. Requests to a fan now time out after 5 seconds.
- **v2.0.2:** Automatically refresh cached fan IP addresses when a fan is rediscovered at a new IP (fixes persistent `EHOSTUNREACH` errors after a DHCP/reservation change)
