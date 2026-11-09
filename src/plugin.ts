import streamDeck from "@elgato/streamdeck";
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
streamDeck.connect();
