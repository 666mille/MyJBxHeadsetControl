import streamDeck from "@elgato/streamdeck";
import { MuteAction } from "./actions/mute";
import { AncAction } from "./actions/anc";
import { SpatialAction } from "./actions/spatial";
import { BatteryAction } from "./actions/battery";
import { ChatBalanceAction } from "./actions/chat-balance";
import { startListener } from "./jbl-listener";

// "info" statt "trace": trace protokolliert jede WebSocket-Nachricht
// und blaeht die Logs massiv auf.
streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new MuteAction());
streamDeck.actions.registerAction(new AncAction());
streamDeck.actions.registerAction(new SpatialAction());
streamDeck.actions.registerAction(new BatteryAction());
streamDeck.actions.registerAction(new ChatBalanceAction());

startListener();
streamDeck.connect();