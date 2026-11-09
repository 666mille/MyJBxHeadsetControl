# MyJBxHeadsetControl v2.1.0

## New: Footstep Booster key

Toggles the **Footstep Booster** from JBL QuantumENGINE and shows its state and the selected
game profile (e.g. *Counter-Strike 2*).

The Footstep Booster runs inside QuantumENGINE on your PC, not on the headset, so this key
needs QuantumENGINE installed and its service running (the QuantumENGINE window can stay
closed). The plugin uses `IPC.dll` from your local QuantumENGINE installation; nothing from
JBL is shipped with the plugin. Without the service the key shows **NO QUANTUM ENGINE**.

Note: the QuantumENGINE window shows changes made from the Stream Deck only after it is
reopened. Changes made in QuantumENGINE show up on the key within a few seconds.

## Footstep Booster: choose the game

- **Footstep key** can be fixed to a game in the Property Inspector: a press switches to that
  game and turns the booster on, a second press turns it off (e.g. one key for CS2, one for
  Overwatch 2).
- **New Footstep Booster Dial**: rotate to choose the game, rotate while pressed to change the
  strength, press or tap for on/off.

## QuantumENGINE follows the Stream Deck

With QuantumENGINE running, mute and the game/chat balance are now sent through the
QuantumENGINE service, so its window follows right away (before, the balance did not show up
there). ANC, Ambient Aware and spatial sound stay on HID, where the headset reports them back
and QuantumENGINE shows them as before. Without QuantumENGINE nothing changes.

## EQ through QuantumENGINE

With QuantumENGINE running, the EQ key and dial now ask the QuantumENGINE service to switch
the preset, exactly like clicking it there. The QuantumENGINE window follows immediately,
and presets chosen in QuantumENGINE show up on the keys and the dial right away.
Without QuantumENGINE running, the plugin falls back to computing and sending the
coefficients itself, as before. The Property Inspector shows which way is used.

## Every key press is checked

Mute, ANC, Ambient Aware and spatial sound keys now read the real state from the dongle
before switching (so a missed event can no longer make a press "do nothing"), confirm
afterwards that the headset took the change, and retry once. If it still did not arrive,
the key shows an alert instead of a wrong state.

## Base station knob

When the knob on the base station is pressed (whatever it is assigned to in QuantumENGINE:
Footstep Booster, mic, EQ, ...), the plugin refreshes all values right away, so the keys
follow immediately instead of on the next poll.

## Correct state right after start

The plugin now asks the dongle for the link state and all current values (battery, mute,
ANC, Ambient Aware, spatial sound, game/chat balance) when it connects. Before, a headset
that was already switched on when the PC started stayed **OFFLINE** until the first event.

## Fix: headset stays OFFLINE after a QuantumENGINE update

After a QuantumENGINE update, Windows can return the dongle's HID collections in a different
order. The plugin picked the collection by its position in that list, opened the wrong one
and never received any status events: every key showed **OFFLINE** although the headset was
on. "NO DONGLE" still worked.

The plugin now finds the right collection independently of the list order (usage page
`0xff12`, falling back to the `&Col04` path, then to actively probing each collection with
the same harmless poll QuantumENGINE sends). The watchdog also reconnects when the
collection path changes while the dongle stays plugged in.

## Install

Download the `.streamDeckPlugin` file below and double-click it. If an older version is
installed, it is replaced. Requires Windows 10/11 and Stream Deck software 7.1+.
