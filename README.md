# Modern Forms Homebridge Plugin (HB2)

Add support for [Modern Forms](https://modernforms.com) fans to HomeKit using Homebridge.

> **Note:** This is a community fork of [homebridge-modern-forms](https://github.com/nickbreaton/homebridge-modern-forms) by Nick Breaton, updated for Homebridge 2.0 compatibility. All credit for the original implementation goes to the original author. This fork exists solely to keep the plugin working on current Homebridge versions.  This was coded using Claude Code.

## Requirements

- Homebridge 1.6.0 or later (including Homebridge 2.0)
- Node.js 18.20.4, 20.15.1, or 22+

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

## Changes from Original

- Updated to Homebridge 2.0 Promise-based characteristic API (`onGet`/`onSet`)
- Node.js minimum raised to 18.20.4 (matches Homebridge 2.0 requirement)
- Removed unused dependency (`@network-utils/arp-lookup`)
- Updated `axios` to v1.x
