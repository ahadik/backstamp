import { uiReducer, uiInitialState } from "./UIContext";

describe("uiReducer", () => {
  describe("SET_WORKING_TIMEZONE", () => {
    it("updates the timezone", () => {
      const next = uiReducer(uiInitialState, {
        type: "SET_WORKING_TIMEZONE",
        timezone: "America/New_York",
      });
      expect(next.workingTimezone).toBe("America/New_York");
    });
  });

  describe("SET_GRID_COLUMNS", () => {
    it("sets gridColumns to the given value", () => {
      const next = uiReducer(uiInitialState, { type: "SET_GRID_COLUMNS", columns: 3 });
      expect(next.gridColumns).toBe(3);
    });

    it("clamps values below 1 to 1", () => {
      const next = uiReducer(uiInitialState, { type: "SET_GRID_COLUMNS", columns: 0 });
      expect(next.gridColumns).toBe(1);
    });

    it("clamps negative values to 1", () => {
      const next = uiReducer(uiInitialState, { type: "SET_GRID_COLUMNS", columns: -2 });
      expect(next.gridColumns).toBe(1);
    });

    it("accepts boundary value 1", () => {
      const next = uiReducer(uiInitialState, { type: "SET_GRID_COLUMNS", columns: 1 });
      expect(next.gridColumns).toBe(1);
    });
  });

  describe("SET_PANEL_WIDTH", () => {
    it("sets panelWidth to the given value", () => {
      const next = uiReducer(uiInitialState, { type: "SET_PANEL_WIDTH", width: 1200 });
      expect(next.panelWidth).toBe(1200);
    });
  });

  describe("SET_MAP_PANEL_HEIGHT", () => {
    it("updates mapPanelHeight", () => {
      const next = uiReducer(uiInitialState, { type: "SET_MAP_PANEL_HEIGHT", height: 350 });
      expect(next.mapPanelHeight).toBe(350);
    });

    it("clamps values below 60 to 60", () => {
      const next = uiReducer(uiInitialState, { type: "SET_MAP_PANEL_HEIGHT", height: 10 });
      expect(next.mapPanelHeight).toBe(60);
    });
  });

  describe("unknown action", () => {
    it("returns state unchanged", () => {
      // @ts-expect-error intentional unknown action
      const next = uiReducer(uiInitialState, { type: "__UNKNOWN__" });
      expect(next).toBe(uiInitialState);
    });
  });
});
