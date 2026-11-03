import { IAllEquipment, IEquipmentData, IEquipmentSetup, IUnit } from "../types";
import { ObjectUtils_isEqual } from "../utils/object";
import { Equipment_build } from "./equipment";
import { EquipmentLegacyDefaults_all } from "./equipmentLegacyDefaults";
import { EquipmentSetup_fromLegacy, EquipmentSetup_save } from "./equipmentSetup";
import { EquipmentSetupEdit_default } from "./equipmentSetupEdit";

function typedSetup(key: string, legacy: IEquipmentData, unit: IUnit): IEquipmentSetup {
  switch (key) {
    case "dumbbell":
      return {
        type: "fixed",
        unit,
        ranges: unit === "lb" ? [{ from: 10, to: 75, step: 5 }] : [{ from: 5, to: 35, step: 2.5 }],
        values: [],
      };
    case "kettlebell":
      return {
        type: "fixed",
        unit,
        ranges: unit === "lb" ? [{ from: 25, to: 100, step: 2.5 }] : [{ from: 12, to: 48, step: 2 }],
        values: [],
      };
    case "cable":
      return EquipmentSetupEdit_default("stack", unit);
    case "band": {
      const bands = EquipmentSetupEdit_default("bands", unit);
      return bands.type === "bands" ? { ...bands, combine: true } : bands;
    }
    default:
      return EquipmentSetup_fromLegacy(legacy, unit);
  }
}

function legacyWithBand(): IAllEquipment {
  return { ...EquipmentLegacyDefaults_all(), band: Equipment_build("") };
}

export function EquipmentDefaults_build(unit: IUnit): IAllEquipment {
  const result: IAllEquipment = {};
  for (const [key, legacy] of Object.entries(legacyWithBand())) {
    if (legacy != null) {
      result[key] = EquipmentSetup_save({ ...legacy, name: undefined }, typedSetup(key, legacy, unit));
    }
  }
  return result;
}

function legacyDefaultSetup(key: string, unit: IUnit): IEquipmentSetup | undefined {
  const legacy = EquipmentLegacyDefaults_all()[key];
  return legacy != null ? EquipmentSetup_fromLegacy(legacy, unit) : undefined;
}

export function EquipmentDefaults_inUnit(
  key: string,
  setup: IEquipmentSetup,
  unit: IUnit
): IEquipmentSetup | undefined {
  const pairs: [IEquipmentSetup | undefined, IEquipmentSetup | undefined][] = [
    [EquipmentDefaults_build(setup.unit)[key]?.setup, EquipmentDefaults_build(unit)[key]?.setup],
    [legacyDefaultSetup(key, setup.unit), legacyDefaultSetup(key, unit)],
  ];
  return pairs.find(([source]) => source != null && ObjectUtils_isEqual(source, setup))?.[1];
}
