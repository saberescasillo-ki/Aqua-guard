import { EntityEquippableComponent, EquipmentSlot, system, world } from "@minecraft/server";
import HeldItemType from "./HeldItemType";

class PlayerAnimState {
    constructor() {
        this.heldItem = HeldItemType.None;
        this.usedItemID = "";
        this.usedItemIndex = -1;
        this.eatingFood = false;
        this.drinkingPotion = false;
        this.drawingBow = false;
        this.fishingRod = false;
        this.spying = false;
        this.stateVariables = {
            [HeldItemType.Food]: "eatingFood",
            [HeldItemType.Potion]: "drinkingPotion",
            [HeldItemType.Bow]: "drawingBow",
            [HeldItemType.FishingRod]: "fishingRod",
            [HeldItemType.Spyglass]: "spying",
        };
    }

    static runAllPlayerAnimations() {
        for (const player of world.getAllPlayers()) {
            PlayerAnimState.getPlayerState(player).runPlayerAnimations(player);
        }
    }

    static getPlayerState(player) {
        if (!this.states.has(player.id)) {
            this.states.set(player.id, new PlayerAnimState());
        }
        return this.states.get(player.id);
    }

    static removePlayerState(playerId) {
        this.states.delete(playerId);
    }

    static onEntityHurt(event) {
        const { hurtEntity } = event;
        if (hurtEntity.typeId !== "minecraft:player" || event.damage <= 0) return;
        const player = hurtEntity;
        player.playAnimation("animation.mbp_ap.player.hurt.true", {
            controller: "controller.animation.mbp_ap.player.hurt",
            stopExpression: "q.is_first_person || 0",
        });
        system.runTimeout(() => {
            if (!player.isValid()) return;
            player.playAnimation("animation.mbp_ap.player.hurt.false", {
                controller: "controller.animation.mbp_ap.player.hurt",
                stopExpression: "q.is_first_person || 0",
            });
        }, 3);
    }

    static onItemStartUse(event) {
        const { source } = event;
        if (source.typeId !== "minecraft:player") return;
        const state = PlayerAnimState.getPlayerState(source);
        const stateVar = state.stateVariables[state.heldItem];
        if (!stateVar) return;
        if (state.heldItem === HeldItemType.FishingRod) {
            state[stateVar] = !state[stateVar];
        } else {
            state[stateVar] = true;
        }
    }

    static onItemStopUse(event) {
        const { source } = event;
        if (source.typeId !== "minecraft:player") return;
        const state = PlayerAnimState.getPlayerState(source);
        const stateVar = state.stateVariables[state.heldItem];
        if (stateVar && state.heldItem !== HeldItemType.FishingRod) {
            state[stateVar] = false;
        }
    }

    static onPlayerLeave(event) {
        this.removePlayerState(event.playerId);
    }

    playConditionAnimation(player, condition, animation) {
        player.playAnimation(`animation.mbp_ap.player.${animation}.${condition ? "true" : "false"}`, {
            controller: `controller.animation.mbp_ap.player.${animation}`,
            stopExpression: "q.is_first_person || 0",
        });
    }

    updateHeldItem(mainhandItem) {
        this.heldItem = mainhandItem ? this.getHeldItemType(mainhandItem) : HeldItemType.None;
        this.resetStates();
    }

    getHeldItemType(item) {
        const typeId = item.typeId;
        if (item.hasTag("minecraft:is_food") || typeId === "minecraft:cod" || typeId === "minecraft:salmon" || typeId === "minecraft:pufferfish") {
            return HeldItemType.Food;
        }
        switch (typeId) {
            case "minecraft:potion":
            case "minecraft:water_bottle":
            case "minecraft:honey_bottle":
            case "minecraft:ominous_bottle":
                return HeldItemType.Potion;
            case "minecraft:bow":
                return HeldItemType.Bow;
            case "minecraft:fishing_rod":
                return HeldItemType.FishingRod;
            case "minecraft:spyglass":
                return HeldItemType.Spyglass;
        }
        if (item.hasTag("minecraft:is_sword")) return HeldItemType.Sword;
        return HeldItemType.None;
    }

    resetStates() {
        for (const stateVar of Object.values(this.stateVariables)) this[stateVar] = false;
    }

    updateRidingAnimation(player) {
        const riding = player.getComponent("minecraft:riding");
        let animationName = "none";
        if (riding?.entityRidingOn) {
            switch (riding.entityRidingOn.typeId) {
                case "minecraft:boat": animationName = "boat"; break;
                case "minecraft:minecart": animationName = "minecart"; break;
                default: animationName = "unknown"; break;
            }
        }
        player.playAnimation(`animation.mbp_ap.player.riding.${animationName}`, {
            controller: "controller.animation.mbp_ap.player.riding",
            stopExpression: "q.is_first_person || 0",
        });
    }

    runPlayerAnimations(player) {
        const component = player.getComponent(EntityEquippableComponent.componentId);
        if (!component) return;
        const mainhandItem = component.getEquipment(EquipmentSlot.Mainhand);
        const itemSlotMatch = player.selectedSlotIndex === this.usedItemIndex;
        const itemTypeMatch = mainhandItem?.typeId === this.usedItemID;
        if (!itemSlotMatch || !itemTypeMatch) {
            this.usedItemIndex = player.selectedSlotIndex;
            this.usedItemID = mainhandItem?.typeId || "";
            this.updateHeldItem(mainhandItem);
        }

        const conditions = [
            { condition: this.fishingRod, animation: "fishing_rod" },
            { condition: this.eatingFood, animation: "eating_food" },
            { condition: this.drinkingPotion, animation: "drinking_potion" },
            { condition: this.drawingBow, animation: "drawing_bow" },
            { condition: this.spying, animation: "spying" },
            { condition: this.heldItem === HeldItemType.Sword, animation: "holding_sword" },
            { condition: player.isFlying, animation: "is_flying" },
            { condition: player.isClimbing, animation: "climbing" },
        ];
        for (const { condition, animation } of conditions) this.playConditionAnimation(player, condition, animation);
        this.updateRidingAnimation(player);

        // The original animation is stopped in first person. It is also stopped during Elytra gliding,
        // preserving the original add-on's behavior and preventing the walking cycle from leaking into flight.
        if (!player.isGliding) {
            player.playAnimation("animation.mbp_ap.player", {
                controller: "controller.animation.mbp_ap.player.main",
                stopExpression: "q.is_first_person || q.is_gliding || !q.is_alive",
            });
        }
    }
}

PlayerAnimState.states = new Map();
export default PlayerAnimState;
