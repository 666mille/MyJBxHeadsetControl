# My JBx Headset Control

A Stream Deck plugin for the JBL Quantum 950 Wireless headset.

![Stream Deck showing the plugin actions](docs/screenshot.png)

Control your **JBL Quantum 950 Wireless** headset directly from an Elgato Stream Deck –
no JBL QuantumENGINE required. The plugin talks to the headset's USB dongle over a
reverse-engineered HID protocol and shows live status on your keys and dials.

> ⚠️ This project is not affiliated with, endorsed by, or supported by JBL / HARMAN.
> Use at your own risk.

## Features

| Action | Type | What it does |
|---|---|---|
| **Mute** | Key (4 states) | Toggle mic mute. Live / Muted / Offline / No Dongle – each state can get its own image via the Stream Deck UI |
| **ANC / Ambient** | Key | Cycles Off → Noise Cancelling → Ambient Aware, colors configurable |
| **Spatial Sound** | Key | Cycles Off → Fixed → Head Tracking, colors configurable |
| **Battery** | Key | Live battery level with configurable thresholds and colors |
| **Game-Chat Balance** | Dial | Custom rendered display: JBL header with battery readout, two-color balance bar, rotate to adjust, press to reset to 50/50. Last value is persisted |

All actions react instantly to changes made elsewhere (headset buttons, the wheel on
the earcup, or QuantumENGINE) and show **OFFLINE** when the headset is powered off
and **NO DONGLE** when the USB dongle is unplugged, including automatic reconnect.

## Requirements

- JBL Quantum 950 Wireless with its 2.4 GHz USB dongle
- Elgato Stream Deck software 7.1+ (SDK v3, Node.js 20 plugin runtime)
- Windows 10/11 (developed and tested on Windows; macOS untested)

## Installation

### From a release (recommended)

1. Download the latest `com.holgermilz.myjbxheadsetcontrol.streamDeckPlugin`
   from the [Releases page](https://github.com/666mille/MyJBxHeadsetControl/releases).
2. Double-click the file – the Stream Deck app installs the plugin automatically.

### From source

```bash
git clone https://github.com/666mille/MyJBxHeadsetControl.git
cd MyJBxHeadsetControl
npm install
npm run build
streamdeck link com.holgermilz.myjbxheadsetcontrol.sdPlugin
```

`streamdeck` is the [Elgato CLI](https://docs.elgato.com/sdk/plugins/cli)
(`npm i -g @elgato/cli`). For development use `npm run watch`, which rebuilds and
restarts the plugin on every change.

## How it works

The Quantum 950 dongle exposes several HID collections on USB interface 5. The
plugin opens the vendor collection (`Col04`) with a single shared handle:

- **Events in:** the dongle pushes status packets (`86 00 dd ...`) for battery,
  mute, ANC, ambient aware, spatial mode, game-chat balance and headset power.
  A watchdog additionally polls the device list to detect dongle unplug/replug.
- **Commands out:** settings are written as 64-byte feature reports
  (`88 00 dd 02 00 01 00 05 00 <codeA> <codeB> 01 00 <value>`).

State is kept in memory with a pub/sub mechanism so every key and the dial update
immediately when anything changes.

## Credits

Protocol reverse-engineered with a USB analyzer and a lot of patience.
Built with the [Elgato Stream Deck SDK](https://docs.elgato.com/sdk) and
[node-hid](https://github.com/node-hid/node-hid).

## License

[MIT](LICENSE)