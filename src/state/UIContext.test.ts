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

  describe("SET_MAPBOX_TOKEN", () => {
    it("stores the token", () => {
      const next = uiReducer(uiInitialState, { type: "SET_MAPBOX_TOKEN", token: "pk.test" });
      expect(next.mapboxToken).toBe("pk.test");
    });

    it("accepts null to clear the token", () => {
      const withToken = { ...uiInitialState, mapboxToken: "pk.old" };
      const next = uiReducer(withToken, { type: "SET_MAPBOX_TOKEN", token: null });
      expect(next.mapboxToken).toBeNull();
    });
  });

  describe("RESTORE_UI", () => {
    it("sets workingTimezone", () => {
      const next = uiReducer(uiInitialState, {
        type: "RESTORE_UI", workingTimezone: "Europe/Paris", gridColumns: 5, mapPanelHeight: 200,
      });
      expect(next.workingTimezone).toBe("Europe/Paris");
    });

    it("sets gridColumns", () => {
      const next = uiReducer(uiInitialState, {
        type: "RESTORE_UI", workingTimezone: "America/Los_Angeles", gridColumns: 3, mapPanelHeight: 200,
      });
      expect(next.gridColumns).toBe(3);
    });

    it("sets mapPanelHeight", () => {
      const next = uiReducer(uiInitialState, {
        type: "RESTORE_UI", workingTimezone: "America/Los_Angeles", gridColumns: 5, mapPanelHeight: 350,
      });
      expect(next.mapPanelHeight).toBe(350);
    });

    it("preserves mapboxToken and claudeApiKey from current state", () => {
      const withKeys = { ...uiInitialState, mapboxToken: "pk.test", claudeApiKey: "sk.test" };
      const next = uiReducer(withKeys, {
        type: "RESTORE_UI", workingTimezone: "UTC", gridColumns: 5, mapPanelHeight: 200,
      });
      expect(next.mapboxToken).toBe("pk.test");
      expect(next.claudeApiKey).toBe("sk.test");
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
