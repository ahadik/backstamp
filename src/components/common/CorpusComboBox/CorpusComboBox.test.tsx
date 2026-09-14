import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { CorpusComboBox } from "./CorpusComboBox";
import type { CorpusEntry } from "../../../state/CorpusContext";

const entries: CorpusEntry[] = [
  { value: "Kodak", isBuiltin: true, lastUsed: null, useCount: 0 },
  { value: "Fujifilm", isBuiltin: true, lastUsed: null, useCount: 0 },
  { value: "Ilford", isBuiltin: true, lastUsed: null, useCount: 0 },
];

function setup(value: string | null = null) {
  const onSelect = vi.fn();
  const onAddEntry = vi.fn();
  render(
    <CorpusComboBox
      label="Vendor"
      value={value}
      entries={entries}
      onSelect={onSelect}
      onAddEntry={onAddEntry}
      onRemoveEntry={vi.fn()}
    />
  );
  const input = screen.getByPlaceholderText("Vendor") as HTMLInputElement;
  return { input, onSelect, onAddEntry };
}

describe("CorpusComboBox keyboard commit", () => {
  it("Enter selects the first match for a partial search and blurs", () => {
    const { input, onSelect } = setup();
    input.focus();
    fireEvent.change(input, { target: { value: "fuj" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("Fujifilm");
    expect(document.activeElement).not.toBe(input);
    expect(screen.queryByText("No options match")).not.toBeInTheDocument();
  });

  it("Enter prefers an exact match over an earlier partial match", () => {
    const onSelect = vi.fn();
    render(
      <CorpusComboBox
        label="Lens"
        value={null}
        entries={[{ value: "50mm f/1.4", isBuiltin: true, lastUsed: null, useCount: 0 }, { value: "50mm", isBuiltin: true, lastUsed: null, useCount: 0 }]}
        onSelect={onSelect}
        onAddEntry={vi.fn()}
        onRemoveEntry={vi.fn()}
      />
    );
    const input = screen.getByPlaceholderText("Lens");
    input.focus();
    fireEvent.change(input, { target: { value: "50mm" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("50mm");
  });

  it("Enter with no match adds and selects the typed value", () => {
    const { input, onSelect, onAddEntry } = setup();
    input.focus();
    fireEvent.change(input, { target: { value: "Lomography" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddEntry).toHaveBeenCalledWith("Lomography");
    expect(onSelect).toHaveBeenCalledWith("Lomography");
  });

  it("Enter with an empty search just closes without selecting", () => {
    const { input, onSelect } = setup("Kodak");
    input.focus();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
    expect(input.value).toBe("Kodak");
  });

  it("blurring closes the list and discards the search without selecting", () => {
    const { input, onSelect } = setup("Kodak");
    input.focus();
    fireEvent.change(input, { target: { value: "fuj" } });
    expect(screen.getByText("Fujifilm")).toBeInTheDocument();
    fireEvent.blur(input);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByText("Fujifilm")).not.toBeInTheDocument();
    expect(input.value).toBe("Kodak");
  });
});
