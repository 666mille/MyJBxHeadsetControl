My JBx Headset Control v2.1.0 – Footstep Booster & QuantumENGINE integration

Control your **JBL Quantum 950 Wireless** from an Elgato Stream Deck – now with the **Footstep Booster** and full **QuantumENGINE integration**: changes made on the Stream Deck show up in QuantumENGINE, and changes made in QuantumENGINE show up on the Stream Deck.

### What's new
- **Footstep Booster** (key) – toggles the QuantumENGINE Footstep Booster and shows its state and game profile. Optionally fixed to one game: a press switches to that game and turns it on, a second press turns it off (e.g. one key for CS2, one for Overwatch 2).
- **Footstep Booster Dial** (dial) – rotate to choose the game, rotate while pressed to change the strength, press or tap for on/off.
- **QuantumENGINE follows the Stream Deck** – mute, game/chat balance and EQ presets go through the QuantumENGINE service when it runs, so its window updates right away.
- **Live updates from QuantumENGINE** – presets and settings changed in QuantumENGINE appear on the keys and dials immediately.
- **Every key press is checked** – mute, ANC, Ambient Aware and spatial sound read the real state first, confirm the change and retry once; otherwise the key shows an alert.
- **Correct state right after start** – a headset that was already on when the PC started no longer shows OFFLINE.

### Actions
- **Mute** – microphone icon: white when live, red and crossed out when muted
- **ANC / Ambient** – Off / Noise Cancelling / Ambient Aware, colors configurable
- **Spatial Sound** – Off / Fixed / Head Tracking, colors configurable
- **Battery** – battery graphic that fills according to the charge level
- **Game-Chat Balance** (dial) – JBL header, live battery readout, headset icon and a two-color balance bar; rotate to adjust, press to reset to 50/50
- **EQ Preset** (key) – applies an EQ preset from JBL QuantumENGINE, highlighted when active
- **EQ Preset Dial** (dial) – rotate to browse all presets, press or tap to apply
- **Footstep Booster** (key) – new
- **Footstep Booster Dial** (dial) – new

### Fixed
- **Headset stays OFFLINE after a QuantumENGINE update** – Windows can list the dongle's HID collections in a different order after a driver reinstall; the plugin now finds the right one regardless of the order and reconnects when the path changes.

### Highlights
- Configurable **header text** (default `JBL`) on every key and dial – toggle on/off and change the text per action
- Configurable colors and separate Offline / No-Dongle backgrounds
- **Works with or without QuantumENGINE**: with its service running, settings go through it; without it, everything goes over HID as before
- All keys and dials update instantly when anything changes

### Requirements
- Windows 10/11 and Stream Deck software 7.1+
- **Footstep Booster** actions: JBL QuantumENGINE installed and its service running (the window can stay closed). The Footstep Booster runs inside QuantumENGINE on the PC, not on the headset. Without the service the actions show **NO QUANTUM ENGINE**.
- **EQ** actions: JBL QuantumENGINE installed. With its service running, presets are switched by QuantumENGINE itself; otherwise the plugin computes the coefficients with QuantumENGINE's local DLL, as in v2.0.0.
- All other actions work without QuantumENGINE.
- Nothing from JBL is included in this plugin – it uses the files of your local QuantumENGINE installation.

### Note on the QuantumENGINE window
Tested with QuantumENGINE v2.9.4. **Footstep on/off, footstep strength and spatial sound** are applied right away, but the QuantumENGINE window shows them only after QuantumENGINE is restarted – its service does not announce these changes to other programs. Everything else (mute, balance, EQ, ANC / Ambient, footstep game) shows up immediately. The plugin itself always shows the real state.

### Install
Download `com.holgermilz.myjbxheadsetcontrol.streamDeckPlugin` below and double-click it. An older version is replaced.
