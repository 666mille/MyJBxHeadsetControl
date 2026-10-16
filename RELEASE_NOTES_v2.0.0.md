My JBx Headset Control v2.0.0 – EQ presets

Control your **JBL Quantum 950 Wireless** from an Elgato Stream Deck – now with **EQ presets**. QuantumENGINE doesn't need to be running.

### What's new
- **EQ Preset** (key) – applies an EQ preset from JBL QuantumENGINE: all system presets and your own custom ones. Shows the preset name, highlighted when active.
- **EQ Preset Dial** (dial) – rotate to browse all presets, press or tap to apply.
- **Apply on select** – optionally send a preset as soon as you pick it in the Property Inspector.
- **Safety self-test** – the EQ is only enabled if the computed data matches QuantumENGINE byte for byte.

### Actions
- **Mute** – microphone icon: white when live, red and crossed out when muted
- **ANC / Ambient** – Off / Noise Cancelling / Ambient Aware, colors configurable
- **Spatial Sound** – Off / Fixed / Head Tracking, colors configurable
- **Battery** – battery graphic that fills according to the charge level
- **Game-Chat Balance** (dial) – JBL header, live battery readout, headset icon and a two-color balance bar; rotate to adjust, press to reset to 50/50
- **EQ Preset** (key) – new
- **EQ Preset Dial** (dial) – new

### Highlights
- Configurable **header text** (default `JBL`) on every key and the dial – toggle on/off and change the text per action
- Configurable colors and separate Offline / No-Dongle backgrounds
- **Robust offline detection**: starts offline, goes online on the first real status packet, stays online until power-off – no false "online" after a cold start
- All keys and the dial update instantly when anything changes

### Requirements for the EQ actions
- JBL QuantumENGINE must be **installed** (it doesn't need to be running). Presets are read from its `q950.dat`, and the filter coefficients are computed with its local DLL – the same way QuantumENGINE does it. The DLL is not included in this plugin.
- All other actions work without QuantumENGINE.
- QuantumENGINE doesn't notice presets applied by the plugin and keeps showing its own last selection – the headset uses the preset from the plugin anyway.
- If the EQ shows **Locked** in the Property Inspector, set the DLL path there (usually `C:\Program Files\JBL\QuantumENGINE\PEQ\`).

### Note on OFFLINE
If the headset shows OFFLINE after you switch it on, give the volume wheel a notch (or toggle ANC / mute) so it sends a status packet – it then goes online immediately. Switching the headset on while the PC is already running usually avoids this.

### Install
Download the `.streamDeckPlugin` file below and double-click it. If an older version is installed, it is replaced. Requires Windows 10/11 and Stream Deck software 7.1+.

### Thanks
A big thank you to **@Shiro836** for the EQ research – the feature IDs, the hint that the coefficients come from QuantumENGINE's `serializePEQ`, and the verified preset data. Without that, EQ support wouldn't exist.

*Not affiliated with JBL / HARMAN.*
