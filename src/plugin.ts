import streamDeck from "@elgato/streamdeck";
import { installLifecycle, onShutdown } from "./lifecycle";
import { stopDevice } from "./jbl-device";
import { shutdownService } from "./qe-service";
import { flushState } from "./state";
import { MuteAction } from "./actions/mute";
import { AncAction } from "./actions/anc";
import { SpatialAction } from "./actions/spatial";
import { BatteryAction } from "./actions/battery";
import { ChatBalanceAction } from "./actions/chat-balance";
import { EqKeyAction } from "./actions/eq-key";
import { EqDialAction } from "./actions/eq-dial";
import { FootstepAction } from "./actions/footstep";
import { FootstepDialAction } from "./actions/footstep-dial";
import { startListener } from "./jbl-listener";
import { startDeviceService } from "./device-service";

// "info" instead of "trace": trace logs every WebSocket message.
streamDeck.logger.setLevel("info");

// Clean shutdown when Stream Deck quits (see lifecycle.ts). Order matters:
// first HID (stops the watchdog and the read thread), then IPC.dll, then the state file.
installLifecycle("com.holgermilz.myjbxheadsetcontrol");
onShutdown(() => stopDevice());
onShutdown(() => shutdownService());
onShutdown(() => flushState());

streamDeck.actions.registerAction(new MuteAction());
streamDeck.actions.registerAction(new AncAction());
streamDeck.actions.registerAction(new SpatialAction());
streamDeck.actions.registerAction(new BatteryAction());
streamDeck.actions.registerAction(new ChatBalanceAction());
streamDeck.actions.registerAction(new EqKeyAction());
streamDeck.actions.registerAction(new EqDialAction());
streamDeck.actions.registerAction(new FootstepAction());
streamDeck.actions.registerAction(new FootstepDialAction());

startListener();
startDeviceService(); // QuantumENGINE service, if installed (settings + notifications)
streamDeck.connect().catch((err) => streamDeck.logger.error(`connect failed: ${err}`));
