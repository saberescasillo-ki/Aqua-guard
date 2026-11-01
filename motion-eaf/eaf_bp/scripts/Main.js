import { system, world } from "@minecraft/server";
import PlayerAnimState from "./Animations/PlayerAnimState";

world.afterEvents.itemStartUse.subscribe((event) => {
    system.run(() => PlayerAnimState.onItemStartUse(event));
});

world.afterEvents.itemStopUse.subscribe((event) => {
    system.run(() => PlayerAnimState.onItemStopUse(event));
});

world.afterEvents.entityHurt.subscribe((event) => {
    system.run(() => PlayerAnimState.onEntityHurt(event));
});

world.afterEvents.playerLeave.subscribe((event) => {
    system.run(() => PlayerAnimState.onPlayerLeave(event));
});

system.runInterval(() => {
    PlayerAnimState.runAllPlayerAnimations();
}, 0);
